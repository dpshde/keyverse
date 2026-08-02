defmodule Keyverse.PackWriterTest do
  use ExUnit.Case, async: false

  alias Keyverse.{Note, Pack, Pack.Writer, Scope}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-writer-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()

    on_exit(fn -> File.rm_rf!(root) end)
    {:ok, root: root}
  end

  test "serializes concurrent writes on one pack", _ctx do
    assert {:ok, door} = Pack.create("writer-pack-one-door")
    dir = Pack.path_for(door)
    scope = Scope.parse("John 3:16")

    parent = self()

    tasks =
      for i <- 1..40 do
        Task.async(fn ->
          Note.put_note(dir, scope, %{
            "blocks" => [%{"id" => "b#{i}", "indent" => 0, "text" => "msg-#{i}"}]
          })

          send(parent, {:done, i})
          :ok
        end)
      end

    Enum.each(tasks, &Task.await(&1, 15_000))
    assert Note.read(dir, "jhn.3.16")["blocks"] |> hd() |> Map.get("text") =~ "msg-"
    assert Writer.count() >= 1
  end

  test "different packs use independent writers", %{root: _root} do
    assert {:ok, a} = Pack.create("writer-alpha-beta-gamma")
    assert {:ok, b} = Pack.create("writer-delta-epsilon-zeta")
    da = Pack.path_for(a)
    db = Pack.path_for(b)

    pid_a = Writer.ensure(da)
    pid_b = Writer.ensure(db)
    assert pid_a != pid_b
    assert Process.alive?(pid_a)
    assert Process.alive?(pid_b)
  end
end
