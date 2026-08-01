defmodule Keyverse.MixProject do
  use Mix.Project

  def project do
    [
      app: :keyverse,
      version: "0.2.0",
      elixir: "~> 1.15",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),
      elixirc_paths: elixirc_paths(Mix.env()),
      # Railpack runs `mix release` and expects this app name under _build/prod/rel/
      releases: [
        keyverse: [
          include_executables_for: [:unix],
          applications: [runtime_tools: :permanent]
        ]
      ]
    ]
  end

  def application do
    [
      extra_applications: [:logger, :inets, :ssl, :crypto, :public_key],
      mod: {Keyverse.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:bandit, "~> 1.6"},
      {:plug, "~> 1.16"},
      {:jason, "~> 1.4"},
      {:eqrcode, "~> 0.2.0"}
    ]
  end

  defp aliases do
    [
      start: ["app.start", "run --no-halt"],
      "keyverse.server": ["app.config", "run --no-halt"],
      conformance: ["keyverse.conformance"]
    ]
  end
end
