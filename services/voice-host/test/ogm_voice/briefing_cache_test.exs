defmodule OgmVoice.BriefingCacheTest do
  use ExUnit.Case, async: false

  alias OgmVoice.Ports.{BriefingSource, CommandSource}
  alias VoiceConverse.{Briefing, Ports}

  @target %{"kind" => "build", "game_id" => "g1", "job_id" => "j1", "ticket" => "142", "creator_id" => "u1"}
  @push %{
    "target_key" => "build:j1",
    "observed_at" => "2026-11-01T05:25:00Z",
    "summary" => "Building the castle level",
    "next_steps" => ["Paint the door red"],
    "extra" => [%{"title" => "Budget", "text" => "About 3 more changes fit today."}],
    "sections" => [%{"id" => "budget", "text" => "3 changes left"}, %{"id" => "progress", "text" => "Door next"}]
  }

  setup do
    start_supervised!(OgmVoice.Cache)
    :ok
  end

  test "a push is readable through the port within the 100 ms brief deadline" do
    assert :ok = OgmVoice.Cache.put(@push)

    assert {:ok, %Briefing{summary: %{value: "Building the castle level", observed_at: at}} = briefing} =
             Ports.call_port(BriefingSource, :brief, [@target], :brief)

    assert at == ~U[2026-11-01 05:25:00Z]
    assert briefing.next_steps.value == ["Paint the door red"]
    assert [%{title: "How to talk about budget"}, %{title: "Budget"}] = briefing.extra
    # Not pushed means not reported, never an empty value that reads as "nothing waiting".
    assert briefing.waiting_on == nil
    assert {:ok, "Door next"} = Ports.call_port(BriefingSource, :details, [@target, "progress", []], :details)
  end

  test "a target with no push is unavailable, never an empty briefing" do
    assert {:error, :unavailable} = Ports.call_port(BriefingSource, :brief, [@target], :brief)
    assert {:error, :unavailable} = BriefingSource.details(@target, "budget", [])
    assert {:error, :unavailable} = CommandSource.open(@target)
  end

  test "a scope target reads its own key" do
    assert :ok = OgmVoice.Cache.put(%{@push | "target_key" => "scope:s1"})
    scope = %{"kind" => "scope", "game_id" => "g1", "session_id" => "s1", "creator_id" => "u1"}
    assert {:ok, %Briefing{}} = BriefingSource.brief(scope)
    assert %{id: "scope:s1", kind: :scope} = BriefingSource.describe_target(scope)
    assert {:error, :unavailable} = BriefingSource.brief(@target)
  end

  # A quick question session (#612) is the creator's, in one game: another creator's session there is a different key.
  test "a question session reads the key of its game and creator" do
    assert :ok = OgmVoice.Cache.put(%{@push | "target_key" => "questions:g1:u1"})
    questions = %{"kind" => "questions", "game_id" => "g1", "creator_id" => "u1"}
    assert {:ok, %Briefing{}} = BriefingSource.brief(questions)
    assert %{id: "questions:g1:u1", kind: :questions} = BriefingSource.describe_target(questions)
    assert {:error, :unavailable} = BriefingSource.brief(%{questions | "creator_id" => "u2"})
    assert {:error, :unavailable} = BriefingSource.brief(@target)
  end

  test "an invalid push is rejected and the previous briefing stays" do
    assert :ok = OgmVoice.Cache.put(@push)
    assert {:error, :invalid_push} = OgmVoice.Cache.put(%{@push | "summary" => 42})
    assert {:error, :invalid_observed_at} = OgmVoice.Cache.put(%{@push | "observed_at" => "yesterday"})
    assert {:error, :invalid_target_key} = OgmVoice.Cache.put(%{@push | "target_key" => "job:j1"})
    assert {:error, :invalid_push} = OgmVoice.Cache.put(Map.delete(@push, "observed_at"))

    assert {:ok, %Briefing{summary: %{value: "Building the castle level"}}} = BriefingSource.brief(@target)
  end

  test "commands are unavailable until the API pushes them, then listed as pushed" do
    assert :ok = OgmVoice.Cache.put(@push)
    assert {:error, :unavailable} = CommandSource.open(@target)

    assert :ok = OgmVoice.Cache.put(Map.put(@push, "commands", []))
    assert {:ok, []} = CommandSource.open(@target)

    assert :ok =
             OgmVoice.Cache.put(
               Map.put(@push, "commands", [
                 %{
                   "id" => "c1",
                   "question" => "Red or blue?",
                   "options" => [%{"id" => "red", "label" => "Red"}, %{"id" => "blue", "label" => "Blue"}]
                 }
               ])
             )

    assert {:ok,
            [
              %{
                id: "c1",
                question: "Red or blue?",
                options: [%{"id" => "red", "label" => "Red"}, %{"id" => "blue", "label" => "Blue"}]
              }
            ]} = CommandSource.open(@target)
  end

  test "malformed commands are rejected without replacing the previous briefing" do
    assert :ok = OgmVoice.Cache.put(@push)

    for command <- [
          %{"id" => 1, "question" => "Red or blue?"},
          %{"id" => "c1", "question" => "Red or blue?", "options" => ["red", 2]},
          %{"id" => "c1", "question" => "Red or blue?", "version" => %{}}
        ] do
      assert {:error, :invalid_push} = OgmVoice.Cache.put(Map.put(@push, "commands", [command]))
    end

    assert {:ok, %Briefing{summary: %{value: "Building the castle level"}}} = BriefingSource.brief(@target)
  end

  test "a malformed target is not alive, so no session starts for it" do
    assert BriefingSource.alive?(%{"kind" => "build"}) == false
    assert BriefingSource.alive?(@target) == :unknown
  end
end
