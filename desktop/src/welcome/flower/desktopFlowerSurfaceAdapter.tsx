import type {
  DesktopSettingsDraft,
  SaveDesktopSettingsResult,
} from '../../shared/settingsIPC';
import type {
  DesktopFlowerHostChatMessage,
  DesktopFlowerHostConfig,
  DesktopFlowerHostInputRequest,
  DesktopFlowerHostProvider,
  DesktopFlowerHostProviderDraft,
  DesktopFlowerHostProviderModel,
  DesktopFlowerHostResolveHandlerRequest,
  DesktopFlowerHostSendChatRequest,
  DesktopFlowerHostSettingsDraft,
  DesktopFlowerHostSettingsSnapshot,
  DesktopFlowerHostSubmitInputRequest,
  DesktopFlowerHostTargetCacheEntry,
  DesktopFlowerHostThread,
  DesktopFlowerHostError,
  ForkDesktopFlowerHostThreadResult,
  ListDesktopFlowerHostThreadsResult,
  LoadDesktopFlowerHostSettingsResult,
  LoadDesktopFlowerHostThreadResult,
  RenameDesktopFlowerHostThreadResult,
  ResolveDesktopFlowerHostHandlerResult,
  SaveDesktopFlowerHostSettingsResult,
  SendDesktopFlowerHostChatResult,
  SetDesktopFlowerHostThreadPinnedResult,
  SubmitDesktopFlowerHostInputResult,
} from '../../shared/flowerHostSettingsIPC';
import type {
  FlowerChatMessage,
  FlowerChatMessageBlock,
  FlowerHostConfig,
  FlowerInputRequest,
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
  loadFlowerHostSettings: () => Promise<LoadDesktopFlowerHostSettingsResult>;
  saveFlowerHostSettings: (draft: DesktopFlowerHostSettingsDraft) => Promise<SaveDesktopFlowerHostSettingsResult>;
  listFlowerHostThreads: () => Promise<ListDesktopFlowerHostThreadsResult>;
  loadFlowerHostThread: (threadID: string) => Promise<LoadDesktopFlowerHostThreadResult>;
  renameFlowerHostThread?: (request: { thread_id: string; title: string }) => Promise<RenameDesktopFlowerHostThreadResult>;
  setFlowerHostThreadPinned?: (request: { thread_id: string; pinned: boolean }) => Promise<SetDesktopFlowerHostThreadPinnedResult>;
  forkFlowerHostThread?: (request: { thread_id: string }) => Promise<ForkDesktopFlowerHostThreadResult>;
  resolveFlowerHostHandler: (request?: DesktopFlowerHostResolveHandlerRequest) => Promise<ResolveDesktopFlowerHostHandlerResult>;
  sendFlowerHostChat: (request: DesktopFlowerHostSendChatRequest) => Promise<SendDesktopFlowerHostChatResult>;
  submitFlowerHostInput: (request: DesktopFlowerHostSubmitInputRequest) => Promise<SubmitDesktopFlowerHostInputResult>;
  cancel: () => void;
}>;

function flowerHostError(error: DesktopFlowerHostError): Error & { code?: string } {
  const out = new Error(error.message) as Error & { code?: string };
  out.code = error.code;
  return out;
}

export type DesktopFlowerSurfaceAdapterOptions = Readonly<{
  hostDisplayName: string;
  hostSubtitle: string;
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
  const blocks = message.blocks
    ?.map((block): FlowerChatMessageBlock => ({
      type: block.type,
      ...(block.content !== undefined ? { content: block.content } : {}),
    })) ?? [];
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    created_at_ms: message.created_at_ms,
    ...(blocks.length > 0 ? { blocks } : {}),
  };
}

function mapInputRequest(request: DesktopFlowerHostInputRequest): FlowerInputRequest {
  return {
    prompt_id: request.prompt_id,
    message_id: request.message_id,
    tool_id: request.tool_id,
    tool_name: request.tool_name,
    ...(request.reason_code ? { reason_code: request.reason_code } : {}),
    ...(request.required_from_user ? { required_from_user: request.required_from_user } : {}),
    ...(request.evidence_refs ? { evidence_refs: request.evidence_refs } : {}),
    questions: request.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      ...(question.is_secret !== undefined ? { is_secret: question.is_secret } : {}),
      response_mode: question.response_mode,
      ...(question.choices_exhaustive !== undefined ? { choices_exhaustive: question.choices_exhaustive } : {}),
      ...(question.write_label ? { write_label: question.write_label } : {}),
      ...(question.write_placeholder ? { write_placeholder: question.write_placeholder } : {}),
      ...(question.choices ? {
        choices: question.choices.map((choice) => ({
          choice_id: choice.choice_id,
          label: choice.label,
          ...(choice.description ? { description: choice.description } : {}),
          kind: choice.kind,
          ...(choice.input_placeholder ? { input_placeholder: choice.input_placeholder } : {}),
          ...(choice.actions ? { actions: choice.actions } : {}),
        })),
      } : {}),
    })),
    ...(request.public_summary ? { public_summary: request.public_summary } : {}),
    ...(request.contains_secret !== undefined ? { contains_secret: request.contains_secret } : {}),
  };
}

