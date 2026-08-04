defmodule Keyverse.MetricsTest do
  use ExUnit.Case, async: false
  import Plug.Test

  alias Keyverse.{Metrics, Router}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-metrics-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()
    on_exit(fn -> File.rm_rf!(root) end)
    :ok
  end

  test "health includes metrics summary and /metrics snapshots" do
    conn = conn(:get, "/health") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["ok"] == true
    assert body["version"] == Keyverse.Config.protocol_version()
    assert body["app_version"] == "0.2.0"
    assert is_map(body["metrics"])
    assert Map.has_key?(body["metrics"], "uptime_ms")

    conn = conn(:get, "/metrics") |> Router.call([])
    assert conn.status == 200
    snap = Jason.decode!(conn.resp_body)
    assert snap["host"] == "elixir"
    assert snap["protocol_version"] == Keyverse.Config.protocol_version()
    assert is_map(snap["ops"])
    assert snap["ops"]["http_health"]["count"] >= 1
  end

  test "record and percentile summary" do
    Metrics.reset()
    Metrics.record(:http_put_note, 10)
    Metrics.record(:http_put_note, 20)
    Metrics.record(:http_put_note, 30)
    snap = Metrics.snapshot()
    lat = snap.ops.http_put_note.latency_ms
    assert lat.n == 3
    assert lat.p50 == 20
    assert lat.min == 10
    assert lat.max == 30
  end
end
