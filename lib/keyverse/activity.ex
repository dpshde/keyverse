defmodule Keyverse.Activity do
  @moduledoc """
  Pack activity for the contribution graph (GitHub-style heatmap) and day detail.

  Primary source: `ops/<slug>/*.json` wall-clock `at` (informational timestamps).
  Fallback: note `created_at` only when a slug has no op log yet (not
  `updated_at` — import/sync rewrites that and looks like a mass edit).
  Day detail reconstructs before/after outline text by replaying the op fold
  so clients can render a line diff.
  """

  alias Keyverse.{Fold, Note, OpLog, Scope}

  @type day_cell :: %{
          date: String.t(),
          count: non_neg_integer(),
          level: 0..4
        }

  @doc """
  Heatmap for the **calendar year to date** (UTC): Jan 1 → today.

  Lead metric is **notes taken YTD**: unique notes first written this year.

  Optional `days:` still accepted for tests / legacy clients (trailing N days
  ending today); product UI always uses YTD.

  Returns:
  ```
  %{
    days: [%{date, count, level}],
    total: n,                    # event count in graph window
    notes_taken_ytd: n,
    ytd_from: "YYYY-01-01",
    ytd_to: "YYYY-MM-DD",
    from: "YYYY-MM-DD",          # same as ytd_from when range is YTD
    to: "YYYY-MM-DD",
    source: "ops" | "mixed" | "notes"
  }
  ```
  """
  def heatmap(pack_dir, opts \\ []) do
    today = Date.utc_today()
    ytd_from = Date.new!(today.year, 1, 1)

    from =
      case Keyword.fetch(opts, :days) do
        {:ok, days} -> Date.add(today, -(clamp_days(days) - 1))
        :error -> ytd_from
      end

    # Never start before year start when defaulting; if days is set, allow it.
    span_days = Date.diff(today, from) + 1

    events =
      pack_dir
      |> collect_events(from, today)
      |> drop_empty_net_sessions()

    counts = Enum.reduce(events, %{}, fn e, acc -> Map.update(acc, e.date, 1, &(&1 + 1)) end)

    cells =
      Enum.map(0..(span_days - 1), fn i ->
        d = Date.add(from, i)
        iso = Date.to_iso8601(d)
        c = Map.get(counts, iso, 0)
        %{date: iso, count: c, level: level(c)}
      end)

    source =
      cond do
        events == [] ->
          "notes"

        Enum.any?(events, &(&1.kind == "snapshot")) and Enum.any?(events, &(&1.kind == "edit")) ->
          "mixed"

        Enum.any?(events, &(&1.kind == "edit")) ->
          "ops"

        true ->
          "notes"
      end

    # Notes taken always uses full calendar YTD (even if graph window is custom).
    ytd_events =
      if Date.compare(from, ytd_from) == :eq do
        events
      else
        pack_dir
        |> collect_events(ytd_from, today)
        |> drop_empty_net_sessions()
      end

    notes_taken_ytd = count_notes_taken(ytd_events)

    %{
      days: cells,
      total: Enum.reduce(cells, 0, &(&1.count + &2)),
      notes_taken_ytd: notes_taken_ytd,
      ytd_from: Date.to_iso8601(ytd_from),
      ytd_to: Date.to_iso8601(today),
      from: Date.to_iso8601(from),
      to: Date.to_iso8601(today),
      source: source,
      # Canon coverage rail (note density by book; 1 note/chapter → 90% heat)
      canon: Keyverse.Canon.coverage(pack_dir)
    }
  end

  # Unique notes first written in this period (create / root op / empty→content).
  defp count_notes_taken(events) when is_list(events) do
    events
    |> Enum.filter(&note_taken_event?/1)
    |> Enum.map(& &1.slug)
    |> Enum.reject(&(&1 == "" or is_nil(&1)))
    |> Enum.uniq()
    |> length()
  end

  defp note_taken_event?(%{kind: "created"}), do: true

  defp note_taken_event?(%{kind: "snapshot"} = e) do
    # First snapshot write: empty → any content (text and/or attachments/links).
    empty_note_state?(Map.get(e, :before_state)) and
      not empty_note_state?(Map.get(e, :after_state))
  end

  defp note_taken_event?(%{kind: "edit"} = e) do
    # First write in the log: empty before, content after (text and/or attachments).
    empty_note_state?(Map.get(e, :before_state)) and
      not empty_note_state?(Map.get(e, :after_state))
  end

  defp note_taken_event?(_), do: false

  # Empty = no non-blank block text AND no attachments/links.
  defp empty_note_state?(nil), do: true

  defp empty_note_state?(state) when is_map(state) do
    empty_blocks?(Map.get(state, "blocks")) and empty_attachments?(Map.get(state, "attachments"))
  end

  defp empty_note_state?(_), do: true

  defp empty_blocks?(nil), do: true
  defp empty_blocks?(blocks) when blocks == [], do: true

  defp empty_blocks?(blocks) when is_list(blocks) do
    Enum.all?(blocks, fn b -> not is_map(b) or String.trim(to_string(b["text"] || "")) == "" end)
  end

  defp empty_blocks?(_), do: true

  defp empty_attachments?(nil), do: true
  defp empty_attachments?(atts) when is_list(atts), do: atts == []
  defp empty_attachments?(_), do: true

  # Kept for bootstrap_at call sites / older naming.
  defp empty_outline_state?(state), do: empty_note_state?(state)

  @doc """
  Events on a single UTC calendar day (`YYYY-MM-DD`), newest first.

  Multiple op records for the **same note** on that day are coalesced into one
  card: `before_text` is the outline before the first edit of the day,
  `after_text` is the outline after the last — so a type-then-edit session
  (`"t"` → `"123"`) shows as one net diff, not two micro-cards.

  Net empty sessions (open tray → type → wipe / delete empty note) are omitted:
  both the day's first before-state and last after-state are empty (no text and
  no attachments).

  Each event may include `before_text` / `after_text` (outline form) for diffs.
  """
  def day(pack_dir, date_iso) when is_binary(date_iso) do
    case Date.from_iso8601(date_iso) do
      {:ok, date} ->
        events =
          pack_dir
          |> collect_events(date, date)
          |> Enum.map(&enrich_event/1)
          |> coalesce_by_slug()
          |> Enum.reject(&empty_net_session?/1)
          |> Enum.sort_by(& &1.at, :desc)

        %{
          date: date_iso,
          count: length(events),
          events: Enum.map(events, &public_event/1)
        }

      _ ->
        {:error, :invalid_date}
    end
  end

  # One card per note per day: first before → last after, merged summaries.
  defp coalesce_by_slug(events) do
    events
    |> Enum.group_by(& &1.slug)
    |> Enum.map(fn {_slug, group} ->
      ordered = Enum.sort_by(group, &Map.get(&1, :at, ""), :asc)
      first = hd(ordered)
      last = List.last(ordered)
      n = length(ordered)

      ops = Enum.flat_map(ordered, &(Map.get(&1, :ops) || []))

      base = %{
        kind: if(n == 1, do: Map.get(first, :kind), else: "session"),
        slug: Map.get(first, :slug),
        hash: Map.get(last, :hash),
        at: Map.get(last, :at),
        date: Map.get(first, :date),
        implicit: Enum.any?(ordered, &(Map.get(&1, :implicit) == true)),
        ops: ops,
        before_state: Map.get(first, :before_state),
        after_state: Map.get(last, :after_state),
        before_text: Map.get(first, :before_text),
        after_text: Map.get(last, :after_text),
        label: Map.get(last, :label) || Map.get(first, :label),
        encrypted: Map.get(first, :encrypted) == true,
        change_count: n
      }

      # Summary matches the *net* preview (text + attachments), not raw op micro-counts.
      Map.put(
        base,
        :summary,
        net_content_summary(Map.get(base, :before_state), Map.get(base, :after_state))
      )
    end)
  end

  # Drop slug-day groups whose *net* change is empty → empty (tray noise / wiped drafts).
  # Used by heatmap so open-type-delete doesn't paint a contribution cell.
  defp drop_empty_net_sessions(events) do
    events
    |> Enum.group_by(fn e -> {Map.get(e, :slug), Map.get(e, :date)} end)
    |> Enum.flat_map(fn {_key, group} ->
      ordered = Enum.sort_by(group, &Map.get(&1, :at, ""), :asc)
      first = hd(ordered)
      last = List.last(ordered)

      if empty_net_session?(%{
           before_state: Map.get(first, :before_state),
           after_state: Map.get(last, :after_state)
         }) do
        []
      else
        group
      end
    end)
  end

  defp empty_net_session?(e) do
    empty_note_state?(Map.get(e, :before_state)) and empty_note_state?(Map.get(e, :after_state))
  end

  # Human summary: block text changes + attachment/link changes (separate).
  defp net_content_summary(before_state, after_state) do
    a = block_text_lines(before_state)
    b = block_text_lines(after_state)
    {att_add, att_del} = attachment_diff_counts(before_state, after_state)

    text_parts =
      cond do
        a == [] and b == [] ->
          []

        a == [] and length(b) == 1 ->
          ["Added"]

        a == [] ->
          ["#{length(b)} lines added"]

        b == [] and length(a) == 1 ->
          ["Removed"]

        b == [] ->
          ["#{length(a)} lines removed"]

        true ->
          {adds, dels} = line_diff_counts(a, b)

          []
          |> then(fn p -> if dels > 0, do: ["#{dels} removed" | p], else: p end)
          |> then(fn p -> if adds > 0, do: ["#{adds} added" | p], else: p end)
          |> Enum.reverse()
      end

    att_parts =
      []
      |> then(fn p -> if att_del > 0, do: [att_word(att_del, "removed") | p], else: p end)
      |> then(fn p -> if att_add > 0, do: [att_word(att_add, "attached") | p], else: p end)
      |> Enum.reverse()

    parts = text_parts ++ att_parts

    cond do
      parts != [] -> Enum.join(parts, " · ")
      empty_note_state?(before_state) and empty_note_state?(after_state) -> "Empty"
      true -> "Edited"
    end
  end

  defp block_text_lines(nil), do: []

  defp block_text_lines(state) when is_map(state) do
    outline_lines(
      outline_text(%{"blocks" => Map.get(state, "blocks") || [], "attachments" => []})
    )
  end

  defp block_text_lines(_), do: []

  defp att_word(1, "attached"), do: "1 attachment"
  defp att_word(n, "attached"), do: "#{n} attachments"
  defp att_word(1, "removed"), do: "1 detached"
  defp att_word(n, "removed"), do: "#{n} detached"

  defp attachment_diff_counts(before_state, after_state) do
    ba = attachment_ids(before_state)
    aa = attachment_ids(after_state)
    {MapSet.size(MapSet.difference(aa, ba)), MapSet.size(MapSet.difference(ba, aa))}
  end

  defp attachment_ids(nil), do: MapSet.new()

  defp attachment_ids(%{"attachments" => atts}) when is_list(atts) do
    atts
    |> Enum.map(fn
      %{"id" => id} when is_binary(id) -> id
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
    |> MapSet.new()
  end

  defp attachment_ids(_), do: MapSet.new()

  defp outline_lines(nil), do: []

  defp outline_lines(text) when is_binary(text) do
    text
    |> String.split("\n")
    |> Enum.map(&String.trim_trailing/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp outline_lines(_), do: []

  # Count pure inserts/deletes via LCS (same metric as the web outline preview).
  defp line_diff_counts(a, b) do
    m = length(a)
    n = length(b)
    a_t = List.to_tuple(a)
    b_t = List.to_tuple(b)

    dp =
      for i <- 0..m, into: %{} do
        {i, for(j <- 0..n, into: %{}, do: {j, 0})}
      end

    dp =
      Enum.reduce(1..m//1, dp, fn i, dp ->
        Enum.reduce(1..n//1, dp, fn j, dp ->
          v =
            if elem(a_t, i - 1) == elem(b_t, j - 1) do
              dp[i - 1][j - 1] + 1
            else
              max(dp[i - 1][j], dp[i][j - 1])
            end

          put_in(dp[i][j], v)
        end)
      end)

    lcs = dp[m][n]
    {n - lcs, m - lcs}
  end

  # --- collection -------------------------------------------------------------

  defp collect_events(pack_dir, from, to) do
    op_events = events_from_ops(pack_dir, from, to)
    # Use all slugs that have an op log, not only those with events in-range,
    # so remapped bootstrap ops don't also emit note created_at duplicates.
    slugs_with_ops = all_op_slugs(pack_dir)
    note_events = events_from_notes(pack_dir, from, to, slugs_with_ops)
    op_events ++ note_events
  end

  defp events_from_ops(pack_dir, from, to) do
    root = OpLog.ops_root(pack_dir)

    case File.ls(root) do
      {:ok, slugs} ->
        Enum.flat_map(slugs, fn slug ->
          if String.starts_with?(slug, ".") do
            []
          else
            slug_op_events(pack_dir, slug, from, to)
          end
        end)

      _ ->
        []
    end
  end

  defp slug_op_events(pack_dir, slug, from, to) do
    records = OpLog.list(pack_dir, slug)
    lin = Fold.linearize(records)
    created_at = note_created_at(pack_dir, slug)

    {events, _state, _} =
      Enum.reduce(lin, {[], Fold.empty_state(), true}, fn %{hash: hash, record: rec},
                                                           {acc, state, is_first} ->
        before_mat = Fold.materialize(state)
        ops = List.wrap(rec["ops"])

        state_after =
          Enum.reduce(ops, state, fn op, st -> Fold.apply_op(st, op) end)

        after_mat = Fold.materialize(state_after)

        at =
          bootstrap_at(rec["at"], created_at, before_mat, after_mat, is_first, rec)

        date = iso_date(at)

        acc =
          if date && in_range?(date, from, to) do
            event = %{
              kind: "edit",
              slug: slug,
              hash: hash,
              at: at || "",
              date: date,
              implicit: rec["implicit"] == true,
              ops: ops,
              before_state: before_mat,
              after_state: after_mat,
              label: label_for_slug(slug, pack_dir)
            }

            [event | acc]
          else
            acc
          end

        {acc, state_after, false}
      end)

    Enum.reverse(events)
  end

  defp note_created_at(pack_dir, slug) do
    case Note.read(pack_dir, slug) do
      %{"created_at" => at} when is_binary(at) and at != "" -> at
      _ -> nil
    end
  end

  # Prefer note.created_at for log-seed / first-write ops so bulk mirror after
  # ops shipped does not pile every note onto "today".
  defp bootstrap_at(rec_at, created_at, before_state, after_state, is_first, rec)
       when is_binary(created_at) and created_at != "" do
    cond do
      # Classic empty→content first write
      empty_outline_state?(before_state) and not empty_outline_state?(after_state) ->
        created_at

      # First record in log, implicit seed, or no parents (root)
      is_first and (rec["implicit"] == true or List.wrap(rec["parents"]) == []) and
          not empty_outline_state?(after_state) ->
        created_at

      true ->
        rec_at
    end
  end

  defp bootstrap_at(rec_at, _created_at, _before, _after, _first, _rec), do: rec_at

  # Slugs that have *any* ops on disk (not just ops in the date window).
  # Prevents double-counting created_at note events when ops exist but fall
  # outside the queried day after remapping.
  defp all_op_slugs(pack_dir) do
    root = OpLog.ops_root(pack_dir)

    case File.ls(root) do
      {:ok, names} ->
        names
        |> Enum.reject(&String.starts_with?(&1, "."))
        |> MapSet.new()

      _ ->
        MapSet.new()
    end
  end

  defp events_from_notes(pack_dir, from, to, slugs_with_ops) do
    Note.list(pack_dir)
    |> Enum.flat_map(fn note ->
      slug = get_in(note, ["scope", "slug"]) || ""
      if slug == "" or MapSet.member?(slugs_with_ops, slug), do: [], else: note_touch_events(note, from, to)
    end)
  end

  defp note_touch_events(note, from, to) do
    slug = get_in(note, ["scope", "slug"]) || ""
    label = note_label(note)
    encrypted = is_map(note["cipher"])

    # Only `created_at` — never `updated_at` (import/mirror rewrites that stamp).
    at = note["created_at"]

    with true <- is_binary(at),
         date when is_binary(date) <- iso_date(at),
         true <- in_range?(date, from, to) do
      state = if encrypted, do: nil, else: Fold.state_from_note(note)
      text = if state, do: outline_text(state), else: nil

      [
        %{
          kind: "created",
          slug: slug,
          hash: nil,
          at: at,
          date: date,
          implicit: false,
          ops: [],
          before_state: %{"blocks" => [], "attachments" => []},
          after_state: state,
          before_text: "",
          after_text: text,
          label: label,
          encrypted: encrypted
        }
      ]
    else
      _ -> []
    end
  end

  defp enrich_event(%{before_state: b, after_state: a} = e) do
    e
    |> Map.put_new(:before_text, if(b, do: outline_text(b), else: nil))
    |> Map.put_new(:after_text, if(a, do: outline_text(a), else: nil))
    |> Map.put(:summary, summarize_ops(e.ops, e.kind))
  end

  defp public_event(e) do
    before = Map.get(e, :before_text)
    after_t = Map.get(e, :after_text)
    before_state = Map.get(e, :before_state)
    after_state = Map.get(e, :after_state)

    text_diff =
      is_binary(before) and is_binary(after_t) and before != after_t

    {att_add, att_del} = attachment_diff_counts(before_state, after_state)
    att_diff = att_add + att_del > 0

    %{
      kind: Map.get(e, :kind),
      slug: Map.get(e, :slug),
      label: Map.get(e, :label),
      at: Map.get(e, :at),
      hash: Map.get(e, :hash),
      implicit: Map.get(e, :implicit) == true,
      summary: Map.get(e, :summary),
      op_count: length(Map.get(e, :ops) || []),
      change_count: Map.get(e, :change_count) || 1,
      before_text: before,
      after_text: after_t,
      before_attachments: attachment_list(before_state),
      after_attachments: attachment_list(after_state),
      encrypted: Map.get(e, :encrypted) == true,
      has_diff: text_diff or att_diff
    }
  end

  defp attachment_list(nil), do: []

  defp attachment_list(%{"attachments" => atts}) when is_list(atts) do
    Enum.map(atts, &attachment_public/1)
  end

  defp attachment_list(_), do: []

  defp attachment_public(a) when is_map(a) do
    %{
      id: a["id"],
      kind: a["kind"] || "file",
      label: attachment_label(a)
    }
  end

  defp attachment_public(_), do: %{id: nil, kind: "file", label: "attachment"}

  defp attachment_label(%{"kind" => "url"} = a) do
    cond do
      is_binary(a["title"]) and String.trim(a["title"]) != "" -> String.trim(a["title"])
      is_binary(a["url"]) -> a["url"]
      true -> "link"
    end
  end

  defp attachment_label(a) when is_map(a) do
    cond do
      is_binary(a["filename"]) and a["filename"] != "" -> a["filename"]
      is_binary(a["title"]) and a["title"] != "" -> a["title"]
      is_binary(a["mime"]) -> a["mime"]
      true -> "file"
    end
  end

  defp attachment_label(_), do: "attachment"

  # --- presentation -----------------------------------------------------------

  @doc false
  def outline_text(%{"blocks" => blocks} = state) when is_list(blocks) do
    # Drop trailing empty blocks (outliner often keeps a blank caret line).
    trimmed =
      blocks
      |> Enum.reverse()
      |> Enum.drop_while(fn b -> String.trim(b["text"] || "") == "" end)
      |> Enum.reverse()

    body =
      trimmed
      |> Enum.map(fn b ->
        indent = max(0, b["indent"] || 0)
        text = b["text"] || ""
        String.duplicate("  ", indent) <> text
      end)

    # Attachments/links as preview lines so day diffs surface them.
    att_lines =
      (Map.get(state, "attachments") || [])
      |> Enum.filter(&is_map/1)
      |> Enum.map(fn a ->
        case a["kind"] do
          "url" -> "🔗 " <> attachment_label(a)
          _ -> "📎 " <> attachment_label(a)
        end
      end)

    (body ++ att_lines) |> Enum.join("\n")
  end

  def outline_text(_), do: ""

  defp summarize_ops([], "created"), do: "Note created"
  defp summarize_ops([], "snapshot"), do: "Note updated"
  defp summarize_ops([], _), do: "Change"

  defp summarize_ops(ops, _) do
    counts =
      ops
      |> Enum.reduce(%{}, fn op, acc ->
        name = op["op"] || "op"
        Map.update(acc, name, 1, &(&1 + 1))
      end)

    # Prefer human attachment wording over raw op tallies for link/file notes.
    att_n = Map.get(counts, "put_attachment", 0)
    det_n = Map.get(counts, "remove_attachment", 0)

    parts =
      [
        {"insert", "added"},
        {"delete", "removed"},
        {"set_text", "edited"},
        {"set_indent", "re-indented"},
        {"set_collapsed", "collapsed"},
        {"move", "moved"}
      ]
      |> Enum.flat_map(fn {op, word} ->
        case Map.get(counts, op) do
          n when is_integer(n) and n > 0 -> ["#{n} #{word}"]
          _ -> []
        end
      end)

    parts =
      parts
      |> then(fn p -> if att_n > 0, do: p ++ [att_word(att_n, "attached")], else: p end)
      |> then(fn p -> if det_n > 0, do: p ++ [att_word(det_n, "removed")], else: p end)

    case parts do
      [] -> "#{length(ops)} change(s)"
      _ -> Enum.join(parts, " · ")
    end
  end

  defp label_for_slug(slug, pack_dir) do
    case Note.read(pack_dir, slug) do
      nil -> humanize_slug(slug)
      note -> note_label(note)
    end
  end

  defp note_label(note) do
    scope = note["scope"] || %{}

    cond do
      is_binary(scope["osis"]) and scope["osis"] != "" ->
        case Scope.parse(scope["osis"]) do
          %Scope{} = s ->
            d = Scope.display(s)
            if d != "", do: d, else: scope["osis"]

          _ ->
            scope["osis"]
        end

      is_binary(scope["slug"]) ->
        humanize_slug(scope["slug"])

      true ->
        "Note"
    end
  end

  defp humanize_slug(slug) when is_binary(slug) do
    case Scope.parse(slug) do
      %Scope{} = s ->
        d = Scope.display(s)
        if d != "", do: d, else: String.upcase(slug)

      _ ->
        String.upcase(slug)
    end
  end

  defp humanize_slug(_), do: "Note"

  # --- calendar helpers -------------------------------------------------------

  defp clamp_days(n) when is_integer(n) and n >= 7 and n <= 400, do: n
  defp clamp_days(_), do: 365

  defp iso_date(nil), do: nil

  defp iso_date(s) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> Date.to_iso8601(DateTime.to_date(dt))
      _ ->
        case Date.from_iso8601(String.slice(s, 0, 10)) do
          {:ok, d} -> Date.to_iso8601(d)
          _ -> nil
        end
    end
  end

  defp in_range?(iso, from, to) do
    case Date.from_iso8601(iso) do
      {:ok, d} -> Date.compare(d, from) != :lt and Date.compare(d, to) != :gt
      _ -> false
    end
  end

  # GitHub-style 0–4 intensity
  defp level(0), do: 0
  defp level(1), do: 1
  defp level(n) when n <= 3, do: 2
  defp level(n) when n <= 6, do: 3
  defp level(_), do: 4
end
