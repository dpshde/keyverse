defmodule Keyverse.Scope do
  @moduledoc """
  Passage addressing: human refs and slugs → OSIS scope.
  Compatible subset of grab-bcv for common English book names.
  """

  defstruct [:kind, :osis, :slug, :parsed]

  @books [
    {"genesis", "GEN", 1, 50},
    {"gen", "GEN", 1, 50},
    {"exodus", "EXO", 2, 40},
    {"exod", "EXO", 2, 40},
    {"exo", "EXO", 2, 40},
    {"leviticus", "LEV", 3, 27},
    {"lev", "LEV", 3, 27},
    {"numbers", "NUM", 4, 36},
    {"num", "NUM", 4, 36},
    {"deuteronomy", "DEU", 5, 34},
    {"deut", "DEU", 5, 34},
    {"joshua", "JOS", 6, 24},
    {"josh", "JOS", 6, 24},
    {"judges", "JDG", 7, 21},
    {"judg", "JDG", 7, 21},
    {"ruth", "RUT", 8, 4},
    {"1samuel", "1SA", 9, 31},
    {"1sam", "1SA", 9, 31},
    {"2samuel", "2SA", 10, 24},
    {"2sam", "2SA", 10, 24},
    {"1kings", "1KI", 11, 22},
    {"1kgs", "1KI", 11, 22},
    {"2kings", "2KI", 12, 25},
    {"2kgs", "2KI", 12, 25},
    {"1chronicles", "1CH", 13, 29},
    {"1chr", "1CH", 13, 29},
    {"2chronicles", "2CH", 14, 36},
    {"2chr", "2CH", 14, 36},
    {"ezra", "EZR", 15, 10},
    {"nehemiah", "NEH", 16, 13},
    {"neh", "NEH", 16, 13},
    {"esther", "EST", 17, 10},
    {"esth", "EST", 17, 10},
    {"job", "JOB", 18, 42},
    {"psalm", "PSA", 19, 150},
    {"psalms", "PSA", 19, 150},
    {"ps", "PSA", 19, 150},
    {"proverbs", "PRO", 20, 31},
    {"prov", "PRO", 20, 31},
    {"ecclesiastes", "ECC", 21, 12},
    {"eccl", "ECC", 21, 12},
    {"songofsolomon", "SNG", 22, 8},
    {"song", "SNG", 22, 8},
    {"isaiah", "ISA", 23, 66},
    {"isa", "ISA", 23, 66},
    {"jeremiah", "JER", 24, 52},
    {"jer", "JER", 24, 52},
    {"lamentations", "LAM", 25, 5},
    {"lam", "LAM", 25, 5},
    {"ezekiel", "EZK", 26, 48},
    {"ezek", "EZK", 26, 48},
    {"daniel", "DAN", 27, 12},
    {"dan", "DAN", 27, 12},
    {"hosea", "HOS", 28, 14},
    {"hos", "HOS", 28, 14},
    {"joel", "JOL", 29, 3},
    {"amos", "AMO", 30, 9},
    {"obadiah", "OBA", 31, 1},
    {"obad", "OBA", 31, 1},
    {"jonah", "JON", 32, 4},
    {"micah", "MIC", 33, 7},
    {"mic", "MIC", 33, 7},
    {"nahum", "NAM", 34, 3},
    {"nah", "NAM", 34, 3},
    {"habakkuk", "HAB", 35, 3},
    {"hab", "HAB", 35, 3},
    {"zephaniah", "ZEP", 36, 3},
    {"zeph", "ZEP", 36, 3},
    {"haggai", "HAG", 37, 2},
    {"hag", "HAG", 37, 2},
    {"zechariah", "ZEC", 38, 14},
    {"zech", "ZEC", 38, 14},
    {"malachi", "MAL", 39, 4},
    {"mal", "MAL", 39, 4},
    {"matthew", "MAT", 40, 28},
    {"matt", "MAT", 40, 28},
    {"mt", "MAT", 40, 28},
    {"mark", "MRK", 41, 16},
    {"mk", "MRK", 41, 16},
    {"luke", "LUK", 42, 24},
    {"lk", "LUK", 42, 24},
    {"john", "JHN", 43, 21},
    {"jhn", "JHN", 43, 21},
    {"jn", "JHN", 43, 21},
    {"acts", "ACT", 44, 28},
    {"romans", "ROM", 45, 16},
    {"rom", "ROM", 45, 16},
    {"1corinthians", "1CO", 46, 16},
    {"1cor", "1CO", 46, 16},
    {"2corinthians", "2CO", 47, 13},
    {"2cor", "2CO", 47, 13},
    {"galatians", "GAL", 48, 6},
    {"gal", "GAL", 48, 6},
    {"ephesians", "EPH", 49, 6},
    {"eph", "EPH", 49, 6},
    {"philippians", "PHP", 50, 4},
    {"phil", "PHP", 50, 4},
    {"php", "PHP", 50, 4},
    {"colossians", "COL", 51, 4},
    {"col", "COL", 51, 4},
    {"1thessalonians", "1TH", 52, 5},
    {"1thess", "1TH", 52, 5},
    {"2thessalonians", "2TH", 53, 3},
    {"2thess", "2TH", 53, 3},
    {"1timothy", "1TI", 54, 6},
    {"1tim", "1TI", 54, 6},
    {"2timothy", "2TI", 55, 4},
    {"2tim", "2TI", 55, 4},
    {"titus", "TIT", 56, 3},
    {"philemon", "PHM", 57, 1},
    {"phlm", "PHM", 57, 1},
    {"hebrews", "HEB", 58, 13},
    {"heb", "HEB", 58, 13},
    {"james", "JAS", 59, 5},
    {"jas", "JAS", 59, 5},
    {"1peter", "1PE", 60, 5},
    {"1pet", "1PE", 60, 5},
    {"2peter", "2PE", 61, 3},
    {"2pet", "2PE", 61, 3},
    {"1john", "1JN", 62, 5},
    {"1jn", "1JN", 62, 5},
    {"1jhn", "1JN", 62, 5},
    {"2john", "2JN", 63, 1},
    {"2jn", "2JN", 63, 1},
    {"3john", "3JN", 64, 1},
    {"3jn", "3JN", 64, 1},
    {"jude", "JUD", 65, 1},
    {"revelation", "REV", 66, 22},
    {"rev", "REV", 66, 22},
    {"revelations", "REV", 66, 22}
  ]

  @osis_to_order %{
    "GEN" => 1,
    "EXO" => 2,
    "LEV" => 3,
    "NUM" => 4,
    "DEU" => 5,
    "JOS" => 6,
    "JDG" => 7,
    "RUT" => 8,
    "1SA" => 9,
    "2SA" => 10,
    "1KI" => 11,
    "2KI" => 12,
    "1CH" => 13,
    "2CH" => 14,
    "EZR" => 15,
    "NEH" => 16,
    "EST" => 17,
    "JOB" => 18,
    "PSA" => 19,
    "PRO" => 20,
    "ECC" => 21,
    "SNG" => 22,
    "ISA" => 23,
    "JER" => 24,
    "LAM" => 25,
    "EZK" => 26,
    "DAN" => 27,
    "HOS" => 28,
    "JOL" => 29,
    "AMO" => 30,
    "OBA" => 31,
    "JON" => 32,
    "MIC" => 33,
    "NAM" => 34,
    "HAB" => 35,
    "ZEP" => 36,
    "HAG" => 37,
    "ZEC" => 38,
    "MAL" => 39,
    "MAT" => 40,
    "MRK" => 41,
    "LUK" => 42,
    "JHN" => 43,
    "ACT" => 44,
    "ROM" => 45,
    "1CO" => 46,
    "2CO" => 47,
    "GAL" => 48,
    "EPH" => 49,
    "PHP" => 50,
    "COL" => 51,
    "1TH" => 52,
    "2TH" => 53,
    "1TI" => 54,
    "2TI" => 55,
    "TIT" => 56,
    "PHM" => 57,
    "HEB" => 58,
    "JAS" => 59,
    "1PE" => 60,
    "2PE" => 61,
    "1JN" => 62,
    "2JN" => 63,
    "3JN" => 64,
    "JUD" => 65,
    "REV" => 66
  }

  # OSIS abbreviation → display name
