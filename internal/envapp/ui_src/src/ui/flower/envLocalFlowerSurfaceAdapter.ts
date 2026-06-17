import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { fetchGatewayJSON } from '../services/gatewayApi';
import type { AgentSettingsResponse, AIConfig } from '../pages/settings/types';
import type {
  FlowerProvider,
  FlowerProviderDraft,
  FlowerProviderModel,
  FlowerRouterDecision,
  FlowerTurnLaunchInput,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerThreadReadStatus,
  FlowerLiveBootstrap,
} from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { ContextActionEnvelope } from '../contextActions/protocol';
import { mapFlowerLiveBootstrap } from '../../../../../flower_ui/src/flowerLiveMapper';
import { createRuntimeFlowerSurfaceAdapter } from '../../../../../flower_ui/src/runtimeFlowerSurfaceAdapter';

type EnvLocalFlowerSurfaceAdapterOptions = Readonly<{
  envPublicID: string;
  envLabel: string;
  rpc: RedevenV1Rpc;
  copy?: EnvLocalFlowerSurfaceAdapterCopy;
  uploadAttachment?: (file: File) => Promise<string>;
  openFileBrowser?: FlowerSurfaceAdapter['openFileBrowser'];
  openFilePreview?: FlowerSurfaceAdapter['openFilePreview'];
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
  read_status: ThreadReadStatus;
} & Record<string, unknown>>;

type ThreadReadStatus = FlowerThreadReadStatus;

type CreateThreadResponse = Readonly<{
  thread?: ThreadView;
}>;

type LoadThreadResponse = Readonly<{
  thread?: ThreadView;
}>;

type MarkThreadReadResponse = Readonly<{
  read_status: ThreadReadStatus;
}>;
type FlowerSecretPatch = Readonly<{ provider_id: string; api_key: string | null }>;

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

