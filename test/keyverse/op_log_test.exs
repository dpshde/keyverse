defmodule Keyverse.OpLogTest do
  use ExUnit.Case, async: true

  alias Keyverse.{CanonicalJson, Fold, OpLog}

  # --- canonical JSON --------------------------------------------------------

  describe "CanonicalJson" do
    test "sorts object keys bytewise and emits compact JSON" do
      assert CanonicalJson.encode(%{"b" => 1, "a" => [2, %{"z" => "x", "y" => nil}]}) ==
               ~s({"a":[2,{"y":null,"z":"x"}],"b":1})
    end

    test "key order does not affect the hash" do
      a = %{"slug" => "jhn.3.16", "v" => 1, "ops" => [%{"op" => "delete", "block" => "b1"}]}
      b = %{"ops" => [%{"block" => "b1", "op" => "delete"}], "v" => 1, "slug" => "jhn.3.16"}
      assert CanonicalJson.sha256(a) == CanonicalJson.sha256(b)
    end

    test "known vector" do
      # cross-implementation anchor: echo -n '{"a":1}' | shasum -a 256
      assert CanonicalJson.encode(%{"a" => 1}) == ~s({"a":1})

      assert CanonicalJson.sha256(%{"a" => 1}) ==
               "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
    end
  end

  # --- fold determinism ------------------------------------------------------

  defp rec(hash, lamport, parents, ops) do
    %{hash: hash, record: %{"v" => 1, "parents" => parents, "lamport" => lamport, "ops" => ops}}
  end

  defp texts(records) do
    records |> Fold.fold() |> Fold.materialize() |> Map.get("blocks") |> Enum.map(& &1["text"])
  end

  describe "Fold.linearize/fold" do
    test "any input order gives the same result" do
      records = [
        rec("a" <> String.duplicate("0", 63), 1, [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "one"}
        ]),
        rec("b" <> String.duplicate("0", 63), 2, ["a" <> String.duplicate("0", 63)], [
          %{"op" => "insert", "block" => "b2", "after" => "b1", "indent" => 0, "text" => "two"}
        ]),
        rec("c" <> String.duplicate("0", 63), 2, ["a" <> String.duplicate("0", 63)], [
          %{"op" => "insert", "block" => "b3", "after" => "b1", "indent" => 0, "text" => "three"}
        ])
      ]

      results =
        records
        |> permutations()
        |> Enum.map(&texts/1)
        |> Enum.uniq()

      assert length(results) == 1
    end

    test "parents come before children even with lower lamport on the child branch" do
      # child has lamport 5, an unrelated root has lamport 9
      parent =
        rec(String.duplicate("1", 64), 4, [], [
          %{"op" => "insert", "block" => "p", "after" => nil, "indent" => 0, "text" => "p"}
        ])

      child =
        rec(String.duplicate("2", 64), 5, [String.duplicate("1", 64)], [
          %{"op" => "set_text", "block" => "p", "text" => "p2"}
        ])

      other =
        rec(String.duplicate("3", 64), 9, [], [
          %{"op" => "insert", "block" => "q", "after" => nil, "indent" => 0, "text" => "q"}
        ])

      order = Fold.linearize([other, child, parent]) |> Enum.map(& &1.hash)

      assert order == [
               String.duplicate("1", 64),
               String.duplicate("2", 64),
               String.duplicate("3", 64)
             ]
    end

    test "concurrent inserts at the same anchor converge by (lamport, hash)" do
      root =
        rec(String.duplicate("0", 64), 1, [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "head"}
        ])

      x =
        rec(String.duplicate("a", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "insert", "block" => "bx", "after" => "b1", "indent" => 0, "text" => "x"}
        ])

      y =
        rec(String.duplicate("b", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "insert", "block" => "by", "after" => "b1", "indent" => 0, "text" => "y"}
        ])

      assert texts([root, x, y]) == texts([y, x, root])
      # lower hash applies first; the later (higher-hash) insert lands directly
      # after the shared anchor, pushing the earlier one down
      assert texts([root, x, y]) == ["head", "y", "x"]
    end

    test "concurrent set_text resolves the same regardless of arrival order" do
      root =
        rec(String.duplicate("0", 64), 1, [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "orig"}
        ])

      x =
        rec(String.duplicate("a", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "set_text", "block" => "b1", "text" => "from x"}
        ])

      y =
        rec(String.duplicate("b", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "set_text", "block" => "b1", "text" => "from y"}
        ])

      assert texts([root, x, y]) == texts([x, y, root])
      assert texts([root, x, y]) == ["from y"]
    end

    test "delete tombstone keeps the anchor usable" do
      root =
        rec(String.duplicate("0", 64), 1, [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "one"},
          %{"op" => "insert", "block" => "b2", "after" => "b1", "indent" => 0, "text" => "two"}
        ])

      del =
        rec(String.duplicate("a", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "delete", "block" => "b1"}
        ])

      ins =
        rec(String.duplicate("b", 64), 2, [String.duplicate("0", 64)], [
          %{
            "op" => "insert",
            "block" => "b3",
            "after" => "b1",
            "indent" => 0,
            "text" => "after one"
          }
        ])

      assert texts([root, del, ins]) == ["after one", "two"]
      assert texts([root, del, ins]) == texts([ins, del, root])
    end

    test "unknown primitive is a no-op" do
      root =
        rec(String.duplicate("0", 64), 1, [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "one"},
          %{"op" => "sparkle", "block" => "b1", "amount" => 11}
        ])

      assert texts([root]) == ["one"]
    end

    test "indent clamps to +1 step on materialize" do
      root =
        rec(String.duplicate("0", 64), 1, [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "a"},
          %{"op" => "insert", "block" => "b2", "after" => "b1", "indent" => 5, "text" => "b"}
        ])

      blocks = [root] |> Fold.fold() |> Fold.materialize() |> Map.get("blocks")
      assert Enum.map(blocks, & &1["indent"]) == [0, 1]
    end

    test "concurrent attachment put/remove converges (put wins by order)" do
      att = %{"id" => "att1", "kind" => "url", "url" => "https://example.com"}

      root =
        rec(String.duplicate("0", 64), 1, [], [
          %{"op" => "put_attachment", "attachment" => att}
        ])

      rm =
        rec(String.duplicate("a", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "remove_attachment", "id" => "att1"}
        ])

      put =
        rec(String.duplicate("b", 64), 2, [String.duplicate("0", 64)], [
          %{"op" => "put_attachment", "attachment" => att}
        ])

      one = [root, rm, put] |> Fold.fold() |> Fold.materialize()
      two = [put, rm, root] |> Fold.fold() |> Fold.materialize()
      assert one == two
      assert one["attachments"] == [att]
    end
  end

  # --- diff → replay round trip ---------------------------------------------

  describe "Fold.diff/2" do
    test "applying the diff over the fold reproduces the target state" do
      a = %{
        "blocks" => [
          %{"id" => "b1", "indent" => 0, "text" => "one"},
          %{"id" => "b2", "indent" => 1, "text" => "two"},
          %{"id" => "b3", "indent" => 0, "text" => "three"}
        ],
        "attachments" => [%{"id" => "att1", "kind" => "url", "url" => "https://a"}]
      }

      b = %{
        "blocks" => [
          %{"id" => "b3", "indent" => 0, "text" => "three"},
          %{"id" => "b4", "indent" => 1, "text" => "new", "collapsed" => true},
          %{"id" => "b1", "indent" => 0, "text" => "one edited"}
        ],
        "attachments" => [%{"id" => "att2", "kind" => "url", "url" => "https://b"}]
      }

      # build a state from a, replay diff, materialize
      base = [rec(String.duplicate("0", 64), 1, [], Fold.diff(Fold.state_from_note(nil), a))]
      ops = Fold.diff(a, b)
      final = base ++ [rec(String.duplicate("1", 64), 2, [String.duplicate("0", 64)], ops)]

      assert Fold.equal?(Fold.materialize(Fold.fold(final)), b)
    end

    test "identical states diff to []" do
      s = %{"blocks" => [%{"id" => "b1", "indent" => 0, "text" => "x"}], "attachments" => []}
      assert Fold.diff(s, s) == []
    end
  end

  # --- OpLog on disk ----------------------------------------------------------

  describe "OpLog" do
    setup do
      dir = Path.join(System.tmp_dir!(), "kv-oplog-#{System.unique_integer([:positive])}")
      File.mkdir_p!(dir)
      on_exit(fn -> File.rm_rf!(dir) end)
      {:ok, pack: dir}
    end

    test "append! names files by sha256 of file bytes", %{pack: pack} do
      %{hash: hash} =
        OpLog.append!(pack, "jhn.3.16", [], [
          %{"op" => "insert", "block" => "b1", "after" => nil, "indent" => 0, "text" => "hi"}
        ])

      path = Path.join([pack, "ops", "jhn.3.16", hash <> ".json"])
      assert File.exists?(path)
      body = File.read!(path)
      assert :crypto.hash(:sha256, body) |> Base.encode16(case: :lower) == hash
      # file bytes are the canonical encoding
      assert body == CanonicalJson.encode(Jason.decode!(body))
    end

    test "records chain: second append references first as parent", %{pack: pack} do
      %{hash: h1} = OpLog.append!(pack, "jhn.3.16", [], [%{"op" => "delete", "block" => "b0"}])
      records = OpLog.list(pack, "jhn.3.16")

      %{record: rec2} =
        OpLog.append!(pack, "jhn.3.16", records, [%{"op" => "delete", "block" => "b1"}])

      assert rec2["parents"] == [h1]
      assert rec2["lamport"] == 2
    end

    test "record_transition! logs a plain edit and fold matches", %{pack: pack} do
      state = %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "hello"}],
        "attachments" => []
      }

      assert :ok =
               OpLog.record_transition!(pack, "jhn.3.16", Fold.state_from_note(nil), state)

      records = OpLog.list(pack, "jhn.3.16")
      assert length(records) == 1
      assert Fold.equal?(Fold.materialize(Fold.fold(records)), state)
    end

    test "out-of-band snapshot edit synthesizes an implicit record", %{pack: pack} do
      s1 = %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "logged"}],
        "attachments" => []
      }

      :ok = OpLog.record_transition!(pack, "jhn.3.16", Fold.state_from_note(nil), s1)

      # snapshot was edited out of band: before_state differs from the fold
      s2 = %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "edited outside"}],
        "attachments" => []
      }

      s3 = %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "next logged edit"}],
        "attachments" => []
      }

      :ok = OpLog.record_transition!(pack, "jhn.3.16", s2, s3)

      records = OpLog.list(pack, "jhn.3.16")
      assert Enum.count(records, & &1.record["implicit"]) == 1
      assert Fold.equal?(Fold.materialize(Fold.fold(records)), s3)
    end

    test "no-op transition appends nothing", %{pack: pack} do
      s = %{"blocks" => [%{"id" => "b1", "indent" => 0, "text" => "x"}], "attachments" => []}
      :ok = OpLog.record_transition!(pack, "jhn.3.16", Fold.state_from_note(nil), s)
      n = length(OpLog.list(pack, "jhn.3.16"))
      :ok = OpLog.record_transition!(pack, "jhn.3.16", s, s)
      assert length(OpLog.list(pack, "jhn.3.16")) == n
    end
  end

  # --- helpers ----------------------------------------------------------------

  defp permutations([]), do: [[]]

  defp permutations(list),
    do: for(x <- list, rest <- permutations(list -- [x]), do: [x | rest])
end
