export const LOAD_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL = 'redeven-desktop:flower-host-settings-load';
export const SAVE_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL = 'redeven-desktop:flower-host-settings-save';
export const LIST_DESKTOP_FLOWER_HOST_THREADS_CHANNEL = 'redeven-desktop:flower-host-threads-list';
export const SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL = 'redeven-desktop:flower-host-chat-send';

export type DesktopFlowerHostProviderType =
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'chatglm'
  | 'deepseek'
  | 'qwen'
  | 'openai_compatible';

export type DesktopFlowerHostSecretMode = 'keep' | 'replace' | 'clear';

export type DesktopFlowerHostWebSearchMode = 'disabled' | 'openai_builtin' | 'brave';

export type DesktopFlowerHostWebSearch = Readonly<{
  mode: DesktopFlowerHostWebSearchMode;
}>;

export type DesktopFlowerHostProviderModel = Readonly<{
  model_name: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
  input_modalities?: readonly string[];
}>;

export type DesktopFlowerHostProvider = Readonly<{
  id: string;
  name?: string;
  type: DesktopFlowerHostProviderType;
  base_url?: string;
  web_search?: DesktopFlowerHostWebSearch;
  models: readonly DesktopFlowerHostProviderModel[];
}>;

export type DesktopFlowerHostProviderDraft = DesktopFlowerHostProvider & Readonly<{
  provider_api_key?: string;
  provider_api_key_mode?: DesktopFlowerHostSecretMode;
  web_search_api_key?: string;
  web_search_api_key_mode?: DesktopFlowerHostSecretMode;
}>;

export type DesktopFlowerHostExecutionPolicy = Readonly<{
  require_user_approval: boolean;
  block_dangerous_commands: boolean;
}>;

export type DesktopFlowerHostTerminalExecPolicy = Readonly<{
  default_timeout_ms: number;
  max_timeout_ms: number;
}>;

export type DesktopFlowerHostConfig = Readonly<{
  schema_version: 1;
  enabled: boolean;
  current_model_id: string;
  execution_policy: DesktopFlowerHostExecutionPolicy;
  terminal_exec_policy: DesktopFlowerHostTerminalExecPolicy;
  providers: readonly DesktopFlowerHostProvider[];
}>;

export type DesktopFlowerHostSettingsDraft = Readonly<{
  config: Omit<DesktopFlowerHostConfig, 'providers'> & Readonly<{
    providers: readonly DesktopFlowerHostProviderDraft[];
  }>;
}>;

export type DesktopFlowerHostProviderSecretState = Readonly<{
  provider_id: string;
  provider_api_key_configured: boolean;
  web_search_api_key_configured: boolean;
}>;

export type DesktopFlowerHostTargetCacheEntry = Readonly<{
  target_id: string;
  label: string;
  target_url: string;
  last_seen_at_unix_ms: number;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type DesktopFlowerHostTargetCache = Readonly<{
  version: 1;
  entries: readonly DesktopFlowerHostTargetCacheEntry[];
}>;

export type DesktopFlowerHostSettingsSnapshot = Readonly<{
  config: DesktopFlowerHostConfig;
  provider_secrets: readonly DesktopFlowerHostProviderSecretState[];
  target_cache: DesktopFlowerHostTargetCache;
}>;

export type DesktopFlowerHostChatMessageRole = 'user' | 'assistant';

export type DesktopFlowerHostChatMessage = Readonly<{
  id: string;
  role: DesktopFlowerHostChatMessageRole;
  content: string;
  created_at_ms: number;
}>;

export type DesktopFlowerHostThread = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  status?: 'idle' | 'running' | 'failed';
  messages: readonly DesktopFlowerHostChatMessage[];
}>;

export type DesktopFlowerHostSendChatRequest = Readonly<{
  thread_id?: string;
  prompt: string;
  reply_mode?: 'await' | 'background';
}>;

export type ListDesktopFlowerHostThreadsResult = Readonly<
  | {
      ok: true;
      threads: readonly DesktopFlowerHostThread[];
    }
  | {
      ok: false;
      error: string;
    }
>;

export type SendDesktopFlowerHostChatResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | {
      ok: false;
      error: string;
    }
>;

export type LoadDesktopFlowerHostSettingsResult = Readonly<
  | {
      ok: true;
      snapshot: DesktopFlowerHostSettingsSnapshot;
    }
  | {
      ok: false;
      error: string;
    }
>;

export type SaveDesktopFlowerHostSettingsResult = Readonly<
  | {
      ok: true;
      snapshot: DesktopFlowerHostSettingsSnapshot;
    }
  | {
      ok: false;
      error: string;
    }
>;

export function normalizeDesktopFlowerHostSecretMode(
  value: unknown,
  fallback: DesktopFlowerHostSecretMode = 'replace',
): DesktopFlowerHostSecretMode {
  return value === 'keep' || value === 'replace' || value === 'clear' ? value : fallback;
}
