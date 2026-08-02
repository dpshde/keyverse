defmodule Keyverse.DoorIndexTest do
  use ExUnit.Case, async: false
  import Plug.Test

  alias Keyverse.{DoorIndex, Pack, Router}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-door-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    DoorIndex.reload!()

    on_exit(fn ->
      File.rm_rf!(root)
    end)

    :ok
  end

  test "create stores opaque pack_id and multiword binding" do
    phrase = "quiet-river-lantern-stone"
    assert {:ok, ^phrase} = Pack.create(phrase)
    assert Pack.exists?(phrase)

    {:ok, res} = DoorIndex.resolve(phrase)
    assert res.via == :index
    assert res.role == "write"
    assert String.starts_with?(res.pack_id, "p_")
    assert File.dir?(res.pack_dir)
    assert Path.basename(res.pack_dir) == res.pack_id
    refute File.dir?(Path.join(Application.get_env(:keyverse, :packs_root), phrase))

    protocol = File.read!(Path.join(res.pack_dir, "protocol.json")) |> Jason.decode!()
    assert protocol["pack_id"] == res.pack_id
  end

  test "rotate issues new multiword; old fails" do
    phrase = "alpha-beta-gamma-delta"
    assert {:ok, ^phrase} = Pack.create(phrase)
    {:ok, %{pack_id: pid}} = DoorIndex.resolve(phrase)

    assert {:ok, %{door: new_door, pack_id: ^pid}} = DoorIndex.rotate(pid, phrase)
    assert new_door != phrase
    assert Pack.exists?(new_door)
    refute Pack.exists?(phrase)

    {:ok, again} = DoorIndex.resolve(new_door)
    assert again.pack_id == pid
  end

  test "HTTP multiword URL and rotate endpoint" do
    phrase = "coral-basin-willow-mint"
    assert {:ok, ^phrase} = Pack.create(phrase)

    conn = conn(:get, "/#{phrase}/api/door") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["door"] == phrase
    assert String.starts_with?(body["pack_id"], "p_")
    assert body["role"] == "write"

    conn2 = conn(:post, "/#{phrase}/api/door/rotate", "") |> Router.call([])
    assert conn2.status == 200
    rot = Jason.decode!(conn2.resp_body)
    assert rot["ok"] == true
    new_door = rot["door"]
    assert new_door != phrase

    conn3 = conn(:get, "/#{phrase}/api/door") |> Router.call([])
    assert conn3.status == 404

    conn4 = conn(:get, "/#{new_door}/api/protocol") |> Router.call([])
    assert conn4.status == 200
    proto = Jason.decode!(conn4.resp_body)
    assert proto["pack_id"] == rot["pack_id"]
    assert proto["features"]["opaque_pack_id"] == true
  end

  test "legacy multiword directory still opens" do
    root = Application.get_env(:keyverse, :packs_root)
    phrase = "legacy-stone-path-ember"
    dir = Path.join(root, phrase)
    Pack.ensure_dirs!(dir)
    File.write!(Path.join(dir, "door"), phrase <> "\n")

    assert Pack.exists?(phrase)
    {:ok, res} = DoorIndex.resolve(phrase)
    assert res.via == :legacy
    assert res.pack_dir == dir
  end
end
