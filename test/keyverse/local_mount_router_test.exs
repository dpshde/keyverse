defmodule Keyverse.LocalMountRouterTest do
  use ExUnit.Case, async: false
  import Plug.Test

  alias Keyverse.Router

  setup do
    root = Path.join(System.tmp_dir!(), "kv-local-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  test "GET /local serves mount shell and client assets" do
    conn = conn(:get, "/local") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "local-app"
    assert conn.resp_body =~ "/pack-store.js"
    assert conn.resp_body =~ "/local-mount.js"
    refute conn.resp_body =~ "Hosted door"
    refute conn.resp_body =~ "no account · just your key"

    conn = conn(:get, "/pack-store.js") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "LocalFsPackStore"
    assert conn.resp_body =~ "seedOpfsPackAndOpen"

    conn = conn(:get, "/local-mount.js") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "KeyverseLocalMount"
    assert conn.resp_body =~ "seedAndMount"
    assert conn.resp_body =~ "Open folder"
    assert conn.resp_body =~ "Open with a key"
    refute conn.resp_body =~ "Hosted door"
  end

  test "enter page links to /local in plain language" do
    conn = conn(:get, "/") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ ~s(href="/local")
    assert conn.resp_body =~ "Open notes on this device"
    refute conn.resp_body =~ "Open a local pack folder"
  end

  test "protocol advertises local_fs_mount_ro" do
    {:ok, door} = Keyverse.Pack.create("calm-brook-stone-path")

    conn = conn(:get, "/#{door}/api/protocol") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["features"]["local_fs_mount_ro"] == true
    assert body["ownership"]["local_mount"] =~ "/local"
    assert "GET /local" in body["endpoints"]
  end
end
