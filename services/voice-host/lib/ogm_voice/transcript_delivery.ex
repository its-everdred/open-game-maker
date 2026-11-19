defmodule OgmVoice.TranscriptDelivery do
  @moduledoc """
  Relays finalized voice turns to the API chat store without retaining audio or a
  second transcript in the voice host.

  Delivery is independent of the browser WebSocket subscriber. Each conversation
  has an ordered queue, and failed requests are retried with the same idempotency
  fields before the next turn is sent.
  """

  use GenServer

  require Logger

  alias OgmVoice.Target
  alias VoiceConverse.Events

  @default_retry_delays [250, 1_000, 3_000]

  def start_link(opts) do
    {name, opts} = Keyword.pop(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec watch(GenServer.server(), module(), String.t(), map()) :: :ok | {:error, term()}
  def watch(server \\ __MODULE__, instance, conversation_id, target) do
    GenServer.call(server, {:watch, instance, conversation_id, target})
  end

  @impl true
  def init(opts) do
    state = %{
      api_url: opts |> Keyword.fetch!(:api_url) |> String.trim_trailing("/"),
      secret: Keyword.fetch!(opts, :secret),
      subscribe: Keyword.get(opts, :subscribe, &VoiceConverse.subscribe/3),
      request: Keyword.get(opts, :request, &request/3),
      retry_delays: Keyword.get(opts, :retry_delays, @default_retry_delays),
      conversations: %{}
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:watch, instance, conversation_id, target}, _from, state) do
    with true <- valid_conversation_id?(conversation_id),
         {:ok, _target_key} <- Target.key(target),
         false <- Map.has_key?(state.conversations, conversation_id),
         :ok <- state.subscribe.(instance, conversation_id, self()) do
      conversation = %{
        target: target,
        user_sequence: 0,
        queue: :queue.new(),
        delivering?: false,
        ended?: false,
        ready?: target["kind"] != "edit" or not is_nil(target["job_id"]),
        pending_agent: []
      }

      {:reply, :ok, put_in(state.conversations[conversation_id], conversation)}
    else
      true -> {:reply, :ok, state}
      false -> {:reply, {:error, :invalid_conversation_id}, state}
      :error -> {:reply, {:error, :invalid_target}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  @impl true
  def handle_info(
        {:voice_conversation, conversation_id, %{__struct__: Events.UserTranscript, text: text, final?: true}},
        state
      )
      when is_binary(text) do
    case state.conversations do
      %{^conversation_id => conversation} ->
        sequence = conversation.user_sequence + 1

        payload = %{
          "actor" => "creator",
          "conversation_id" => conversation_id,
          "target" => conversation.target,
          "text" => text,
          "turn_id" => "user-#{sequence}"
        }

        conversation = %{conversation | user_sequence: sequence}
        {:noreply, state |> put_conversation(conversation_id, conversation) |> enqueue(conversation_id, payload)}

      _other ->
        {:noreply, state}
    end
  end

  def handle_info(
        {:voice_conversation, conversation_id,
         %{__struct__: Events.AgentText, turn_id: turn_id, text: text, final?: true}},
        state
      )
      when is_binary(text) do
    case state.conversations do
      %{^conversation_id => conversation} ->
        payload = %{
          "actor" => "agent",
          "conversation_id" => conversation_id,
          "target" => conversation.target,
          "text" => text,
          "turn_id" => normalize_turn_id(turn_id)
        }

        if not conversation.ready? do
          conversation = %{conversation | pending_agent: conversation.pending_agent ++ [payload]}
          {:noreply, put_conversation(state, conversation_id, conversation)}
        else
          {:noreply, enqueue(state, conversation_id, payload)}
        end

      _other ->
        {:noreply, state}
    end
  end

  def handle_info({:deliver, conversation_id}, state) do
    case state.conversations do
      %{^conversation_id => conversation} -> deliver(conversation_id, conversation, state)
      _other -> {:noreply, state}
    end
  end

  def handle_info({:voice_conversation, conversation_id, {:ended, _reason}}, state) do
    case state.conversations do
      %{^conversation_id => conversation} ->
        if not conversation.delivering? and :queue.is_empty(conversation.queue) do
          {:noreply, %{state | conversations: Map.delete(state.conversations, conversation_id)}}
        else
          {:noreply, put_conversation(state, conversation_id, %{conversation | ended?: true})}
        end

      _other ->
        {:noreply, state}
    end
  end

  def handle_info({:voice_conversation, _conversation_id, _event}, state), do: {:noreply, state}
  def handle_info(_message, state), do: {:noreply, state}

  defp enqueue(state, conversation_id, payload) do
    conversation = Map.fetch!(state.conversations, conversation_id)
    item = %{payload: payload, retry_delays: state.retry_delays}
    queue = :queue.in(item, conversation.queue)
    start_delivery? = not conversation.delivering?
    state = put_conversation(state, conversation_id, %{conversation | queue: queue, delivering?: true})

    if start_delivery?, do: send(self(), {:deliver, conversation_id})
    state
  end

  defp deliver(conversation_id, conversation, state) do
    case :queue.out(conversation.queue) do
      {:empty, _queue} ->
        if conversation.ended? do
          {:noreply, %{state | conversations: Map.delete(state.conversations, conversation_id)}}
        else
          {:noreply, put_conversation(state, conversation_id, %{conversation | delivering?: false})}
        end

      {{:value, item}, remaining} ->
        url = state.api_url <> "/internal/voice/transcript"

        case perform_request(state, url, item.payload) do
          {:ok, status} when status in 200..299 ->
            {remaining, conversation} =
              if not conversation.ready? and item.payload["actor"] == "creator" do
                queue =
                  Enum.reduce(Enum.reverse(conversation.pending_agent), remaining, fn payload, queue ->
                    :queue.in_r(%{payload: payload, retry_delays: state.retry_delays}, queue)
                  end)

                {queue, %{conversation | ready?: true, pending_agent: []}}
              else
                {remaining, conversation}
              end

            send(self(), {:deliver, conversation_id})
            {:noreply, put_conversation(state, conversation_id, %{conversation | queue: remaining})}

          _failure ->
            retry_or_drop(conversation_id, conversation, item, remaining, state)
        end
    end
  end

  defp retry_or_drop(conversation_id, conversation, item, remaining, state) do
    case item.retry_delays do
      [delay | retry_delays] ->
        queue = :queue.in_r(%{item | retry_delays: retry_delays}, remaining)
        Process.send_after(self(), {:deliver, conversation_id}, delay)
        {:noreply, put_conversation(state, conversation_id, %{conversation | queue: queue})}

      [] ->
        Logger.warning("voice transcript delivery exhausted retries")
        send(self(), {:deliver, conversation_id})
        {:noreply, put_conversation(state, conversation_id, %{conversation | queue: remaining})}
    end
  end

  defp request(url, secret, payload) do
    headers = [
      {~c"content-type", ~c"application/json"},
      {~c"x-ogm-internal", String.to_charlist(secret || "")}
    ]

    request = {String.to_charlist(url), headers, ~c"application/json", Jason.encode!(payload)}

    case :httpc.request(:post, request, [timeout: 3_000], body_format: :binary) do
      {:ok, {{_http_version, status, _reason}, _headers, _body}} -> {:ok, status}
      {:error, reason} -> {:error, reason}
    end
  end

  defp perform_request(state, url, payload) do
    state.request.(url, state.secret.(), payload)
  rescue
    _error -> {:error, :request_failed}
  catch
    _kind, _reason -> {:error, :request_failed}
  end

  defp put_conversation(state, conversation_id, conversation),
    do: put_in(state.conversations[conversation_id], conversation)

  defp valid_conversation_id?(conversation_id),
    do: is_binary(conversation_id) and byte_size(conversation_id) in 1..128

  defp normalize_turn_id(turn_id) when is_binary(turn_id) and byte_size(turn_id) in 1..128, do: turn_id
  defp normalize_turn_id(turn_id), do: turn_id |> inspect(limit: 10, printable_limit: 64) |> String.slice(0, 128)
end
