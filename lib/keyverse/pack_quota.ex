defmodule Keyverse.PackQuota do
  @moduledoc """
  Per-pack attachment storage budgets.

  Scans `pack/attachments/` (CAS files). Deduped re-uploads of an existing
  sha do not consume additional quota. Enforced on the write path so a single
  door cannot fill the shared volume under medium traffic.
  """

  alias Keyverse.{Config, Pack}

  defmodule Error do
    defexception [:reason, :usage]

    @impl true
    def message(%__MODULE__{reason: reason, usage: usage}) do
      Keyverse.PackQuota.error_message(reason, usage)
    end
  end

  @doc "Return `%{bytes, count, max_bytes, max_count, ...}` for a pack."
  def usage(pack_dir) when is_binary(pack_dir) do
    dir = Pack.attach_dir(pack_dir)
    {bytes, count} = du_attachments(dir)

    %{
      bytes: bytes,
      count: count,
      max_bytes: Config.max_pack_attach_bytes(),
      max_count: Config.max_pack_attach_count(),
      bytes_remaining: max(0, Config.max_pack_attach_bytes() - bytes),
      count_remaining: max(0, Config.max_pack_attach_count() - count)
    }
  end

  @doc """
  Check whether adding `add_bytes` for a blob is allowed.

  If the CAS object already exists, always OK (no new bytes).
  """
  def check_add_blob(pack_dir, sha, add_bytes)
      when is_binary(pack_dir) and is_binary(sha) and is_integer(add_bytes) do
    path = Path.join(Pack.attach_dir(pack_dir), String.downcase(sha))

    if File.exists?(path) do
      :ok
    else
      u = usage(pack_dir)

      cond do
        add_bytes < 0 ->
          {:error, :invalid_size, u}

        u.count >= u.max_count ->
          {:error, :pack_attach_count, u}

        u.bytes + add_bytes > u.max_bytes ->
          {:error, :pack_attach_bytes, u}

        true ->
          :ok
      end
    end
  end

  def error_message(:pack_attach_bytes, u) do
    "pack attachment storage full (#{u.bytes}/#{u.max_bytes} bytes). Export or remove files."
  end

  def error_message(:pack_attach_count, u) do
    "pack attachment limit reached (#{u.count}/#{u.max_count} files). Remove some attachments."
  end

  def error_message(_, _), do: "pack storage quota exceeded"

  def http_status(:pack_attach_bytes), do: 507
  def http_status(:pack_attach_count), do: 507
  def http_status(_), do: 507

  defp du_attachments(dir) do
    case File.ls(dir) do
      {:ok, files} ->
        Enum.reduce(files, {0, 0}, fn f, {b, c} ->
          path = Path.join(dir, f)

          if Regex.match?(~r/^[a-f0-9]{64}$/, f) do
            case File.stat(path) do
              {:ok, %File.Stat{type: :regular, size: size}} -> {b + size, c + 1}
              _ -> {b, c}
            end
          else
            {b, c}
          end
        end)

      _ ->
        {0, 0}
    end
  end
end
