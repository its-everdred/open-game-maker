defmodule OgmVoice.BudgetBriefingTest do
  use ExUnit.Case, async: false

  alias OgmVoice.Ports.BriefingSource
  alias VoiceConverse.Briefing

  @target %{"kind" => "build", "game_id" => "g1", "job_id" => "j1", "ticket" => "142", "creator_id" => "u1"}
  @budget "Remaining today: 2.0 stars (40%). Resets at 12:00 am. Free slots: 1 new game, 2 edits. Queued: none."
  @sizes "Rough sizes: small ≈ 0.5 star, medium ≈ 1–2, large ≈ 3–5, huge ≈ 6+ (low confidence)."

  setup do
    start_supervised!(OgmVoice.Cache)
    :ok
  end

  test "the role is short, contains no invented numbers, and names the budget rules" do
    role = File.read!(Path.expand("../../roles/creator.md", __DIR__))

    assert div(byte_size(role), 4) <= 400
    refute role =~ ~r/\d/
    assert role =~ "make it smaller"
    assert role =~ "split it into two builds"
    assert role =~ "queue it for the reset"
    assert role =~ "ask an admin"
    assert role =~ "[later]"
    assert role =~ "get_status"
    assert role =~ "every open Command"
    assert role =~ "answer_command"
    # #597: a clear spoken choice is submitted with no confirm step; questions and maybes are not choices.
    assert role =~ "no confirm step"
    assert role =~ "are not choices"
    assert role =~ "Open decision"
    assert role =~ "its own change"
    assert role =~ "record_summary"
  end

  test "budget, estimate and role details survive the configured briefing budget" do
    assert :ok = OgmVoice.Cache.put(push())
    assert {:ok, briefing} = BriefingSource.brief(@target)

    {rendered, meta} = Briefing.render(briefing, budget: 2_500, now: ~U[2026-11-01 05:10:30Z])

    assert rendered =~ "How to talk about budget:"
    assert rendered =~ "Budget: #{@budget}"
    assert meta.dropped == []
    refute meta.over_budget
    assert {:ok, @budget <> "\n" <> @sizes} = BriefingSource.details(@target, "budget", [])
    assert {:ok, @sizes} = BriefingSource.details(@target, "estimate", [])
    assert Enum.map(BriefingSource.sections(@target), & &1.id) == ["budget", "progress", "estimate"]
  end

  test "a paused build carries waiting_on into the next status" do
    fixture =
      "../../../../fixtures/voice/push-build-paused.json"
      |> Path.expand(__DIR__)
      |> File.read!()
      |> Jason.decode!()

    assert :ok = OgmVoice.Cache.put(fixture)
    assert {:ok, briefing} = BriefingSource.brief(@target)
    assert briefing.waiting_on.value == "Build paused at its reservation: ask an admin to raise it, or trim"
    assert hd(briefing.extra).title == "How to talk about budget"
  end

  test "missing budget data is explicit and unknown section ids are rejected" do
    without_budget = %{push() | "sections" => [%{"id" => "progress", "text" => "Building"}], "extra" => []}
    assert :ok = OgmVoice.Cache.put(without_budget)
    assert {:ok, briefing} = BriefingSource.brief(@target)
    assert "Budget unavailable" in briefing.gaps
    assert {:error, :unavailable} = BriefingSource.details(@target, "budget", [])

    invalid = %{push() | "sections" => [%{"id" => "secret", "text" => "do not cache"}]}
    assert {:error, :invalid_push} = OgmVoice.Cache.put(invalid)
  end

  defp push do
    %{
      "target_key" => "build:j1",
      "observed_at" => "2026-11-01T05:10:00Z",
      "summary" => "Building",
      "current_task" => "Placing the first room",
      "next_steps" => [],
      "questions" => [],
      "extra" => [%{"title" => "Budget", "text" => @budget}],
      "sections" => [
        %{"id" => "budget", "text" => @budget <> "\n" <> @sizes},
        %{"id" => "progress", "text" => "Building: placing the first room"},
        %{"id" => "estimate", "text" => @sizes}
      ]
    }
  end
end
