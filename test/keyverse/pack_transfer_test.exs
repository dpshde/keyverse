defmodule Keyverse.PackTransferTest do
  use ExUnit.Case, async: false

  alias Keyverse.PackTransfer

  @moduletag :protocol

  setup do
    tmp = Path.join(System.tmp_dir!(), "kv-xfer-#{System.unique_integer([:positive])}")
    File.rm_rf!(tmp)
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)
    %{tmp: tmp}
  end

  test "import flat export zip (merge)", %{tmp: tmp} do
    pack = Path.expand("protocol/fixtures/valid/minimal")
    assert {:ok, _name, bin} = PackTransfer.export_zip(pack)

    dest = Path.join(tmp, "flat")
    assert {:ok, info} = PackTransfer.import_zip(dest, bin, mode: :merge)
    assert info.files >= 2
    assert File.exists?(Path.join(dest, "notes/jhn.3.16.json"))
    assert File.exists?(Path.join(dest, "protocol.json"))
  end

  test "import zip with single wrapper directory (Finder Compress)", %{tmp: tmp} do
    pack = Path.expand("protocol/fixtures/valid/minimal")
    assert {:ok, _name, bin} = PackTransfer.export_zip(pack)
    {:ok, files} = :zip.extract(bin, [:memory])

    nested =
      Enum.map(files, fn {n, d} ->
        {~c"my-exported-pack/" ++ n, d}
      end)

    assert {:ok, {_, nested_bin}} = :zip.create(~c"nested.zip", nested, [:memory])

    dest = Path.join(tmp, "nested")
    assert {:ok, info} = PackTransfer.import_zip(dest, nested_bin, mode: :replace)
    assert info.files >= 2
    assert File.exists?(Path.join(dest, "notes/jhn.3.16.json"))
    assert File.exists?(Path.join(dest, "protocol.json"))
    refute File.dir?(Path.join(dest, "my-exported-pack"))
    assert Keyverse.Protocol.Conformance.validate_pack(dest).ok?
  end

  test "import rejects path traversal even under a wrapper", %{tmp: tmp} do
    entries = [
      {~c"evil/../../../etc/passwd", "nope"},
      {~c"pack/notes/../../secret.json", "nope"}
    ]

    assert {:ok, {_, bin}} = :zip.create(~c"bad.zip", entries, [:memory])
    dest = Path.join(tmp, "bad")
    assert {:error, "zip contained no safe pack paths"} = PackTransfer.import_zip(dest, bin, mode: :merge, validate: false)
  end

  test "replace clears notes, attachments, and ops", %{tmp: tmp} do
    dest = Path.join(tmp, "replace-target")
    File.mkdir_p!(Path.join(dest, "notes"))
    File.mkdir_p!(Path.join(dest, "attachments"))
    File.mkdir_p!(Path.join(dest, "ops/old.slug"))
    File.write!(Path.join(dest, "notes/old.json"), "{}\n")
    File.write!(Path.join(dest, "attachments/" <> String.duplicate("a", 64)), "x")
    File.write!(Path.join(dest, "ops/old.slug/" <> String.duplicate("b", 64) <> ".json"), "{}\n")
    File.write!(Path.join(dest, "door"), "keep-me\n")

    pack = Path.expand("protocol/fixtures/valid/minimal")
    assert {:ok, _name, bin} = PackTransfer.export_zip(pack)
    assert {:ok, _} = PackTransfer.import_zip(dest, bin, mode: :replace)

    refute File.exists?(Path.join(dest, "notes/old.json"))
    assert File.exists?(Path.join(dest, "notes/jhn.3.16.json"))
    refute File.dir?(Path.join(dest, "ops/old.slug"))
    # door from zip overwrites when present; fixture has a door
    assert File.exists?(Path.join(dest, "door"))
  end
end
