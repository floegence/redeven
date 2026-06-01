import type {
  DesktopSettingsDraft,
  SaveDesktopSettingsResult,
} from '../../shared/settingsIPC';
import type {
  DesktopFlowerHostChatMessage,
  DesktopFlowerHostConfig,
  DesktopFlowerHostProvider,
  DesktopFlowerHostProviderDraft,
  DesktopFlowerHostProviderModel,
  DesktopFlowerHostResolveHandlerRequest,
  DesktopFlowerHostRouterDecision,
  DesktopFlowerHostSendChatRequest,
  DesktopFlowerHostSettingsDraft,
  DesktopFlowerHostSettingsSnapshot,
  DesktopFlowerHostTargetCacheEntry,
  DesktopFlowerHostThread,
} from '../../shared/flowerHostSettingsIPC';
import type {
  FlowerChatMessage,
  FlowerHostConfig,
  FlowerProvider,
  FlowerProviderDraft,
  FlowerProviderModel,
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerTargetView,
  FlowerThreadSnapshot,
} from '../../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';

export type DesktopSettingsBridge = Readonly<{
  save: (draft: DesktopSettingsDraft) => Promise<SaveDesktopSettingsResult>;
  loadFlowerHostSettings: () => Promise<
    | { ok: true; snapshot: DesktopFlowerHostSettingsSnapshot }
    | { ok: false; error: string }
  >;
  saveFlowerHostSettings: (draft: DesktopFlowerHostSettingsDraft) => Promise<
    | { ok: true; snapshot: DesktopFlowerHostSettingsSnapshot }
    | { ok: false; error: string }
  >;
  listFlowerHostThreads: () => Promise<
    | { ok: true; threads: readonly DesktopFlowerHostThread[] }
    | { ok: false; error: string }
  >;
  loadFlowerHostThread: (threadID: string) => Promise<
    | { ok: true; thread: DesktopFlowerHostThread }
    | { ok: false; error: string }
  >;
  resolveFlowerHostHandler: (request?: DesktopFlowerHostResolveHandlerRequest) => Promise<
    | { ok: true; decision: DesktopFlowerHostRouterDecision }
    | { ok: false; error: string }
  >;
  sendFlowerHostChat: (request: DesktopFlowerHostSendChatRequest) => Promise<
    | { ok: true; thread: DesktopFlowerHostThread }
    | { ok: false; error: string }
  >;
  cancel: () => void;
}>;

export type DesktopFlowerSurfaceAdapterOptions = Readonly<{
  hostDisplayName: string;
  hostSubtitle: string;
  threadSourceLabel: string;
}>;

function mapModel(model: DesktopFlowerHostProviderModel): FlowerProviderModel {
  return {
    model_name: model.model_name,
    ...(model.context_window ? { context_window: model.context_window } : {}),
    ...(model.max_output_tokens ? { max_output_tokens: model.max_output_tokens } : {}),
    ...(model.effective_context_window_percent ? { effective_context_window_percent: model.effective_context_window_percent } : {}),
    ...(model.input_modalities ? { input_modalities: model.input_modalities } : {}),
  };
}

function mapProvider(provider: DesktopFlowerHostProvider): FlowerProvider {
  return {
    id: provider.id,
    ...(provider.name ? { name: provider.name } : {}),
    type: provider.type,
    ...(provider.base_url ? { base_url: provider.base_url } : {}),
    ...(provider.web_search ? { web_search: provider.web_search } : {}),
    models: provider.models.map(mapModel),
  };
}

function mapConfig(config: DesktopFlowerHostConfig): FlowerHostConfig {
  return {
    schema_version: 1,
    enabled: config.enabled,
    current_model_id: config.current_model_id,
    execution_policy: config.execution_policy,
    terminal_exec_policy: config.terminal_exec_policy,
    providers: config.providers.map(mapProvider),
  };
}

function mapTarget(target: DesktopFlowerHostTargetCacheEntry): FlowerTargetView {
  return {
    target_id: target.target_id,
    label: target.label,
    target_url: target.target_url,
    last_seen_at_unix_ms: target.last_seen_at_unix_ms,
    ...(target.metadata ? { metadata: target.metadata } : {}),
  };
}

export function mapDesktopFlowerSnapshot(snapshot: DesktopFlowerHostSettingsSnapshot): FlowerSettingsSnapshot {
  return {
    config: mapConfig(snapshot.config),
    provider_secrets: snapshot.provider_secrets.map((secret) => ({
      provider_id: secret.provider_id,
      provider_api_key_configured: secret.provider_api_key_configured,
      web_search_api_key_configured: secret.web_search_api_key_configured,
    })),
    target_cache: {
      version: 1,
      entries: snapshot.target_cache.entries.map(mapTarget),
    },
  };
}

