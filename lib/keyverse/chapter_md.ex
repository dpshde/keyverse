defmodule Keyverse.ChapterMd do
  @moduledoc """
  Stitch a chapter's BSB text + pack notes into one Markdown document.

  Layout (matches reader order):
  1. Title + translation line
  2. Chapter-scope note (if any)
  3. Each verse in order: scripture line, then verse note, then range notes
     that end on that verse
  """

  alias Keyverse.{Note, Scope, TextCache}

  @doc """
  Build Markdown for a chapter. `slug` may be chapter (`heb.8`) or any
  verse/range in that chapter (`heb.8.12`) — always expands to the full chapter.

  Returns `{:ok, markdown}` or `{:error, reason}`.
  """
  def render(pack_dir, slug) when is_binary(pack_dir) and is_binary(slug) do
    case Scope.parse(slug) do
      nil ->
        {:error, :invalid_address}

      scope ->
        book = scope.parsed.book
        chapter = scope.parsed.chapter
        render_chapter(pack_dir, book, chapter)
    end
  end

  def render_chapter(pack_dir, book, chapter)
      when is_binary(pack_dir) and is_binary(book) and is_integer(chapter) do
    book = String.upcase(book)

    case TextCache.get_chapter(book, chapter) do
      {:error, reason} ->
        {:error, reason}

      {:ok, text} ->
        notes = Note.list_for_chapter(pack_dir, book, chapter)
        {:ok, stitch(book, chapter, text, notes)}
    end
  end

  # --- stitch ---------------------------------------------------------------

  defp stitch(book, chapter, text, notes) do
    ch_scope = Scope.parse("#{book}.#{chapter}")
    title = if ch_scope, do: Scope.display(ch_scope), else: "#{book} #{chapter}"

    {chapter_note, verse_notes, range_by_end} = index_notes(notes, book, chapter)

    verses = text["verses"] || []

    parts = [
      "# #{title}",
      "",
      "_BSB · keyverse_",
      ""
    ]

    parts =
      if chapter_note do
        parts ++
          [
            "## Chapter note",
            "",
            note_body_md(chapter_note),
            ""
          ]
      else
        parts
      end

    verse_parts =
      Enum.flat_map(verses, fn vrow ->
        v = vrow["v"]
        vtext = String.trim(to_string(vrow["text"] || ""))
        line = if vtext == "", do: ["**#{v}**"], else: ["**#{v}** #{vtext}", ""]

        vnote = Map.get(verse_notes, v)
        note_bits =
          if vnote do
            ["", note_body_md(vnote), ""]
          else
            []
          end

        ranges = Map.get(range_by_end, v, [])

        range_bits =
          Enum.flat_map(ranges, fn %{note: n, scope: sc} ->
            label = Scope.display(sc)

            [
              "",
              "*Note · #{label}*",
              "",
              note_body_md(n),
              ""
            ]
          end)

        line ++ note_bits ++ range_bits
      end)

    (parts ++ verse_parts)
    |> Enum.join("\n")
    |> String.trim_trailing()
    |> Kernel.<>("\n")
  end

  defp index_notes(notes, book, chapter) do
    Enum.reduce(notes, {nil, %{}, %{}}, fn note, {cn, vn, rn} ->
      other =
        Scope.parse(get_in(note, ["scope", "osis"]) || get_in(note, ["scope", "slug"]))

      cond do
        is_nil(other) ->
          {cn, vn, rn}

        other.parsed.book != book or other.parsed.chapter != chapter ->
          {cn, vn, rn}

        other.kind == "chapter" ->
          {note, vn, rn}

        other.kind == "verse" ->
          {cn, Map.put(vn, other.parsed.verse, note), rn}

        true ->
          start_v = other.parsed.verse
          end_v = other.parsed.verse_end || start_v
          list = Map.get(rn, end_v, []) ++ [%{note: note, scope: other, start_v: start_v}]
          {cn, vn, Map.put(rn, end_v, list)}
      end
    end)
  end

  @doc false
  def note_body_md(note) when is_map(note) do
    cond do
      Note.encrypted?(note) ->
        "*[Encrypted note — sealed]*"

      true ->
        blocks_md = blocks_to_md(note["blocks"] || [])
        atts_md = attachments_to_md(note["attachments"] || [])

        body =
          [blocks_md, atts_md]
          |> Enum.reject(&(&1 == ""))
          |> Enum.join("\n\n")

        if body == "", do: "*[Empty note]*", else: body
    end
  end

  @doc false
  def blocks_to_md(blocks) when is_list(blocks) do
    blocks
    |> Enum.map(fn b ->
      indent = max(0, trunc(b["indent"] || 0))
      text = to_string(b["text"] || "")
      # Keep blank caret lines out of export unless they are the only content
      {indent, text}
    end)
    |> then(fn rows ->
      nonempty = Enum.any?(rows, fn {_, t} -> String.trim(t) != "" end)

      rows
      |> Enum.reject(fn {_, t} -> nonempty and String.trim(t) == "" end)
      |> Enum.map(fn {indent, text} ->
        pad = String.duplicate("  ", indent)
        # List marker; body may already contain inline MD / wiki [[…]]
        "#{pad}- #{text}"
      end)
      |> Enum.join("\n")
    end)
  end

  def blocks_to_md(_), do: ""

  defp attachments_to_md(atts) when is_list(atts) do
    atts
    |> Enum.map(fn a ->
      case a["kind"] do
        "url" ->
          title = a["title"] || a["url"] || "link"
          url = a["url"] || ""
          if url != "", do: "- 🔗 [#{title}](#{url})", else: "- 🔗 #{title}"

        _ ->
          name = a["name"] || a["filename"] || "file"
          "- 📎 #{name}"
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  defp attachments_to_md(_), do: ""
end
