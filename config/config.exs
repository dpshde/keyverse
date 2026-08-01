import Config

config :keyverse,
  port: String.to_integer(System.get_env("PORT") || "4180"),
  host: System.get_env("HOST") || "0.0.0.0",
  packs_root: System.get_env("PACK_DIR") || Path.expand("packs"),
  door_open: System.get_env("DOOR_OPEN") in ["1", "true"],
  boot_door: System.get_env("DOOR") || System.get_env("PACK_DOOR") || "",
  max_attach_bytes: String.to_integer(System.get_env("MAX_ATTACH_BYTES") || "#{50 * 1024 * 1024}"),
  max_attach_per_note: String.to_integer(System.get_env("MAX_ATTACH_PER_NOTE") || "80"),
  max_import_bytes: String.to_integer(System.get_env("MAX_IMPORT_BYTES") || "#{200 * 1024 * 1024}"),
  max_pack_attach_bytes:
    String.to_integer(System.get_env("MAX_PACK_ATTACH_BYTES") || "#{1 * 1024 * 1024 * 1024}"),
  max_pack_attach_count: String.to_integer(System.get_env("MAX_PACK_ATTACH_COUNT") || "2000"),
  cors_origin: System.get_env("CORS_ORIGIN"),
  fathom_site: System.get_env("FATHOM_SITE") || "EMYGRIAR"

config :logger, level: :info

import_config "#{config_env()}.exs"