export function mapDesktopFlowerThread(thread: DesktopFlowerHostThread): FlowerThreadSnapshot {
  return {
    thread_id: thread.thread_id,
    title: thread.title,
    model_id: thread.model_id,
    working_dir: thread.working_dir,
    ...(thread.pinned_at_ms ? { pinned_at_ms: thread.pinned_at_ms } : {}),
    created_at_ms: thread.created_at_ms,
    updated_at_ms: thread.updated_at_ms,
    status: thread.status,
    ...(thread.home_host_id ? { home_host_id: thread.home_host_id } : {}),
    ...(thread.home_host_kind ? { home_host_kind: thread.home_host_kind } : {}),
    source_label: thread.source_label,
    target_labels: thread.target_labels,
    messages: thread.messages.map(mapMessage),
    ...(thread.tool_activity ? { tool_activity: thread.tool_activity } : {}),
    ...(thread.input_request ? { input_request: mapInputRequest(thread.input_request) } : {}),
    ...(thread.error !== undefined ? { error: thread.error } : {}),
  };
}

export function createDesktopFlowerSurfaceAdapter(
  bridge: DesktopSettingsBridge,
  options: DesktopFlowerSurfaceAdapterOptions = {
    hostDisplayName: 'this host',
    hostSubtitle: 'Global assistant host',
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
      if (!result.ok) throw flowerHostError(result.error);
      return mapDesktopFlowerSnapshot(result.snapshot);
    },
    saveSettings: async (draft) => {
      const result = await bridge.saveFlowerHostSettings(mapFlowerSettingsDraftToDesktop(draft));
      if (!result.ok) throw flowerHostError(result.error);
      return mapDesktopFlowerSnapshot(result.snapshot);
    },
    listThreads: async () => {
      const result = await bridge.listFlowerHostThreads();
      if (!result.ok) throw flowerHostError(result.error);
      return result.threads.map((thread) => mapDesktopFlowerThread(thread));
    },
    loadThread: async (threadID) => {
      const result = await bridge.loadFlowerHostThread(threadID);
      if (!result.ok) throw flowerHostError(result.error);
      return mapDesktopFlowerThread(result.thread);
    },
    ...(bridge.renameFlowerHostThread ? {
      renameThread: async (threadID, title) => {
        const result = await bridge.renameFlowerHostThread!({ thread_id: threadID, title });
        if (!result.ok) throw flowerHostError(result.error);
        return mapDesktopFlowerThread(result.thread);
      },
    } : {}),
    ...(bridge.setFlowerHostThreadPinned ? {
      setThreadPinned: async (threadID, pinned) => {
        const result = await bridge.setFlowerHostThreadPinned!({ thread_id: threadID, pinned });
        if (!result.ok) throw flowerHostError(result.error);
        return mapDesktopFlowerThread(result.thread);
      },
    } : {}),
    ...(bridge.forkFlowerHostThread ? {
      forkThread: async (threadID) => {
        const result = await bridge.forkFlowerHostThread!({ thread_id: threadID });
        if (!result.ok) throw flowerHostError(result.error);
        return mapDesktopFlowerThread(result.thread);
      },
    } : {}),
    resolveHandler: async (request) => {
      const result = await bridge.resolveFlowerHostHandler(request);
      if (!result.ok) throw flowerHostError(result.error);
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
        const error = flowerHostError(result.error) as Error & { code?: string; fresh_decision?: FlowerRouterDecision };
        const freshDecision = (result as { fresh_decision?: FlowerRouterDecision }).fresh_decision;
        if (freshDecision) {
          error.fresh_decision = freshDecision;
        }
        throw error;
      }
      return mapDesktopFlowerThread(result.thread);
    },
    submitInput: async (input) => {
      const result = await bridge.submitFlowerHostInput({
        thread_id: input.thread_id,
        prompt_id: input.prompt_id,
        answers: input.answers,
      });
      if (!result.ok) throw flowerHostError(result.error);
      return mapDesktopFlowerThread(result.thread);
    },
  };
}