function positiveInteger(raw: unknown): number | undefined {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function defaultConfig(): FlowerSettingsSnapshot['config'] {
  return {
    schema_version: 1,
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

function mapDesktopModelSource(settings: AgentSettingsResponse, models?: ModelsResponse): FlowerSettingsSnapshot['model_source'] {
  const source = settings.ai_runtime?.desktop_model_source;
  if (!source?.connected) return undefined;
  const modelCount = Number(source.model_count ?? models?.models?.length ?? 0);
  const currentModel = trim(models?.current_model);
  return {
    kind: 'desktop_model_source',
    ready: Boolean(source.available && currentModel && modelCount > 0),
    label: trim(source.model_source) || 'Local AI Profile',
    model_count: Number.isFinite(modelCount) && modelCount > 0 ? Math.floor(modelCount) : 0,
    missing_key_provider_ids: (source.missing_key_provider_ids ?? []).map(trim).filter(Boolean),
    ...(trim(source.last_error) ? { last_error: trim(source.last_error) } : {}),
  };
}

function mapSettings(settings: AgentSettingsResponse, models?: ModelsResponse): FlowerSettingsSnapshot {
  const ai = settings.ai;
  const externalModelSource = mapDesktopModelSource(settings, models);
  if (externalModelSource?.kind === 'desktop_model_source') {
    return {
      config: {
        ...defaultConfig(),
        current_model_id: trim(models?.current_model) || trim(ai?.current_model_id),
      },
      provider_secrets: [],
      model_source: externalModelSource,
    };
  }
  const config = ai
    ? {
        schema_version: 1 as const,
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

function envLiveMapperOptions(options: EnvLocalFlowerSurfaceAdapterOptions) {
  const copy = adapterCopy(options);
  const envID = trim(options.envPublicID) || 'current';
  const envLabel = trim(options.envLabel) || copy.currentEnvironment;
  return {
    runtimeID: `env:${envID}`,
    runtimeKind: 'env_local' as const,
    sourceLabel: envLabel,
    targetLabels: [envLabel],
    originEnvPublicID: envID,
  };
}

function mapEnvFlowerLiveBootstrap(raw: unknown, options: EnvLocalFlowerSurfaceAdapterOptions): FlowerLiveBootstrap {
  return mapFlowerLiveBootstrap(raw, envLiveMapperOptions(options));
}

function decision(options: EnvLocalFlowerSurfaceAdapterOptions): FlowerRouterDecision {
  const copy = adapterCopy(options);
  const envID = trim(options.envPublicID) || 'current';
  const envLabel = trim(options.envLabel) || copy.currentEnvironment;
  const now = Date.now();
  return {
    decision_id: `env-local-${envID}-${now}`,
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
    },
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      lock_reason: 'env_local_surface',
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'env_app_flower_surface',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: `env:${envID}`,
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: envLabel,
      state: 'online',
      endpoint: { visibility: 'runtime' },
      capabilities: ['chat', 'task'],
      last_seen_at_unix_ms: now,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [
      { kind: 'runtime', label: copy.usingCurrentEnvironment, tone: 'normal' },
      { kind: 'source', label: envLabel, tone: 'normal' },
    ],
    blocker: null,
    created_at_unix_ms: now,
  };
}

async function loadSettingsSnapshot(): Promise<FlowerSettingsSnapshot> {
  const [settings, models] = await Promise.all([
    fetchGatewayJSON<AgentSettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' }),
    loadModels().catch(() => undefined),
  ]);
  return mapSettings(settings, models);
}

async function loadModels(): Promise<ModelsResponse> {
  return fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' });
}

function currentModelID(snapshot: FlowerSettingsSnapshot, models: ModelsResponse): string {
  const configured = trim(snapshot.config.current_model_id);
  if (configured) return configured;
  return trim(models.current_model);
}

function isContextActionEnvelope(value: unknown): value is ContextActionEnvelope {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<ContextActionEnvelope>;
  return action.schema_version === 2
    && typeof action.action_id === 'string'
    && Array.isArray(action.context)
    && !!action.target
    && !!action.source
    && !!action.presentation;
}

export function createEnvLocalFlowerSurfaceAdapter(options: EnvLocalFlowerSurfaceAdapterOptions): FlowerSurfaceAdapter {
  const copy = adapterCopy(options);
  const loadThread = async (threadID: string) => mapEnvFlowerLiveBootstrap(
    await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(trim(threadID))}/live/bootstrap`, { method: 'GET' }),
    options,
  );

  return createRuntimeFlowerSurfaceAdapter({
    runtime: {
      runtime_id: `env:${trim(options.envPublicID) || 'current'}`,
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: trim(options.envLabel) || copy.currentEnvironment,
      subtitle: copy.environmentLocalSubtitle,
    },
    transport: {
      listThreads: () => fetchGatewayJSON('/_redeven_proxy/api/ai/threads?limit=200', { method: 'GET' }),
      loadThread: (threadID) => fetchGatewayJSON(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/live/bootstrap`, { method: 'GET' }),
      listThreadLiveEvents: (threadID, afterSeq, limit) => fetchGatewayJSON(
        `/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/live/events?after_seq=${afterSeq}&limit=${limit}`,
        { method: 'GET' },
      ),
      markThreadRead: (threadID, body) => fetchGatewayJSON<MarkThreadReadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/read`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      patchThread: (threadID, body) => fetchGatewayJSON<LoadThreadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      forkThread: (threadID) => fetchGatewayJSON<LoadThreadResponse>(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(threadID)}/fork`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      submitApproval: (body) => fetchGatewayJSON(`/_redeven_proxy/api/ai/threads/${encodeURIComponent(body.thread_id)}/approvals`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    },
    mapperOptions: envLiveMapperOptions(options),
    loadSettings: loadSettingsSnapshot,
    saveSettings: async (draft) => {
      const providerAPIKeyPatches: FlowerSecretPatch[] = draft.config.providers.flatMap((provider): FlowerSecretPatch[] => {
        if (provider.provider_api_key === undefined) return [];
        const providerID = trim(provider.id);
        if (!providerID) return [];
        if (provider.provider_api_key === null) return [{ provider_id: providerID, api_key: null }];
        const apiKey = trim(provider.provider_api_key);
        return apiKey ? [{ provider_id: providerID, api_key: apiKey }] : [];
      });
      const webSearchKeyPatches: FlowerSecretPatch[] = draft.config.providers.flatMap((provider): FlowerSecretPatch[] => {
        if (provider.web_search_api_key === undefined) return [];
        const providerID = trim(provider.id);
        if (!providerID) return [];
        if (provider.web_search_api_key === null) return [{ provider_id: providerID, api_key: null }];
        const apiKey = trim(provider.web_search_api_key);
        return apiKey ? [{ provider_id: providerID, api_key: apiKey }] : [];
      });
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
    resolveHandler: async () => decision(options),
    launchTurn: async (input: FlowerTurnLaunchInput) => {
      const copy = adapterCopy(options);
      const prompt = trim(input.prompt);
      if (!prompt) throw new Error(copy.enterMessageBeforeSending);
      const snapshot = await loadSettingsSnapshot();
      const models = await loadModels();
      const modelID = currentModelID(snapshot, models);
      if (!modelID) throw new Error(copy.selectModelBeforeChat);
      let threadID = trim(input.thread_id);
      if (!threadID) {
        const createBody: Record<string, unknown> = {
          title: '',
          model_id: modelID,
          execution_mode: input.mode ?? 'act',
        };
        if (trim(input.working_dir)) {
          createBody.working_dir = trim(input.working_dir);
        }
        const created = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
          method: 'POST',
          body: JSON.stringify(createBody),
        });
        threadID = trim(created.thread?.thread_id);
      }
      if (!threadID) throw new Error(copy.failedToCreateChat);
      const attachments = (input.attachments ?? [])
        .map((attachment) => ({
          name: trim(attachment.name) || 'attachment',
          mimeType: trim(attachment.mime_type) || 'application/octet-stream',
          url: trim(attachment.url),
        }))
        .filter((attachment) => !!attachment.url);
      for (const file of (input.pending_files ?? [])) {
        if (!options.uploadAttachment) continue;
        attachments.push({
          name: trim(file.name) || 'attachment',
          mimeType: trim(file.type) || 'application/octet-stream',
          url: await options.uploadAttachment(file),
        });
      }
      await options.rpc.ai.subscribeThread({ threadId: threadID });
      await options.rpc.ai.sendUserTurn({
        threadId: threadID,
        model: modelID,
        input: {
          text: prompt,
          attachments,
          ...(isContextActionEnvelope(input.context_action) ? { contextAction: input.context_action } : {}),
        },
        options: {
          maxSteps: 10,
          mode: input.mode ?? 'act',
        },
      });
      return loadThread(threadID);
    },
    submitInput: async (input) => {
      const tid = trim(input.thread_id);
      const promptID = trim(input.prompt_id);
      if (!tid) throw new Error(adapterCopy(options).missingThreadID);
      if (!promptID) throw new Error('Missing input prompt id.');
      await options.rpc.ai.submitRequestUserInputResponse({
        threadId: tid,
        response: {
          promptId: promptID,
          answers: Object.fromEntries(Object.entries(input.answers).map(([questionID, answer]) => [
            questionID,
            {
              choiceId: trim(answer.choice_id) || undefined,
              text: trim(answer.text) || undefined,
            },
          ])),
        },
        input: {
          text: '',
          attachments: [],
        },
        options: {
          maxSteps: 10,
          mode: 'act',
        },
      });
      return loadThread(tid);
    },
    missingThreadID: copy.missingThreadID,
    failedToCreateThread: copy.failedToCreateChat,
    ...(options.openFileBrowser ? { openFileBrowser: options.openFileBrowser } : {}),
    ...(options.openFilePreview ? { openFilePreview: options.openFilePreview } : {}),
  });
}
