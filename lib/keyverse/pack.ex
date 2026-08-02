defmodule Keyverse.Pack do
  @moduledoc """
  Multipack filesystem under PACK_DIR.

  New packs use opaque ids (`p_<hex>`) on disk. Multiword keys resolve through
  `Keyverse.DoorIndex`. Legacy multipacks that used the multiword path as the
  directory name still open until rotated.
  """

  alias Keyverse.{Config, Door, DoorIndex}

  def dir_for_id(pack_id) when is_binary(pack_id) do
    id = pack_id |> String.trim() |> String.downcase()

    cond do
      id == "" -> nil
      String.contains?(id, ["..", "/", "\\"]) -> nil
      true -> Path.join(Config.packs_root(), id)
    end
  end

  @doc "Resolve multiword (or legacy) door to pack directory. Prefer DoorIndex.resolve/1."
  def path_for(phrase) do
    case DoorIndex.resolve(phrase) do
      {:ok, %{pack_dir: dir}} -> dir
      :error -> nil
    end
  end

  def open_path, do: Path.join(Config.packs_root(), "_open")

  def exists?(phrase), do: DoorIndex.exists?(phrase)

  def pack_directory?(dir) when is_binary(dir) do
    File.dir?(Path.join(dir, "notes")) or File.exists?(Path.join(dir, "protocol.json"))
  end

  def pack_directory?(_), do: false

  def ensure_dirs!(dir, opts \\ []) do
    File.mkdir_p!(Path.join(dir, "notes"))
    File.mkdir_p!(Path.join(dir, "attachments"))
    File.mkdir_p!(Path.join(Config.packs_root(), "_cache/text/bsb"))
    protocol = Path.join(dir, "protocol.json")
    pack_id = Keyword.get(opts, :pack_id)

    meta = %{
      "protocol" => Config.protocol_name(),
      "version" => Config.protocol_version(),
      "schemas" => "schemas/"
    }

    meta =
      if is_binary(pack_id) and pack_id != "" do
        Map.put(meta, "pack_id", pack_id)
      else
        meta
      end

    cond do
      not File.exists?(protocol) ->
        File.write!(protocol, Jason.encode!(meta, pretty: true) <> "\n")

      is_binary(pack_id) and pack_id != "" ->
        case File.read(protocol) do
          {:ok, raw} ->
            case Jason.decode(raw) do
              {:ok, map} when is_map(map) ->
                if map["pack_id"] == pack_id do
                  :ok
                else
                  File.write!(
                    protocol,
                    Jason.encode!(Map.put(map, "pack_id", pack_id), pretty: true) <> "\n"
                  )
                end

              _ ->
                :ok
            end

          _ ->
            :ok
        end

      true ->
        :ok
    end

    :ok
  end

  def create(phrase), do: DoorIndex.create(phrase)

  def list_doors, do: DoorIndex.list_phrases()

  @doc "Legacy multipack dirs named with multiword phrases (pre opaque id)."
  def list_legacy_doors do
    root = Config.packs_root()

    case File.ls(root) do
      {:ok, entries} ->
        entries
        |> Enum.filter(fn name ->
          not String.starts_with?(name, "_") and not DoorIndex.pack_id_name?(name) and
            Door.valid?(name) and pack_directory?(Path.join(root, name))
        end)
        |> Enum.sort()

      _ ->
        []
    end
  end

  def read_pack_id(pack_dir) when is_binary(pack_dir) do
    protocol = Path.join(pack_dir, "protocol.json")

    case File.read(protocol) do
      {:ok, raw} ->
        case Jason.decode(raw) do
          {:ok, %{"pack_id" => id}} when is_binary(id) and id != "" -> id
          _ -> Path.basename(pack_dir)
        end

      _ ->
        Path.basename(pack_dir)
    end
  end

  def notes_dir(pack_dir), do: Path.join(pack_dir, "notes")
  def attach_dir(pack_dir), do: Path.join(pack_dir, "attachments")
  def text_dir, do: Path.join(Config.packs_root(), "_cache/text/bsb")
end
