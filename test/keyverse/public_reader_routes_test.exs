defmodule Keyverse.PublicReaderRoutesTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Keyverse.Router

  setup do
    root = Path.join(System.tmp_dir!(), "kv-public-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  test "GET /go?q= redirects to public /read slug" do
    conn = conn(:get, "/go?q=John+3:16") |> Router.call([])
    assert conn.status == 302
    assert get_resp_header(conn, "location") == ["/read/jhn.3.16"]
  end

  test "GET /read/jhn.3.16 serves BSB reader without a door" do
    conn = conn(:get, "/read/jhn.3.16") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "reader-root"
    assert conn.resp_body =~ ~s(data-v="16")
    assert conn.resp_body =~ ~s(window.BASE="")
  end

  test "GET /read/JHN.3.16 canonicalizes to lowercase slug" do
    conn = conn(:get, "/read/JHN.3.16") |> Router.call([])
    assert conn.status == 302
    assert get_resp_header(conn, "location") == ["/read/jhn.3.16"]
  end

  test "GET /api/text/bsb/JHN/3 is available at origin (no door)" do
    conn = conn(:get, "/api/text/bsb/JHN/3") |> Router.call([])
    assert conn.status == 200
    assert get_resp_header(conn, "x-keyverse-text") == ["bsb-pack"]
    body = Jason.decode!(conn.resp_body)
    verses = body["verses"]
    assert is_list(verses) and length(verses) >= 30
  end

  test "GET /api/read/jhn.3 is available at origin (no door)" do
    conn = conn(:get, "/api/read/jhn.3") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["ok"] == true
    assert body["meta"]["slug"] == "jhn.3"
    assert is_binary(body["html"]["verses"])
  end

  test "invalid public slug 404s" do
    conn = conn(:get, "/read/not-a-passage") |> Router.call([])
    assert conn.status == 404
  end
end
