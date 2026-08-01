defmodule Mix.Tasks.Keyverse.Import do
  @shortdoc "Import a user-owned pack zip into a directory"
  @moduledoc """
      mix keyverse.import PACK.zip DEST_DIR [--replace]
  """
  use Mix.Task

  @impl true
  def run(args) do
    Mix.Task.run("app.start")
    {opts, rest, _} = OptionParser.parse(args, strict: [replace: :boolean])

    case rest do
      [zip_path, dest] ->
        mode = if opts[:replace], do: :replace, else: :merge
        bin = File.read!(zip_path)

        case Keyverse.PackTransfer.import_zip(dest, bin, mode: mode) do
          {:ok, info} ->
            Mix.shell().info("imported #{info.files} files (#{info.mode}) → #{Path.expand(dest)}")

          {:error, {:conformance_failed, report}} ->
            Mix.shell().error("import wrote files but conformance failed:")
            Enum.each(report.errors, fn e ->
              Mix.shell().error("  [#{e.code}] #{e.path}: #{e.message}")
            end)
            System.halt(1)

          {:error, reason} ->
            Mix.shell().error(inspect(reason))
            System.halt(1)
        end

      _ ->
        Mix.shell().error("usage: mix keyverse.import PACK.zip DEST_DIR [--replace]")
        System.halt(1)
    end
  end
end
