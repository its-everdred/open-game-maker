defmodule OgmVoice.Cache do
  @moduledoc """
  The briefing cache the API pushes into (`POST /internal/briefing`). Ports read it straight from
  ETS, so they answer inside the package's 100/300 ms deadlines and never do network I/O.

  A push that fails validation is rejected and the previous entry stays. Entries live in memory
  only: the host writes nothing to disk.
  """
  use GenServer

  alias VoiceConverse.Briefing

  @table :ogm_voice_briefings
  @max_age_s 60
  @section_ids MapSet.new(~w(budget progress estimate))

  @type entry :: %{
          briefing: Briefing.t(),
          sections: %{String.t() => String.t()},
          commands: [map()] | nil,
          observed_at: DateTime.t()
        }

  def start_link(_opts), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @spec put(map()) :: :ok | {:error, atom()}
  def put(push), do: GenServer.call(__MODULE__, {:put, push})

  @spec get(String.t()) :: {:ok, entry()} | :error
  def get(target_key) do
    case :ets.lookup(@table, target_key) do
      [{^target_key, entry}] -> {:ok, entry}
      [] -> :error
    end
  rescue
    ArgumentError -> :error
  end

  @impl true
  def init(:ok) do
    :ets.new(@table, [:named_table, :protected, read_concurrency: true])
    {:ok, nil}
  end

  @impl true
  def handle_call({:put, push}, _from, state) do
    case parse(push) do
      {:ok, key, entry} ->
        :ets.insert(@table, {key, entry})
        {:reply, :ok, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp parse(%{"target_key" => key, "observed_at" => observed_at} = push) when is_binary(key) do
    with :ok <- check_key(key),
         {:ok, at} <- observed_at(observed_at),
         {:ok, briefing} <- briefing(push, at),
         {:ok, sections} <- sections(Map.get(push, "sections", [])),
         {:ok, commands} <- commands(Map.get(push, "commands")) do
      {:ok, key, %{briefing: briefing, sections: sections, commands: commands, observed_at: at}}
    end
  end

  defp parse(_push), do: {:error, :invalid_push}

  defp observed_at(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, at, _offset} -> {:ok, at}
      {:error, _reason} -> {:error, :invalid_observed_at}
    end
  end

  defp observed_at(_value), do: {:error, :invalid_observed_at}

  defp check_key("scope:" <> id) when id != "", do: :ok
  defp check_key("build:" <> id) when id != "", do: :ok
  defp check_key("questions:" <> id) when id != "", do: :ok
  defp check_key(_key), do: {:error, :invalid_target_key}

  defp briefing(push, at) do
    with {:ok, summary} <- text(push, "summary"),
         {:ok, current_task} <- text(push, "current_task"),
         {:ok, waiting_on} <- text(push, "waiting_on"),
         {:ok, next_steps} <- texts(push, "next_steps"),
         {:ok, questions} <- texts(push, "questions"),
         {:ok, extra} <- extra(Map.get(push, "extra", []), at) do
      {:ok,
       %Briefing{
         summary: field(summary, at),
         current_task: field(current_task, at),
         waiting_on: field(waiting_on, at),
         next_steps: field(next_steps, at),
         questions: field(questions, at),
         extra: extra
       }}
    end
  end

  # An absent field stays `nil` ("not reported"); only a pushed value becomes a field.
  defp field(nil, _at), do: nil
  defp field(value, at), do: %{value: value, observed_at: at, max_age_s: @max_age_s}

  defp text(push, name) do
    case Map.get(push, name) do
      value when is_nil(value) or is_binary(value) -> {:ok, value}
      _ -> {:error, :invalid_push}
    end
  end

  defp texts(push, name) do
    case Map.get(push, name) do
      nil -> {:ok, nil}
      list when is_list(list) -> if Enum.all?(list, &is_binary/1), do: {:ok, list}, else: {:error, :invalid_push}
      _ -> {:error, :invalid_push}
    end
  end

  defp extra(list, at) when is_list(list) do
    collect(list, fn
      %{"title" => title, "text" => text} when is_binary(title) and is_binary(text) ->
        {:ok, %{title: title, text: text, observed_at: at}}

      _ ->
        :error
    end)
  end

  defp extra(_list, _at), do: {:error, :invalid_push}

  defp sections(list) when is_list(list) do
    with {:ok, pairs} <-
           collect(list, fn
             %{"id" => id, "text" => text} when is_binary(id) and is_binary(text) ->
               if MapSet.member?(@section_ids, id), do: {:ok, {id, text}}, else: :error

             _ ->
               :error
           end),
         do: {:ok, Map.new(pairs)}
  end

  defp sections(_list), do: {:error, :invalid_push}

  # `nil` means the API sent no command data, which reads as "unavailable", never as "none open".
  defp commands(nil), do: {:ok, nil}

  defp commands(list) when is_list(list) do
    collect(list, fn
      %{"id" => id, "question" => question} = command when is_binary(id) and is_binary(question) ->
        options = Map.get(command, "options", [])
        version = Map.get(command, "version")

        if is_list(options) and Enum.all?(options, &valid_option?/1) and
             (is_nil(version) or is_binary(version) or is_number(version)),
           do: {:ok, %{id: id, version: version, question: question, options: options}},
           else: :error

      _ ->
        :error
    end)
  end

  defp commands(_list), do: {:error, :invalid_push}

  defp valid_option?(option) when is_binary(option), do: true

  defp valid_option?(%{"id" => id, "label" => label}) when is_binary(id) and is_binary(label),
    do: id != "" and label != ""

  defp valid_option?(_option), do: false

  defp collect(list, fun) do
    Enum.reduce_while(list, {:ok, []}, fn item, {:ok, acc} ->
      case fun.(item) do
        {:ok, value} -> {:cont, {:ok, [value | acc]}}
        :error -> {:halt, {:error, :invalid_push}}
      end
    end)
    |> case do
      {:ok, items} -> {:ok, Enum.reverse(items)}
      error -> error
    end
  end
end
