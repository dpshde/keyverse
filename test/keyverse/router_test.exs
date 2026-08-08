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
    Keyverse.DoorIndex.reload!()

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

  test "PUT shrink without X-KV-Allow-Shrink is rejected (anti-stomp)" do
    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "bold-fir-meadow-lake"})
      |> Router.call([])

    assert conn.status == 302

    rich =
      Jason.encode!(%{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "Remember their sins no more"},
          %{
            "id" => "b2",
            "indent" => 1,
            "text" => "God has claimed us as HIS. Cleansed our records through Jesus."
          }
        ]
      })

    conn =
      conn(:put, "/bold-fir-meadow-lake/api/note/heb.8.12", rich)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200

    thin =
      Jason.encode!(%{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "Remember their sins no more"}]
      })

    # QuietSync-style stomp (no allow-shrink)
    conn =
      conn(:put, "/bold-fir-meadow-lake/api/note/heb.8.12", thin)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 409
    body = Jason.decode!(conn.resp_body)
    assert body["error"] == "shrink_rejected"
    assert length(body["current"]["blocks"]) == 2

    # User-authored save with allow-shrink
    conn =
      conn(:put, "/bold-fir-meadow-lake/api/note/heb.8.12", thin)
      |> put_req_header("content-type", "application/json")
      |> put_req_header("x-kv-allow-shrink", "1")
      |> Router.call([])

    assert conn.status == 200
    note = Jason.decode!(conn.resp_body)
    assert length(note["blocks"]) == 1
  end

  test "PUT note with X-KV-Base-Updated-At rejects stale stomps (409)" do
    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "calm-oak-ridge-mint"})
      |> Router.call([])

    assert conn.status == 302

    body1 =
      Jason.encode!(%{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "parent line"},
          %{"id" => "b2", "indent" => 1, "text" => "nested child that must not be wiped"}
        ]
      })

    conn =
      conn(:put, "/calm-oak-ridge-mint/api/note/heb.8.12", body1)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200
    note1 = Jason.decode!(conn.resp_body)
    stamp1 = note1["updated_at"]
    assert is_binary(stamp1)

    # Concurrent richer state already on door; stale thin writer still holds stamp1
    body2 =
      Jason.encode!(%{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "parent line"},
          %{"id" => "b2", "indent" => 1, "text" => "nested child that must not be wiped"},
          %{"id" => "b3", "indent" => 0, "text" => "web added this"}
        ]
      })

    conn =
      conn(:put, "/calm-oak-ridge-mint/api/note/heb.8.12", body2)
      |> put_req_header("content-type", "application/json")
      |> Router.call([])

    assert conn.status == 200
    note2 = Jason.decode!(conn.resp_body)
    stamp2 = note2["updated_at"]
    assert stamp2 > stamp1

    # Stale client based on stamp1 tries to push thin body
    thin =
      Jason.encode!(%{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "parent line only"}]
      })

    conn =
      conn(:put, "/calm-oak-ridge-mint/api/note/heb.8.12", thin)
      |> put_req_header("content-type", "application/json")
      |> put_req_header("x-kv-base-updated-at", stamp1)
      |> Router.call([])

    assert conn.status == 409
    conflict = Jason.decode!(conn.resp_body)
    assert conflict["error"] == "conflict"
    assert conflict["base"] == stamp1
    assert get_in(conflict, ["current", "updated_at"]) == stamp2
    texts = Enum.map(conflict["current"]["blocks"], & &1["text"])
    assert "nested child that must not be wiped" in texts
    assert "web added this" in texts

    # Same thin write with correct base + allow-shrink (user-authored edit)
    conn =
      conn(:put, "/calm-oak-ridge-mint/api/note/heb.8.12", thin)
      |> put_req_header("content-type", "application/json")
      |> put_req_header("x-kv-base-updated-at", stamp2)
      |> put_req_header("x-kv-allow-shrink", "1")
      |> Router.call([])

    assert conn.status == 200
    note3 = Jason.decode!(conn.resp_body)
    assert length(note3["blocks"]) == 1
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
    assert proto["features"]["pack_export"] == true
    assert proto["ownership"]["user_owned_pack"] == true

    # pack manifest + export zip
    conn = conn(:get, "/firm-sane-chef-earn/api/pack") |> Router.call([])
    assert conn.status == 200
    man = Jason.decode!(conn.resp_body)
    assert man["notes"] >= 1
    assert man["user_owned"] == true

    conn = conn(:get, "/firm-sane-chef-earn/api/pack/export") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body != ""
    ct = conn |> Plug.Conn.get_resp_header("content-type") |> List.first() || ""
    assert String.contains?(ct, "zip") or byte_size(conn.resp_body) > 30

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


  test "normalize_share_path allows note and read deep links" do
    assert Router.normalize_share_path(nil) == "/"
    assert Router.normalize_share_path("") == "/"
    assert Router.normalize_share_path("/read/jhn.3.16") == "/read/jhn.3.16"
    assert Router.normalize_share_path("/NOTE/JHN.3.16-18") == "/note/jhn.3.16-18"
    assert Router.normalize_share_path("../etc/passwd") == nil
    assert Router.normalize_share_path("https://evil") == nil
    assert Router.normalize_share_path("/api/notes") == nil
  end

  test "share-qr accepts path deep link and rejects invalid path" do
    conn =
      conn(:post, "/setup", %{"intent" => "claim", "door" => "quiet-share-path-test"})
      |> Router.call([])

    assert conn.status == 302

    conn =
      conn(
        :get,
        "/quiet-share-path-test/api/share-qr?origin=https://example.test&path=/read/jhn.3.16"
      )
      |> Router.call([])

    assert conn.status == 200
    ct = conn |> Plug.Conn.get_resp_header("content-type") |> List.first() || ""
    assert String.contains?(ct, "svg")
    assert conn.resp_body =~ "<svg" or conn.resp_body =~ "svg"

    conn =
      conn(
        :get,
        "/quiet-share-path-test/api/share-qr?origin=https://example.test&path=//evil"
      )
      |> Router.call([])

    assert conn.status == 400
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
    assert conn.resp_body =~ "passage-share.js"
    assert conn.resp_body =~ ~s(data-passage-share)
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
      assert html =~ "passage-share.js"
      assert html =~ ~s(data-passage-share)
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
