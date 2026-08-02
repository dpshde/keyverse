defmodule Keyverse.PackNoteTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Door, Note, Pack, Scope}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-test-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()

    on_exit(fn ->
      File.rm_rf!(root)
    end)

    {:ok, root: root}
  end

  test "create pack and isolate notes", _ctx do
    assert {:ok, a} = Pack.create("alpha-beta-gamma-delta")
    assert {:ok, b} = Pack.create("stone-path-ember-wind")
    assert Pack.exists?(a)
    assert Pack.exists?(b)
    dir_a = Pack.path_for(a)
    assert File.dir?(dir_a)
    assert String.starts_with?(Path.basename(dir_a), "p_")
    dir_b = Pack.path_for(b)

    scope = Scope.parse("John 3:16")
    assert scope.slug == "jhn.3.16"

    {:ok, _} =
      Note.put_note(dir_a, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "pack A"}]
      })

    {:ok, _} =
      Note.put_note(dir_b, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "pack B"}]
      })

    na = Note.read(dir_a, "jhn.3.16")
    nb = Note.read(dir_b, "jhn.3.16")
    assert hd(na["blocks"])["text"] == "pack A"
    assert hd(nb["blocks"])["text"] == "pack B"

    # empty clears
    assert {:deleted, true} =
             Note.put_note(dir_a, scope, %{"blocks" => [%{"id" => "b1", "indent" => 0, "text" => ""}]})

    assert Note.read(dir_a, "jhn.3.16") == nil
  end

  test "duplicate create fails" do
    assert {:ok, p} = Pack.create("one-two-three-four")
    assert {:error, _} = Pack.create(p)
  end

  test "door generate is usable for create" do
    phrase = Door.generate()
    assert {:ok, ^phrase} = Pack.create(phrase)
  end
end
