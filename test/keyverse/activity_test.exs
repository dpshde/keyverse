defmodule Keyverse.ActivityTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Activity, Note, Pack, Scope}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-act-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()

    {:ok, key} = Pack.create("activity-graph-test-door")
    pack = Pack.path_for(key)

    on_exit(fn -> File.rm_rf!(root) end)
    %{pack: pack}
  end

  test "heatmap counts op edits by day and YTD notes taken", %{pack: pack} do
    scope = Scope.parse("John 3:16")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "first"}]
      })

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "second"}]
      })

    scope2 = Scope.parse("John 3:17")

    {:ok, _} =
      Note.put_note(pack, scope2, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "other"}]
      })

    today = Date.utc_today() |> Date.to_iso8601()
    ytd_from = "#{Date.utc_today().year}-01-01"
    heat = Activity.heatmap(pack)
    assert heat.to == today
    assert heat.from == ytd_from
    assert heat.ytd_from == ytd_from
    assert heat.ytd_to == today
    assert List.first(heat.days).date == ytd_from
    assert List.last(heat.days).date == today
    assert heat.total >= 2

    cell = Enum.find(heat.days, &(&1.date == today))
    assert cell.count >= 2
    assert cell.level >= 1
    assert heat.source in ["ops", "mixed"]

    # Two distinct notes first written YTD (re-saves of John 3:16 don't add a third)
    assert heat.notes_taken_ytd == 2
  end

  test "day detail coalesces same-note edits into one net diff", %{pack: pack} do
    scope = Scope.parse("Romans 8:28")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "t"}]
      })

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "All things work together"},
          %{"id" => "b2", "indent" => 1, "text" => "for good"}
        ]
      })

    today = Date.utc_today() |> Date.to_iso8601()
    detail = Activity.day(pack, today)

    # One card for the note — not separate create + edit micro-events
    same = Enum.filter(detail.events, &(&1.slug == scope.slug))
    assert length(same) == 1

    edit = hd(same)
    assert edit.has_diff
    assert edit.change_count == 2
    # Net: empty → final outline (not the intermediate "t")
    assert edit.before_text == "" or is_nil(edit.before_text) or edit.before_text == ""
    assert String.contains?(edit.after_text, "for good")
    refute edit.after_text == "t"
    # Summary matches net outline, not raw "2 saves · 2 added · 1 edited"
    assert edit.summary =~ ~r/added|Created|Edited/i
    refute edit.summary =~ "saves"
  end

  test "day rejects bad date" do
    assert {:error, :invalid_date} = Activity.day("/tmp", "not-a-date")
  end

  test "outline_text indents blocks" do
    state = %{
      "blocks" => [
        %{"id" => "a", "indent" => 0, "text" => "Root"},
        %{"id" => "b", "indent" => 1, "text" => "Child"}
      ],
      "attachments" => []
    }

    assert Activity.outline_text(state) == "Root\n  Child"
  end
end
