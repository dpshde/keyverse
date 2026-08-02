defmodule Keyverse.ReaderApiTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Keyverse.Router

  setup do
    root = Path.join(System.tmp_dir!(), "kv-reader-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()
    on_exit(fn -> File.rm_rf!(root) end)

    {:ok, door} = Keyverse.Pack.create("calm-river-stone-path")
    {:ok, root: root, door: door}
  end

  test "GET /api/text/bsb/JHN/3 is immutable pack JSON", %{door: door} do
    conn = conn(:get, "/#{door}/api/text/bsb/JHN/3") |> Router.call([])
    assert conn.status == 200
    assert get_resp_header(conn, "cache-control") == ["public, max-age=31536000, immutable"]
    assert get_resp_header(conn, "x-keyverse-text") == ["bsb-pack"]
    body = Jason.decode!(conn.resp_body)
    assert body["book"] in ["JHN", "jhn"] or body["translation"] == "BSB"
    verses = body["verses"]
    assert is_list(verses) and length(verses) >= 30
    v16 = Enum.find(verses, &(&1["v"] == 16))
    assert v16["text"] =~ "God so loved"
  end

  test "GET /api/read/jhn.3 returns bundle with nav + html", %{door: door} do
    # seed a verse note
    note = %{
      "id" => "note_t",
      "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => "jhn.3.16"},
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "hello"}],
      "created_at" => "2026-01-01T00:00:00Z",
      "updated_at" => "2026-01-01T00:00:00Z"
    }

    Keyverse.Note.write!(Keyverse.Pack.path_for(door), note)

    conn = conn(:get, "/#{door}/api/read/jhn.3") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["ok"] == true
    assert body["meta"]["slug"] == "jhn.3"
    assert body["meta"]["next_slug"] == "jhn.4"
    assert body["meta"]["prev_slug"] == "jhn.2"
    assert is_binary(body["html"]["verses"])
    assert body["html"]["verses"] =~ "data-v=\"16\""
    assert body["seed"]["jhn.3.16"]
  end

  test "chapter-scoped note list ignores other books", %{door: door} do
    pack = Keyverse.Pack.path_for(door)

    Keyverse.Note.write!(pack, %{
      "id" => "a",
      "scope" => %{"kind" => "verse", "osis" => "JHN.3.1", "slug" => "jhn.3.1"},
      "blocks" => [%{"id" => "b", "indent" => 0, "text" => "a"}],
      "created_at" => "2026-01-01T00:00:00Z",
      "updated_at" => "2026-01-01T00:00:00Z"
    })

    Keyverse.Note.write!(pack, %{
      "id" => "b",
      "scope" => %{"kind" => "verse", "osis" => "GEN.1.1", "slug" => "gen.1.1"},
      "blocks" => [%{"id" => "b", "indent" => 0, "text" => "b"}],
      "created_at" => "2026-01-01T00:00:00Z",
      "updated_at" => "2026-01-01T00:00:00Z"
    })

    notes = Keyverse.Note.list_for_chapter(pack, "JHN", 3)
    slugs = Enum.map(notes, &get_in(&1, ["scope", "slug"]))
    assert "jhn.3.1" in slugs
    refute "gen.1.1" in slugs
  end
end
