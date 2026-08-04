defmodule Keyverse.Tree do
  @moduledoc "Home containment forest + reader helpers matching the Node door."

  alias Keyverse.{Note, Scope}

  def pos(chapter, verse), do: chapter * 1000 + verse

  def scope_interval(%Scope{parsed: p}) do
    %{
      book: p.book,
      s: pos(p.chapter, p.verse || 1),
      e: pos(p.chapter, p.verse_end || p.verse || 999)
    }
  end

  def relate_intervals(a, b) do
    cond do
      a.book != b.book or a.e < b.s or b.e < a.s -> nil
      a.s == b.s and a.e == b.e -> :same
      a.s <= b.s and b.e <= a.e -> :contains
      b.s <= a.s and a.e <= b.e -> :within
      true -> :overlaps
    end
  end

  def note_entry(note) do
    osis = get_in(note, ["scope", "osis"]) || get_in(note, ["scope", "slug"])

    case Scope.parse(osis) do
      nil -> nil
      scope -> %{note: note, scope: scope, interval: scope_interval(scope)}
    end
  end

  def build_containment_forest_fixed(entries) do
    sorted =
      Enum.sort(entries, fn a, b ->
        cond do
          a.interval.book != b.interval.book ->
            (Scope.book_order(a.interval.book) || 999) <= (Scope.book_order(b.interval.book) || 999)

          a.interval.s != b.interval.s ->
            a.interval.s < b.interval.s

          true ->
            span_a = a.interval.e - a.interval.s
            span_b = b.interval.e - b.interval.s
            if span_a != span_b, do: span_a > span_b, else: a.scope.slug <= b.scope.slug
        end
      end)

    {nodes, roots, _stack} =
      Enum.reduce(sorted, {%{}, [], []}, fn entry, {nodes, roots, stack} ->
        stack =
          Enum.drop_while(stack, fn top_slug ->
            top = Map.fetch!(nodes, top_slug)
            relate_intervals(top.entry.interval, entry.interval) != :contains
          end)

        slug = entry.scope.slug
        nodes = Map.put(nodes, slug, %{kind: :note, entry: entry, child_slugs: []})

        case stack do
          [] ->
            {nodes, roots ++ [slug], [slug]}

          [parent_slug | _] ->
            nodes =
              Map.update!(nodes, parent_slug, fn p ->
                %{p | child_slugs: p.child_slugs ++ [slug]}
              end)

            {nodes, roots, [slug | stack]}
        end
      end)

    Enum.map(roots, &materialize(nodes, &1))
  end

  defp materialize(nodes, slug) do
    n = Map.fetch!(nodes, slug)

    %{
      kind: :note,
      entry: n.entry,
      children: Enum.map(n.child_slugs, &materialize(nodes, &1))
    }
  end

  # Public API uses fixed version
  def forest(entries), do: build_containment_forest_fixed(entries)

  def max_updated_at(entries) do
    Enum.reduce(entries, "", fn e, best ->
      t = e.note["updated_at"] || ""
      if t > best, do: t, else: best
    end)
  end

  def build_home_note_tree(notes) do
    entries =
      notes
      |> Enum.map(&note_entry/1)
      |> Enum.reject(&is_nil/1)

    if entries == [] do
      []
    else
      by_book = Enum.group_by(entries, & &1.interval.book)

      books =
        Map.keys(by_book)
        |> Enum.sort_by(&(Scope.book_order(&1) || 999))

      Enum.flat_map(books, fn book ->
        book_entries = by_book[book]

        by_chapter =
          Enum.group_by(book_entries, fn e -> e.scope.parsed.chapter end)

        units =
          by_chapter
          |> Enum.map(fn {ch, list} ->
            %{type: :chapter, chapter: ch, entries: list, s: pos(ch, 1)}
          end)
          |> Enum.sort_by(& &1.s)

        Enum.flat_map(units, fn unit ->
          forest = forest(unit.entries)
          chapter_note = Enum.find(unit.entries, fn e -> e.scope.kind == "chapter" end)

          if chapter_note do
            root = Enum.find(forest, fn n -> n.entry.scope.slug == chapter_note.scope.slug end)

            root =
              if root do
                others = Enum.reject(forest, &(&1.entry.scope.slug == chapter_note.scope.slug))
                %{root | children: root.children ++ others}
              else
                %{kind: :note, entry: chapter_note, children: forest}
              end

            [root]
          else
            ch_scope = Scope.parse("#{book}.#{unit.chapter}")
            label = if ch_scope, do: Scope.display(ch_scope), else: "#{book} #{unit.chapter}"
            slug = if ch_scope, do: ch_scope.slug, else: String.downcase("#{book}.#{unit.chapter}")

            [
              %{
                kind: :folder,
                label: label,
                slug: slug,
                children: forest,
                updated_at: max_updated_at(unit.entries),
                count: length(unit.entries)
              }
            ]
          end
        end)
      end)
    end
  end

  def count_tree_notes(%{kind: :note, children: kids}) do
    1 + Enum.reduce(kids, 0, fn c, n -> n + count_tree_notes(c) end)
  end

  def count_tree_notes(%{children: kids}) do
    Enum.reduce(kids || [], 0, fn c, n -> n + count_tree_notes(c) end)
  end

  def count_tree_notes(_), do: 0

  @doc """
  Flat note list for Inbox home mode — no book/chapter hierarchy.
  Newest **created** first. Uses pack `created_at` only — never `updated_at`
  (import/sync rewrites that stamp and would pollute order).
  """
  def build_home_inbox(notes) when is_list(notes) do
    notes
    |> Enum.map(&note_entry/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(&note_created_key/1, :desc)
  end

  @doc """
  Inbox grouped by UTC calendar day of `created_at`.
  Returns `[%{day_key, label, entries}]` newest day first — empty days omitted.
  """
  def build_home_inbox_days(notes) when is_list(notes) do
    build_home_inbox(notes)
    |> Enum.group_by(&created_day_key/1)
    |> Enum.sort_by(fn {day, _} -> day end, :desc)
    # "unknown" sorts after ISO dates when descending? "unknown" > "2024..." lexically
    # so put unknown at the end always:
    |> Enum.sort_by(fn {day, _} -> if day == "unknown", do: 1, else: 0 end)
    |> Enum.map(fn {day_key, entries} ->
      # Preserve newest-created order within the day (group_by keeps relative order)
      %{
        day_key: day_key,
        label: format_inbox_day_label(day_key),
        entries: entries
      }
    end)
  end

  def note_created_key(%{note: note}) do
    case note["created_at"] do
      at when is_binary(at) and at != "" -> at
      _ -> ""
    end
  end

  def note_created_key(_), do: ""

  def created_day_key(%{note: note}) do
    case note["created_at"] do
      <<y::binary-size(4), "-", m::binary-size(2), "-", d::binary-size(2), _::binary>>
      when y != "" ->
        "#{y}-#{m}-#{d}"

      at when is_binary(at) and at != "" ->
        case DateTime.from_iso8601(normalize_iso(at)) do
          {:ok, dt, _} -> Date.to_iso8601(DateTime.to_date(dt))
          _ -> "unknown"
        end

      _ ->
        "unknown"
    end
  end

  def created_day_key(_), do: "unknown"

  defp normalize_iso(at) do
    s = String.replace(at, " ", "T")

    cond do
      String.ends_with?(s, "Z") -> s
      Regex.match?(~r/[+-]\d{2}:?\d{2}$/, s) -> s
      true -> s <> "Z"
    end
  end

  def format_inbox_day_label("unknown"), do: "Unknown date"

  def format_inbox_day_label(<<y::binary-size(4), "-", m::binary-size(2), "-", d::binary-size(2)>>) do
    case Date.from_iso8601("#{y}-#{m}-#{d}") do
      {:ok, date} ->
        today = Date.utc_today()

        cond do
          date == today ->
            "Today"

          date == Date.add(today, -1) ->
            "Yesterday"

          true ->
            # "Tue · Aug 4" / with year when not current year
            mon = ~w(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec) |> Enum.at(date.month - 1)
            wday = ~w(Mon Tue Wed Thu Fri Sat Sun) |> Enum.at(Date.day_of_week(date) - 1)

            if date.year == today.year do
              "#{wday} · #{mon} #{date.day}"
            else
              "#{wday} · #{mon} #{date.day}, #{date.year}"
            end
        end

      _ ->
        "#{y}-#{m}-#{d}"
    end
  end

  def format_inbox_day_label(other), do: to_string(other)

  def excerpt(note) do
    cond do
      Note.encrypted?(note) ->
        "Encrypted"

      true ->
        text =
          (note["blocks"] || [])
          |> Enum.map(&to_string(&1["text"] || ""))
          |> Enum.join(" ")
          |> String.trim()
          |> String.slice(0, 120)

        if text == "", do: "empty", else: text
    end
  end

  def rel_time(iso) when is_binary(iso) and iso != "" do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} ->
        s = DateTime.diff(DateTime.utc_now(), dt, :second)

        cond do
          s < 60 -> "just now"
          s < 3600 -> "#{div(s, 60)}m ago"
          s < 86400 -> "#{div(s, 3600)}h ago"
          true -> "#{div(s, 86400)}d ago"
        end

      _ ->
        ""
    end
  end

  def rel_time(_), do: ""
end
