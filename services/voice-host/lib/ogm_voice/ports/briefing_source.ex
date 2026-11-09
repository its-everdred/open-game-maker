defmodule OgmVoice.Ports.BriefingSource do
  @moduledoc """
  Serves the target's briefing from `OgmVoice.Cache`. A target with no push answers
  `{:error, :unavailable}`, never an empty briefing that would read as "idle".
  """
  @behaviour VoiceConverse.Ports.BriefingSource

  alias OgmVoice.{Cache, Target}

  @role_path Path.expand("../../../roles/creator.md", __DIR__)
  @external_resource @role_path
  @role File.read!(@role_path) |> String.trim()

  @sections [
    %{id: "budget", description: "Today's allowance and what fits"},
    %{id: "progress", description: "What the builder is doing"},
    %{id: "estimate", description: "Rough change-size estimates"}
  ]

  @impl true
  def describe_target(%{"kind" => "scope", "game_id" => game} = target),
    do: %{id: key!(target), kind: :scope, title: "Scope for #{game}"}

  def describe_target(%{"kind" => "build", "job_id" => job} = target),
    do: %{id: key!(target), kind: :build, title: "Build #{job}"}

  def describe_target(%{"kind" => "questions", "game_id" => game} = target),
    do: %{id: key!(target), kind: :questions, title: "Quick questions for #{game}"}

  @impl true
  def brief(target) do
    with {:ok, entry} <- entry(target) do
      role = %{title: "How to talk about budget", text: @role, observed_at: entry.observed_at}

      gaps =
        if Map.has_key?(entry.sections, "budget"),
          do: entry.briefing.gaps,
          else: ["Budget unavailable" | entry.briefing.gaps]

      {:ok, %{entry.briefing | extra: [role | entry.briefing.extra], gaps: gaps}}
    end
  end

  @impl true
  def details(target, section, _opts) do
    with {:ok, entry} <- entry(target),
         {:ok, text} <- Map.fetch(entry.sections, section) do
      {:ok, text}
    else
      _ -> {:error, :unavailable}
    end
  end

  @impl true
  def sections(_target), do: @sections

  @impl true
  def subscribe(_target, _pid), do: :unsupported

  # A malformed target can never start a session; anything else is unknown until the API says.
  @impl true
  def alive?(target), do: if(match?({:ok, _}, Target.key(target)), do: :unknown, else: false)

  @doc false
  @spec entry(term()) :: {:ok, Cache.entry()} | {:error, :unavailable}
  def entry(target) do
    with {:ok, key} <- Target.key(target),
         {:ok, entry} <- Cache.get(key) do
      {:ok, entry}
    else
      _ -> {:error, :unavailable}
    end
  end

  defp key!(target) do
    {:ok, key} = Target.key(target)
    key
  end
end
