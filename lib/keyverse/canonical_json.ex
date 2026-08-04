defmodule Keyverse.CanonicalJson do
  @moduledoc """
  Deterministic JSON encoding for content-addressing op records.

  Rules (PROTOCOL.md §10.2):
  - Objects: keys sorted bytewise ascending; no duplicate keys.
  - Arrays: element order preserved.
  - No insignificant whitespace.
  - Strings: JSON minimal escaping (Jason defaults — `\"`, `\\\\`, control
    chars); everything else raw UTF-8.
  - Numbers in op records are non-negative integers only (no floats), so
    integer decimal form is canonical.

  The op id is the lowercase hex SHA-256 of this encoding.
  """

  @doc "Encode a term canonically. Raises on unencodable terms."
  def encode(term), do: IO.iodata_to_binary(enc(term))

  @doc "Lowercase hex SHA-256 of the canonical encoding."
  def sha256(term) do
    :crypto.hash(:sha256, encode(term)) |> Base.encode16(case: :lower)
  end

  defp enc(map) when is_map(map) do
    inner =
      map
      |> Enum.map(fn {k, v} -> {encode_key(k), v} end)
      |> Enum.sort_by(fn {k, _} -> k end)
      |> Enum.map(fn {k, v} -> [Jason.encode!(k), ":", enc(v)] end)
      |> Enum.intersperse(",")

    ["{", inner, "}"]
  end

  defp enc(list) when is_list(list) do
    ["[", list |> Enum.map(&enc/1) |> Enum.intersperse(","), "]"]
  end

  defp enc(other), do: Jason.encode!(other)

  defp encode_key(k) when is_binary(k), do: k
  defp encode_key(k) when is_atom(k), do: Atom.to_string(k)
end
