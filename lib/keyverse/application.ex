defmodule Keyverse.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    Keyverse.Config.ensure_packs_root!()

    children =
      [
        {Registry, keys: :unique, name: Keyverse.Pack.WriterRegistry},
        {DynamicSupervisor, name: Keyverse.Pack.WriterSupervisor, strategy: :one_for_one},
        Keyverse.Metrics,
        Keyverse.RateLimit,
        Keyverse.DoorIndex,
        Keyverse.TextCache
      ] ++
        if Application.get_env(:keyverse, :start_server, true) do
          [
            {Bandit,
             plug: Keyverse.Router,
             scheme: :http,
             port: Keyverse.Config.port(),
             ip: Keyverse.Config.ip()}
          ]
        else
          []
        end

    opts = [strategy: :one_for_one, name: Keyverse.Supervisor]
    result = Supervisor.start_link(children, opts)

    if Application.get_env(:keyverse, :start_server, true), do: log_boot()
    result
  end

  defp log_boot do
    host = if Keyverse.Config.host() in ["0.0.0.0", ""], do: "localhost", else: Keyverse.Config.host()
    root = "http://#{host}:#{Keyverse.Config.port()}"

    if Keyverse.Config.door_open?() do
      IO.puts("keyverse: #{root}/  (DOOR_OPEN — open access, no key)")
      IO.puts("pack on disk:   #{Path.join(Keyverse.Config.packs_root(), "_open")}")
    else
      doors = Keyverse.Pack.list_doors()
      IO.puts("keyverse multipack (Elixir): #{root}/")
      IO.puts("create:  #{root}/setup")
      IO.puts("open:    #{root}/  (enter your four-word key)")

      if doors == [] do
        IO.puts("packs:   none yet — create one at /setup")
      else
        IO.puts("packs:   #{length(doors)}  (e.g. #{root}/#{hd(doors)}/)")
      end

      boot = Keyverse.Config.boot_door()

      if boot != "" do
        IO.puts("boot key: #{boot}")
      end
    end

    IO.puts("packs root:     #{Keyverse.Config.packs_root()}")
    IO.puts("app version:    #{Keyverse.Config.app_version()}")
    IO.puts("protocol:       #{Keyverse.Config.protocol_name()} #{Keyverse.Config.protocol_version()}")
  end
end
