defmodule Keyverse.PassageStripTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Html, Scope}

  test "verse note strip includes BSB text" do
    scope = Scope.parse("John 3:16")
    assert scope.kind == "verse"
    html = Html.passage_strip_html(scope)
    assert html =~ "passage-strip"
    # title already carries the ref — strip is body text only
    refute html =~ "passage-strip-ref"
    refute html =~ ~s(passage-strip-tr)
    assert html =~ "aria-label="
    assert html =~ "BSB"
    assert html =~ "data-v=\"16\""
    assert html =~ "God" or html =~ "loved" or String.length(html) > 80
  end

  test "range note strip includes multiple verses" do
    scope = Scope.parse("John 3:16-17")
    assert scope.kind == "range"
    html = Html.passage_strip_html(scope)
    assert html =~ "data-v=\"16\""
    assert html =~ "data-v=\"17\""
  end

  test "chapter note has no passage strip" do
    scope = Scope.parse("John 3")
    assert scope.kind == "chapter"
    assert Html.passage_strip_html(scope) == ""
  end
end
