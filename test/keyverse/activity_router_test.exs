defmodule Keyverse.ActivityRouterTest do
  use ExUnit.Case, async: false
  import Plug.Test

  alias Keyverse.{Note, Pack, Router, Scope}

  setup do
    root = Path.join(System.tmp_dir!(), "kv-act-rt-#{System.unique_integer([:positive])}")
    File.rm_rf!(root)
    File.mkdir_p!(root)
    Application.put_env(:keyverse, :packs_root, root)
    Application.put_env(:keyverse, :door_open, false)
    Keyverse.DoorIndex.reload!()

    {:ok, key} = Pack.create("activity-router-test-door")
    pack = Pack.path_for(key)
    scope = Scope.parse("John 1:1")

    {:ok, _} =
      Note.put_note(pack, scope, %{
        "blocks" => [%{"id" => "b1", "indent" => 0, "text" => "In the beginning"}]
      })

    on_exit(fn -> File.rm_rf!(root) end)
    %{door: key}
  end

  test "GET /api/activity returns heatmap", %{door: door} do
    conn = conn(:get, "/#{door}/api/activity") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert is_list(body["days"])
    assert body["total"] >= 1
    assert body["from"]
    assert body["to"]
    # Canon coverage rail (note density; 1 note/chapter → 90% heat)
    assert is_map(body["canon"])
    assert is_list(body["canon"]["books"])
    assert length(body["canon"]["books"]) == 66
  end

  test "GET /api/activity?date= returns day events", %{door: door} do
    today = Date.utc_today() |> Date.to_iso8601()
    conn = conn(:get, "/#{door}/api/activity?date=#{today}") |> Router.call([])
    assert conn.status == 200
    body = Jason.decode!(conn.resp_body)
    assert body["date"] == today
    assert is_list(body["events"])
    assert length(body["events"]) >= 1
    ev = hd(body["events"])
    assert ev["slug"] == "jhn.1.1"
    assert is_binary(ev["after_text"])
  end

  test "GET /activity serves activity page", %{door: door} do
    conn = conn(:get, "/#{door}/activity") |> Router.call([])
    assert conn.status == 200
    assert conn.resp_body =~ "activity-page"
    assert conn.resp_body =~ "/activity.js"
    assert conn.resp_body =~ "canon-map"
  end

  test "protocol advertises activity", %{door: door} do
    conn = conn(:get, "/#{door}/api/protocol") |> Router.call([])
    body = Jason.decode!(conn.resp_body)
    assert body["features"]["activity"] == true
    assert Enum.any?(body["endpoints"], &String.contains?(&1, "/api/activity"))
  end
end
