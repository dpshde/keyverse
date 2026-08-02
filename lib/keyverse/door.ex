defmodule Keyverse.Door do
  @moduledoc "Multiword door phrase normalize / validate / generate."

  @reserved MapSet.new([
               "enter",
               "login",
               "setup",
               "api",
               "go",
               "note",
               "notes",
               "read",
               "offline",
               "icons",
               "public",
               "assets",
               "sw.js",
               "manifest.webmanifest",
               "manifest.json",
               "favicon.ico",
               "health",
               "healthz",
               "ready",
               "robots.txt",
               "_cache",
               "_open",
               "local",
               "p",
               "packs"
             ])

  def reserved, do: @reserved

  def normalize(nil), do: ""

  def normalize(s) do
    s
    |> to_string()
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[\s_]+/, "-")
    |> String.replace(~r/[^a-z0-9-]/, "")
    |> String.replace(~r/-+/, "-")
    |> String.trim("-")
  end

  def valid?(phrase) do
    p = normalize(phrase)
    parts = String.split(p, "-", trim: true)

    cond do
      p == "" -> false
      length(parts) < 3 or length(parts) > 8 -> false
      Enum.any?(parts, fn w -> String.length(w) < 2 or String.length(w) > 12 end) -> false
      MapSet.member?(@reserved, p) -> false
      Enum.any?(parts, &MapSet.member?(@reserved, &1)) -> false
      true -> true
    end
  end

  def generate do
    words = word_list()
    n = length(words)

    1..4
    |> Enum.map(fn _ -> Enum.at(words, :rand.uniform(n) - 1) end)
    |> Enum.join("-")
  end

  defp word_list do
    path = Keyverse.Config.words_path()

    case File.read(path) do
      {:ok, raw} ->
        words =
          raw
          |> String.split(~r/\s+/, trim: true)
          |> Enum.map(&String.downcase/1)
          |> Enum.filter(&Regex.match?(~r/^[a-z]{3,8}$/, &1))

        if length(words) >= 64, do: words, else: fallback_words()

      _ ->
        fallback_words()
    end
  end

  defp fallback_words do
    ~w(able acid also aqua arch area atom auto axis baby ball band bank bare base beam bean bear
       bird blue boat body bold bone book burn cake calm card care case city cold cool corn cost
       dark data dawn deal deep desk door down drop dust duty each east easy echo edge even exit
       face fact fair fall farm fast fear feed feel file find fine fire fish five flag flat flow
       foam fold food form free full gain game gift girl give glow goal gold good gray grew grow
       hard head heal heat help high hill hold home hope host hour huge idea iron item join jump
       keep kind king know lake land lane last late lead leaf left life lift like line link list
       live load long look loop lose love made mail main make many mark mass meal mean meet mind
       mine mode moon more most move much near need next nice nine none noon note once only open
       over pack page paid pain pair park part pass past path pick plan play plot plus poem pool
       port post pure push quiet race rain rank rate read real rest rice rich ride ring rise road
       rock roll roof room root rose rule safe said sail sale salt same sand save seal seed seem
       self send ship shop show side sign sing site size skin slow snow soft some song soon sort
       soul spot star stay step stop such suit sure talk tall tape task team tell term test text
       than that them then they this time tiny told tone took tool tour town tree trip true turn
       type unit upon used user vary very view vote wait walk wall want warm wave ways weak week
       well went were west what when wide wife wild will wind wine wing wire wise wish with wood
       word work year your zero zone)
  end
end
