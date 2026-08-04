defmodule Keyverse.Fold do
  @moduledoc """
  Deterministic fold of a note's op DAG into note state (PROTOCOL.md §10).

  The fold is a pure function of the *set* of op records: linearize the DAG
  (topological order, concurrent records tie-broken by `{lamport, hash}`),
  then replay primitive ops with total semantics (no op may fail). Any two
  clients holding the same records produce identical materialized state.

  Internal state keeps tombstones so concurrent edits against deleted blocks
  resolve deterministically; `materialize/1` strips them and clamps indent to
  the +1-step rule.
  """

  @type clean_state :: %{String.t() => list()}

  # --- linearize -------------------------------------------------------------

  @doc """
  Total order over op records: topological (parents first), concurrent
  records ordered by `{lamport, hash}`. Records are `%{hash: h, record: map}`.
  Parents absent from the set are treated as satisfied (dangling is legal).
  """
  def linearize(records) when is_list(records) do
    by_hash = Map.new(records, fn %{hash: h} = r -> {h, r} end)

    present_parents = fn %{record: rec} ->
      rec |> Map.get("parents", []) |> Enum.filter(&Map.has_key?(by_hash, &1))
    end

    children =
      Enum.reduce(records, %{}, fn %{hash: h} = r, acc ->
        Enum.reduce(present_parents.(r), acc, fn p, a ->
          Map.update(a, p, [h], &[h | &1])
        end)
      end)

    indegree = Map.new(records, fn %{hash: h} = r -> {h, length(present_parents.(r))} end)

    ready =
      records
      |> Enum.filter(fn %{hash: h} -> indegree[h] == 0 end)
      |> Enum.map(& &1.hash)
      |> Enum.sort_by(&sort_key(by_hash[&1]))

    do_linearize(ready, indegree, children, by_hash, [])
  end

  defp do_linearize([], _indegree, _children, _by_hash, acc), do: Enum.reverse(acc)

  defp do_linearize([h | rest], indegree, children, by_hash, acc) do
    {ready_adds, indegree} =
      Enum.reduce(Map.get(children, h, []), {[], indegree}, fn c, {adds, ind} ->
        ind = Map.update!(ind, c, &(&1 - 1))
        if ind[c] == 0, do: {[c | adds], ind}, else: {adds, ind}
      end)

    ready =
      (rest ++ Enum.sort_by(ready_adds, &sort_key(by_hash[&1])))
      |> Enum.sort_by(&sort_key(by_hash[&1]))

    do_linearize(ready, indegree, children, by_hash, [by_hash[h] | acc])
  end

  defp sort_key(%{hash: h, record: rec}), do: {rec["lamport"] || 0, h}

  # --- fold ------------------------------------------------------------------

  @doc "Fold op records into internal state (blocks with tombstones)."
  def fold(records) do
    records
    |> linearize()
    |> Enum.reduce(empty_state(), fn %{record: rec}, state ->
      Enum.reduce(List.wrap(rec["ops"]), state, &apply_op(&2, &1))
    end)
  end

  def empty_state, do: %{blocks: [], atts: []}

  # --- primitive op semantics (total: no op may fail) ------------------------

  @doc false
  def apply_op(state, %{"op" => "insert", "block" => id} = op) when is_binary(id) do
    if find_block(state, id) do
      # duplicate insert = no-op (idempotent)
      state
    else
      block =
        %{
          "id" => id,
          "indent" => non_neg_int(op["indent"]),
          "text" => one_line(op["text"]),
          "deleted" => false
        }
        |> maybe_collapsed(op["collapsed"])

      place_after(state, block, op["after"])
    end
  end

  def apply_op(state, %{"op" => "set_text", "block" => id, "text" => text})
      when is_binary(id) do
    update_block(state, id, &Map.put(&1, "text", one_line(text)))
  end

  def apply_op(state, %{"op" => "set_indent", "block" => id} = op) when is_binary(id) do
    update_block(state, id, &Map.put(&1, "indent", non_neg_int(op["indent"])))
  end

  def apply_op(state, %{"op" => "set_collapsed", "block" => id} = op) when is_binary(id) do
    update_block(state, id, fn b ->
      if op["collapsed"] == true,
        do: Map.put(b, "collapsed", true),
        else: Map.delete(b, "collapsed")
    end)
  end

  def apply_op(state, %{"op" => "move", "block" => id} = op) when is_binary(id) do
    case find_block(state, id) do
      nil ->
        state

      block ->
        state = %{state | blocks: Enum.reject(state.blocks, &(&1["id"] == id))}
        place_after(state, block, op["after"])
    end
  end

  def apply_op(state, %{"op" => "delete", "block" => id}) when is_binary(id) do
    case find_block(state, id) do
      nil ->
        # tombstone for a block we never saw: keep totality
        tomb = %{"id" => id, "indent" => 0, "text" => "", "deleted" => true}
        %{state | blocks: state.blocks ++ [tomb]}

      _ ->
        update_block(state, id, &Map.put(&1, "deleted", true))
    end
  end

  def apply_op(state, %{"op" => "put_attachment", "attachment" => %{"id" => id} = row})
      when is_binary(id) do
    # remove-then-append: reproduces attachment display order deterministically
    atts = Enum.reject(state.atts, &(&1["id"] == id))
    %{state | atts: atts ++ [%{"id" => id, "row" => row}]}
  end

  def apply_op(state, %{"op" => "remove_attachment", "id" => id}) when is_binary(id) do
    atts = Enum.reject(state.atts, &(&1["id"] == id))
    %{state | atts: atts ++ [%{"id" => id, "row" => nil}]}
  end

  # unknown / malformed op: no-op (forward compatibility)
  def apply_op(state, _op), do: state

  defp find_block(state, id), do: Enum.find(state.blocks, &(&1["id"] == id))

  defp update_block(state, id, fun) do
    %{
      state
      | blocks: Enum.map(state.blocks, fn b -> if b["id"] == id, do: fun.(b), else: b end)
    }
  end

  # after: nil = head; block id = immediately after that block (tombstones keep
  # position); unknown anchor = append at end
  defp place_after(state, block, nil), do: %{state | blocks: [block | state.blocks]}

  defp place_after(state, block, anchor) when is_binary(anchor) do
    case Enum.find_index(state.blocks, &(&1["id"] == anchor)) do
      nil -> %{state | blocks: state.blocks ++ [block]}
      i -> %{state | blocks: List.insert_at(state.blocks, i + 1, block)}
    end
  end

  defp place_after(state, block, _), do: %{state | blocks: state.blocks ++ [block]}

  defp maybe_collapsed(block, true), do: Map.put(block, "collapsed", true)
  defp maybe_collapsed(block, _), do: block

  defp non_neg_int(n) when is_integer(n) and n >= 0, do: min(n, 32)
  defp non_neg_int(_), do: 0

  defp one_line(t) do
    t |> to_string() |> String.replace(["\n", "\r"], " ")
  end

  # --- materialize -----------------------------------------------------------

  @doc """
  Strip tombstones and clamp indent to the +1-step rule. Returns a clean
  state: `%{"blocks" => [...], "attachments" => [...]}` matching note shape.
  """
  def materialize(state) do
    blocks =
      state.blocks
      |> Enum.reject(& &1["deleted"])
      |> Enum.map(&Map.delete(&1, "deleted"))
      |> clamp_indents()

    attachments = state.atts |> Enum.map(& &1["row"]) |> Enum.reject(&is_nil/1)
    %{"blocks" => blocks, "attachments" => attachments}
  end

  defp clamp_indents(blocks) do
    {out, _} =
      Enum.reduce(blocks, {[], -1}, fn b, {acc, prev} ->
        indent = min(b["indent"], prev + 1)
        {[Map.put(b, "indent", indent) | acc], indent}
      end)

    Enum.reverse(out)
  end

  # --- clean-state helpers ----------------------------------------------------

  @doc "Clean state from a (plaintext) note record, or empty for nil."
  def state_from_note(nil), do: %{"blocks" => [], "attachments" => []}

  def state_from_note(note) when is_map(note) do
    blocks =
      note["blocks"]
      |> List.wrap()
      |> Enum.filter(&is_map/1)
      |> Enum.map(fn b ->
        %{
          "id" => to_string(b["id"] || ""),
          "indent" => non_neg_int(b["indent"]),
          "text" => one_line(b["text"])
        }
        |> maybe_collapsed(b["collapsed"] == true)
      end)

    %{
      "blocks" => blocks,
      "attachments" => note["attachments"] |> List.wrap() |> Enum.filter(&is_map/1)
    }
  end

  @doc "Structural equality of two clean states."
  def equal?(a, b) do
    normalize_clean(a) == normalize_clean(b)
  end

  defp normalize_clean(s) do
    %{
      "blocks" =>
        Enum.map(s["blocks"] || [], &Map.take(&1, ["id", "indent", "text", "collapsed"])),
      "attachments" => s["attachments"] || []
    }
  end

  # --- diff (clean state A → clean state B → primitive ops) -------------------

  @doc """
  Primitive ops that transform clean state `a` into clean state `b` when
  applied in order. Kept blocks (LCS of common ids) are never moved; others
  are anchored after their predecessor in `b`.
  """
  def diff(a, b) do
    a_blocks = a["blocks"] || []
    b_blocks = b["blocks"] || []
    a_by_id = Map.new(a_blocks, &{&1["id"], &1})
    b_ids = MapSet.new(b_blocks, & &1["id"])

    deletes =
      a_blocks
      |> Enum.reject(&MapSet.member?(b_ids, &1["id"]))
      |> Enum.map(&%{"op" => "delete", "block" => &1["id"]})

    kept = kept_ids(a_blocks, b_blocks)

    {order_and_field_ops, _prev} =
      Enum.reduce(b_blocks, {[], nil}, fn blk, {ops, prev} ->
        id = blk["id"]

        ops =
          cond do
            not Map.has_key?(a_by_id, id) ->
              insert =
                %{
                  "op" => "insert",
                  "block" => id,
                  "after" => prev,
                  "indent" => blk["indent"],
                  "text" => blk["text"]
                }
                |> then(fn op ->
                  if blk["collapsed"] == true, do: Map.put(op, "collapsed", true), else: op
                end)

              [insert | ops]

            not MapSet.member?(kept, id) ->
              move = %{"op" => "move", "block" => id, "after" => prev}
              Enum.reverse(field_ops(a_by_id[id], blk)) ++ [move | ops]

            true ->
              Enum.reverse(field_ops(a_by_id[id], blk)) ++ ops
          end

        {ops, id}
      end)

    att_ops = attachment_ops(a["attachments"] || [], b["attachments"] || [])
    deletes ++ Enum.reverse(order_and_field_ops) ++ att_ops
  end

  defp field_ops(a, b) do
    []
    |> then(fn ops ->
      if a["text"] != b["text"],
        do: [%{"op" => "set_text", "block" => b["id"], "text" => b["text"]} | ops],
        else: ops
    end)
    |> then(fn ops ->
      if a["indent"] != b["indent"],
        do: [%{"op" => "set_indent", "block" => b["id"], "indent" => b["indent"]} | ops],
        else: ops
    end)
    |> then(fn ops ->
      if a["collapsed"] == true != (b["collapsed"] == true),
        do: [
          %{"op" => "set_collapsed", "block" => b["id"], "collapsed" => b["collapsed"] == true}
          | ops
        ],
        else: ops
    end)
  end

  # Longest common subsequence of block ids present in both lists: these keep
  # their relative order and are never moved.
  defp kept_ids(a_blocks, b_blocks) do
    b_ids = MapSet.new(b_blocks, & &1["id"])
    a_ids = MapSet.new(a_blocks, & &1["id"])
    xs = a_blocks |> Enum.map(& &1["id"]) |> Enum.filter(&MapSet.member?(b_ids, &1))
    ys = b_blocks |> Enum.map(& &1["id"]) |> Enum.filter(&MapSet.member?(a_ids, &1))
    MapSet.new(lcs(xs, ys))
  end

  defp lcs([], _), do: []
  defp lcs(_, []), do: []

  defp lcs(xs, ys) do
    xs_t = List.to_tuple(xs)
    ys_t = List.to_tuple(ys)
    n = tuple_size(xs_t)
    m = tuple_size(ys_t)

    table =
      Enum.reduce((n - 1)..0//-1, %{}, fn i, tab ->
        Enum.reduce((m - 1)..0//-1, tab, fn j, t ->
          v =
            if elem(xs_t, i) == elem(ys_t, j) do
              1 + Map.get(t, {i + 1, j + 1}, 0)
            else
              max(Map.get(t, {i + 1, j}, 0), Map.get(t, {i, j + 1}, 0))
            end

          Map.put(t, {i, j}, v)
        end)
      end)

    walk_lcs(0, 0, n, m, xs_t, ys_t, table, [])
  end

  defp walk_lcs(i, j, n, m, _xs, _ys, _tab, acc) when i >= n or j >= m, do: Enum.reverse(acc)

  defp walk_lcs(i, j, n, m, xs, ys, tab, acc) do
    cond do
      elem(xs, i) == elem(ys, j) ->
        walk_lcs(i + 1, j + 1, n, m, xs, ys, tab, [elem(xs, i) | acc])

      Map.get(tab, {i + 1, j}, 0) >= Map.get(tab, {i, j + 1}, 0) ->
        walk_lcs(i + 1, j, n, m, xs, ys, tab, acc)

      true ->
        walk_lcs(i, j + 1, n, m, xs, ys, tab, acc)
    end
  end

  # Attachments: removes for missing ids; if the surviving sequence (ids and
  # rows) differs at all, re-put every attachment of `b` in order
  # (put = remove-then-append), reproducing display order exactly.
  defp attachment_ops(a_atts, b_atts) do
    b_ids = MapSet.new(b_atts, & &1["id"])

    removes =
      a_atts
      |> Enum.reject(&MapSet.member?(b_ids, &1["id"]))
      |> Enum.map(&%{"op" => "remove_attachment", "id" => &1["id"]})

    survivors = Enum.filter(a_atts, &MapSet.member?(b_ids, &1["id"]))

    puts =
      if survivors == b_atts do
        []
      else
        Enum.map(b_atts, &%{"op" => "put_attachment", "attachment" => &1})
      end

    removes ++ puts
  end
end