@osis_display %{
    "GEN" => "Genesis", "EXO" => "Exodus", "LEV" => "Leviticus", "NUM" => "Numbers",
    "DEU" => "Deuteronomy", "JOS" => "Joshua", "JDG" => "Judges", "RUT" => "Ruth",
    "1SA" => "1 Samuel", "2SA" => "2 Samuel", "1KI" => "1 Kings", "2KI" => "2 Kings",
    "1CH" => "1 Chronicles", "2CH" => "2 Chronicles", "EZR" => "Ezra", "NEH" => "Nehemiah",
    "EST" => "Esther", "JOB" => "Job", "PSA" => "Psalm", "PRO" => "Proverbs",
    "ECC" => "Ecclesiastes", "SNG" => "Song of Solomon", "ISA" => "Isaiah", "JER" => "Jeremiah",
    "LAM" => "Lamentations", "EZK" => "Ezekiel", "DAN" => "Daniel", "HOS" => "Hosea",
    "JOL" => "Joel", "AMO" => "Amos", "OBA" => "Obadiah", "JON" => "Jonah",
    "MIC" => "Micah", "NAM" => "Nahum", "HAB" => "Habakkuk", "ZEP" => "Zephaniah",
    "HAG" => "Haggai", "ZEC" => "Zechariah", "MAL" => "Malachi", "MAT" => "Matthew",
    "MRK" => "Mark", "LUK" => "Luke", "JHN" => "John", "ACT" => "Acts",
    "ROM" => "Romans", "1CO" => "1 Corinthians", "2CO" => "2 Corinthians", "GAL" => "Galatians",
    "EPH" => "Ephesians", "PHP" => "Philippians", "COL" => "Colossians", "1TH" => "1 Thessalonians",
    "2TH" => "2 Thessalonians", "1TI" => "1 Timothy", "2TI" => "2 Timothy", "TIT" => "Titus",
    "PHM" => "Philemon", "HEB" => "Hebrews", "JAS" => "James", "1PE" => "1 Peter",
    "2PE" => "2 Peter", "1JN" => "1 John", "2JN" => "2 John", "3JN" => "3 John",
    "JUD" => "Jude", "REV" => "Revelation"
  }

  def parse(nil), do: nil
  def parse(""), do: nil

  def parse(input) do
    raw = input |> to_string() |> String.trim()
    if raw == "", do: nil, else: do_parse(raw)
  end

  defp do_parse(raw) do
    # Already OSIS-like slug or osis: jhn.3.16, JHN.3.16-18, 1jn.1
    compact = raw |> String.downcase() |> String.replace(" ", "")

    cond do
      Regex.match?(~r/^[0-9]?[a-z]+\.\d+(\.\d+(-\d+)?)?$/i, compact) ->
        parse_osis_like(compact)

      true ->
        parse_human(raw)
    end
  end

  defp parse_osis_like(s) do
    parts = String.split(s, ".")

    case parts do
      [book_tok, ch] ->
        with {osis, _} <- resolve_book(book_tok),
             {chapter, _} <- Integer.parse(ch) do
          build(osis, chapter, nil, nil)
        else
          _ -> nil
        end

      [book_tok, ch, vs] ->
        with {osis, _} <- resolve_book(book_tok),
             {chapter, _} <- Integer.parse(ch) do
          case String.split(vs, "-") do
            [v] ->
              case Integer.parse(v) do
                {verse, _} -> build(osis, chapter, verse, nil)
                _ -> nil
              end

            [v1, v2] ->
              with {a, _} <- Integer.parse(v1),
                   {b, _} <- Integer.parse(v2) do
                build(osis, chapter, a, b)
              else
                _ -> nil
              end

            _ ->
              nil
          end
        else
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp parse_human(raw) do
    # Patterns: "John 3:16", "1 John 1:1-3", "Rom 8", "1jn 1"
    s = String.trim(raw)

    cond do
      # Book chapter:verse or chapter:verse-verse
      m = Regex.run(~r/^((?:[123]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+)[:\.](\d+)(?:\s*[-–—]\s*(\d+))?$/u, s) ->
        [_, book, ch, v1, v2] = pad_match(m, 5)
        finish_human(book, ch, v1, v2)

      # Book chapter only
      m = Regex.run(~r/^((?:[123]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+)$/u, s) ->
        [_, book, ch] = m
        finish_human(book, ch, nil, nil)

      true ->
        # try collapsing spaces in book numbers: "1 jn 1:1"
        collapsed = Regex.replace(~r/^([123])\s+/, s, "\\1")
        if collapsed != s, do: parse_human(collapsed), else: nil
    end
  end

  defp pad_match(m, n), do: m ++ List.duplicate(nil, max(0, n - length(m)))

  defp finish_human(book, ch, v1, v2) do
    with {osis, _} <- resolve_book(book),
         {chapter, _} <- Integer.parse(to_string(ch)) do
      cond do
        v1 in [nil, ""] ->
          build(osis, chapter, nil, nil)

        v2 in [nil, ""] ->
          case Integer.parse(to_string(v1)) do
            {verse, _} -> build(osis, chapter, verse, nil)
            _ -> nil
          end

        true ->
          with {a, _} <- Integer.parse(to_string(v1)),
               {b, _} <- Integer.parse(to_string(v2)) do
            build(osis, chapter, a, b)
          else
            _ -> nil
          end
      end
    else
      _ -> nil
    end
  end

  defp resolve_book(tok) do
    key =
      tok
      |> to_string()
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9]/, "")

    # Also try osis lower
    case Enum.find(@books, fn {k, _, _, _} -> k == key end) do
      {_, osis, order, _} -> {osis, order}
      nil ->
        # match by osis lower
        Enum.find_value(@osis_to_order, fn {osis, order} ->
          if String.downcase(osis) == key, do: {osis, order}
        end)
    end
  end

  defp build(osis, chapter, verse, verse_end) do
    cond do
      is_nil(verse) ->
        osis_s = "#{osis}.#{chapter}"
        %__MODULE__{
          kind: "chapter",
          osis: osis_s,
          slug: String.downcase(osis_s),
          parsed: %{book: osis, chapter: chapter, verse: nil, verse_end: nil}
        }

      is_nil(verse_end) or verse_end == verse ->
        osis_s = "#{osis}.#{chapter}.#{verse}"
        %__MODULE__{
          kind: "verse",
          osis: osis_s,
          slug: String.downcase(osis_s),
          parsed: %{book: osis, chapter: chapter, verse: verse, verse_end: nil}
        }

      true ->
        a = min(verse, verse_end)
        b = max(verse, verse_end)
        osis_s = "#{osis}.#{chapter}.#{a}-#{b}"
        %__MODULE__{
          kind: "range",
          osis: osis_s,
          slug: String.downcase(osis_s),
          parsed: %{book: osis, chapter: chapter, verse: a, verse_end: b}
        }
    end
  end

  def display(%__MODULE__{parsed: p, kind: kind, osis: osis}) do
    book = Map.get(@osis_display, p.book, p.book)

    case kind do
      "chapter" -> "#{book} #{p.chapter}"
      "verse" -> "#{book} #{p.chapter}:#{p.verse}"
      "range" -> "#{book} #{p.chapter}:#{p.verse}–#{p.verse_end}"
      _ -> osis
    end
  end

  def display(_), do: ""

  def book_order(osis_book), do: Map.get(@osis_to_order, osis_book)

  @doc "Number of chapters in a book (OSIS code), or nil if unknown."
  def chapter_count(osis_book) when is_binary(osis_book) do
    osis = String.upcase(osis_book)

    @books
    |> Enum.find_value(fn {_, o, _, chs} -> if o == osis, do: chs end)
  end

  def chapter_count(_), do: nil

  @doc """
  Neighbor chapter scope within the canon for prev/next navigation.
  Stays inside the same book (no book boundary hop in v1).
  """
  def neighbor_chapter(%__MODULE__{} = scope, delta) when delta in [-1, 1] do
    book = scope.parsed.book
    ch = scope.parsed.chapter
    max_ch = chapter_count(book) || ch
    next = ch + delta

    cond do
      next < 1 or next > max_ch -> nil
      true -> parse("#{book}.#{next}")
    end
  end

  def neighbor_chapter(_, _), do: nil

  def autocomplete(q, limit \\ 8) do
    q = q |> to_string() |> String.trim()
    limit = limit |> max(1) |> min(20)

    if q == "" do
      []
    else
      # book suggestions + parse if possible
      qkey = String.downcase(q) |> String.replace(~r/[^a-z0-9 :.-]/, "")

      book_hits =
        @books
        |> Enum.uniq_by(fn {_, osis, _, _} -> osis end)
        |> Enum.filter(fn {k, osis, _, _} ->
          String.starts_with?(k, String.replace(qkey, ~r/[\s.].*/, "")) or
            String.starts_with?(String.downcase(osis), String.replace(qkey, ~r/[\s.].*/, ""))
        end)
        |> Enum.take(limit)
        |> Enum.map(fn {_, osis, _, _} ->
          label = Map.get(@osis_display, osis, osis)
          %{label: label, insertText: label <> " ", canonical: osis, kind: "book"}
        end)

      parsed =
        case parse(q) do
          nil ->
            []

          scope ->
            [
              %{
                label: display(scope),
                insertText: display(scope),
                canonical: scope.osis,
                kind: scope.kind
              }
            ]
        end

      (parsed ++ book_hits)
      |> Enum.uniq_by(& &1.canonical)
      |> Enum.take(limit)
    end
  end

  def interval(%__MODULE__{parsed: p}) do
    order = book_order(p.book) || 0
    ch = p.chapter
    v0 = p.verse || 0
    v1 = p.verse_end || p.verse || 999

    # start/end as sortable tuples
    {{order, ch, v0}, {order, ch, v1}}
  end

  def relate(a, b) do
    {as, ae} = interval(a)
    {bs, be} = interval(b)

    cond do
      as == bs and ae == be -> :same
      as <= bs and ae >= be -> :contains
      bs <= as and be >= ae -> :within
      as <= be and bs <= ae -> :overlaps
      true -> :disjoint
    end
  end
end
