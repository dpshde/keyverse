defmodule Keyverse.Pack.Writer do
  @moduledoc """
  Per-pack serialized write queue.

  All mutating pack IO (note PUT/delete, attachment blob write, import) should
  go through `call/2` so concurrent requests for the same pack never interleave
  filesystem writes. Different packs run on different processes.
  """

  use GenServer

  @registry Keyverse.Pack.WriterRegistry
  @supervisor Keyverse.Pack.WriterSupervisor

  # --- API -----------------------------------------------------------------

  def child_spec(pack_dir) do
    %{
      id: {__MODULE__, pack_dir},
      start: {__MODULE__, :start_link, [pack_dir]},
      restart: :temporary
    }
  end

  def start_link(pack_dir) when is_binary(pack_dir) do
    GenServer.start_link(__MODULE__, pack_dir, name: via(pack_dir))
  end

  @doc "Run `fun` exclusively for this pack. Returns fun's result."
  def call(pack_dir, fun, timeout \\ 60_000) when is_binary(pack_dir) and is_function(fun, 0) do
    pack_dir = Path.expand(pack_dir)
    pid = ensure(pack_dir)

    result =
      Keyverse.Metrics.time(:pack_write, fn ->
        GenServer.call(pid, {:run, fun}, timeout)
      end)

    case result do
      {:writer_exception, e, stack} ->
        reraise e, stack

      {:writer_throw, kind, reason, stack} ->
        :erlang.raise(kind, reason, stack)

      other ->
        other
    end
  end

  @doc "Ensure a writer is running for pack_dir; return pid."
  def ensure(pack_dir) when is_binary(pack_dir) do
    pack_dir = Path.expand(pack_dir)

    case Registry.lookup(@registry, pack_dir) do
      [{pid, _}] ->
        if Process.alive?(pid), do: pid, else: start_writer!(pack_dir)

      [] ->
        start_writer!(pack_dir)
    end
  end

  def count do
    Registry.count(@registry)
  catch
    _, _ -> 0
  end

  def via(pack_dir), do: {:via, Registry, {@registry, Path.expand(pack_dir)}}

  # --- GenServer -----------------------------------------------------------

  @impl true
  def init(pack_dir) do
    # stop idle writers after quiet period to avoid unbounded process growth
    schedule_idle_check()
    {:ok, %{pack_dir: pack_dir, last_used: System.monotonic_time(:millisecond)}}
  end

  @impl true
  def handle_call({:run, fun}, _from, state) do
    result =
      try do
        {:ok, fun.()}
      rescue
        e -> {:error, e, __STACKTRACE__}
      catch
        kind, reason -> {:throw, kind, reason, __STACKTRACE__}
      end

    state = %{state | last_used: System.monotonic_time(:millisecond)}

    case result do
      {:ok, value} ->
        {:reply, value, state}

      {:error, e, stack} ->
        {:reply, {:writer_exception, e, stack}, state}

      {:throw, kind, reason, stack} ->
        {:reply, {:writer_throw, kind, reason, stack}, state}
    end
  end

  @impl true
  def handle_info(:idle_check, state) do
    idle_for = System.monotonic_time(:millisecond) - state.last_used
    # 5 minutes idle → stop
    if idle_for > 300_000 do
      {:stop, :normal, state}
    else
      schedule_idle_check()
      {:noreply, state}
    end
  end

  defp schedule_idle_check do
    Process.send_after(self(), :idle_check, 60_000)
  end

  defp start_writer!(pack_dir) do
    case DynamicSupervisor.start_child(@supervisor, {__MODULE__, pack_dir}) do
      {:ok, pid} -> pid
      {:error, {:already_started, pid}} -> pid
      {:error, {:already_present, _}} -> ensure(pack_dir)
      {:error, reason} -> raise "failed to start pack writer for #{pack_dir}: #{inspect(reason)}"
    end
  end
end
