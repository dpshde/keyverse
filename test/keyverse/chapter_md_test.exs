defmodule Keyverse.ChapterMdTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Keyverse.{ChapterMd, Note, Pack, Router}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-md-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()
    on_exit(fn -> File.rm_rf!(root) end)

    {:ok, door} = Pack.create("warm-lake-pine-road")
    pack = Pack.path_for(door)
    {:ok, root: root, door: door, pack: pack}
  end

  test "blocks_to_md preserves indent as nested list", %{} do
    md =
      ChapterMd.blocks_to_md([
        %{"id" => "a", "indent" => 0, "text" => "parent"},
        %{"id" => "b", "indent" => 1, "text" => "child [[Heb 7:28]]"},
        %{"id" => "c", "indent" => 0, "text" => ""}
      ])

    assert md ==
             "- parent\n  - child [Hebrews 7:28](https://route.bible/heb.7.28)"
  end

  test "wiki links become route.bible MD links" do
    assert ChapterMd.wiki_links_to_md("see [[John 3:16]] and [[jhn.3.16|Love]]") ==
             "see [John 3:16](https://route.bible/jhn.3.16) and [Love](https://route.bible/jhn.3.16)"

    assert ChapterMd.wiki_links_to_md("embed ![[keep]] raw") == "embed ![[keep]] raw"
    assert ChapterMd.wiki_links_to_md("[[not a real book xyz]]") == "[[not a real book xyz]]"
  end

  test "single blank line between verse text and its note", %{pack: pack} do
    now = "2026-01-01T00:00:00Z"

    Note.write!(pack, %{
      "id" => "v1",
      "scope" => %{"kind" => "verse", "osis" => "JHN.3.1", "slug" => "jhn.3.1"},
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "my note"}],
      "created_at" => now,
      "updated_at" => now
    })

    assert {:ok, md} = ChapterMd.render(pack, "jhn.3")
    # Exactly one blank between verse line and first note bullet (not two)
    assert md =~ ~r/\*\*1\*\* [^\n]+\n\n- my note\n/
    refute md =~ ~r/\*\*1\*\* [^\n]+\n\n\n- my note/
  end

  test "render stitches chapter note, verses, verse notes, range notes", %{pack: pack} do
    now = "2026-01-01T00:00:00Z"

    Note.write!(pack, %{
      "id" => "ch",
      "scope" => %{"kind" => "chapter", "osis" => "JHN.3", "slug" => "jhn.3"},
      "blocks" => [%{"id" => "c1", "indent" => 0, "text" => "Chapter setup"}],
      "created_at" => now,
      "updated_at" => now
    })

    Note.write!(pack, %{
      "id" => "v16",
      "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => "jhn.3.16"},
      "blocks" => [
        %{"id" => "b1", "indent" => 0, "text" => "God so loved"},
        %{"id" => "b2", "indent" => 1, "text" => "the world"}
      ],
      "created_at" => now,
      "updated_at" => now
    })

    Note.write!(pack, %{
      "id" => "r",
      "scope" => %{"kind" => "range", "osis" => "JHN.3.14-15", "slug" => "jhn.3.14-15"},
      "blocks" => [%{"id" => "r1", "indent" => 0, "text" => "lifted up"}],
      "created_at" => now,
      "updated_at" => now
    })

    assert {:ok, md} = ChapterMd.render(pack, "jhn.3.16")
    assert md =~ ~r/^# John 3/m
    assert md =~ "BSB"
    assert md =~ "## Chapter note"
    assert md =~ "- Chapter setup"
    assert md =~ "**16**"
    assert md =~ "God so loved"
    assert md =~ "  - the world"
    # range ends at 15 → after verse 15
    assert md =~ "*Note ·"
    assert md =~ "lifted up"
    # verse text present
    assert md =~ "**1**"
  end

  test "GET /api/md returns raw text/markdown", %{door: door, pack: pack} do
    now = "2026-01-01T00:00:00Z"

    Note.write!(pack, %{
      "id" => "v",
      "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => "jhn.3.16"},
      "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "hello md"}],
      "created_at" => now,
      "updated_at" => now
    })

    conn = conn(:get, "/#{door}/api/md/jhn.3") |> Router.call([])
    assert conn.status == 200
    assert get_resp_header(conn, "content-type") |> List.first() =~ "text/markdown"
    assert get_resp_header(conn, "x-keyverse-md") == ["chapter"]
    assert conn.resp_body =~ "# John 3"
    assert conn.resp_body =~ "hello md"
    assert conn.resp_body =~ "**16**"

    # .md suffix and verse slug also work
    conn = conn(:get, "/#{door}/api/md/jhn.3.16.md") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "hello md"

    # public (no door) still serves scripture
    conn = conn(:get, "/api/md/jhn.3") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "# John 3"
    assert conn.resp_body =~ "**16**"
  end

  test "encrypted note is placeholder", %{pack: pack} do
    now = "2026-01-01T00:00:00Z"

    Note.write!(pack, %{
      "id" => "e",
      "scope" => %{"kind" => "verse", "osis" => "JHN.3.1", "slug" => "jhn.3.1"},
      "encrypted" => true,
      "cipher" => %{"v" => 1},
      "blocks" => [],
      "created_at" => now,
      "updated_at" => now
    })

    assert {:ok, md} = ChapterMd.render(pack, "jhn.3")
    assert md =~ "Encrypted note"
    refute md =~ "secret plaintext"
  end

  test "invalid slug is 400", %{door: door} do
    conn = conn(:get, "/#{door}/api/md/not-a-passage") |> Router.call([])
    assert conn.status == 400
  end
end
