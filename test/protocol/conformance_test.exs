defmodule Keyverse.Protocol.ConformanceTest do
  use ExUnit.Case, async: false

  @moduletag :protocol

  test "fixture packs meet conformance expectations" do
    result = Keyverse.Protocol.Conformance.validate_fixtures()

    unless result.ok? do
      flunk(
        result.cases
        |> Enum.reject(& &1.ok?)
        |> Enum.map(fn c ->
          errs =
            (c.report.errors || [])
            |> Enum.map(&"#{&1.code}:#{&1.path}")
            |> Enum.join(", ")

          "#{c.kind}/#{Path.basename(c.dir)} #{c[:reason]} [#{errs}]"
        end)
        |> Enum.join("\n")
      )
    end

    assert result.ok?
    assert length(result.cases) >= 8
  end

  test "minimal fixture validates and exports" do
    pack = Path.expand("protocol/fixtures/valid/minimal")
    report = Keyverse.Protocol.Conformance.validate_pack(pack)
    assert report.ok?

    assert {:ok, name, bin} = Keyverse.PackTransfer.export_zip(pack)
    assert String.ends_with?(name, ".zip")
    assert byte_size(bin) > 20

    dest = Path.join(System.tmp_dir!(), "kv-import-#{System.unique_integer([:positive])}")
    File.rm_rf!(dest)
    assert {:ok, info} = Keyverse.PackTransfer.import_zip(dest, bin, mode: :replace)
    assert info.files >= 2
    assert File.exists?(Path.join(dest, "notes/jhn.3.16.json"))
    assert Keyverse.Protocol.Conformance.validate_pack(dest).ok?
    File.rm_rf!(dest)
  end

  test "export excludes disposable text cache" do
    root = Path.join(System.tmp_dir!(), "kv-exp-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(Path.join(root, "notes"))
    File.mkdir_p!(Path.join(root, "text/bsb"))
    File.write!(Path.join(root, "protocol.json"), ~s({"protocol":"keyverse","version":"0.1-demo"}\n))
    File.write!(Path.join(root, "door"), "test-door-key-here\n")

    File.write!(
      Path.join(root, "notes/jhn.3.16.json"),
      Jason.encode!(%{
        "id" => "note_1",
        "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => "jhn.3.16"},
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "x"}],
        "created_at" => "2026-01-01T00:00:00Z",
        "updated_at" => "2026-01-01T00:00:00Z"
      }) <> "\n"
    )

    File.write!(Path.join(root, "text/bsb/JHN.3.json"), "{}\n")

    assert {:ok, _name, bin} = Keyverse.PackTransfer.export_zip(root)
    {:ok, files} = :zip.extract(bin, [:memory])
    names = Enum.map(files, fn {n, _} -> to_string(n) end)
    refute Enum.any?(names, &String.contains?(&1, "text/"))
    assert Enum.any?(names, &String.starts_with?(&1, "notes/"))
    File.rm_rf!(root)
  end
end
