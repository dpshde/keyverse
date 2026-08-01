defmodule Keyverse.Pack do
  @moduledoc "Multipack filesystem: create/open pack directories under PACK_DIR."

  alias Keyverse.{Config, Door}

  def path_for(phrase) do
    p = Door.normalize(phrase)

    cond do
      p == "" -> nil
      String.contains?(p, ["..", "/", "\\"]) -> nil
      true -> Path.join(Config.packs_root(), p)
    end
  end

  def open_path, do: Path.join(Config.packs_root(), "_open")

  def exists?(phrase) do
    case path_for(phrase) do
      nil -> false
      dir -> pack_directory?(dir)
    end
  end

  def pack_directory?(dir) do
    File.dir?(Path.join(dir, "notes")) or File.exists?(Path.join(dir, "protocol.json"))
  end

  def ensure_dirs!(dir) do
    File.mkdir_p!(Path.join(dir, "notes"))
    File.mkdir_p!(Path.join(dir, "attachments"))
    File.mkdir_p!(Path.join(Config.packs_root(), "_cache/text/bsb"))
    protocol = Path.join(dir, "protocol.json")

    unless File.exists?(protocol) do
      body =
        Jason.encode!(
          %{
            protocol: Config.protocol_name(),
            version: Config.protocol_version(),
            schemas: "schemas/"
          },
          pretty: true
        )

      File.write!(protocol, body <> "\n")
    end

    :ok
  end

  def create(phrase) do
    if Config.door_open?() do
      {:error, "this site is open without a key — nothing to create"}
    else
      p = Door.normalize(phrase)

      cond do
        not Door.valid?(p) ->
          {:error, "use 3–8 short words, e.g. quiet-river-lantern-notes"}

        exists?(p) ->
          {:error, "that key already has notes — open it from the sign-in page"}

        true ->
          dir = path_for(p)
          File.mkdir_p!(Config.packs_root())
          ensure_dirs!(dir)
          File.write!(Path.join(dir, "door"), p <> "\n")
          {:ok, p}
      end
    end
  end

  def list_doors do
    root = Config.packs_root()

    case File.ls(root) do
      {:ok, entries} ->
        entries
        |> Enum.filter(fn name ->
          not String.starts_with?(name, "_") and Door.valid?(name) and
            pack_directory?(Path.join(root, name))
        end)
        |> Enum.sort()

      _ ->
        []
    end
  end

  def notes_dir(pack_dir), do: Path.join(pack_dir, "notes")
  def attach_dir(pack_dir), do: Path.join(pack_dir, "attachments")
  def text_dir, do: Path.join(Config.packs_root(), "_cache/text/bsb")
end
