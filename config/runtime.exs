import Config

# Loaded for all releases and for mix run in prod.
port = String.to_integer(System.get_env("PORT") || "4180")
host = System.get_env("HOST") || "0.0.0.0"
packs = System.get_env("PACK_DIR") || Path.expand("packs")

config :keyverse,
  port: port,
  host: host,
  packs_root: packs,
  door_open: System.get_env("DOOR_OPEN") in ["1", "true"],
  boot_door: System.get_env("DOOR") || System.get_env("PACK_DOOR") || "",
  max_attach_bytes: String.to_integer(System.get_env("MAX_ATTACH_BYTES") || "#{50 * 1024 * 1024}"),
  cors_origin: System.get_env("CORS_ORIGIN"),
  fathom_site: System.get_env("FATHOM_SITE") || "EMYGRIAR"

# Only override start_server when explicitly set (preserve config/test.exs false).
case System.get_env("START_SERVER") do
  nil -> :ok
  val -> config :keyverse, start_server: val not in ["false", "0", "no"]
end
