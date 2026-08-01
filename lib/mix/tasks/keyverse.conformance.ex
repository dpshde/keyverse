defmodule Mix.Tasks.Keyverse.Conformance do
  @shortdoc "Validate protocol/fixtures packs (no HTTP)"
  @moduledoc """
  Runs offline pack conformance against `protocol/fixtures`.

      mix keyverse.conformance
      mix keyverse.conformance path/to/pack
  """
  use Mix.Task

  @impl true
  def run([]) do
    Mix.Task.run("app.start")
    result = Keyverse.Protocol.Conformance.validate_fixtures()
    print_fixture_result(result)
    if result.ok?, do: :ok, else: System.halt(1)
  end

  def run([path | _]) do
    Mix.Task.run("app.start")
    report = Keyverse.Protocol.Conformance.validate_pack(path)
    print_report(report)
    if report.ok?, do: :ok, else: System.halt(1)
  end

  defp print_fixture_result(%{ok?: ok?, cases: cases}) do
    Enum.each(cases, fn c ->
      mark = if c.ok?, do: "PASS", else: "FAIL"
      base = Path.basename(c.dir)
      reason = Map.get(c, :reason, "")
      Mix.shell().info("#{mark}  #{c.kind}/#{base}#{if reason != "", do: " — #{reason}", else: ""}")

      unless c.ok? do
        Enum.each(c.report.errors || [], fn e ->
          Mix.shell().info("      [#{e.code}] #{e.path}: #{e.message}")
        end)
      end
    end)

    Mix.shell().info(if(ok?, do: "\nconformance: ok", else: "\nconformance: FAILED"))
  end

  defp print_report(report) do
    Mix.shell().info("pack: #{report.pack}")
    Mix.shell().info(if(report.ok?, do: "ok", else: "FAILED"))

    Enum.each(report.errors, fn e ->
      Mix.shell().info("  error [#{e.code}] #{e.path}: #{e.message}")
    end)

    Enum.each(report.warnings, fn e ->
      Mix.shell().info("  warn  [#{e.code}] #{e.path}: #{e.message}")
    end)
  end
end
