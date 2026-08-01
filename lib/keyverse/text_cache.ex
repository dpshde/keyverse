defmodule Keyverse.TextCache do
  @moduledoc """
  Disposable BSB chapter cache.

  Layers (fast → slow):
  1. ETS decoded docs (process memory)
  2. Disk under `packs/_cache/text/bsb/<book>.<chapter>.json`
  3. Upstream bolls.life (single-flight per chapter; concurrent waiters share one fetch)

  Prefetch of adjacent chapters is fire-and-forget after a successful get.
  """

  use GenServer

  alias Keyverse.{Metrics, Note, Pack, Scope}

  @ets :keyverse_bsb_text
  @http_profile :keyverse_bsb
  @call_timeout 45_000

  # --- public API ----------------------------------------------------------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Return `{:ok, doc}` or `{:error, reason}` for a chapter.

  `doc` shape: `%{\"translation\", \"book\", \"chapter\", \"verses\" => [%{\"v\", \"text\"}], \"fetched_at\"}`
  """
  def get_chapter(book_osis, chapter) when is_binary(book_osis) and is_integer(chapter) do
    key = normalize_key(book_osis, chapter)

    case ets_get(key) do
      {:ok, doc} ->
        Metrics.record(:bsb_ets_hit, 0)
        maybe_prefetch_neighbors(key)
        {:ok, doc}

      :miss ->
        Metrics.time(:bsb_get, fn ->
          GenServer.call(__MODULE__, {:get, key}, @call_timeout)
        end)
        |> tap(fn
          {:ok, _} -> maybe_prefetch_neighbors(key)
          _ -> :ok
        end)
    end
  end

  def get_chapter(book_osis, chapter) when is_binary(chapter) do
    case Integer.parse(to_string(chapter)) do
      {n, _} -> get_chapter(book_osis, n)
      :error -> {:error, "invalid chapter"}
    end
  end

  @doc "Warm a chapter into ETS/disk without blocking the caller."
  def warm(book_osis, chapter) do
    key = normalize_key(book_osis, chapter)

    case ets_get(key) do
      {:ok, _} -> :ok
      :miss -> GenServer.cast(__MODULE__, {:warm, key})
    end
  end

  @doc "ETS + pending stats for metrics/health."
  def stats do
    ensure_ets()

    %{
      ets_entries: safe_ets_info(@ets, :size) || 0,
      pending: GenServer.call(__MODULE__, :pending_count, 5_000)
    }
  catch
    _, _ -> %{ets_entries: 0, pending: 0}
  end

  # --- GenServer -----------------------------------------------------------

  @impl true
  def init(_opts) do
    ensure_ets()
    ensure_http_profile()
    {:ok, %{pending: %{}}}
  end

  @impl true
  def handle_call({:get, key}, from, state) do
    case ets_get(key) do
      {:ok, doc} ->
        {:reply, {:ok, doc}, state}

      :miss ->
        case disk_get(key) do
          {:ok, doc} ->
            ets_put(key, doc)
            Metrics.record(:bsb_disk_hit, 0)
            {:reply, {:ok, doc}, state}

          :miss ->
            case Map.get(state.pending, key) do
              nil ->
                me = self()

                Task.start(fn ->
                  result = fetch_upstream(key)
                  GenServer.cast(me, {:fetch_done, key, result})
                end)

                {:noreply, %{state | pending: Map.put(state.pending, key, [from])}}

              waiters ->
                {:noreply, %{state | pending: Map.put(state.pending, key, [from | waiters])}}
            end
        end
    end
  end

  def handle_call(:pending_count, _from, state) do
    {:reply, map_size(state.pending), state}
  end

  @impl true
  def handle_cast({:warm, key}, state) do
    case ets_get(key) do
      {:ok, _} ->
        {:noreply, state}

      :miss ->
        case disk_get(key) do
          {:ok, doc} ->
            ets_put(key, doc)
            {:noreply, state}

          :miss ->
            if Map.has_key?(state.pending, key) do
              {:noreply, state}
            else
              me = self()

              Task.start(fn ->
                result = fetch_upstream(key)
                GenServer.cast(me, {:fetch_done, key, result})
              end)

              # no waiters — warm only
              {:noreply, %{state | pending: Map.put(state.pending, key, [])}}
            end
        end
    end
  end

  def handle_cast({:fetch_done, key, result}, state) do
    waiters = Map.get(state.pending, key, [])

    case result do
      {:ok, doc} ->
        ets_put(key, doc)
        path = disk_path(key)
        write_disk(path, doc)
        Enum.each(waiters, &GenServer.reply(&1, {:ok, doc}))

      {:error, _} = err ->
        Enum.each(waiters, &GenServer.reply(&1, err))
    end

    {:noreply, %{state | pending: Map.delete(state.pending, key)}}
  end

  # --- internals -----------------------------------------------------------

  defp normalize_key(book_osis, chapter) do
    book = book_osis |> to_string() |> String.upcase()
    {book, chapter}
  end

  defp ensure_ets do
    case :ets.whereis(@ets) do
      :undefined ->
        :ets.new(@ets, [
          :named_table,
          :public,
          :set,
          read_concurrency: true,
          write_concurrency: true
        ])

      _ ->
        @ets
    end
  end

  defp ets_get(key) do
    ensure_ets()

    case :ets.lookup(@ets, key) do
      [{^key, doc}] -> {:ok, doc}
      [] -> :miss
    end
  rescue
    _ -> :miss
  end

  defp ets_put(key, doc) do
    ensure_ets()
    :ets.insert(@ets, {key, doc})
    :ok
  rescue
    _ -> :ok
  end

  defp disk_path({book, chapter}) do
    Path.join(Pack.text_dir(), "#{String.downcase(book)}.#{chapter}.json")
  end

  defp disk_get(key) do
    path = disk_path(key)

    case File.read(path) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, doc} when is_map(doc) -> {:ok, doc}
          _ -> :miss
        end

      _ ->
        :miss
    end
  end

  defp write_disk(path, doc) do
    File.mkdir_p!(Path.dirname(path))
    # compact JSON — smaller + faster decode than pretty
    File.write!(path, Jason.encode!(doc) <> "\n")
  rescue
    _ -> :ok
  end

  defp fetch_upstream({book, chapter} = key) do
    t0 = System.monotonic_time(:microsecond)
    order = Scope.book_order(book)

    result =
      if is_nil(order) do
        {:error, "unknown book"}
      else
        url = "https://bolls.life/get-text/BSB/#{order}/#{chapter}/"

        case http_get(url) do
          {:ok, raw} when is_list(raw) ->
            doc = %{
              "translation" => "BSB",
              "book" => book,
              "chapter" => chapter,
              "verses" =>
                Enum.map(raw, fn v ->
                  text =
                    v
                    |> Map.get("text", "")
                    |> to_string()
                    |> String.replace(~r/<[^>]+>/, "")
                    |> String.trim()

                  %{"v" => v["verse"], "text" => text}
                end),
              "fetched_at" => Note.iso_now()
            }

            {:ok, doc}

          {:ok, _} ->
            {:error, "unexpected BSB payload"}

          {:error, reason} ->
            {:error, reason}
        end
      end

    dt = (System.monotonic_time(:microsecond) - t0) / 1000
    err? = match?({:error, _}, result)
    Metrics.record(:bsb_fetch, dt, %{error: err?, key: inspect(key)})
    result
  end

  defp ensure_http_profile do
    :inets.start()
    :ssl.start()

    case :inets.start(:httpc, profile: @http_profile) do
      {:ok, _} -> :ok
      {:error, {:already_started, _}} -> :ok
      {:error, :already_started} -> :ok
      _ -> :ok
    end

    # Keep-alive pool toward bolls.life — avoids full TCP/TLS setup per miss.
    _ =
      :httpc.set_options(
        [
          max_sessions: 8,
          max_keep_alive_length: 16,
          keep_alive_timeout: 120_000,
          max_pipeline_length: 0
        ],
        @http_profile
      )

    :ok
  rescue
    _ -> :ok
  end

  defp http_get(url) do
    ensure_http_profile()

    headers = [
      {~c"user-agent", ~c"keyverse/0.2"},
      {~c"accept", ~c"application/json"}
    ]

    request = {String.to_charlist(url), headers}

    http_opts = [
      timeout: 20_000,
      connect_timeout: 8_000,
      ssl: [
        verify: :verify_peer,
        cacerts: :public_key.cacerts_get(),
        depth: 3,
        customize_hostname_check: [
          match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
        ]
      ]
    ]

    opts = [body_format: :binary, full_result: true]

    case :httpc.request(:get, request, http_opts, opts, @http_profile) do
      {:ok, {{_, 200, _}, _, body}} ->
        Jason.decode(body)

      {:ok, {{_, code, _}, _, _}} ->
        {:error, "BSB fetch failed: #{code}"}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp maybe_prefetch_neighbors({book, chapter}) do
    # fire-and-forget next (and prev if > 1) — hides latency on swipe/advance
    warm(book, chapter + 1)
    if chapter > 1, do: warm(book, chapter - 1)
    :ok
  catch
    _, _ -> :ok
  end

  defp safe_ets_info(table, key) do
    :ets.info(table, key)
  rescue
    _ -> nil
  end

  # Elixir 1.12+ has tap/2; provide local if needed — 1.15 has it.
end
