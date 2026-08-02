defmodule Keyverse.DoorIndex do
  @moduledoc """
  Multiword key → opaque pack_id bindings.

  Humans use multiword URLs (`/{phrase}/…`). On disk, packs live at
  `packs/<pack_id>/` where `pack_id` is a stable opaque id. The index under
  `packs/_doors/` is the rotatable control plane.
  """

  use GenServer

  alias Keyverse.{Config, Door, Pack}

  @registry_table :keyverse_door_index

  # --- public API ----------------------------------------------------------

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Resolve a multiword phrase to pack binding + directory."
  def resolve(phrase) do
    p = Door.normalize(phrase)

    cond do
      p == "" or not Door.valid?(p) ->
        :error

      true ->
        case lookup_binding(p) do
          {:ok, binding} ->
            dir = Pack.dir_for_id(binding.pack_id)

            if Pack.pack_directory?(dir) do
              {:ok,
               %{
                 phrase: p,
                 pack_id: binding.pack_id,
                 role: binding.role,
                 pack_dir: dir,
                 via: :index
               }}
            else
              :error
            end

          :error ->
            # Legacy: pack directory named after the multiword phrase
            legacy = Path.join(Config.packs_root(), p)

            if Pack.pack_directory?(legacy) and not pack_id_name?(p) do
              {:ok,
               %{
                 phrase: p,
                 pack_id: p,
                 role: "write",
                 pack_dir: legacy,
                 via: :legacy
               }}
            else
              :error
            end
        end
    end
  end

  def exists?(phrase) do
    match?({:ok, _}, resolve(phrase))
  end

  @doc "Reload bindings from disk (tests when packs_root changes)."
  def reload! do
    GenServer.call(__MODULE__, :reload, 15_000)
  end

  @doc "Create a new pack with opaque id and multiword write binding."
  def create(phrase) do
    if Config.door_open?() do
      {:error, "this site is open without a key — nothing to create"}
    else
      GenServer.call(__MODULE__, {:create, phrase}, 30_000)
    end
  end

  @doc "Issue a new multiword write key for an existing pack; revoke old key."
  def rotate(pack_id, old_phrase) do
    GenServer.call(__MODULE__, {:rotate, pack_id, old_phrase}, 30_000)
  end

  @doc "List active multiword doors (for ops / boot log)."
  def list_phrases do
    ensure_loaded()
    root = doors_root()
    by_key = Path.join(root, "by_key")

    phrases =
      case File.ls(by_key) do
        {:ok, files} ->
          files
          |> Enum.filter(&String.ends_with?(&1, ".json"))
          |> Enum.map(fn f ->
            case read_json(Path.join(by_key, f)) do
              {:ok, %{"key" => _k, "revoked" => true}} -> nil
              {:ok, %{"key" => k}} -> k
              _ -> nil
            end
          end)
          |> Enum.reject(&is_nil/1)

        _ ->
          []
      end

    legacy =
      Pack.list_legacy_doors()
      |> Enum.reject(fn p -> Enum.member?(phrases, p) end)

    (phrases ++ legacy) |> Enum.uniq() |> Enum.sort()
  end

  def pack_id_name?(name) when is_binary(name) do
    String.match?(name, ~r/^p_[a-f0-9]{16,64}$/)
  end

  def pack_id_name?(_), do: false

  def new_pack_id do
    "p_" <> Base.encode16(:crypto.strong_rand_bytes(16), case: :lower)
  end

  def key_hash(phrase) do
    p = Door.normalize(phrase)
    :crypto.hash(:sha256, "keyverse-door-v1:" <> p) |> Base.encode16(case: :lower)
  end

  # --- GenServer -----------------------------------------------------------

  @impl true
  def init(_opts) do
    ensure_dirs!()
    ensure_table()
    load_all_into_ets()
    {:ok, %{}}
  end

  @impl true
  def handle_call(:reload, _from, state) do
    ensure_dirs!()
    ensure_table()
    :ets.delete_all_objects(@registry_table)
    load_all_into_ets()
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:create, phrase}, _from, state) do
    result = do_create(phrase)
    {:reply, result, state}
  end

  @impl true
  def handle_call({:rotate, pack_id, old_phrase}, _from, state) do
    result = do_rotate(pack_id, old_phrase)
    {:reply, result, state}
  end

  # --- impl ----------------------------------------------------------------

  defp do_create(phrase) do
    p = Door.normalize(phrase)

    cond do
      not Door.valid?(p) ->
        {:error, "use 3–8 short words, e.g. quiet-river-lantern-notes"}

      exists?(p) ->
        {:error, "that key already has notes — open it from the sign-in page"}

      true ->
        pack_id = new_pack_id()
        dir = Pack.dir_for_id(pack_id)
        File.mkdir_p!(Config.packs_root())
        Pack.ensure_dirs!(dir, pack_id: pack_id)
        File.write!(Path.join(dir, "door"), p <> "\n")

        binding = %{
          "key" => p,
          "pack_id" => pack_id,
          "role" => "write",
          "created_at" => iso_now(),
          "kid" => new_kid()
        }

        case write_binding(binding) do
          :ok ->
            put_ets(p, binding)
            {:ok, p}

          {:error, _} = err ->
            File.rm_rf(dir)
            err
        end
    end
  end

  defp do_rotate(pack_id, old_phrase) when is_binary(pack_id) do
    old = Door.normalize(old_phrase)

    case lookup_binding(old) do
      {:ok, binding} ->
        same_pack? = binding.pack_id == pack_id or binding.pack_id == old

        cond do
          not same_pack? ->
            {:error, "cannot rotate this key"}

          binding.role not in ["write", :write] ->
            {:error, "cannot rotate this key"}

          true ->
            real_id =
              if pack_id_name?(to_string(binding.pack_id)) do
                binding.pack_id
              else
                promote_legacy_pack!(old)
              end

            new_phrase = unique_phrase()

            new_binding = %{
              "key" => new_phrase,
              "pack_id" => real_id,
              "role" => "write",
              "created_at" => iso_now(),
              "kid" => new_kid(),
              "rotated_from" => key_hash(old)
            }

            case write_binding(new_binding) do
              :ok ->
                revoke_binding(old)
                put_ets(new_phrase, new_binding)
                delete_ets(old)
                dir = Pack.dir_for_id(real_id)
                File.write!(Path.join(dir, "door"), new_phrase <> "\n")
                {:ok, %{door: new_phrase, pack_id: real_id, old_door: old}}

              err ->
                err
            end
        end

      :error ->
        {:error, "cannot rotate this key"}
    end
  end

  defp promote_legacy_pack!(phrase) do
    p = Door.normalize(phrase)
    legacy = Path.join(Config.packs_root(), p)

    if Pack.pack_directory?(legacy) and not pack_id_name?(p) do
      pack_id = new_pack_id()
      dest = Pack.dir_for_id(pack_id)

      case File.rename(legacy, dest) do
        :ok ->
          Pack.ensure_dirs!(dest, pack_id: pack_id)
          pack_id

        {:error, _} ->
          # cross-device fallback: copy
          File.cp_r!(legacy, dest)
          File.rm_rf!(legacy)
          Pack.ensure_dirs!(dest, pack_id: pack_id)
          pack_id
      end
    else
      p
    end
  end

  defp unique_phrase do
    Enum.find_value(1..20, fn _ ->
      cand = Door.generate()
      if exists?(cand), do: nil, else: cand
    end) || Door.generate() <> "-x" <> Integer.to_string(System.unique_integer([:positive]))
  end

  defp lookup_binding(phrase) do
    p = Door.normalize(phrase)
    ensure_loaded()

    case :ets.lookup(@registry_table, p) do
      [{^p, binding}] ->
        {:ok, atomize_binding(binding)}

      [] ->
        case read_binding_file(p) do
          {:ok, %{"revoked" => true}} ->
            :error

          {:ok, binding} ->
            put_ets(p, binding)
            {:ok, atomize_binding(binding)}

          :error ->
            :error
        end
    end
  end

  defp atomize_binding(b) when is_map(b) do
    %{
      phrase: b["key"] || b[:key],
      pack_id: b["pack_id"] || b[:pack_id],
      role: to_string(b["role"] || b[:role] || "write"),
      kid: b["kid"] || b[:kid]
    }
  end

  defp write_binding(%{"key" => key, "pack_id" => pack_id} = binding) do
    ensure_dirs!()
    hash = key_hash(key)
    path = Path.join([doors_root(), "by_key", hash <> ".json"])
    body = Jason.encode!(binding, pretty: true)

    case File.write(path, body <> "\n") do
      :ok ->
        append_pack_key!(pack_id, hash, binding)
        :ok

      {:error, r} ->
        {:error, r}
    end
  end

  defp revoke_binding(phrase) do
    p = Door.normalize(phrase)
    hash = key_hash(p)
    path = Path.join([doors_root(), "by_key", hash <> ".json"])

    case read_json(path) do
      {:ok, binding} ->
        binding =
          binding
          |> Map.put("revoked", true)
          |> Map.put("revoked_at", iso_now())

        File.write!(path, Jason.encode!(binding, pretty: true) <> "\n")
        delete_ets(p)
        :ok

      _ ->
        :ok
    end
  end

  defp append_pack_key!(pack_id, hash, binding) do
    path = Path.join([doors_root(), "by_pack", pack_id <> ".json"])

    existing =
      case read_json(path) do
        {:ok, %{"keys" => keys}} when is_list(keys) -> keys
        _ -> []
      end

    entry = %{
      "key_hash" => hash,
      "role" => binding["role"],
      "kid" => binding["kid"],
      "created_at" => binding["created_at"]
    }

    keys = [entry | Enum.reject(existing, &(&1["key_hash"] == hash))]
    body = Jason.encode!(%{"pack_id" => pack_id, "keys" => keys}, pretty: true)
    File.write!(path, body <> "\n")
  end

  defp read_binding_file(phrase) do
    path = Path.join([doors_root(), "by_key", key_hash(phrase) <> ".json"])
    read_json(path)
  end

  defp read_json(path) do
    case File.read(path) do
      {:ok, raw} ->
        case Jason.decode(raw) do
          {:ok, map} when is_map(map) -> {:ok, map}
          _ -> :error
        end

      _ ->
        :error
    end
  end

  defp doors_root, do: Path.join(Config.packs_root(), "_doors")

  defp ensure_dirs! do
    File.mkdir_p!(Path.join(doors_root(), "by_key"))
    File.mkdir_p!(Path.join(doors_root(), "by_pack"))
  end

  defp ensure_table do
    case :ets.whereis(@registry_table) do
      :undefined ->
        :ets.new(@registry_table, [:named_table, :public, :set, read_concurrency: true])

      _ ->
        @registry_table
    end
  end

  defp ensure_loaded do
    ensure_table()
    :ok
  end

  defp load_all_into_ets do
    by_key = Path.join(doors_root(), "by_key")

    case File.ls(by_key) do
      {:ok, files} ->
        Enum.each(files, fn f ->
          if String.ends_with?(f, ".json") do
            case read_json(Path.join(by_key, f)) do
              {:ok, %{"key" => _k, "revoked" => true}} ->
                :ok

              {:ok, %{"key" => k} = b} ->
                put_ets(k, b)

              _ ->
                :ok
            end
          end
        end)

      _ ->
        :ok
    end
  end

  defp put_ets(phrase, binding) do
    ensure_table()
    :ets.insert(@registry_table, {Door.normalize(phrase), stringify_keys(binding)})
  end

  defp delete_ets(phrase) do
    ensure_table()
    :ets.delete(@registry_table, Door.normalize(phrase))
  rescue
    _ -> :ok
  end

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end

  defp iso_now do
    DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
  end

  defp new_kid do
    Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)
  end
end
