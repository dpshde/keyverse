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

  test "home inbox is flat and newest-created first (ignores updated_at)" do
    notes = [
      %{
        "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => "jhn.3.16"},
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "older"}],
        "created_at" => "2020-01-01T00:00:00Z",
        # Fresh update must not bubble this to the top
        "updated_at" => "2025-12-01T00:00:00Z"
      },
      %{
        "scope" => %{"kind" => "verse", "osis" => "ROM.8.1", "slug" => "rom.8.1"},
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "newer"}],
        "created_at" => "2024-06-01T12:00:00Z",
        "updated_at" => "2024-06-01T12:00:00Z"
      },
      %{
        "scope" => %{"kind" => "chapter", "osis" => "PSA.23", "slug" => "psa.23"},
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "mid"}],
        "created_at" => "2022-03-15T00:00:00Z",
        "updated_at" => "2025-01-01T00:00:00Z"
      }
    ]

    inbox = Tree.build_home_inbox(notes)
    assert length(inbox) == 3
    assert Enum.map(inbox, & &1.scope.slug) == ["rom.8.1", "psa.23", "jhn.3.16"]

    days = Tree.build_home_inbox_days(notes)
    assert Enum.map(days, & &1.day_key) == ["2024-06-01", "2022-03-15", "2020-01-01"]
    # No empty day sections
    assert Enum.all?(days, fn d -> length(d.entries) > 0 end)
  end
end
