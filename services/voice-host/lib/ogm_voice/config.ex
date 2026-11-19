defmodule OgmVoice.Config do
  @moduledoc """
  Host settings read from the unit's environment by name. Secrets stay zero-arity functions that
  read the environment at use time, so no secret value sits in a struct a crash report could print.
  """

  @instance OgmVoice.Instance
  @min_secret_bytes 32
  @providers %{
    # Reports a provider conversation at once, as a live adapter does on connect, so the session
    # reaches `listening` with no key.
    "fake" =>
      {VoiceConverse.Testing.FakeProvider, [script: [%VoiceConverse.Events.ProviderConversationId{id: "fake"}]]},
    "elevenlabs_agents" => {VoiceConverse.Providers.ElevenLabsAgents, []},
    "openai_realtime" => {VoiceConverse.Providers.OpenAIRealtime, []}
  }
  @provider_ids %{
    "fake" => :fake,
    "elevenlabs_agents" => :elevenlabs_agents,
    "openai_realtime" => :openai_realtime
  }
  @allowed_tools ~w(
    get_status get_details list_open_commands answer_command propose_instruction record_summary end_conversation
  )

  @enforce_keys [
    :port,
    :internal_port,
    :provider,
    :llm,
    :max_sessions,
    :api_internal_url,
    :render_dir,
    :token_secret,
    :internal_secret
  ]
  defstruct @enforce_keys ++
              [
                agent_id: nil,
                narration_enabled: false,
                cleanup_root: nil,
                dictation_transcriber: VoiceTranscribe.Scribe,
                dictation_transcriber_opts: nil
              ]

  @type secret :: (-> String.t() | nil)
  @type t :: %__MODULE__{
          port: :inet.port_number(),
          internal_port: :inet.port_number(),
          provider: String.t(),
          llm: String.t(),
          agent_id: String.t() | nil,
          max_sessions: pos_integer(),
          api_internal_url: String.t(),
          render_dir: Path.t(),
          narration_enabled: boolean(),
          cleanup_root: Path.t() | nil,
          dictation_transcriber: module(),
          dictation_transcriber_opts: keyword() | nil,
          token_secret: secret(),
          internal_secret: secret()
        }

  defmodule Error do
    defexception [:variable, :reason]

    @impl true
    def message(%{variable: variable, reason: reason}), do: "config(voice-host): #{variable} #{reason}"
  end

  @spec instance() :: module()
  def instance, do: @instance

  @doc "Reads and validates the environment. Raises `OgmVoice.Config.Error` naming the variable, never its value."
  @spec from_env!(%{optional(String.t()) => String.t()}) :: t()
  def from_env!(env \\ System.get_env()) do
    provider = get(env, "OGM_VOICE_PROVIDER", "fake")
    unless Map.has_key?(@providers, provider), do: fail!("OGM_VOICE_PROVIDER", "is not one of #{providers()}")

    secret!(env, "OGM_VOICE_TOKEN_SECRET")
    secret!(env, "OGM_VOICE_INTERNAL_SECRET")

    llm = llm!(env, provider)
    cleanup_root = cleanup_root!(env, provider)

    %__MODULE__{
      port: port!(env, "OGM_VOICE_PORT", "40400"),
      internal_port: port!(env, "OGM_VOICE_INTERNAL_PORT", "40401"),
      provider: provider,
      llm: llm,
      agent_id: get(env, "ELEVENLABS_AGENT_ID", nil),
      cleanup_root: cleanup_root,
      max_sessions: positive!(env, "OGM_VOICE_MAX_SESSIONS", "2"),
      api_internal_url: url!(env, "OGM_API_INTERNAL_URL"),
      render_dir: path!(env, "OGM_VOICE_RENDER_DIR", Path.join(System.tmp_dir!(), "ogm-voice-renders")),
      narration_enabled: bool!(env, "OGM_VOICE_NARRATION_ENABLED", "false"),
      token_secret: fn -> System.get_env("OGM_VOICE_TOKEN_SECRET") end,
      internal_secret: fn -> System.get_env("OGM_VOICE_INTERNAL_SECRET") end
    }
  end

  @doc "The `VoiceConverse.Config` options for the one supervised instance."
  @spec voice_converse(t()) :: keyword()
  def voice_converse(%__MODULE__{} = config) do
    [
      name: @instance,
      provider: Map.fetch!(@providers, config.provider),
      llm: config.llm,
      agent_id: config.agent_id,
      cloud_disclosure_accepted: true,
      transcript: :none,
      provider_cleanup: not is_nil(config.cleanup_root),
      cleanup_root: config.cleanup_root,
      credentials: OgmVoice.Ports.Credentials,
      briefing_source: OgmVoice.Ports.BriefingSource,
      agent_channel: OgmVoice.Ports.AgentChannel,
      command_source: OgmVoice.Ports.CommandSource,
      token_issuer: OgmVoice.TokenIssuer,
      allowed_tools: @allowed_tools,
      limits: %{max_sessions: config.max_sessions, briefing_token_budget: 2_500},
      privacy: privacy()
    ]
  end

  @doc "The options shared by every batch narration render."
  @spec narration(t()) :: keyword()
  def narration(%__MODULE__{} = config) do
    {provider, _provider_opts} = Map.fetch!(@providers, config.provider)

    [
      render_dir: config.render_dir,
      provider: provider,
      provider_id: Map.fetch!(@provider_ids, config.provider),
      credentials: OgmVoice.Ports.Credentials,
      privacy: privacy()
    ]
  end

  @doc "The credential-safe options for one Scribe dictation WebSocket."
  @spec dictation(t()) :: keyword()
  def dictation(%__MODULE__{} = config) do
    transcriber_opts =
      config.dictation_transcriber_opts || [api_key_fun: fn -> System.get_env("ELEVENLABS_API_KEY") end]

    [transcriber: config.dictation_transcriber, transcriber_opts: transcriber_opts]
  end

  defp privacy do
    %{
      provider_allowlist: [:elevenlabs_agents, :openai_realtime, :fake],
      required_provider_options: %{elevenlabs_agents: %{record_voice: false}}
    }
  end

  defp providers, do: @providers |> Map.keys() |> Enum.sort() |> Enum.join(", ")

  defp secret!(env, name) do
    case Map.get(env, name) do
      nil -> fail!(name, "is missing")
      value when byte_size(value) < @min_secret_bytes -> fail!(name, "is shorter than #{@min_secret_bytes} bytes")
      _value -> :ok
    end
  end

  # A real provider needs the operator to choose a model; the fake one ignores it.
  defp llm!(env, "fake"), do: get(env, "OGM_VOICE_LLM", "fake")

  defp llm!(env, _provider) do
    case get(env, "OGM_VOICE_LLM", "") do
      "" -> fail!("OGM_VOICE_LLM", "is missing")
      llm -> llm
    end
  end

  # A live conversation exists at the provider until the durable queue deletes it, so its root must
  # survive a restart. The fake provider has nothing to delete.
  defp cleanup_root!(env, provider) do
    if cleanup_root_set?(env) do
      path!(env, "OGM_VOICE_CLEANUP_ROOT", "")
    else
      if provider == "fake", do: nil, else: fail!("OGM_VOICE_CLEANUP_ROOT", "is missing")
    end
  end

  defp cleanup_root_set?(env), do: get(env, "OGM_VOICE_CLEANUP_ROOT", "") != ""

  defp port!(env, name, default) do
    port = positive!(env, name, default)
    if port <= 65_535, do: port, else: fail!(name, "is outside 1-65535")
  end

  defp positive!(env, name, default) do
    case Integer.parse(get(env, name, default)) do
      {value, ""} when value > 0 -> value
      _ -> fail!(name, "is not a positive integer")
    end
  end

  defp url!(env, name) do
    case URI.new(Map.get(env, name, "")) do
      {:ok, %URI{scheme: scheme, host: host}} when scheme in ["http", "https"] and host not in [nil, ""] ->
        Map.fetch!(env, name)

      _ ->
        fail!(name, "is missing or not an http(s) URL")
    end
  end

  defp bool!(env, name, default) do
    case get(env, name, default) do
      value when value in ["true", "1"] -> true
      value when value in ["false", "0"] -> false
      _ -> fail!(name, "is not true, false, 1 or 0")
    end
  end

  defp path!(env, name, default) do
    path = get(env, name, default)
    if Path.type(path) == :absolute, do: path, else: fail!(name, "is not an absolute path")
  end

  # `ogm-env-init` writes every name as `NAME=`, so a blank value selects the default, as in `@ogm/config`.
  defp get(env, name, default) do
    case env |> Map.get(name, "") |> String.trim() do
      "" -> default
      value -> value
    end
  end

  defp fail!(variable, reason), do: raise(Error, variable: variable, reason: reason)
end
