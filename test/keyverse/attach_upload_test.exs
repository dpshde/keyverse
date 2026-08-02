defmodule Keyverse.AttachUploadTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Keyverse.Router

  setup do
    root = Path.join(System.tmp_dir!(), "kv-att-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Application.put_env(:keyverse, :max_attach_bytes, 1024)
    Application.put_env(:keyverse, :max_attach_per_note, 3)
    Keyverse.DoorIndex.reload!()
    on_exit(fn ->
      File.rm_rf!(root)
      Application.put_env(:keyverse, :max_attach_bytes, 50 * 1024 * 1024)
      Application.put_env(:keyverse, :max_attach_per_note, 80)
    end)

    {:ok, door} = Keyverse.Pack.create("calm-river-stone-path")
    pack = Keyverse.Pack.path_for(door)
    {:ok, door: door, pack: pack}
  end

  test "upload file stores CAS blob and sanitizes name", %{door: door} do
    body = :crypto.strong_rand_bytes(64)

    conn =
      conn(:post, "/#{door}/api/note/jhn.3.16/attachments", body)
      |> put_req_header("content-type", "image/png")
      |> put_req_header("x-filename", encode_uri("../../evil.png"))
      |> Router.call([])

    assert conn.status == 200
    note = Jason.decode!(conn.resp_body)
    [att] = note["attachments"]
    assert att["name"] == "evil.png"
    assert att["mime"] == "image/png"
    assert att["bytes"] == 64
    assert File.exists?(Path.join([Keyverse.Pack.path_for(door), "attachments", att["sha256"]]))

    # fetch blob
    conn2 = conn(:get, "/#{door}/api/attachments/#{att["sha256"]}") |> Router.call([])
    assert conn2.status == 200
    assert get_resp_header(conn2, "x-content-type-options") == ["nosniff"]
    assert conn2.resp_body == body
  end

  test "rejects oversize upload with 413", %{door: door} do
    body = :crypto.strong_rand_bytes(2048)

    conn =
      conn(:post, "/#{door}/api/note/jhn.3.16/attachments", body)
      |> put_req_header("content-type", "application/octet-stream")
      |> put_req_header("content-length", "2048")
      |> put_req_header("x-filename", "big.bin")
      |> Router.call([])

    assert conn.status == 413
    err = Jason.decode!(conn.resp_body)
    assert err["error"] =~ "too large"
  end

  test "rejects empty upload", %{door: door} do
    conn =
      conn(:post, "/#{door}/api/note/jhn.3.16/attachments", "")
      |> put_req_header("content-type", "application/octet-stream")
      |> put_req_header("x-filename", "empty.bin")
      |> Router.call([])

    assert conn.status == 400
  end

  test "rejects javascript: urls", %{door: door} do
    conn =
      conn(:post, "/#{door}/api/note/jhn.3.16/attachments", Jason.encode!(%{kind: "url", url: "javascript:alert(1)"}))
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 400
    assert Jason.decode!(conn.resp_body)["error"] =~ "http"
  end

  test "accepts https url", %{door: door} do
    conn =
      conn(
        :post,
        "/#{door}/api/note/jhn.3.16/attachments",
        Jason.encode!(%{kind: "url", url: "https://example.com/doc"})
      )
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200
    note = Jason.decode!(conn.resp_body)
    assert Enum.any?(note["attachments"], &(&1["url"] == "https://example.com/doc"))
  end

  test "enforces max attachments per note", %{door: door} do
    for i <- 1..3 do
      body = "x#{i}"

      conn =
        conn(:post, "/#{door}/api/note/jhn.3.16/attachments", body)
        |> put_req_header("content-type", "text/plain")
        |> put_req_header("x-filename", "f#{i}.txt")
        |> Router.call([])

      assert conn.status == 200, "upload #{i} failed: #{conn.resp_body}"
    end

    conn =
      conn(:post, "/#{door}/api/note/jhn.3.16/attachments", "overflow")
      |> put_req_header("content-type", "text/plain")
      |> put_req_header("x-filename", "nope.txt")
      |> Router.call([])

    assert conn.status == 400
    assert Jason.decode!(conn.resp_body)["error"] =~ "too many"
  end

  defp encode_uri(s), do: URI.encode(s, &URI.char_unreserved?/1)
end
