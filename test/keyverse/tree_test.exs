defmodule Keyverse.TreeTest do
  use ExUnit.Case, async: true

  alias Keyverse.{Scope, Tree}

  test "home tree nests verse under synthetic chapter folder" do
    notes = [
      %{
        "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => "jhn.3.16"},
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "a"}],
        "updated_at" => "2020-01-01T00:00:00Z"
      },
      %{
        "scope" => %{"kind" => "verse", "osis" => "JHN.3.17", "slug" => "jhn.3.17"},
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "b"}],
        "updated_at" => "2020-01-02T00:00:00Z"
      }
    ]

    tree = Tree.build_home_note_tree(notes)
    assert tree != []
    # synthetic chapter folder
    folder = hd(tree)
    assert folder.kind == :folder
    assert folder.slug == "jhn.3"
    assert length(folder.children) == 2
  end

  test "relate intervals containment" do
    ch = Scope.parse("JHN.3")
    v = Scope.parse("JHN.3.16")
    assert Tree.relate_intervals(Tree.scope_interval(ch), Tree.scope_interval(v)) == :contains
  end
end
