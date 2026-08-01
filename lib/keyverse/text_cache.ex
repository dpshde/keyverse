defmodule Keyverse.TextCache do
  @moduledoc """
  BSB chapter text served **entirely from the app pack** (no upstream).

  Source: public-domain Berean Standard Bible (`priv/bsb/chapters.json.gz`),
  built from https://bereanbible.com/bsb.txt (see `priv/bsb/NOTICE`).

  Layers:
  1. ETS decoded chapter docs (loaded at boot from the pack)
  2. Optional legacy disk files under `packs/_cache/text/bsb/` (read-only fallback
     for older deploys; never required when the pack is present)

  There is **no** network fetch (bolls.life and friends are not used).
  """

  use GenServer

  alias Keyverse.{Metrics, Pack}

  @ets :keyverse_bsb_text
  @call_timeout 15_000

  # --- public API ----------------------------------------------------------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Return `{:ok, doc}` or `{:error, reason}` for a chapter.

  `doc` shape: `%{"translation", "book", "chapter", "verses" => [%{"v", "text"}], ...}`
  """
  def get_chapter(book_osis, chapter) when is_binary(book_osis) and is_integer(chapter) do
    key = normalize_key(book_osis, chapter)

    case ets_get(key) do
      {:ok, doc} ->
        Metrics.record(:bsb_ets_hit, 0)
        maybe_prefetch_neighbors(key)
        {:ok, doc}

      :miss ->
        # Pack should already be loaded; rare miss → try disk fallback / ensure boot.
        Metrics.time(:bsb_get, fn ->
          GenServer.call(__MODULE__, {:get, key}, @call_timeout)
        end)
        |> tap(fn
          {:ok, _} -> maybe_prefetch_neighbors(key)
          _ -> :ok
        end)
    end
  end

  def get_chapter(book_osis, chapter) when is_binary(chapter) or is_integer(chapter) do
    case Integer.parse(to_string(chapter)) do
      {n, _} -> get_chapter(to_string(book_osis), n)
      :error -> {:error, "invalid chapter"}
    end
  end

  @doc "No-op warm kept for API compatibility (neighbors already in pack/ETS)."
  def warm(book_osis, chapter) do
    _ = {book_osis, chapter}
    :ok
  end

  @doc "ETS + pack stats for metrics/health."
  def stats do
    ensure_ets()

    %{
      ets_entries: safe_ets_info(@ets, :size) || 0,
      pack_loaded: pack_loaded?(),
      pack_path: pack_path() && to_string(pack_path()),
      pending: 0
    }
  catch
    _, _ -> %{ets_entries: 0, pack_loaded: false, pack_path: nil, pending: 0}
  end

  # --- GenServer -----------------------------------------------------------

  @impl true
  def init(_opts) do
    ensure_ets()
    case load_pack_into_ets() do
      {:ok, n} ->
        IO.puts("keyverse BSB pack: loaded #{n} chapters from #{pack_path()}")
        {:ok, %{loaded: true, chapters: n}}

      {:error, reason} ->
        IO.puts("keyverse BSB pack: FAILED to load (#{inspect(reason)}) — reader text unavailable")
        {:ok, %{loaded: false, chapters: 0, error: reason}}
    end
  end

  @impl true
  def handle_call({:get, key}, _from, state) do
    reply =
      case ets_get(key) do
        {:ok, doc} ->
          {:ok, doc}

        :miss ->
          case disk_get(key) do
            {:ok, doc} ->
              ets_put(key, doc)
              Metrics.record(:bsb_disk_hit, 0)
              {:ok, doc}

            :miss ->
              {:error, "chapter not in BSB pack"}
          end
      end

    {:reply, reply, state}
  end

  def handle_call(:pending_count, _from, state), do: {:reply, 0, state}

  @impl true
  def handle_cast({:warm, _key}, state), do: {:noreply, state}

  # --- pack load -----------------------------------------------------------

  defp pack_path do
    candidates = [
      Path.join([File.cwd!(), "priv", "bsb", "chapters.json.gz"]),
      Application.app_dir(:keyverse, "priv/bsb/chapters.json.gz")
    ]

    Enum.find(candidates, &File.regular?/1)
  end

  defp pack_loaded? do
    ensure_ets()
    (safe_ets_info(@ets, :size) || 0) > 0
  end

  defp load_pack_into_ets do
    path = pack_path()

    if is_nil(path) do
      {:error, :pack_missing}
    else
      t0 = System.monotonic_time(:millisecond)

      with {:ok, gz} <- File.read(path),
           {:ok, json} <- gunzip(gz),
           {:ok, map} when is_map(map) <- Jason.decode(json) do
        count =
          Enum.reduce(map, 0, fn {slug, doc}, acc ->
            case parse_slug(slug) do
              {book, ch} when is_map(doc) ->
                ets_put({book, ch}, normalize_doc(doc, book, ch))
                acc + 1

              _ ->
                acc
            end
          end)

        dt = System.monotonic_time(:millisecond) - t0
        Metrics.record(:bsb_pack_load, dt, %{error: count == 0})
        if count == 0, do: {:error, :empty_pack}, else: {:ok, count}
      else
        {:error, _} = err -> err
        other -> {:error, {:bad_pack, other}}
      end
    end
  end

  defp gunzip(bin) when is_binary(bin) do
    try do
      # :zlib.gunzip handles gzip wrapper
      {:ok, :zlib.gunzip(bin)}
    rescue
      e -> {:error, {:gunzip, Exception.message(e)}}
    end
  end

  defp parse_slug(slug) when is_binary(slug) do
    case String.split(slug, ".", parts: 2) do
      [book, ch_s] ->
        case Integer.parse(ch_s) do
          {ch, ""} -> {String.upcase(book), ch}
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp parse_slug(_), do: nil

  defp normalize_doc(doc, book, ch) do
    verses =
      doc
      |> Map.get("verses", [])
      |> Enum.map(fn
        %{"v" => v, "text" => t} -> %{"v" => v, "text" => to_string(t)}
        %{v: v, text: t} -> %{"v" => v, "text" => to_string(t)}
        other when is_map(other) ->
          %{"v" => other["v"] || other[:v], "text" => to_string(other["text"] || other[:text] || "")}
      end)

    %{
      "translation" => doc["translation"] || "BSB",
      "book" => doc["book"] || book,
      "chapter" => doc["chapter"] || ch,
      "verses" => verses,
      "source" => doc["source"] || "priv/bsb",
      "license" => doc["license"] || "public-domain"
    }
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

  defp maybe_prefetch_neighbors(_key), do: :ok

  defp safe_ets_info(table, key) do
    :ets.info(table, key)
  rescue
    _ -> nil
  end
end
