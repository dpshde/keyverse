defmodule Keyverse.Canon do
  @moduledoc """
  Canon coverage rail — verse-of-scripture book segments with note density heat.

  Segment widths are **chapter-weighted** (1189 chapters total). Heat is continuous
  0..1 from notes-with-content per book:

      heat = min(1.0, 0.9 * notes / chapters)

  so **1 note per chapter = 90% hot**; denser books can saturate to full heat.
  """

  alias Keyverse.Note

  # 66-book Protestant canon, chapter counts (OSIS order).
  @books [
    {"GEN", "Genesis", 50},
    {"EXO", "Exodus", 40},
    {"LEV", "Leviticus", 27},
    {"NUM", "Numbers", 36},
    {"DEU", "Deuteronomy", 34},
    {"JOS", "Joshua", 24},
    {"JDG", "Judges", 21},
    {"RUT", "Ruth", 4},
    {"1SA", "1 Samuel", 31},
    {"2SA", "2 Samuel", 24},
    {"1KI", "1 Kings", 22},
    {"2KI", "2 Kings", 25},
    {"1CH", "1 Chronicles", 29},
    {"2CH", "2 Chronicles", 36},
    {"EZR", "Ezra", 10},
    {"NEH", "Nehemiah", 13},
    {"EST", "Esther", 10},
    {"JOB", "Job", 42},
    {"PSA", "Psalms", 150},
    {"PRO", "Proverbs", 31},
    {"ECC", "Ecclesiastes", 12},
    {"SNG", "Song of Solomon", 8},
    {"ISA", "Isaiah", 66},
    {"JER", "Jeremiah", 52},
    {"LAM", "Lamentations", 5},
    {"EZK", "Ezekiel", 48},
    {"DAN", "Daniel", 12},
    {"HOS", "Hosea", 14},
    {"JOL", "Joel", 3},
    {"AMO", "Amos", 9},
    {"OBA", "Obadiah", 1},
    {"JON", "Jonah", 4},
    {"MIC", "Micah", 7},
    {"NAM", "Nahum", 3},
    {"HAB", "Habakkuk", 3},
    {"ZEP", "Zephaniah", 3},
    {"HAG", "Haggai", 2},
    {"ZEC", "Zechariah", 14},
    {"MAL", "Malachi", 4},
    {"MAT", "Matthew", 28},
    {"MRK", "Mark", 16},
    {"LUK", "Luke", 24},
    {"JHN", "John", 21},
    {"ACT", "Acts", 28},
    {"ROM", "Romans", 16},
    {"1CO", "1 Corinthians", 16},
    {"2CO", "2 Corinthians", 13},
    {"GAL", "Galatians", 6},
    {"EPH", "Ephesians", 6},
    {"PHP", "Philippians", 4},
    {"COL", "Colossians", 4},
    {"1TH", "1 Thessalonians", 5},
    {"2TH", "2 Thessalonians", 3},
    {"1TI", "1 Timothy", 6},
    {"2TI", "2 Timothy", 4},
    {"TIT", "Titus", 3},
    {"PHM", "Philemon", 1},
    {"HEB", "Hebrews", 13},
    {"JAS", "James", 5},
    {"1PE", "1 Peter", 5},
    {"2PE", "2 Peter", 3},
    {"1JN", "1 John", 5},
    {"2JN", "2 John", 1},
    {"3JN", "3 John", 1},
    {"JUD", "Jude", 1},
    {"REV", "Revelation", 22}
  ]

  @total_chapters 1189
  # Cumulative chapters through Malachi (OT/NT seam).
  @ot_chapters 929

  @doc "Full Protestant canon book list with chapter counts."
  def books, do: @books

  @doc "Total chapters in the Protestant canon."
  def total_chapters, do: @total_chapters

  @doc "0..1 position of the OT/NT seam (after Malachi)."
  def testament_seam_t, do: @ot_chapters / @total_chapters

  @doc """
  Continuous heat 0..1 for a book.

  Scale: **1 note per chapter → 0.9**. Above that, heat saturates toward 1.0.
  """
  def heat(notes, chapters) when is_integer(notes) and notes >= 0 and is_integer(chapters) and chapters > 0 do
    min(1.0, 0.9 * notes / chapters)
  end

  def heat(_, _), do: 0.0

  @doc """
  Coverage map for a pack directory.

  Counts notes that have content (text and/or attachments) or are sealed.
  Empty draft shells do not paint the rail.
  """
  def coverage(pack_dir) when is_binary(pack_dir) do
    pack_dir
    |> Note.list()
    |> coverage_from_notes()
  end

  @doc "Build coverage from already-loaded note maps (mobile offline path)."
  def coverage_from_notes(notes) when is_list(notes) do
    counts = count_notes_by_book(notes)
    build(counts)
  end

  @doc "Build coverage from a map of uppercase OSIS book → note count."
  def coverage_from_counts(counts) when is_map(counts) do
    build(counts)
  end

  defp build(counts) do
    {books, _} =
      Enum.map_reduce(@books, 0, fn {osis, name, chapters}, start ->
        notes = Map.get(counts, osis, 0)
        t0 = start / @total_chapters
        t1 = (start + chapters) / @total_chapters
        ratio = if chapters > 0, do: notes / chapters, else: 0.0
        h = heat(notes, chapters)

        book = %{
          osis: osis,
          name: name,
          chapters: chapters,
          notes: notes,
          ratio: Float.round(ratio * 1.0, 4),
          heat: Float.round(h * 1.0, 4),
          t0: Float.round(t0 * 1.0, 6),
          t1: Float.round(t1 * 1.0, 6)
        }

        {book, start + chapters}
      end)

    total_notes = Enum.reduce(books, 0, &(&1.notes + &2))
    books_with_notes = Enum.count(books, &(&1.notes > 0))

    %{
      books: books,
      testament_seam_t: Float.round(testament_seam_t() * 1.0, 6),
      total_chapters: @total_chapters,
      total_notes: total_notes,
      books_with_notes: books_with_notes,
      # Calibration for clients/docs
      heat_scale: %{notes_per_chapter_at_90: 1.0}
    }
  end

  defp count_notes_by_book(notes) do
    Enum.reduce(notes, %{}, fn note, acc ->
      if note_counts?(note) do
        case book_osis(note) do
          nil -> acc
          osis -> Map.update(acc, osis, 1, &(&1 + 1))
        end
      else
        acc
      end
    end)
  end

  # Contentful or sealed notes paint the map; empty shells do not.
  defp note_counts?(note) when is_map(note) do
    Note.encrypted?(note) or
      Note.has_content?(note["blocks"]) or
      has_attachments?(note["attachments"])
  end

  defp note_counts?(_), do: false

  defp has_attachments?(atts) when is_list(atts), do: atts != []
  defp has_attachments?(_), do: false

  defp book_osis(note) when is_map(note) do
    slug =
      get_in(note, ["scope", "slug"]) ||
        get_in(note, ["scope", :slug]) ||
        ""

    book_osis_from_slug(slug)
  end

  @doc false
  def book_osis_from_slug(slug) when is_binary(slug) do
    case String.split(slug, ".", parts: 2) do
      [book | _] when book != "" ->
        osis = String.upcase(book)
        if Enum.any?(@books, fn {o, _, _} -> o == osis end), do: osis, else: nil

      _ ->
        nil
    end
  end

  def book_osis_from_slug(_), do: nil
end
