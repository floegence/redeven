import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import type { Message, MessageBlock } from '../chat/types';
import { fetchGatewayJSON } from '../services/gatewayApi';
import type { AgentSettingsResponse, AIConfig } from '../pages/settings/types';
import type {
  FlowerChatMessage,
  FlowerProvider,
  FlowerProviderDraft,
  FlowerProviderModel,
  FlowerRouterDecision,
  FlowerSendMessageInput,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
} from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

type EnvLocalFlowerSurfaceAdapterOptions = Readonly<{
  envPublicID: string;
  envLabel: string;
  rpc: RedevenV1Rpc;
  copy?: EnvLocalFlowerSurfaceAdapterCopy;
}>;

export type EnvLocalFlowerSurfaceAdapterCopy = Readonly<{
  currentEnvironment: string;
  usingCurrentEnvironment: string;
  environmentLocalSubtitle: string;
  missingThreadID: string;
  enterMessageBeforeSending: string;
  selectModelBeforeChat: string;
  failedToCreateChat: string;
}>;

type ModelsResponse = Readonly<{
  current_model?: string;
  models?: readonly Readonly<{
    id?: string;
    label?: string;
    context_window?: number;
    max_output_tokens?: number;
    input_modalities?: readonly string[];
  }>[];
}>;

type ThreadView = Readonly<{
  thread_id?: string;
  title?: string;
  model_id?: string;
  run_status?: string;
  created_at_unix_ms?: number;
  updated_at_unix_ms?: number;
  last_message_at_unix_ms?: number;
  last_message_preview?: string;
}>;

type ListThreadsResponse = Readonly<{
  threads?: readonly ThreadView[];
}>;

type CreateThreadResponse = Readonly<{
  thread?: ThreadView;
}>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function adapterCopy(options: EnvLocalFlowerSurfaceAdapterOptions): EnvLocalFlowerSurfaceAdapterCopy {
  return {
    currentEnvironment: options.copy?.currentEnvironment ?? 'This environment',
    usingCurrentEnvironment: options.copy?.usingCurrentEnvironment ?? 'Using this environment',
    environmentLocalSubtitle: options.copy?.environmentLocalSubtitle ?? 'Environment-local Flower',
    missingThreadID: options.copy?.missingThreadID ?? 'Missing thread id.',
    enterMessageBeforeSending: options.copy?.enterMessageBeforeSending ?? 'Enter a message before sending.',
    selectModelBeforeChat: options.copy?.selectModelBeforeChat ?? 'Select a Flower model before starting a chat.',
    failedToCreateChat: options.copy?.failedToCreateChat ?? 'Failed to create Flower chat.',
  };
}

function unixMs(raw: unknown): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value <= 0) return Date.now();
  return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

function positiveInteger(raw: unknown): number | undefined {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function defaultConfig(): FlowerSettingsSnapshot['config'] {
  return {
    schema_version: 1,
    enabled: false,
    current_model_id: '',
    execution_policy: {
      require_user_approval: true,
      block_dangerous_commands: true,
    },
    terminal_exec_policy: {
      default_timeout_ms: 120000,
      max_timeout_ms: 600000,
    },
    providers: [],
  };
}

function mapProviderModel(model: NonNullable<AIConfig['providers'][number]['models']>[number]): FlowerProviderModel {
  return {
    model_name: trim(model.model_name),
    ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
    ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
    ...(positiveInteger(model.effective_context_window_percent) ? { effective_context_window_percent: positiveInteger(model.effective_context_window_percent) } : {}),
    ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) } : {}),
  };
}

function mapProvider(provider: AIConfig['providers'][number]): FlowerProvider {
  return {
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.web_search ? { web_search: { mode: provider.web_search.mode ?? 'disabled' } } : {}),
    models: (provider.models ?? []).map(mapProviderModel).filter((model) => model.model_name),
  };
}

function mapSettings(settings: AgentSettingsResponse): FlowerSettingsSnapshot {
  const ai = settings.ai;
  const config = ai
    ? {
        schema_version: 1 as const,
        enabled: true,
        current_model_id: trim(ai.current_model_id),
        execution_policy: {
          require_user_approval: ai.execution_policy?.require_user_approval ?? true,
          block_dangerous_commands: ai.execution_policy?.block_dangerous_commands ?? true,
        },
        terminal_exec_policy: {
          default_timeout_ms: positiveInteger(ai.terminal_exec_policy?.default_timeout_ms) ?? 120000,
          max_timeout_ms: positiveInteger(ai.terminal_exec_policy?.max_timeout_ms) ?? 600000,
        },
        providers: (ai.providers ?? []).map(mapProvider).filter((provider) => provider.id && provider.models.length > 0),
      }
    : defaultConfig();
  const providerSecrets = settings.ai_secrets?.provider_api_key_set ?? {};
  const webSecrets = settings.ai_secrets?.web_search_provider_api_key_set ?? {};
  return {
    config,
    provider_secrets: config.providers.map((provider) => ({
      provider_id: provider.id,
      provider_api_key_configured: Boolean(providerSecrets[provider.id]),
      web_search_api_key_configured: Boolean(webSecrets[provider.id]),
    })),
    target_cache: {
      version: 1,
      entries: [],
    },
  };
}

