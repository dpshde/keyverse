defmodule Keyverse.RouterTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Keyverse.Router

  setup do
    root = Path.join(System.tmp_dir!(), "kv-router-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)

    on_exit(fn -> File.rm_rf!(root) end)
    {:ok, root: root}
  end

  test "health" do
    conn = conn(:get, "/health") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["ok"] == true
    assert body["host"] == "elixir"
    assert body["protocol"] == "keyverse"
  end

  test "setup creates pack and note APIs isolate" do
    # create A
    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "firm-sane-chef-earn"})
      |> Router.call([])

    assert conn.status == 302
    assert Plug.Conn.get_resp_header(conn, "location") == ["/firm-sane-chef-earn/"]

    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "stone-path-ember-wind"})
      |> Router.call([])

    assert conn.status == 302

    # write notes
    body_a = Jason.encode!(%{"blocks" => [%{"id" => "b1", "indent" => 0, "text" => "note in pack A"}]})
    conn =
      conn(:put, "/firm-sane-chef-earn/api/note/jhn.3.16", body_a)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200

    body_b = Jason.encode!(%{"blocks" => [%{"id" => "b1", "indent" => 0, "text" => "note in pack B"}]})
    conn =
      conn(:put, "/stone-path-ember-wind/api/note/jhn.3.16", body_b)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200

    conn = conn(:get, "/firm-sane-chef-earn/api/note/jhn.3.16?raw") |> Router.call([])
    assert conn.status == 200
    assert String.trim(conn.resp_body) == "note in pack A"

    conn = conn(:get, "/stone-path-ember-wind/api/note/jhn.3.16?raw") |> Router.call([])
    assert conn.status == 200
    assert String.trim(conn.resp_body) == "note in pack B"

    # protocol
    conn = conn(:get, "/firm-sane-chef-earn/api/protocol") |> Router.call([])
    assert conn.status == 200
    proto = Jason.decode!(conn.resp_body)
    assert proto["multipack"] == true
    assert proto["door_phrase"] == "firm-sane-chef-earn"

    # resolve
    conn = conn(:get, "/firm-sane-chef-earn/api/resolve?q=John+3:16") |> Router.call([])
    assert conn.status == 200
    res = Jason.decode!(conn.resp_body)
    assert res["ok"] == true
    assert res["scope"]["slug"] == "jhn.3.16"

    # unknown door
    conn = conn(:get, "/nope-not-a-real-pack-here/") |> Router.call([])
    assert conn.status == 404

    # URL attachment
    att_body = Jason.encode!(%{"kind" => "url", "url" => "https://example.com", "title" => "ex"})

    conn =
      conn(:post, "/firm-sane-chef-earn/api/note/jhn.3.16/attachments", att_body)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200
    note = Jason.decode!(conn.resp_body)
    assert Enum.any?(note["attachments"] || [], &(&1["kind"] == "url"))
  end


  test "UX HTML includes window.BASE" do
    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "quiet-river-lantern-home"})
      |> Router.call([])

    assert conn.status == 302

    # seed a note so home tree + reader have structure
    body =
      Jason.encode!(%{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "hello home"}]
      })

    conn =
      conn(:put, "/quiet-river-lantern-home/api/note/jhn.3.16", body)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200

    conn = conn(:get, "/quiet-river-lantern-home/") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "window.BASE"
    assert conn.resp_body =~ "keyverse"
    assert conn.resp_body =~ "/quiet-river-lantern-home"
    # nested home forest (not flat note-list)
    assert conn.resp_body =~ ~s(id="note-tree")
    assert conn.resp_body =~ "nt-node"
    assert conn.resp_body =~ "home-tree.js"
    # no extractor banner leaking into HTML body/head as visible text
    refute conn.resp_body =~ "extract_client_js"
    refute conn.resp_body =~ "hand-fix escapes"
    # original ref-search: no Go button / Passage label
    refute conn.resp_body =~ ~s(class="ref-go")
    refute conn.resp_body =~ ">Passage<"
    assert conn.resp_body =~ ~s(id="ref-search")
    assert conn.resp_body =~ ~s(id="ref-input")

    conn = conn(:get, "/setup") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "Create your notes"

    conn = conn(:get, "/") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "Open your notes" or conn.resp_body =~ "Open my notes"

    conn = conn(:get, "/quiet-river-lantern-home/note/jhn.3.16") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "window.BASE"
    assert conn.resp_body =~ "outliner.js" or conn.resp_body =~ "mountOutliner" or conn.resp_body =~ "editor"
  end

  test "reader HTML matches client contract (verse-seeds, id=vN, vnotes)" do
    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "reader-seed-test-pack"})
      |> Router.call([])

    assert conn.status == 302

    body =
      Jason.encode!(%{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "seed verse"}]
      })

    conn =
      conn(:put, "/reader-seed-test-pack/api/note/jhn.3.16", body)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200

    # Prefer chapter read page — may need network for BSB; if fetch fails, still check structure on error path
    conn = conn(:get, "/reader-seed-test-pack/read/jhn.3") |> Router.call([])
    assert conn.status == 200
    html = conn.resp_body

    if html =~ "Could not fetch text" do
      # Offline/no network: still require verse-seeds path is the real renderer, not chapter-notes
      refute html =~ ~s(id="chapter-notes")
    else
      assert html =~ ~s(id="verse-seeds")
      assert html =~ ~s(id="v16") or html =~ ~s(id="v1")
      assert html =~ "vnotes"
      assert html =~ "vtext"
      assert html =~ "expand-notes"
      assert html =~ "reader-page.js"
      assert html =~ "outliner.js"
      # seed map includes the verse note blocks
      assert html =~ "seed verse" or html =~ "jhn.3.16"
      refute html =~ ~s(id="chapter-notes")
    end
  end


  test "PWA assets" do
    conn = conn(:get, "/sw.js") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "service" or byte_size(conn.resp_body) > 10

    conn = conn(:get, "/icons/icon-192.png") |> Router.call([])
    assert conn.status == 200
  end
end