function mapDraftModel(model: FlowerProviderModel): DesktopFlowerHostProviderModel {
  return {
    model_name: model.model_name,
    ...(model.context_window ? { context_window: model.context_window } : {}),
    ...(model.max_output_tokens ? { max_output_tokens: model.max_output_tokens } : {}),
    ...(model.effective_context_window_percent ? { effective_context_window_percent: model.effective_context_window_percent } : {}),
    ...(model.input_modalities ? { input_modalities: model.input_modalities } : {}),
  };
}

function mapDraftProvider(provider: FlowerProviderDraft): DesktopFlowerHostProviderDraft {
  return {
    id: provider.id,
    ...(provider.name ? { name: provider.name } : {}),
    type: provider.type,
    ...(provider.base_url ? { base_url: provider.base_url } : {}),
    ...(provider.web_search ? { web_search: provider.web_search } : {}),
    models: provider.models.map(mapDraftModel),
    provider_api_key: provider.provider_api_key ?? '',
    provider_api_key_mode: provider.provider_api_key_mode ?? 'keep',
    web_search_api_key: provider.web_search_api_key ?? '',
    web_search_api_key_mode: provider.web_search_api_key_mode ?? 'keep',
  };
}

export function mapFlowerSettingsDraftToDesktop(draft: FlowerSettingsDraft): DesktopFlowerHostSettingsDraft {
  return {
    config: {
      schema_version: 1,
      enabled: draft.config.enabled,
      current_model_id: draft.config.current_model_id,
      execution_policy: draft.config.execution_policy,
      terminal_exec_policy: draft.config.terminal_exec_policy,
      providers: draft.config.providers.map(mapDraftProvider),
    },
  };
}

function mapMessage(message: DesktopFlowerHostChatMessage): FlowerChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    created_at_ms: message.created_at_ms,
  };
}

export function mapDesktopFlowerThread(thread: DesktopFlowerHostThread, sourceLabel = 'this host'): FlowerThreadSnapshot {
  return {
    thread_id: thread.thread_id,
    title: thread.title,
    model_id: thread.model_id,
    created_at_ms: thread.created_at_ms,
    updated_at_ms: thread.updated_at_ms,
    status: thread.status ?? 'idle',
    source_label: thread.source_label || sourceLabel,
    target_labels: thread.target_labels ?? [],
    messages: thread.messages.map(mapMessage),
  };
}

export function createDesktopFlowerSurfaceAdapter(
  bridge: DesktopSettingsBridge,
  options: DesktopFlowerSurfaceAdapterOptions = {
    hostDisplayName: 'this host',
    hostSubtitle: 'Global assistant host',
    threadSourceLabel: 'this host',
  },
): FlowerSurfaceAdapter {
  return {
    host: {
      host_id: 'flower-host',
      host_kind: 'global',
      carrier_kind: 'desktop',
      display_name: options.hostDisplayName,
      subtitle: options.hostSubtitle,
    },
    loadSettings: async () => {
      const result = await bridge.loadFlowerHostSettings();
      if (!result.ok) throw new Error(result.error);
      return mapDesktopFlowerSnapshot(result.snapshot);
    },
    saveSettings: async (draft) => {
      const result = await bridge.saveFlowerHostSettings(mapFlowerSettingsDraftToDesktop(draft));
      if (!result.ok) throw new Error(result.error);
      return mapDesktopFlowerSnapshot(result.snapshot);
    },
    listThreads: async () => {
      const result = await bridge.listFlowerHostThreads();
      if (!result.ok) throw new Error(result.error);
      return result.threads.map((thread) => mapDesktopFlowerThread(thread, options.threadSourceLabel));
    },
    loadThread: async (threadID) => {
      const result = await bridge.loadFlowerHostThread(threadID);
      if (!result.ok) throw new Error(result.error);
      return mapDesktopFlowerThread(result.thread, options.threadSourceLabel);
    },
    resolveHandler: async (request) => {
      const result = await bridge.resolveFlowerHostHandler(request);
      if (!result.ok) throw new Error(result.error);
      return result.decision;
    },
    sendMessage: async (input) => {
      const result = await bridge.sendFlowerHostChat({
        thread_id: input.thread_id,
        prompt: input.prompt,
        decision_id: input.decision?.decision_id,
        decision_revision: input.decision?.decision_revision,
        selected_handler_id: input.decision?.selected_handler?.handler_id,
        thread_kind: input.decision?.decision_scope.thread_kind,
        primary_target_id: input.decision?.decision_scope.primary_target_id,
        client_surface: input.decision?.decision_scope.client_surface,
      });
      if (!result.ok) {
        const error = new Error(result.error) as Error & { fresh_decision?: FlowerRouterDecision };
        const freshDecision = (result as { fresh_decision?: FlowerRouterDecision }).fresh_decision;
        if (freshDecision) {
          error.fresh_decision = freshDecision;
        }
        throw error;
      }
      return mapDesktopFlowerThread(result.thread, options.threadSourceLabel);
    },
  };
}