function draftProviderToAI(provider: FlowerProviderDraft): AIConfig['providers'][number] {
  return {
    id: trim(provider.id),
    ...(trim(provider.name) ? { name: trim(provider.name) } : {}),
    type: provider.type,
    ...(trim(provider.base_url) ? { base_url: trim(provider.base_url) } : {}),
    ...(provider.web_search ? { web_search: provider.web_search } : {}),
    models: provider.models.map((model) => ({
      model_name: trim(model.model_name),
      ...(positiveInteger(model.context_window) ? { context_window: positiveInteger(model.context_window) } : {}),
      ...(positiveInteger(model.max_output_tokens) ? { max_output_tokens: positiveInteger(model.max_output_tokens) } : {}),
      ...(positiveInteger(model.effective_context_window_percent) ? { effective_context_window_percent: positiveInteger(model.effective_context_window_percent) } : {}),
      ...(Array.isArray(model.input_modalities) ? { input_modalities: model.input_modalities.map(trim).filter(Boolean) as Array<'text' | 'image'> } : {}),
    })),
  };
}

function draftToAIConfig(draft: FlowerSettingsDraft): AIConfig {
  return {
    current_model_id: trim(draft.config.current_model_id),
    execution_policy: {
      require_user_approval: draft.config.execution_policy.require_user_approval,
      block_dangerous_commands: draft.config.execution_policy.block_dangerous_commands,
    },
    terminal_exec_policy: {
      default_timeout_ms: draft.config.terminal_exec_policy.default_timeout_ms,
      max_timeout_ms: draft.config.terminal_exec_policy.max_timeout_ms,
    },
    providers: draft.config.providers.map(draftProviderToAI),
  };
}

function runStatus(raw: unknown): FlowerThreadStatus {
  switch (trim(raw).toLowerCase()) {
    case 'accepted':
    case 'running':
    case 'recovering':
    case 'finalizing':
      return 'running';
    case 'waiting_approval':
      return 'waiting_approval';
    case 'waiting_user':
      return 'waiting_user';
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return 'failed';
    case 'success':
      return 'success';
    default:
      return 'idle';
  }
}

function blockText(block: MessageBlock): string {
  switch (block.type) {
    case 'text':
    case 'markdown':
    case 'code':
    case 'svg':
    case 'mermaid':
      return trim(block.content);
    case 'code-diff':
      return [block.oldCode, block.newCode].map(trim).filter(Boolean).join('\n\n');
    case 'shell':
      return [block.command, block.output].map(trim).filter(Boolean).join('\n');
    case 'file':
      return trim(block.name);
    case 'checklist':
      return block.items.map((item) => item.text).map(trim).filter(Boolean).join('\n');
    case 'todos':
      return block.todos.map((item) => item.content).map(trim).filter(Boolean).join('\n');
    case 'sources':
      return block.sources.map((item) => item.title || item.url).map(trim).filter(Boolean).join('\n');
    case 'thinking':
      return '';
    default:
      return '';
  }
}

function messageText(message: Message): string {
  return message.blocks.map(blockText).filter(Boolean).join('\n\n');
}

function mapMessage(message: Message): FlowerChatMessage | null {
  const id = trim(message.id);
  const role = trim(message.role).toLowerCase();
  if (!id || (role !== 'user' && role !== 'assistant' && role !== 'system')) return null;
  return {
    id,
    role,
    content: messageText(message),
    created_at_ms: unixMs(message.timestamp),
  };
}

function mapThread(thread: ThreadView, messages: readonly FlowerChatMessage[], options: EnvLocalFlowerSurfaceAdapterOptions): FlowerThreadSnapshot {
  const copy = adapterCopy(options);
  const threadID = trim(thread.thread_id);
  const title = trim(thread.title) || trim(thread.last_message_preview) || 'Ask Flower';
  const envLabel = trim(options.envLabel) || copy.currentEnvironment;
  return {
    thread_id: threadID,
    title,
    model_id: trim(thread.model_id),
    home_host_id: `env:${trim(options.envPublicID) || 'current'}`,
    home_host_kind: 'env_local',
    origin_env_public_id: trim(options.envPublicID) || undefined,
    created_at_ms: unixMs(thread.created_at_unix_ms),
    updated_at_ms: unixMs(thread.updated_at_unix_ms ?? thread.last_message_at_unix_ms),
    status: runStatus(thread.run_status),
    source_label: envLabel,
    target_labels: [envLabel],
    messages,
  };
}

