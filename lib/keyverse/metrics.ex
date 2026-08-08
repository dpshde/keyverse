defmodule Keyverse.Metrics do
  @moduledoc """
  Lightweight in-process metrics for the multipack door.

  Tracks request counts, error counts, and rolling latency samples (ms) per op.
  Exposed via `GET /metrics` and summarized on `GET /health`.
  """

  use GenServer

  @table :keyverse_metrics
  @sample_limit 256
  @ops [
    :http_health,
    :http_get_note,
    :http_put_note,
    :http_list_notes,
    :http_attach,
    :http_export,
    :http_import,
    :http_other,
    :pack_write,
    :bsb_get,
    :bsb_pack_load,
    :bsb_ets_hit,
    :bsb_disk_hit,
    :http_text,
    :http_read_bundle,
    :http_chapter_md,
    :rate_limited,
    :quota_reject
  ]

  # --- public API ----------------------------------------------------------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Record a completed operation latency in milliseconds."
  def record(op, ms, meta \\ %{}) when is_atom(op) and is_number(ms) do
    ensure_table()
    op = normalize_op(op)
    ms_i = ms |> max(0) |> round()

    :ets.update_counter(@table, {:count, op}, {2, 1}, {{:count, op}, 0})

    if meta[:error] do
      :ets.update_counter(@table, {:error, op}, {2, 1}, {{:error, op}, 0})
    end

    case :ets.lookup(@table, {:samples, op}) do
      [{{:samples, ^op}, list}] ->
        list = [ms_i | list] |> Enum.take(@sample_limit)
        :ets.insert(@table, {{:samples, op}, list})

      [] ->
        :ets.insert(@table, {{:samples, op}, [ms_i]})
    end

    :ok
  catch
    _, _ -> :ok
  end

  @doc "Time a function and record under op. Returns fun result."
  def time(op, fun, meta \\ %{}) when is_function(fun, 0) do
    t0 = System.monotonic_time(:microsecond)

    try do
      result = fun.()
      dt_ms = (System.monotonic_time(:microsecond) - t0) / 1000
      error? = match?({:error, _}, result) or match?({:error, _, _}, result)
      record(op, dt_ms, Map.put(meta, :error, error? or meta[:error]))
      result
    rescue
      e ->
        dt_ms = (System.monotonic_time(:microsecond) - t0) / 1000
        record(op, dt_ms, Map.put(meta, :error, true))
        reraise e, __STACKTRACE__
    end
  end

  def snapshot do
    ensure_table()
    boot = boot_ms()

    ops =
      Map.new(@ops, fn op ->
        count = lookup_counter({:count, op})
        errors = lookup_counter({:error, op})
        samples = lookup_samples(op)

        {op,
         %{
           count: count,
           errors: errors,
           latency_ms: percentile_summary(samples)
         }}
      end)

    %{
      service: "keyverse",
      protocol: Keyverse.Config.protocol_name(),
      protocol_version: Keyverse.Config.protocol_version(),
      host: "elixir",
      app_version: Keyverse.Config.app_version(),
      uptime_ms: boot,
      packs_root: Keyverse.Config.packs_root(),
      pack_count: safe_pack_count(),
      volume: volume_stats(),
      writers: Keyverse.Pack.Writer.count(),
      ops: ops
    }
  end

  @doc "Clear counters/samples (tests only)."
  def reset do
    ensure_table()

    for op <- @ops do
      :ets.delete(@table, {:count, op})
      :ets.delete(@table, {:error, op})
      :ets.delete(@table, {:samples, op})
    end

    :ok
  end

  def health_summary do
    snap = snapshot()
    put = snap.ops[:http_put_note] || %{}
    get = snap.ops[:http_get_note] || %{}
    bsb = snap.ops[:bsb_get] || %{}
    rate = snap.ops[:rate_limited] || %{}
    quota = snap.ops[:quota_reject] || %{}
    bsb_stats = Keyverse.TextCache.stats()
    rl = Keyverse.RateLimit.stats()

    %{
      uptime_ms: snap.uptime_ms,
      pack_count: snap.pack_count,
      writers: snap.writers,
      put_p95_ms: get_in(put, [:latency_ms, :p95]),
      get_p95_ms: get_in(get, [:latency_ms, :p95]),
      put_count: put[:count] || 0,
      get_count: get[:count] || 0,
      bsb_get_p95_ms: get_in(bsb, [:latency_ms, :p95]),
      bsb_get_count: bsb[:count] || 0,
      bsb_ets: bsb_stats.ets_entries,
      bsb_pack: bsb_stats.pack_loaded,
      rate_limited_count: rate[:count] || 0,
      quota_reject_count: quota[:count] || 0,
      rate_limit_keys: rl.keys,
      limits: %{
        max_attach_bytes: Keyverse.Config.max_attach_bytes(),
        max_pack_attach_bytes: Keyverse.Config.max_pack_attach_bytes(),
        max_pack_attach_count: Keyverse.Config.max_pack_attach_count()
      }
    }
  end

  # --- GenServer -----------------------------------------------------------

  @impl true
  def init(_opts) do
    ensure_table()
    :ets.insert(@table, {:boot_mono_ms, System.monotonic_time(:millisecond)})
    {:ok, %{}}
  end

  # --- internals -----------------------------------------------------------

  defp ensure_table do
    case :ets.whereis(@table) do
      :undefined ->
        :ets.new(@table, [
          :named_table,
          :public,
          :set,
          read_concurrency: true,
          write_concurrency: true
        ])

      _ ->
        @table
    end
  end

  defp normalize_op(op) when op in @ops, do: op
  defp normalize_op(_), do: :http_other

  defp lookup_counter(key) do
    case :ets.lookup(@table, key) do
      [{^key, n}] -> n
      _ -> 0
    end
  end

  defp lookup_samples(op) do
    case :ets.lookup(@table, {:samples, op}) do
      [{{:samples, ^op}, list}] when is_list(list) -> list
      _ -> []
    end
  end

  defp boot_ms do
    case :ets.lookup(@table, :boot_mono_ms) do
      [{:boot_mono_ms, t0}] -> max(0, System.monotonic_time(:millisecond) - t0)
      _ -> 0
    end
  end

  defp percentile_summary([]), do: %{n: 0}

  defp percentile_summary(samples) do
    s = Enum.sort(samples)
    n = length(s)

    %{
      n: n,
      min: hd(s),
      p50: percentile(s, 50),
      p95: percentile(s, 95),
      p99: percentile(s, 99),
      max: List.last(s)
    }
  end

  defp percentile(sorted, p) do
    n = length(sorted)
    idx = min(n - 1, max(0, round((p / 100) * (n - 1))))
    Enum.at(sorted, idx)
  end

  defp safe_pack_count do
    length(Keyverse.Pack.list_doors())
  catch
    _, _ -> 0
  end

  defp volume_stats do
    root = Keyverse.Config.packs_root()

    case File.stat(root) do
      {:ok, _} ->
        {bytes, files} = du_user_data(root)

        %{
          packs_root: root,
          user_data_bytes: bytes,
          user_data_files: files
        }

      _ ->
        %{packs_root: root, user_data_bytes: 0, user_data_files: 0}
    end
  end

  defp du_user_data(root) do
    # Sum notes/ + attachments/ under each pack; skip _cache
    case File.ls(root) do
      {:ok, names} ->
        Enum.reduce(names, {0, 0}, fn name, {b, f} ->
          if String.starts_with?(name, "_") do
            {b, f}
          else
            pack = Path.join(root, name)

            if File.dir?(pack) do
              {b2, f2} = du_dir(Path.join(pack, "notes"))
              {b3, f3} = du_dir(Path.join(pack, "attachments"))
              {b + b2 + b3, f + f2 + f3}
            else
              {b, f}
            end
          end
        end)

      _ ->
        {0, 0}
    end
  end

  defp du_dir(dir) do
    if File.dir?(dir) do
      dir
      |> Path.join("**")
      |> Path.wildcard(match_dot: false)
      |> Enum.reduce({0, 0}, fn path, {b, f} ->
        case File.stat(path) do
          {:ok, %{type: :regular, size: s}} -> {b + s, f + 1}
          _ -> {b, f}
        end
      end)
    else
      {0, 0}
    end
  end
end
