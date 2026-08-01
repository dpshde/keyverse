defmodule Keyverse.TextCache do
  @moduledoc "Disposable BSB chapter cache under packs/_cache/text/bsb."

  alias Keyverse.{Pack, Scope}

  def get_chapter(book_osis, chapter) do
    path = Path.join(Pack.text_dir(), "#{String.downcase(book_osis)}.#{chapter}.json")

    case File.read(path) do
      {:ok, body} ->
        case Jason.decode(body) do
          {:ok, doc} -> {:ok, doc}
          _ -> fetch_and_cache(book_osis, chapter, path)
        end

      _ ->
        fetch_and_cache(book_osis, chapter, path)
    end
  end

  defp fetch_and_cache(book_osis, chapter, path) do
    order = Scope.book_order(book_osis)

    if is_nil(order) do
      {:error, "unknown book"}
    else
      # bolls is 1-based book id; grab-bcv order is 1-based here too
      url = "https://bolls.life/get-text/BSB/#{order}/#{chapter}/"

      case http_get(url) do
        {:ok, raw} when is_list(raw) ->
          doc = %{
            "translation" => "BSB",
            "book" => book_osis,
            "chapter" => chapter,
            "verses" =>
              Enum.map(raw, fn v ->
                text =
                  v
                  |> Map.get("text", "")
                  |> to_string()
                  |> String.replace(~r/<[^>]+>/, "")
                  |> String.trim()

                %{"v" => v["verse"], "text" => text}
              end),
            "fetched_at" => Keyverse.Note.iso_now()
          }

          File.mkdir_p!(Path.dirname(path))
          File.write!(path, Jason.encode!(doc, pretty: true) <> "\n")
          {:ok, doc}

        {:ok, _} ->
          {:error, "unexpected BSB payload"}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp http_get(url) do
    :inets.start()
    :ssl.start()

    headers = [{~c"user-agent", ~c"keyverse/0.1-demo"}]
    request = {String.to_charlist(url), headers}

    http_opts = [
      ssl: [
        verify: :verify_peer,
        cacerts: :public_key.cacerts_get(),
        depth: 3,
        customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]
      ]
    ]

    case :httpc.request(:get, request, http_opts, body_format: :binary) do
      {:ok, {{_, 200, _}, _, body}} ->
        Jason.decode(body)

      {:ok, {{_, code, _}, _, _}} ->
        {:error, "BSB fetch failed: #{code}"}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end
end
