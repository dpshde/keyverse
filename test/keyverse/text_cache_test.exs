defmodule Keyverse.TextCacheTest do
  use ExUnit.Case, async: false

  alias Keyverse.TextCache

  setup do
    root = Path.join(System.tmp_dir!(), "kv-bsb-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(Path.join(root, "_cache/text/bsb"))
    Application.put_env(:keyverse, :packs_root, root)

    # Clear ETS between tests
    case :ets.whereis(:keyverse_bsb_text) do
      :undefined -> :ok
      tid -> :ets.delete_all_objects(tid)
    end

    on_exit(fn -> File.rm_rf!(root) end)
    {:ok, root: root}
  end

  test "disk hit populates ETS and second get is ETS-fast", %{root: root} do
    path = Path.join(root, "_cache/text/bsb/jhn.3.json")

    doc = %{
      "translation" => "BSB",
      "book" => "JHN",
      "chapter" => 3,
      "verses" => [%{"v" => 16, "text" => "For God so loved the world"}],
      "fetched_at" => "2026-01-01T00:00:00Z"
    }

    File.write!(path, Jason.encode!(doc) <> "\n")

    assert {:ok, got} = TextCache.get_chapter("JHN", 3)
    assert get_in(got, ["verses", Access.at(0), "text"]) =~ "God so loved"

    # Second call should not need disk (ETS)
    t0 = System.monotonic_time(:microsecond)
    assert {:ok, ^got} = TextCache.get_chapter("JHN", 3)
    dt_us = System.monotonic_time(:microsecond) - t0
    assert dt_us < 5_000
  end

  test "unknown book errors" do
    assert {:error, "unknown book"} = TextCache.get_chapter("ZZZ", 1)
  end

  test "stats reports ets entries", %{root: root} do
    path = Path.join(root, "_cache/text/bsb/gen.1.json")

    File.write!(
      path,
      Jason.encode!(%{
        "translation" => "BSB",
        "book" => "GEN",
        "chapter" => 1,
        "verses" => [%{"v" => 1, "text" => "In the beginning"}],
        "fetched_at" => "2026-01-01T00:00:00Z"
      }) <> "\n"
    )

    assert {:ok, _} = TextCache.get_chapter("GEN", 1)
    stats = TextCache.stats()
    assert stats.ets_entries >= 1
  end
end
