defmodule Keyverse.StaticJsSyntaxTest do
  @moduledoc """
  Gate: every priv/static/*.js must parse under `node --check`.
  Blocks re-landing of template-literal escape artifacts that SyntaxError in browsers.
  """
  use ExUnit.Case, async: false

  defp static_js_files do
    dir =
      [
        Path.join([Application.app_dir(:keyverse, "priv"), "static"]),
        Path.join([File.cwd!(), "priv", "static"])
      ]
      |> Enum.find(&File.dir?/1)

    dir
    |> File.ls!()
    |> Enum.filter(&String.ends_with?(&1, ".js"))
    |> Enum.map(&Path.join(dir, &1))
    |> Enum.sort()
  end

  test "node --check passes for every priv/static/*.js" do
    files = static_js_files()
    assert files != [], "no static js files found"

    failures =
      Enum.reduce(files, [], fn file, acc ->
        {out, status} = System.cmd("node", ["--check", file], stderr_to_stdout: true)

        if status == 0 do
          acc
        else
          [{Path.basename(file), out} | acc]
        end
      end)

    assert failures == [], """
    node --check failed for:
    #{Enum.map_join(failures, "\n", fn {f, o} -> "  #{f}: #{String.slice(o, 0, 400)}" end)}

    Re-run: node scripts/extract_client_js.mjs
    """
  end

  test "platform.js prefers saved multiword key on public /read weblinks" do
    path =
      Enum.find(static_js_files(), &String.ends_with?(&1, "platform.js")) ||
        flunk("platform.js missing")

    src = File.read!(path)
    assert src =~ "vp_door_key"
    assert src =~ ~S|/read/|
    assert src =~ "/api/protocol"
    assert src =~ "location.replace"
  end

  test "outliner paste splits on real newlines (evaluated template form)" do
    path =
      Enum.find(static_js_files(), &String.ends_with?(&1, "outliner.js")) ||
        flunk("outliner.js missing")

    src = File.read!(path)
    # Evaluated form (what Node injects): .replace(/\r\n/g, "\n").split("\n")
    # In the file bytes, "\n" is quote-backslash-n-quote — use ~S for literal backslashes.
    assert src =~ ~S|replace(/\r\n/g, "\n").split("\n")|
    # Must not keep double-escaped paste split from template source
    refute src =~ ~S|replace(/\r\n/g, "\\n").split("\\n")|
    # escHtml quote key is "\"" not "\\""
    assert src =~ ~S|"\"": "&quot;"|
    refute src =~ ~S|"\\"": "&quot;"|
  end
end

