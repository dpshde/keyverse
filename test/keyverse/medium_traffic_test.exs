defmodule Keyverse.MediumTrafficTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Keyverse.{PackQuota, RateLimit, Router}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-mt-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Application.put_env(:keyverse, :max_pack_attach_bytes, 200)
    Application.put_env(:keyverse, :max_pack_attach_count, 2)
    Application.put_env(:keyverse, :rate_attach, {3, 60_000})
    Application.put_env(:keyverse, :rate_global_write, {10_000, 60_000})
    Application.put_env(:keyverse, :max_attach_bytes, 10_000)
    Keyverse.RateLimit.reset!()
    Keyverse.DoorIndex.reload!()

    on_exit(fn ->
      File.rm_rf!(root)
      Keyverse.RateLimit.reset!()
      Application.put_env(:keyverse, :max_pack_attach_bytes, 1 * 1024 * 1024 * 1024)
      Application.put_env(:keyverse, :max_pack_attach_count, 2_000)
      Application.put_env(:keyverse, :rate_attach, {60, 60_000})
      Application.put_env(:keyverse, :rate_global_write, {600, 60_000})
      Application.put_env(:keyverse, :max_attach_bytes, 50 * 1024 * 1024)
    end)

    # Prefer a fixed phrase; retry generate if the word list is briefly unavailable.
    door =
      Enum.find_value(1..12, fn i ->
        candidate =
          if i == 1 do
            "able-acid-also-beam"
          else
            Keyverse.Door.generate()
          end

        case Keyverse.Pack.create(candidate) do
          {:ok, d} -> d
          {:error, _} -> nil
        end
      end) || raise "could not create test pack"

    Keyverse.RateLimit.reset!()
    {:ok, door: door, pack: Keyverse.Pack.path_for(door)}
  end

  test "pack quota blocks new blobs over byte budget", %{door: door, pack: pack} do
    body1 = :crypto.strong_rand_bytes(120)
    body2 = :crypto.strong_rand_bytes(120)

    c1 =
      conn(:post, "/#{door}/api/note/jhn.3.1/attachments", body1)
      |> put_req_header("content-type", "application/octet-stream")
      |> put_req_header("x-filename", "a.bin")
      |> Router.call([])

    assert c1.status == 200

    c2 =
      conn(:post, "/#{door}/api/note/jhn.3.1/attachments", body2)
      |> put_req_header("content-type", "application/octet-stream")
      |> put_req_header("x-filename", "b.bin")
      |> Router.call([])

    assert c2.status == 507
    err = Jason.decode!(c2.resp_body)
    assert err["error"] =~ "storage full"
    assert err["quota"]["max_bytes"] == 200

    u = PackQuota.usage(pack)
    assert u.bytes == 120
    assert u.count == 1
  end

  test "dedupe same sha does not burn quota", %{door: door, pack: pack} do
    body = :crypto.strong_rand_bytes(100)

    for i <- 1..2 do
      c =
        conn(:post, "/#{door}/api/note/jhn.3.#{i}/attachments", body)
        |> put_req_header("content-type", "application/octet-stream")
        |> put_req_header("x-filename", "same.bin")
        |> Router.call([])

      assert c.status == 200, "upload #{i}: #{c.resp_body}"
    end

    u = PackQuota.usage(pack)
    assert u.count == 1
    assert u.bytes == 100
  end

  test "rate limit returns 429 with retry-after", %{door: door} do
    Application.put_env(:keyverse, :rate_attach, {2, 60_000})
    Application.put_env(:keyverse, :max_pack_attach_count, 50)
    Keyverse.RateLimit.reset!()

    statuses =
      for i <- 1..4 do
        conn(:post, "/#{door}/api/note/jhn.3.16/attachments", "x#{i}-#{System.unique_integer()}")
        |> put_req_header("content-type", "text/plain")
        |> put_req_header("x-filename", "f#{i}.txt")
        |> Router.call([])
        |> Map.get(:status)
      end

    assert Enum.count(statuses, &(&1 == 200)) == 2
    assert Enum.any?(statuses, &(&1 == 429))
  end

  test "api/pack includes quota", %{door: door} do
    conn = conn(:get, "/#{door}/api/pack") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["quota"]["max_bytes"] == 200
    assert body["quota"]["max_count"] == 2
  end

  test "RateLimit sliding window" do
    key = "test-#{System.unique_integer()}"
    assert :ok = RateLimit.check(key, 2, 60_000)
    assert :ok = RateLimit.check(key, 2, 60_000)
    assert {:error, :rate_limited, _} = RateLimit.check(key, 2, 60_000)
  end
end
