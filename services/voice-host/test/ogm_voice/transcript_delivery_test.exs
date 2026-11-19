defmodule OgmVoice.TranscriptDeliveryTest do
  use ExUnit.Case, async: true

  alias VoiceConverse.Events

  @target %{"kind" => "build", "game_id" => "g1", "job_id" => "j1", "ticket" => "7", "creator_id" => "u1"}

  test "holds an edit greeting until the creator turn creates its job" do
    test = self()
    name = unique_name()
    target = %{"kind" => "edit", "game_id" => "g1", "creator_id" => "u1", "session_id" => "s1"}

    start_supervised!(
      {OgmVoice.TranscriptDelivery,
       name: name,
       api_url: "http://127.0.0.1:4300",
       secret: fn -> "internal-secret" end,
       subscribe: fn _, _, _ -> :ok end,
       request: fn _, _, payload ->
         send(test, {:delivered, payload})
         {:ok, 200}
       end}
    )

    assert :ok = OgmVoice.TranscriptDelivery.watch(name, VoiceInstance, "edit-conversation", target)

    send(
      name,
      {:voice_conversation, "edit-conversation", %Events.AgentText{turn_id: "a1", text: "Hello", final?: true}}
    )

    send(name, {:voice_conversation, "edit-conversation", %Events.UserTranscript{text: "Add a bridge", final?: true}})
    assert_receive {:delivered, %{"actor" => "creator", "text" => "Add a bridge"}}
    assert_receive {:delivered, %{"actor" => "agent", "text" => "Hello"}}
  end

  test "subscribes independently and delivers only final turns in order" do
    test = self()
    name = unique_name()

    start_supervised!(
      {OgmVoice.TranscriptDelivery,
       name: name,
       api_url: "http://127.0.0.1:4300",
       secret: fn -> "internal-secret" end,
       subscribe: fn instance, conversation_id, subscriber ->
         send(test, {:subscribed, instance, conversation_id, subscriber})
         :ok
       end,
       request: fn url, secret, payload ->
         send(test, {:request, url, secret, payload})
         {:ok, 200}
       end}
    )

    assert :ok = OgmVoice.TranscriptDelivery.watch(name, VoiceInstance, "conversation-1", @target)
    assert_receive {:subscribed, VoiceInstance, "conversation-1", relay}

    send(relay, {:voice_conversation, "conversation-1", %Events.UserTranscript{text: "partial", final?: false}})
    send(relay, {:voice_conversation, "conversation-1", %Events.UserTranscript{text: "hello", final?: true}})

    send(
      relay,
      {:voice_conversation, "conversation-1", %Events.AgentText{turn_id: "agent-turn", text: "hi", final?: true}}
    )

    assert_receive {:request, "http://127.0.0.1:4300/internal/voice/transcript", "internal-secret", user}

    assert user == %{
             "actor" => "creator",
             "conversation_id" => "conversation-1",
             "target" => @target,
             "text" => "hello",
             "turn_id" => "user-1"
           }

    assert_receive {:request, _, _, agent}

    assert agent == %{
             "actor" => "agent",
             "conversation_id" => "conversation-1",
             "target" => @target,
             "text" => "hi",
             "turn_id" => "agent-turn"
           }

    refute_receive {:request, _, _, %{"text" => "partial"}}
  end

  test "retries a failed delivery with the same idempotency fields" do
    test = self()
    name = unique_name()
    {:ok, attempts} = Agent.start_link(fn -> 0 end)

    start_supervised!(
      {OgmVoice.TranscriptDelivery,
       name: name,
       api_url: "http://127.0.0.1:4300",
       secret: fn -> "internal-secret" end,
       subscribe: fn _instance, _conversation_id, _subscriber -> :ok end,
       retry_delays: [0],
       request: fn _url, _secret, payload ->
         send(test, {:attempt, payload})
         if Agent.get_and_update(attempts, &{&1, &1 + 1}) == 0, do: {:error, :closed}, else: {:ok, 200}
       end}
    )

    assert :ok = OgmVoice.TranscriptDelivery.watch(name, VoiceInstance, "conversation-2", @target)
    send(name, {:voice_conversation, "conversation-2", %Events.UserTranscript{text: "retry me", final?: true}})

    assert_receive {:attempt, first}
    assert_receive {:attempt, second}
    assert first == second
  end

  test "refuses invalid targets before subscribing" do
    name = unique_name()

    start_supervised!(
      {OgmVoice.TranscriptDelivery,
       name: name,
       api_url: "http://127.0.0.1:4300",
       secret: fn -> "internal-secret" end,
       subscribe: fn _instance, _conversation_id, _subscriber -> flunk("must not subscribe") end,
       request: fn _url, _secret, _body -> {:ok, 200} end}
    )

    assert {:error, :invalid_target} =
             OgmVoice.TranscriptDelivery.watch(name, VoiceInstance, "conversation-3", %{"kind" => "build"})
  end

  test "drains final delivery after the conversation ends and forgets the relay" do
    test = self()
    name = unique_name()

    start_supervised!(
      {OgmVoice.TranscriptDelivery,
       name: name,
       api_url: "http://127.0.0.1:4300",
       secret: fn -> "internal-secret" end,
       subscribe: fn _instance, _conversation_id, _subscriber -> :ok end,
       request: fn _url, _secret, payload ->
         send(test, {:delivered, payload})
         {:ok, 200}
       end}
    )

    assert :ok = OgmVoice.TranscriptDelivery.watch(name, VoiceInstance, "conversation-4", @target)
    send(name, {:voice_conversation, "conversation-4", %Events.UserTranscript{text: "last turn", final?: true}})
    send(name, {:voice_conversation, "conversation-4", {:ended, :transport_lost}})

    assert_receive {:delivered, %{"text" => "last turn"}}
    assert eventually(fn -> :sys.get_state(name).conversations == %{} end)
  end

  defp unique_name, do: Module.concat(__MODULE__, "Relay#{System.unique_integer([:positive])}")

  defp eventually(predicate, attempts \\ 20)
  defp eventually(predicate, 0), do: predicate.()

  defp eventually(predicate, attempts) do
    if predicate.() do
      true
    else
      Process.sleep(5)
      eventually(predicate, attempts - 1)
    end
  end
end
