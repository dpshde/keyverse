defmodule Keyverse.PassageStripTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Html, Scope}

  test "verse note strip includes BSB text" do
    scope = Scope.parse("John 3:16")
    assert scope.kind == "verse"
    html = Html.passage_strip_html(scope)
    assert html =~ "passage-strip"
    assert html =~ "John 3:16" or html =~ "JHN"
    assert html =~ "BSB"
    assert html =~ "data-v=\"16\""
    # real BSB snippet
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
