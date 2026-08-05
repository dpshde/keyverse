defmodule Keyverse.CanonTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Canon, Note, Pack, Scope}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-canon-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()

    {:ok, key} = Pack.create("canon-coverage-test-door")
    pack = Pack.path_for(key)

    on_exit(fn -> File.rm_rf!(root) end)
    %{pack: pack}
  end

  test "heat scales so 1 note per chapter is 90%" do
    # 21 chapters of John: 21 notes → ratio 1.0 → heat 0.9
    assert_in_delta Canon.heat(21, 21), 0.9, 0.0001
    # half that density → 45%
    assert_in_delta Canon.heat(10, 21) + Canon.heat(11, 21), 0.9, 0.01
    assert_in_delta Canon.heat(10, 20), 0.45, 0.0001
    # denser than 1/chapter saturates toward 1.0
    assert Canon.heat(50, 21) > 0.9
    assert Canon.heat(50, 21) <= 1.0
    assert Canon.heat(0, 21) == 0.0
  end

  test "coverage paints books with contentful notes only", %{pack: pack} do
    # John 3:16 with content
    scope = Scope.parse("John 3:16")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "for God so loved"}]
      })

    # Empty shell in Romans should not count (write file directly; put_note drops empties)
    scope_empty = Scope.parse("Romans 1:1")
    now = DateTime.utc_now() |> DateTime.to_iso8601()

    Note.write!(pack, %{
      "id" => "n_empty_rom",
      "scope" => Note.scope_map(scope_empty),
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "  "}],
      "attachments" => [],
      "created_at" => now,
      "updated_at" => now
    })

    # Second John note
    scope2 = Scope.parse("John 1:1")

    {:ok, _} =
      Note.put_note(pack, scope2, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "In the beginning"}]
      })

    cov = Canon.coverage(pack)
    assert cov.total_chapters == 1189
    assert length(cov.books) == 66
    assert cov.books_with_notes == 1
    assert cov.total_notes == 2

    jhn = Enum.find(cov.books, &(&1.osis == "JHN"))
    assert jhn.notes == 2
    assert jhn.chapters == 21
    assert_in_delta jhn.heat, Canon.heat(2, 21), 0.0001
    assert jhn.t1 > jhn.t0

    rom = Enum.find(cov.books, &(&1.osis == "ROM"))
    assert rom.notes == 0
    assert rom.heat == 0.0

    # OT/NT seam after Malachi
    assert_in_delta cov.testament_seam_t, 929 / 1189, 0.0001
  end

  test "heatmap response includes canon", %{pack: pack} do
    scope = Scope.parse("Psalm 23")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "shepherd"}]
      })

    heat = Keyverse.Activity.heatmap(pack)
    assert is_map(heat.canon)
    assert length(heat.canon.books) == 66
    psa = Enum.find(heat.canon.books, &(&1.osis == "PSA"))
    assert psa.notes == 1
  end
end
