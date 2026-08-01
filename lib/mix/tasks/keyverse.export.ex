defmodule Mix.Tasks.Keyverse.Export do
  @shortdoc "Export a pack directory to a user-owned zip"
  @moduledoc """
      mix keyverse.export PACK_DIR [OUT.zip]
  """
  use Mix.Task

  @impl true
  def run([pack_dir | rest]) do
    Mix.Task.run("app.start")
    out = List.first(rest)

    case Keyverse.PackTransfer.export_zip(pack_dir) do
      {:ok, name, bin} ->
        path = out || Path.join(File.cwd!(), name)
        File.write!(path, bin)
        Mix.shell().info("wrote #{path} (#{byte_size(bin)} bytes)")

      {:error, reason} ->
        Mix.shell().error(to_string(reason))
        System.halt(1)
    end
  end

  def run(_) do
    Mix.shell().error("usage: mix keyverse.export PACK_DIR [OUT.zip]")
    System.halt(1)
  end
end
