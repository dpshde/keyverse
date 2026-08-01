defmodule Keyverse.Attach do
  @moduledoc """
  Attachment upload / metadata hygiene.

  File bytes stay content-addressed with no MIME allowlist (ADR 0010).
  This module hardens *metadata and size limits* so path tricks, huge
  bodies, and sketchy URL schemes cannot land in the pack.
  """

  alias Keyverse.Config

  @max_filename_bytes 180
  @max_url_bytes 2048
  @max_title_bytes 200
  @max_mime_bytes 100

  # MIME subtypes that should never be rendered inline by the browser.
  @force_download_mimes ~w(
    text/html text/javascript application/javascript application/x-javascript
    application/xhtml+xml image/svg+xml text/xml application/xml
  )

  def max_bytes, do: Config.max_attach_bytes()
  def max_per_note, do: Config.max_attach_per_note()

  @doc "Sanitize a client-supplied filename for storage/display."
  def sanitize_filename(nil), do: "file"
  def sanitize_filename(""), do: "file"

  def sanitize_filename(name) when is_binary(name) do
    name
    |> String.replace("\\", "/")
    |> String.split("/")
    |> List.last()
    |> to_string()
    |> String.replace(~r/[\x00-\x1f\x7f]/, "")
    |> String.trim()
    |> case do
      "" -> "file"
      # Windows-reserved / relative tricks
      n when n in [".", ".."] -> "file"
      n -> truncate_utf8(n, @max_filename_bytes)
    end
  end

  def sanitize_filename(_), do: "file"

  @doc "Normalize advisory MIME; never trust for security alone."
  def sanitize_mime(nil), do: "application/octet-stream"
  def sanitize_mime(""), do: "application/octet-stream"

  def sanitize_mime(ct) when is_binary(ct) do
    ct
    |> String.downcase()
    |> String.split(";", parts: 2)
    |> hd()
    |> String.trim()
    |> case do
      mime ->
        if Regex.match?(~r/^[a-z0-9!#$&\-\^_+.]+\/[a-z0-9!#$&\-\^_+.]+$/, mime) and
             byte_size(mime) <= @max_mime_bytes do
          mime
        else
          "application/octet-stream"
        end
    end
  end

  def sanitize_mime(_), do: "application/octet-stream"

  @doc """
  Validate a URL attachment. Only http(s). No javascript:/data:/file:.
  """
  def validate_url(url) when is_binary(url) do
    url = String.trim(url)

    cond do
      url == "" ->
        {:error, "url required"}

      byte_size(url) > @max_url_bytes ->
        {:error, "url too long"}

      String.contains?(url, ["\x00", "\r", "\n"]) ->
        {:error, "invalid url"}

      true ->
        case URI.parse(url) do
          %URI{scheme: scheme, host: host} when scheme in ["http", "https"] ->
            host = to_string(host || "")

            if host == "" or String.contains?(host, " ") do
              {:error, "invalid url"}
            else
              {:ok, url}
            end

          _ ->
            {:error, "url must be http or https"}
        end
    end
  end

  def validate_url(_), do: {:error, "url required"}

  def sanitize_title(nil), do: nil

  def sanitize_title(t) when is_binary(t) do
    t
    |> String.replace(~r/[\x00-\x1f\x7f]/, "")
    |> String.trim()
    |> case do
      "" -> nil
      s -> truncate_utf8(s, @max_title_bytes)
    end
  end

  def sanitize_title(_), do: nil

  @doc "Reject when note already has too many attachments."
  def check_count(existing_atts) when is_list(existing_atts) do
    if length(existing_atts) >= max_per_note() do
      {:error, "too many attachments (max #{max_per_note()})"}
    else
      :ok
    end
  end

  def check_count(_), do: :ok

  @doc """
  Read request body with hard cap. Returns `{:ok, body, conn}`,
  `{:error, :too_large}`, or `{:error, :empty}`.
  """
  def read_body_capped(conn, max \\ max_bytes()) do
    cl =
      case Plug.Conn.get_req_header(conn, "content-length") do
        [v | _] ->
          case Integer.parse(v) do
            {n, _} when n >= 0 -> n
            _ -> nil
          end

        _ ->
          nil
      end

    cond do
      is_integer(cl) and cl > max ->
        {:error, :too_large}

      is_integer(cl) and cl == 0 ->
        {:error, :empty}

      true ->
        # read slightly over so :more is detectable as too_large
        case Plug.Conn.read_body(conn, length: max, read_length: 1_048_576, read_timeout: 60_000) do
          {:ok, body, _conn} when byte_size(body) == 0 ->
            {:error, :empty}

          {:ok, body, _conn} when byte_size(body) > max ->
            {:error, :too_large}

          {:ok, body, conn} ->
            {:ok, body, conn}

          {:more, _partial, conn} ->
            # drain remainder so connection can close cleanly
            _ = drain_body(conn)
            {:error, :too_large}

          {:error, _} ->
            {:error, :read_failed}
        end
    end
  end

  defp drain_body(conn) do
    case Plug.Conn.read_body(conn, length: 1_048_576) do
      {:ok, _, conn} -> conn
      {:more, _, conn} -> drain_body(conn)
      {:error, _} -> conn
    end
  end

  @doc "Whether Content-Disposition should force download."
  def force_download?(mime) do
    m = sanitize_mime(mime)
    m in @force_download_mimes or String.ends_with?(m, "+xml") or String.contains?(m, "html")
  end

  def content_disposition(name, mime) do
    safe = sanitize_filename(name) |> String.replace("\"", "")
    # ASCII fallback + RFC 5987 filename*
    ascii =
      safe
      |> String.replace(~r/[^0-9A-Za-z._\- ]/, "_")
      |> String.slice(0, 80)
      |> case do
        "" -> "file"
        s -> s
      end

    encoded = URI.encode(safe, &URI.char_unreserved?/1)

    kind = if force_download?(mime), do: "attachment", else: "inline"

    ~s(#{kind}; filename="#{ascii}"; filename*=UTF-8''#{encoded})
  end

  def error_status(:too_large), do: 413
  def error_status(:empty), do: 400
  def error_status(:read_failed), do: 400
  def error_status(_), do: 400

  def error_message(:too_large), do: "file too large (max #{max_bytes()} bytes)"
  def error_message(:empty), do: "empty file"
  def error_message(:read_failed), do: "could not read upload"
  def error_message(other) when is_binary(other), do: other
  def error_message(_), do: "upload failed"

  defp truncate_utf8(s, max) when byte_size(s) <= max, do: s

  defp truncate_utf8(s, max) do
    s
    |> String.graphemes()
    |> Enum.reduce_while({"", 0}, fn g, {acc, n} ->
      b = byte_size(g)

      if n + b > max do
        {:halt, {acc, n}}
      else
        {:cont, {acc <> g, n + b}}
      end
    end)
    |> elem(0)
    |> case do
      "" -> "file"
      t -> t
    end
  end
end
