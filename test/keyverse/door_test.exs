defmodule Keyverse.DoorTest do
  use ExUnit.Case, async: true

  alias Keyverse.Door

  test "normalize collapses spaces and case" do
    assert Door.normalize("Quiet River Lantern") == "quiet-river-lantern"
    assert Door.normalize("  foo_bar_baz_qux  ") == "foo-bar-baz-qux"
  end

  test "valid requires 3–8 short words" do
    assert Door.valid?("quiet-river-lantern")
    assert Door.valid?("able-bird-cold-deep-east-fair-gold-high")
    refute Door.valid?("ab")
    refute Door.valid?("one-two")
    refute Door.valid?("setup")
    refute Door.valid?("api-foo-bar-baz")
  end

  test "generate returns valid phrase" do
    phrase = Door.generate()
    assert Door.valid?(phrase)
    assert length(String.split(phrase, "-")) == 4
  end
end