function decision(options: EnvLocalFlowerSurfaceAdapterOptions): FlowerRouterDecision {
  const copy = adapterCopy(options);
  const envID = trim(options.envPublicID) || 'current';
  const envLabel = trim(options.envLabel) || copy.currentEnvironment;
  return {
    decision_id: `env-local-${envID}-${Date.now()}`,
    decision_revision: 1,
    route: 'env_local',
    reason_code: 'current_env_only',
    selected_handler: {
      handler_id: `env:${envID}`,
      handler_kind: 'env_local',
      display_name: envLabel,
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat', 'task'],
      allowed_target_ids: [`env:${envID}`],
    },
    available_handlers: [],
    handler_selection: {
      can_switch: false,
      lock_reason: 'env_local_surface',
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'env_app_flower_surface',
      primary_target_id: `env:${envID}`,
    },
    ui_chips: [
      { kind: 'host', label: copy.usingCurrentEnvironment, tone: 'normal' },
      { kind: 'source', label: envLabel, tone: 'normal' },
    ],
    blocker: null,
  };
}

async function loadSettingsSnapshot(): Promise<FlowerSettingsSnapshot> {
  return mapSettings(await fetchGatewayJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' }));
}

async function loadModels(): Promise<ModelsResponse> {
  return fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' });
}

function currentModelID(snapshot: FlowerSettingsSnapshot, models: ModelsResponse): string {
  const configured = trim(snapshot.config.current_model_id);
  if (configured) return configured;
  return trim(models.current_model);
}

export function createEnvLocalFlowerSurfaceAdapter(options: EnvLocalFlowerSurfaceAdapterOptions): FlowerSurfaceAdapter {
  const loadThread = async (threadID: string): Promise<FlowerThreadSnapshot> => {
    const copy = adapterCopy(options);
    const tid = trim(threadID);
    if (!tid) throw new Error(copy.missingThreadID);
    const threadResp = await fetchGatewayJSON<{ thread: ThreadView }>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(tid)}`, { method: 'GET' });
    const messagesResp = await options.rpc.ai.listMessages({ threadId: tid, tail: true, limit: 200 });
    const messages = (messagesResp.messages ?? [])
      .map((item) => mapMessage(item.messageJson as Message))
      .filter((item): item is FlowerChatMessage => item !== null);
    return mapThread(threadResp.thread ?? { thread_id: tid }, messages, options);
  };

  return {
    host: {
      host_id: `env:${trim(options.envPublicID) || 'current'}`,
      host_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: trim(options.envLabel) || adapterCopy(options).currentEnvironment,
      subtitle: adapterCopy(options).environmentLocalSubtitle,
    },
    loadSettings: loadSettingsSnapshot,
    saveSettings: async (draft) => {
      const providerAPIKeyPatches = draft.config.providers
        .filter((provider) => trim(provider.provider_api_key) && (provider.provider_api_key_mode ?? 'replace') !== 'clear')
        .map((provider) => ({ provider_id: trim(provider.id), api_key: trim(provider.provider_api_key) }));
      const webSearchKeyPatches = draft.config.providers
        .filter((provider) => trim(provider.web_search_api_key) && (provider.web_search_api_key_mode ?? 'replace') !== 'clear')
        .map((provider) => ({ provider_id: trim(provider.id), api_key: trim(provider.web_search_api_key) }));
      await fetchGatewayJSON<unknown>('/_redeven_proxy/api/ai/provider_bundle', {
        method: 'PUT',
        body: JSON.stringify({
          ai: draftToAIConfig(draft),
          provider_api_key_patches: providerAPIKeyPatches,
          web_search_provider_key_patches: webSearchKeyPatches,
        }),
      });
      return loadSettingsSnapshot();
    },
    listThreads: async () => {
      const result = await fetchGatewayJSON<ListThreadsResponse>('/_redeven_proxy/api/ai/threads?limit=200', { method: 'GET' });
      return (result.threads ?? []).map((thread) => mapThread(thread, [], options));
    },
    loadThread,
    resolveHandler: async () => decision(options),
    sendMessage: async (input: FlowerSendMessageInput) => {
      const copy = adapterCopy(options);
      const prompt = trim(input.prompt);
      if (!prompt) throw new Error(copy.enterMessageBeforeSending);
      const snapshot = await loadSettingsSnapshot();
      const models = await loadModels();
      const modelID = currentModelID(snapshot, models);
      if (!modelID) throw new Error(copy.selectModelBeforeChat);
      let threadID = trim(input.thread_id);
      if (!threadID) {
        const created = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
          method: 'POST',
          body: JSON.stringify({
            title: '',
            model_id: modelID,
            execution_mode: 'act',
          }),
        });
        threadID = trim(created.thread?.thread_id);
      }
      if (!threadID) throw new Error(copy.failedToCreateChat);
      await options.rpc.ai.subscribeThread({ threadId: threadID });
      await options.rpc.ai.sendUserTurn({
        threadId: threadID,
        model: modelID,
        input: {
          text: prompt,
          attachments: [],
        },
        options: {
          maxSteps: 10,
          mode: 'act',
        },
      });
      return loadThread(threadID);
    },
  };
}
