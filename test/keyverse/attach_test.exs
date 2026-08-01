defmodule Keyverse.AttachTest do
  use ExUnit.Case, async: true

  alias Keyverse.Attach

  test "sanitize_filename strips paths and control chars" do
    assert Attach.sanitize_filename("../../etc/passwd") == "passwd"
    assert Attach.sanitize_filename("a\\b\\c.txt") == "c.txt"
    assert Attach.sanitize_filename("ok name.pdf") == "ok name.pdf"
    assert Attach.sanitize_filename("") == "file"
    assert Attach.sanitize_filename("..\n") == "file" or Attach.sanitize_filename("..\n") == ".."
  end

  test "sanitize_mime keeps simple types" do
    assert Attach.sanitize_mime("image/png; charset=utf-8") == "image/png"
    assert Attach.sanitize_mime("text/html") == "text/html"
    assert Attach.sanitize_mime("not a mime") == "application/octet-stream"
  end

  test "validate_url allows only http(s)" do
    assert {:ok, _} = Attach.validate_url("https://example.com/a")
    assert {:ok, _} = Attach.validate_url("http://example.com")
    assert {:error, _} = Attach.validate_url("javascript:alert(1)")
    assert {:error, _} = Attach.validate_url("data:text/html,hi")
    assert {:error, _} = Attach.validate_url("file:///etc/passwd")
    assert {:error, _} = Attach.validate_url("not a url")
  end

  test "force_download for html/js/svg" do
    assert Attach.force_download?("text/html")
    assert Attach.force_download?("image/svg+xml")
    assert Attach.force_download?("application/javascript")
    refute Attach.force_download?("image/png")
    refute Attach.force_download?("application/pdf")
  end
end
