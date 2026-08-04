# Regenerates protocol/fixtures/{valid/with_ops,invalid/bad_op_hash}.
# Run: mix run scripts/gen_ops_fixture.exs
#
# The op records use a fixed "at" so the fixture is byte-reproducible; hashes
# in the filenames are sha256 of the file bytes (canonical JSON).

alias Keyverse.{CanonicalJson, Fold}

slug = "jhn.3.16"
at = "2026-01-01T00:00:00.000Z"

write_record = fn dir, record ->
  body = CanonicalJson.encode(record)
  hash = :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)
  File.mkdir_p!(dir)
  File.write!(Path.join(dir, hash <> ".json"), body)
  {hash, record}
end

# --- valid/with_ops ---------------------------------------------------------

root_dir = Path.expand("protocol/fixtures/valid/with_ops")
File.rm_rf!(root_dir)
ops_dir = Path.join([root_dir, "ops", slug])

{h_root, _} =
  write_record.(ops_dir, %{
    "v" => 1,
    "slug" => slug,
    "parents" => [],
    "lamport" => 1,
    "at" => at,
    "ops" => [
      %{
        "op" => "insert",
        "block" => "b1",
        "after" => nil,
        "indent" => 0,
        "text" => "God so loved"
      }
    ]
  })

# concurrent fork: two records share the root as parent and lamport 2
{h_a, _} =
  write_record.(ops_dir, %{
    "v" => 1,
    "slug" => slug,
    "parents" => [h_root],
    "lamport" => 2,
    "at" => at,
    "ops" => [
      %{"op" => "insert", "block" => "b2", "after" => "b1", "indent" => 1, "text" => "the world"}
    ]
  })

{h_b, _} =
  write_record.(ops_dir, %{
    "v" => 1,
    "slug" => slug,
    "parents" => [h_root],
    "lamport" => 2,
    "at" => at,
    "ops" => [
      %{"op" => "set_text", "block" => "b1", "text" => "For God so loved"}
    ]
  })

# merge record referencing both heads
{_h_m, _} =
  write_record.(ops_dir, %{
    "v" => 1,
    "slug" => slug,
    "parents" => Enum.sort([h_a, h_b]),
    "lamport" => 3,
    "at" => at,
    "ops" => [
      %{
        "op" => "insert",
        "block" => "b3",
        "after" => "b2",
        "indent" => 1,
        "text" => "that he gave"
      }
    ]
  })

records =
  ops_dir
  |> File.ls!()
  |> Enum.map(fn f ->
    %{
      hash: String.trim_trailing(f, ".json"),
      record: Jason.decode!(File.read!(Path.join(ops_dir, f)))
    }
  end)

folded = Fold.materialize(Fold.fold(records))

note =
  %{
    "id" => "note_ops1",
    "scope" => %{"kind" => "verse", "osis" => "JHN.3.16", "slug" => slug},
    "blocks" => folded["blocks"],
    "attachments" => folded["attachments"],
    "created_at" => "2026-01-01T00:00:00Z",
    "updated_at" => "2026-01-01T00:00:00Z"
  }

File.mkdir_p!(Path.join(root_dir, "notes"))
File.write!(Path.join(root_dir, "notes/#{slug}.json"), Jason.encode!(note, pretty: true) <> "\n")
File.write!(Path.join(root_dir, "protocol.json"), ~s({"protocol":"keyverse","version":"0.3"}\n))
File.write!(Path.join(root_dir, "door"), "fold-vector-fixture-door\n")

File.write!(
  Path.join(root_dir, "expect.json"),
  Jason.encode!(%{"must_pass" => true, "fold" => %{slug => folded}}, pretty: true) <> "\n"
)

IO.puts("valid/with_ops: fold = #{Jason.encode!(folded)}")

# --- invalid/bad_op_hash ------------------------------------------------------

bad_dir = Path.expand("protocol/fixtures/invalid/bad_op_hash")
File.rm_rf!(bad_dir)
bad_ops = Path.join([bad_dir, "ops", slug])
File.mkdir_p!(bad_ops)

record = %{
  "v" => 1,
  "slug" => slug,
  "parents" => [],
  "lamport" => 1,
  "at" => at,
  "ops" => [%{"op" => "delete", "block" => "b1"}]
}

# deliberately wrong filename
File.write!(
  Path.join(bad_ops, String.duplicate("0", 64) <> ".json"),
  CanonicalJson.encode(record)
)

File.write!(Path.join(bad_dir, "protocol.json"), ~s({"protocol":"keyverse","version":"0.3"}\n))
File.write!(Path.join(bad_dir, "door"), "bad-op-hash-fixture-door\n")

File.write!(
  Path.join(bad_dir, "expect.json"),
  Jason.encode!(%{"error_codes_any" => ["op_hash_mismatch"]}, pretty: true) <> "\n"
)

IO.puts("invalid/bad_op_hash written")
