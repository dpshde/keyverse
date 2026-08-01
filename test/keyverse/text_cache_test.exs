defmodule Keyverse.TextCacheTest do
  use ExUnit.Case, async: false

  alias Keyverse.TextCache

  setup do
    root = Path.join(System.tmp_dir!(), "kv-bsb-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(Path.join(root, "_cache/text/bsb"))
    Application.put_env(:keyverse, :packs_root, root)
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  test "pack serves John 3 from local BSB (no network)" do
    assert {:ok, doc} = TextCache.get_chapter("JHN", 3)
    assert doc["translation"] == "BSB"
    assert doc["license"] in ["public-domain", "public_domain", nil] or is_binary(doc["license"])
    verses = doc["verses"]
    assert is_list(verses) and length(verses) >= 30
    v16 = Enum.find(verses, fn v -> v["v"] == 16 end)
    assert v16
    assert v16["text"] =~ "God so loved the world"
  end

  test "second get is ETS-fast" do
    assert {:ok, _} = TextCache.get_chapter("GEN", 1)
    t0 = System.monotonic_time(:microsecond)
    assert {:ok, doc} = TextCache.get_chapter("GEN", 1)
    dt_us = System.monotonic_time(:microsecond) - t0
    assert dt_us < 5_000
    assert hd(doc["verses"])["text"] =~ "In the beginning"
  end

  test "unknown book / missing chapter errors" do
    assert {:error, _} = TextCache.get_chapter("ZZZ", 1)
    # Psalm 200 doesn't exist
    assert {:error, "chapter not in BSB pack"} = TextCache.get_chapter("PSA", 200)
  end

  test "stats show pack loaded" do
    stats = TextCache.stats()
    assert stats.ets_entries >= 1000
    assert stats.pack_loaded == true
  end
end
