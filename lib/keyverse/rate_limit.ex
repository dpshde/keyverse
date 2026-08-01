defmodule Keyverse.RateLimit do
  @moduledoc """
  Simple sliding-window rate limiter (ETS).

  Used to keep a single multipack door healthy under medium traffic / abuse
  without external Redis. Keys are opaque strings (door, ip, global).
  """

  use GenServer

  @table :keyverse_rate_limit
  @cleanup_ms 60_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Allow at most `limit` events per `window_ms` for `key`.

  Returns `:ok` or `{:error, :rate_limited, retry_after_ms}`.
  """
  def check(key, limit, window_ms)
      when is_binary(key) and is_integer(limit) and limit > 0 and is_integer(window_ms) and
             window_ms > 0 do
    ensure_table()
    now = System.monotonic_time(:millisecond)
    cutoff = now - window_ms

    case :ets.lookup(@table, key) do
      [{^key, times}] ->
        times = Enum.filter(times, &(&1 > cutoff))

        if length(times) >= limit do
          oldest = Enum.min(times)
          retry = max(1, oldest + window_ms - now)
          Keyverse.Metrics.record(:rate_limited, 0, %{error: true})
          {:error, :rate_limited, retry}
        else
          :ets.insert(@table, {key, [now | times]})
          :ok
        end

      [] ->
        :ets.insert(@table, {key, [now]})
        :ok
    end
  rescue
    _ -> :ok
  end

  def check(_key, _limit, _window_ms), do: :ok

  @doc "Convenience: check and map to HTTP-ish error tuple."
  def allow(key, limit, window_ms) do
    case check(key, limit, window_ms) do
      :ok -> :ok
      {:error, :rate_limited, ms} -> {:error, :rate_limited, ms}
    end
  end

  def stats do
    ensure_table()
    %{keys: safe_size()}
  catch
    _, _ -> %{keys: 0}
  end

  @doc "Test helper — wipe all buckets."
  def reset! do
    ensure_table()
    :ets.delete_all_objects(@table)
    :ok
  rescue
    _ -> :ok
  end

  # --- GenServer (cleanup only) --------------------------------------------

  @impl true
  def init(_opts) do
    ensure_table()
    schedule_cleanup()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.monotonic_time(:millisecond)
    # drop entries fully outside a generous horizon (1h)
    horizon = now - 3_600_000

    try do
      :ets.safe_fixtable(@table, true)

      :ets.foldl(
        fn {key, times}, _ ->
          kept = Enum.filter(times, &(&1 > horizon))

          if kept == [] do
            :ets.delete(@table, key)
          else
            :ets.insert(@table, {key, kept})
          end

          true
        end,
        true,
        @table
      )
    after
      try do
        :ets.safe_fixtable(@table, false)
      rescue
        _ -> :ok
      end
    end

    schedule_cleanup()
    {:noreply, state}
  end

  defp schedule_cleanup, do: Process.send_after(self(), :cleanup, @cleanup_ms)

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

  defp safe_size do
    :ets.info(@table, :size) || 0
  rescue
    _ -> 0
  end
end
