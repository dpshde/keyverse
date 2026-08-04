defmodule Keyverse.Config do
  @moduledoc "Runtime configuration for the multipack door."

  def port, do: Application.get_env(:keyverse, :port, 4180)

  def host, do: Application.get_env(:keyverse, :host, "0.0.0.0")

  def ip do
    case host() do
      "0.0.0.0" ->
        {0, 0, 0, 0}

      "127.0.0.1" ->
        {127, 0, 0, 1}

      "::" ->
        {0, 0, 0, 0, 0, 0, 0, 0}

      other ->
        case :inet.parse_address(String.to_charlist(other)) do
          {:ok, addr} -> addr
          _ -> {0, 0, 0, 0}
        end
    end
  end

  def packs_root do
    root = Application.get_env(:keyverse, :packs_root) || Path.expand("packs")
    Path.expand(root)
  end

  def door_open?, do: Application.get_env(:keyverse, :door_open, false) == true

  def boot_door do
    Application.get_env(:keyverse, :boot_door, "")
    |> to_string()
    |> Keyverse.Door.normalize()
  end

  def max_attach_bytes, do: Application.get_env(:keyverse, :max_attach_bytes, 50 * 1024 * 1024)

  def max_attach_per_note,
    do: Application.get_env(:keyverse, :max_attach_per_note, 80)

  def max_import_bytes,
    do: Application.get_env(:keyverse, :max_import_bytes, 200 * 1024 * 1024)

  # Per-pack budgets (shared volume protection)
  def max_pack_attach_bytes,
    do: Application.get_env(:keyverse, :max_pack_attach_bytes, 1 * 1024 * 1024 * 1024)

  def max_pack_attach_count,
    do: Application.get_env(:keyverse, :max_pack_attach_count, 2_000)

  # Rate limits: {limit, window_ms}
  def rate_attach, do: Application.get_env(:keyverse, :rate_attach, {60, 60_000})
  def rate_import, do: Application.get_env(:keyverse, :rate_import, {6, 3_600_000})
  def rate_put_note, do: Application.get_env(:keyverse, :rate_put_note, {180, 60_000})
  def rate_setup, do: Application.get_env(:keyverse, :rate_setup, {20, 3_600_000})
  def rate_global_write, do: Application.get_env(:keyverse, :rate_global_write, {600, 60_000})

  def cors_origin, do: Application.get_env(:keyverse, :cors_origin)

  def fathom_site do
    case Application.get_env(:keyverse, :fathom_site, "EMYGRIAR") do
      v when v in ["off", "0", "false", "no", ""] -> ""
      nil -> "EMYGRIAR"
      other -> to_string(other) |> String.trim()
    end
  end

  def protocol_name, do: "keyverse"

  # Pack format version (0.3 = append-only op log under ops/, ADR 0020).
  # Additive vs 0.2 and 0.1-demo: clients MUST ignore unknown keys.
  def protocol_version, do: "0.3"

  def app_version do
    Application.spec(:keyverse, :vsn) |> to_string()
  end

  def static_dir do
    # Prefer repo priv during mix run / tests so new static files are served
    # without requiring a full release copy into _build.
    candidates = [
      Path.join([File.cwd!(), "priv", "static"]),
      Application.app_dir(:keyverse, "priv/static")
    ]

    Enum.find(candidates, &File.dir?/1) || List.first(candidates)
  end

  def words_path do
    candidates = [
      Path.join(File.cwd!(), "words-door.txt"),
      Path.expand("words-door.txt"),
      Application.app_dir(:keyverse, "priv/words-door.txt")
    ]

    Enum.find(candidates, &File.exists?/1) || List.first(candidates)
  end

  def ensure_packs_root! do
    File.mkdir_p!(packs_root())
    File.mkdir_p!(Path.join(packs_root(), "_cache/text/bsb"))

    if door_open?() do
      Keyverse.Pack.ensure_dirs!(Path.join(packs_root(), "_open"))
    end

    boot = boot_door()

    if boot != "" and Keyverse.Door.valid?(boot) and not Keyverse.Pack.exists?(boot) do
      case Keyverse.Pack.create(boot) do
        {:ok, _} -> IO.puts("created boot pack: #{boot}")
        {:error, reason} -> IO.puts("boot pack error: #{inspect(reason)}")
      end
    end

    :ok
  end
end
