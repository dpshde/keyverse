defmodule Keyverse.NoteOpLogTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Fold, Note, OpLog, Pack, PackTransfer, Scope}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-noteops-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()

    {:ok, key} = Pack.create("op-log-test-words")
    pack = Pack.path_for(key)

    on_exit(fn -> File.rm_rf!(root) end)
    {:ok, pack: pack}
  end

  defp fold_state(pack, slug) do
    Fold.materialize(Fold.fold(OpLog.list(pack, slug)))
  end

  test "put_note appends op records whose fold matches the snapshot", %{pack: pack} do
    scope = Scope.parse("John 3:16")

    {:ok, note} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "first"}]
      })

    {:ok, note2} =
      Note.put_note(pack, scope, %{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "first edited"},
          %{"id" => "b2", "indent" => 1, "text" => "second"}
        ]
      })

    records = OpLog.list(pack, scope.slug)
    assert length(records) == 2
    assert Fold.equal?(fold_state(pack, scope.slug), Fold.state_from_note(note2))
    refute Fold.equal?(fold_state(pack, scope.slug), Fold.state_from_note(note))
  end

  test "deleting a note logs the empty transition", %{pack: pack} do
    scope = Scope.parse("John 3:17")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "gone soon"}]
      })

    {:deleted, true} =
      Note.put_note(pack, scope, %{"blocks" => [%{"id" => "b1", "indent" => 0, "text" => ""}]})

    assert Note.read(pack, scope.slug) == nil
    assert Fold.equal?(fold_state(pack, scope.slug), Fold.state_from_note(nil))
  end

  test "sealed notes write no plaintext ops", %{pack: pack} do
    scope = Scope.parse("John 3:18")

    Note.put_note(pack, scope, %{
      "encrypted" => true,
      "cipher" => %{"alg" => "aes-256-gcm", "iv" => "aWl2", "ct" => "Y3Q=", "salt" => "c2FsdA=="}
    })

    assert OpLog.list(pack, scope.slug) == []

    # unsealing diffs from the fold state (empty), so the log picks up cleanly
    {:ok, note} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "revealed"}]
      })

    assert Fold.equal?(fold_state(pack, scope.slug), Fold.state_from_note(note))
  end

  test "out-of-band snapshot rewrite heals via an implicit record", %{pack: pack} do
    scope = Scope.parse("John 3:19")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "logged"}]
      })

    # simulate an external tool rewriting the snapshot without touching ops/
    raw = Note.read(pack, scope.slug)
    raw = put_in(raw["blocks"], [%{"id" => "b1", "indent" => 0, "text" => "hand edited"}])
    Note.write!(pack, raw)

    {:ok, note} =
      Note.put_note(pack, scope, %{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "hand edited"},
          %{"id" => "b2", "indent" => 0, "text" => "next edit"}
        ]
      })

    records = OpLog.list(pack, scope.slug)
    assert Enum.count(records, & &1.record["implicit"]) == 1
    assert Fold.equal?(fold_state(pack, scope.slug), Fold.state_from_note(note))
  end

  test "seeding empty log from existing note stamps created_at; re-put is no-op", %{pack: pack} do
    scope = Scope.parse("John 3:21")
    created = "2026-08-02T03:16:23.798Z"

    # Write snapshot without going through put_note logging first (simulate pre-ops pack).
    note = %{
      "id" => "n_pre",
      "scope" => Note.scope_map(scope),
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "old content"}],
      "attachments" => [],
      "created_at" => created,
      "updated_at" => created
    }

    Note.write!(pack, note)
    assert OpLog.list(pack, scope.slug) == []

    # First put after ops enabled: seeds log with created_at, not wall-clock now.
    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "old content"}]
      })

    records = OpLog.list(pack, scope.slug)
    assert length(records) == 1
    assert hd(records).record["at"] == created
    assert hd(records).record["implicit"] == true

    n_after_seed = length(records)

    # Identical re-put (mirror) must not append more ops.
    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "old content"}]
      })

    assert length(OpLog.list(pack, scope.slug)) == n_after_seed
  end

  test "export/import round-trips ops/", %{pack: pack} do
    scope = Scope.parse("John 3:20")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "travels"}]
      })

    [%{hash: hash}] = OpLog.list(pack, scope.slug)

    assert {:ok, _name, bin} = PackTransfer.export_zip(pack)

    dest = Path.join(System.tmp_dir!(), "kv-ops-import-#{System.unique_integer([:positive])}")
    File.rm_rf!(dest)
    assert {:ok, _info} = PackTransfer.import_zip(dest, bin, mode: :replace)

    imported = Path.join([dest, "ops", scope.slug, hash <> ".json"])
    assert File.exists?(imported)
    assert Fold.equal?(fold_state(dest, scope.slug), fold_state(pack, scope.slug))

    report = Keyverse.Protocol.Conformance.validate_pack(dest)
    assert report.ok?
    assert report.warnings == []
    File.rm_rf!(dest)
  end
end
