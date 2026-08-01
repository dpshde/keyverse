defmodule Keyverse.ScopeTest do
  use ExUnit.Case, async: true

  alias Keyverse.Scope

  test "parses John 3:16" do
    s = Scope.parse("John 3:16")
    assert s.slug == "jhn.3.16"
    assert s.kind == "verse"
    assert s.osis == "JHN.3.16"
    assert Scope.display(s) =~ "John"
  end

  test "parses slug jhn.3.16" do
    s = Scope.parse("jhn.3.16")
    assert s.slug == "jhn.3.16"
    assert s.kind == "verse"
  end

  test "parses chapter and range" do
    ch = Scope.parse("Rom 8")
    assert ch.kind == "chapter"
    assert ch.slug == "rom.8"

    r = Scope.parse("John 3:16-18")
    assert r.kind == "range"
    assert r.slug == "jhn.3.16-18"
  end

  test "autocomplete returns suggestions" do
    s = Scope.autocomplete("john 3", 5)
    assert is_list(s)
    assert s != []
  end
end
