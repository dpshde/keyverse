defmodule Keyverse.ReaderJsTest do
  @moduledoc """
  Regression: extracted reader-page.js must not keep template-literal escape
  artifacts that break multi-verse range slugs (skeptic finding).
  """
  use ExUnit.Case, async: true

  defp reader_js do
    path = Path.join([Application.app_dir(:keyverse, "priv"), "static", "reader-page.js"])

    path =
      if File.exists?(path) do
        path
      else
        Path.join([File.cwd!(), "priv", "static", "reader-page.js"])
      end

    File.read!(path)
  end

  test "chapterDisplay uses META.display not JSON.stringify" do
    src = reader_js()
    assert src =~ "const chapterDisplay = META.display;"
    refute src =~ "JSON.stringify(META.display)"
  end

  test "rangeSlug regex matches jhn.3.16 (not over-escaped)" do
    src = reader_js()
    # Over-escaped form from template extraction (must NOT appear):
    # in file bytes: \ \ . \ \ d  i.e. four backslash chars before patterns
    refute src =~ ~r/\^\(\.\*\)\\\\\. \(\\\\d/
    refute src =~ "\\\\.(\\\\d+)"
    # Correct single-escape form is present
    assert src =~ ~s|/^(.*)\\.(\\d+)$/|
  end

  test "range end regex and Write ellipsis are correctly escaped" do
    src = reader_js()
    assert src =~ ~s|/\\.(\\d+)-(\\d+)$/|
    refute src =~ "Write\\\\u2026"
    assert src =~ "Write\\u2026" or src =~ "Write…"
  end

  test "rangeSlug logic via Node against shipped file" do
    # Drive the real shipped file with node (same runtime as the browser).
    script = """
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const verseEl = (n) => ({ dataset: { slug: 'jhn.3.' + n } });
    const chapterDisplay = 'John 3';
    const m1 = src.match(/function rangeSlug\\(lo, hi\\) \\{[\\s\\S]*?\\n      \\}/);
    const m2 = src.match(/function rangeLabel\\(lo, hi\\) \\{[\\s\\S]*?\\n      \\}/);
    if (!m1 || !m2) { console.log('EXTRACT_FAIL'); process.exit(2); }
    const { rangeSlug, rangeLabel } = new Function(
      'verseEl', 'chapterDisplay',
      m1[0] + '\\n' + m2[0] + '\\nreturn { rangeSlug, rangeLabel };'
    )(verseEl, chapterDisplay);
    const a = rangeSlug(16, 16);
    const b = rangeSlug(16, 18);
    const c = rangeLabel(16, 18);
    if (a !== 'jhn.3.16' || b !== 'jhn.3.16-18') {
      console.log('SLUG_FAIL', a, b); process.exit(1);
    }
    if (!String(c).includes('John 3:16') || !String(c).includes('18')) {
      console.log('LABEL_FAIL', c); process.exit(1);
    }
    console.log('OK', a, b, c);
    """

    path = Path.join([File.cwd!(), "priv", "static", "reader-page.js"])
    {out, status} = System.cmd("node", ["-e", script, path], stderr_to_stdout: true)
    assert status == 0, "node rangeSlug failed: #{out}"
    assert out =~ "OK"
    assert out =~ "jhn.3.16-18"
  end
end
