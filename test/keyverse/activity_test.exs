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

  test "bootstrap ops use note created_at for activity day, not wall-clock", %{pack: pack} do
    scope = Scope.parse("Psalm 32:9")
    created = "2026-08-02T03:16:23.798Z"

    note = %{
      "id" => "n_old",
      "scope" => Note.scope_map(scope),
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "from last week"}],
      "attachments" => [],
      "created_at" => created,
      "updated_at" => created
    }

    Note.write!(pack, note)

    # Seed log the way a bulk mirror would after ops ship
    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "from last week"}]
      })

    # Activity for create day should list this note; today should not (no real edit).
    day_created = Activity.day(pack, "2026-08-02")
    assert day_created.count >= 1
    assert Enum.any?(day_created.events, &(&1.slug == scope.slug))

    today = Date.utc_today() |> Date.to_iso8601()

    if today != "2026-08-02" do
      day_today = Activity.day(pack, today)
      refute Enum.any?(day_today.events, &(&1.slug == scope.slug and &1.kind == "edit"))
    end
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

  test "attachment-only note counts as notes taken and surfaces in day detail", %{pack: pack} do
    scope = Scope.parse("John 3:18")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => ""}],
        "attachments" => [
          %{
            "id" => "att1",
            "kind" => "url",
            "url" => "https://example.com/article",
            "title" => "Example article"
          }
        ]
      })

    heat = Activity.heatmap(pack)
    assert heat.notes_taken_ytd >= 1

    today = Date.utc_today() |> Date.to_iso8601()
    detail = Activity.day(pack, today)
    ev = Enum.find(detail.events, &(&1.slug == scope.slug))
    assert ev
    assert ev.has_diff
    assert String.contains?(ev.after_text || "", "Example article")
    assert is_list(ev.after_attachments)
    assert Enum.any?(ev.after_attachments, &(&1.label == "Example article"))
    assert ev.summary =~ ~r/attachment|Added|attached/i
  end

  test "empty note deletion does not appear as activity diff", %{pack: pack} do
    today = Date.utc_today()
    today_iso = Date.to_iso8601(today)
    yesterday = Date.add(today, -1)
    yesterday_at = DateTime.new!(yesterday, ~T[12:00:00], "Etc/UTC") |> DateTime.to_iso8601()

    # Never had content: put empty (no-op delete path)
    scope0 = Scope.parse("Psalm 10:1")

    assert {:deleted, true} =
             Note.put_note(pack, scope0, %{
               "blocks" => [%{"id" => "b1", "indent" => 0, "text" => ""}]
             })

    # Prior-day content deleted today — real removal, should still show
    scope1 = Scope.parse("Psalm 10:2")
    content_state = %{
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "had content"}],
      "attachments" => []
    }

    note1 = %{
      "id" => "n_prior",
      "scope" => Note.scope_map(scope1),
      "blocks" => content_state["blocks"],
      "attachments" => [],
      "created_at" => yesterday_at,
      "updated_at" => yesterday_at
    }

    Note.write!(pack, note1)

    Keyverse.Pack.Writer.call(pack, fn ->
      Keyverse.OpLog.record_transition!(
        pack,
        scope1.slug,
        %{"blocks" => [], "attachments" => []},
        content_state,
        at: yesterday_at
      )
    end)

    assert {:deleted, true} =
             Note.put_note(pack, scope1, %{
               "blocks" => [%{"id" => "b1", "indent" => 0, "text" => ""}]
             })

    # Open tray → type → wipe/delete: net empty→empty, must not card
    scope3 = Scope.parse("Psalm 10:4")

    {:ok, _} =
      Note.put_note(pack, scope3, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "draft"}]
      })

    assert {:deleted, true} =
             Note.put_note(pack, scope3, %{
               "blocks" => [%{"id" => "b1", "indent" => 0, "text" => ""}]
             })

    detail = Activity.day(pack, today_iso)

    refute Enum.any?(detail.events, &(&1.slug == scope0.slug))
    refute Enum.any?(detail.events, &(&1.slug == scope3.slug))

    # Deleting yesterday's content today still surfaces as a removal
    rem = Enum.find(detail.events, &(&1.slug == scope1.slug))
    assert rem
    assert rem.has_diff
    assert rem.summary =~ ~r/Removed|removed/i

    heat = Activity.heatmap(pack)
    cell = Enum.find(heat.days, &(&1.date == today_iso))
    # Draft wipe excluded; prior-content delete still counts
    assert cell.count >= 1
    # Wiped draft does not count as a note taken; prior-day create does
    assert heat.notes_taken_ytd == 1
  end
end
