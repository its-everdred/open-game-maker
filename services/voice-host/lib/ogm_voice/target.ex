defmodule OgmVoice.Target do
  @moduledoc """
  The `VoiceTarget` a browser sends in its `start` frame (string keys, as decoded from JSON) and
  the cache key derived from it: `"scope:" <> session_id`, `"build:" <> job_id` or
  `"questions:" <> game_id <> ":" <> creator_id`.
  """

  @spec key(term()) :: {:ok, String.t()} | :error
  def key(%{"kind" => "scope", "game_id" => game, "session_id" => session, "creator_id" => creator})
      when is_binary(game) and game != "" and is_binary(creator) and creator != "" and is_binary(session) and
             session != "",
      do: {:ok, "scope:" <> session}

  def key(%{"kind" => "build", "game_id" => game, "job_id" => job, "ticket" => ticket, "creator_id" => creator})
      when is_binary(game) and game != "" and is_binary(ticket) and ticket != "" and is_binary(creator) and
             creator != "" and is_binary(job) and job != "",
      do: {:ok, "build:" <> job}

  # A quick question session (#612) belongs to the game and the creator, not to one build.
  def key(%{"kind" => "questions", "game_id" => game, "creator_id" => creator})
      when is_binary(game) and game != "" and is_binary(creator) and creator != "",
      do: {:ok, "questions:" <> game <> ":" <> creator}

  def key(_target), do: :error

  @spec creator(term()) :: String.t() | nil
  def creator(%{"creator_id" => creator}) when is_binary(creator), do: creator
  def creator(_target), do: nil
end
