defmodule Keyverse.NoteGuard do
  @moduledoc """
  Server-side protection against destructive note overwrites (sync stomps).

  Mobile quietSync historically pushed thin/stale local copies over richer door
  notes. Client LWW helps, but old app builds omit base stamps. The door must
  refuse severe shrinks unless the writer opts in (`X-KV-Allow-Shrink: 1`) or
  issues an explicit delete (blank blocks + no attachments).
  """

  @doc """
  Score plaintext richness of a note map (or nil).
  Sealed notes count as opaque content (never treated as empty).
  """
  def content_score(nil), do: %{nonempty: 0, chars: 0, atts: 0, empty: true, encrypted: false}

  def content_score(note) when is_map(note) do
    if note["encrypted"] == true or is_map(note["cipher"]) do
      %{nonempty: 1, chars: 1, atts: 0, empty: false, encrypted: true}
    else
      blocks = List.wrap(note["blocks"])

      {nonempty, chars} =
        Enum.reduce(blocks, {0, 0}, fn b, {n, c} ->
          t = b |> Map.get("text", "") |> to_string() |> String.trim()
          if t == "", do: {n, c}, else: {n + 1, c + String.length(t)}
        end)

      atts = length(List.wrap(note["attachments"]))
      empty = nonempty == 0 and atts == 0
      %{nonempty: nonempty, chars: chars, atts: atts, empty: empty, encrypted: false}
    end
  end

  @doc """
  Build a virtual "incoming" note shape from a put payload for scoring.
  """
  def score_payload(%{"encrypted" => true, "cipher" => cipher}) when is_map(cipher) do
    %{nonempty: 1, chars: 1, atts: 0, empty: false, encrypted: true}
  end

  def score_payload(payload) when is_map(payload) do
    blocks = payload["blocks"] || payload[:blocks] || []
    atts = payload["attachments"] || payload[:attachments]

    note = %{
      "blocks" => List.wrap(blocks),
      # nil attachments means "preserve" at put time — treat as non-destructive for atts
      "attachments" => if(is_nil(atts), do: [%{"_preserve" => true}], else: List.wrap(atts))
    }

    # Preserve-attachments: don't count as empty solely from atts
    score = content_score(%{note | "attachments" => List.wrap(if(is_nil(atts), do: [], else: atts))})

    if is_nil(atts) and score.nonempty == 0 do
      # Could be intentional clear of text while keeping files — not empty stomp of whole note
      %{score | empty: false, atts: 1}
    else
      score
    end
  end

  def score_payload(blocks) when is_list(blocks) do
    content_score(%{"blocks" => blocks, "attachments" => []})
  end

  def score_payload(_), do: %{nonempty: 0, chars: 0, atts: 0, empty: true, encrypted: false}

  @doc """
  True when applying `incoming` score would destroy meaningful `existing` content.

  Full delete (incoming empty + explicit empty attachments) is NOT destructive here —
  callers pass `explicit_delete?: true` to allow it.
  """
  def destructive_shrink?(existing_note, incoming_score, opts \\ []) do
    explicit_delete? = Keyword.get(opts, :explicit_delete?, false)
    if explicit_delete?, do: false, else: do_destructive?(content_score(existing_note), incoming_score)
  end

  defp do_destructive?(_existing, %{encrypted: true}), do: false
  defp do_destructive?(%{empty: true}, _), do: false
  defp do_destructive?(%{encrypted: true}, %{encrypted: false} = _inc) do
    # Unsealing to plaintext is allowed; client decrypted intentionally
    false
  end

  defp do_destructive?(existing, incoming) do
    cond do
      # Blank body over contentful note (and not classified as explicit delete)
      incoming.empty and not existing.empty ->
        true

      # Lost outline lines and lost body mass
      incoming.nonempty < existing.nonempty and incoming.chars < existing.chars ->
        true

      # Same/fewer lines but majority of text gone (nested child wiped)
      incoming.nonempty <= existing.nonempty and existing.chars >= 40 and
          incoming.chars < existing.chars * 0.5 ->
        true

      true ->
        false
    end
  end

  @doc """
  Explicit protocol delete: no text content and attachments explicitly empty array
  (or omitted with all-blank blocks — Note.put_note treats blank+no atts as delete).
  """
  def explicit_delete_payload?(payload) when is_map(payload) do
    if payload["encrypted"] == true, do: false, else: do_explicit_delete(payload)
  end

  def explicit_delete_payload?(blocks) when is_list(blocks) do
    score_payload(blocks).empty
  end

  def explicit_delete_payload?(_), do: false

  defp do_explicit_delete(payload) do
    blocks = List.wrap(payload["blocks"] || payload[:blocks] || [])
    atts = payload["attachments"] || payload[:attachments]
    text_empty =
      Enum.all?(blocks, fn b ->
        b |> Map.get("text", "") |> to_string() |> String.trim() == ""
      end)

    atts_empty = is_list(atts) and atts == []
    # omit attachments + blank blocks → put_note deletes if existing has no atts to preserve
    # treat as explicit delete attempt when text empty and (atts [] or both empty)
    text_empty and (atts_empty or is_nil(atts))
  end
end
