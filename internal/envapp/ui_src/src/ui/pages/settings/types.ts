export type PermissionSet = Readonly<{ read: boolean; write: boolean; execute: boolean }>;

export type PermissionPolicy = Readonly<{
  schema_version: number;
  local_max: PermissionSet;
  by_user?: Record<string, PermissionSet>;
  by_app?: Record<string, PermissionSet>;
}>;

export type AIProviderType = 'openai' | 'anthropic' | 'moonshot' | 'chatglm' | 'deepseek' | 'qwen' | 'openai_compatible';

export type AIProviderModel = Readonly<{
  model_name: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
}>;

export type AIProvider = Readonly<{
  id: string;
  name?: string;
  type: AIProviderType;
  base_url?: string;
  models: AIProviderModel[];
}>;

export type AIExecutionPolicy = Readonly<{
  require_user_approval?: boolean;
  block_dangerous_commands?: boolean;
}>;

export type AIConfig = Readonly<{
  current_model_id: string;
  providers: AIProvider[];
  mode?: 'act' | 'plan';
  web_search_provider?: 'prefer_openai' | 'brave' | 'disabled';
  tool_recovery_enabled?: boolean;
  tool_recovery_max_steps?: number;
  tool_recovery_allow_path_rewrite?: boolean;
  tool_recovery_allow_probe_tools?: boolean;
  tool_recovery_fail_on_repeated_signature?: boolean;
  execution_policy?: AIExecutionPolicy;
}>;

export type AISecretsView = Readonly<{ provider_api_key_set: Record<string, boolean> }>;

export type CodexHostStatus = Readonly<{
  available: boolean;
  ready: boolean;
  binary_path?: string;
  agent_home_dir?: string;
  error?: string;
}>;

export type SkillCatalogNotice = Readonly<{
  name?: string;
  path?: string;
  message?: string;
  winner_path?: string;
}>;

export type SkillCatalogEntry = Readonly<{
  id: string;
  name: string;
  description: string;
  path: string;
  scope: string;
  priority?: number;
  mode_hints?: string[];
  allow_implicit_invocation?: boolean;
  dependencies?: ReadonlyArray<Readonly<{ name?: string; transport?: string; command?: string; url?: string }>>;
  dependency_state?: string;
  enabled: boolean;
  effective: boolean;
  shadowed_by?: string;
}>;

export type SkillsCatalogResponse = Readonly<{
  catalog_version: number;
  skills: SkillCatalogEntry[];
  conflicts?: SkillCatalogNotice[];
  errors?: SkillCatalogNotice[];
}>;

export type SkillSourceItem = Readonly<{
  skill_path: string;
  source_type: 'local_manual' | 'github_import' | 'system_bundle' | string;
  source_id: string;
  repo?: string;
  ref?: string;
  repo_path?: string;
  install_mode?: string;
  installed_commit?: string;
  installed_at_unix_ms?: number;
  last_checked_at_unix_ms?: number;
}>;

export type SkillSourcesResponse = Readonly<{
  items: SkillSourceItem[];
}>;

export type SkillGitHubCatalogItem = Readonly<{
  remote_id: string;
  name: string;
  description: string;
  repo_path: string;
  exists_local: boolean;
  installed_paths?: string[];
}>;

export type SkillGitHubCatalogResponse = Readonly<{
  source: Readonly<{ repo: string; ref: string; base_path: string }>;
  skills: SkillGitHubCatalogItem[];
}>;

export type SkillGitHubValidateItem = Readonly<{
  name: string;
  description: string;
  repo: string;
  ref: string;
  repo_path: string;
  target_dir: string;
  target_skill_path: string;
  already_exists: boolean;
}>;

export type SkillGitHubValidateResponse = Readonly<{
  resolved: SkillGitHubValidateItem[];
}>;

export type SkillGitHubImportItem = Readonly<{
  name: string;
  scope: string;
  skill_path: string;
  source_type: string;
  source_id: string;
  install_mode: string;
  installed_commit?: string;
}>;

export type SkillGitHubImportResponse = Readonly<{
  catalog: SkillsCatalogResponse;
  imports: SkillGitHubImportItem[];
}>;

export type SkillReinstallResponse = Readonly<{
  catalog: SkillsCatalogResponse;
  reinstalled: ReadonlyArray<Readonly<{ skill_path: string; source_id: string; install_mode: string }>>;
}>;

export type SkillBrowseTreeEntry = Readonly<{
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at_unix_ms: number;
}>;

export type SkillBrowseTreeResponse = Readonly<{
  root: string;
  dir: string;
  entries: SkillBrowseTreeEntry[];
}>;

export type SkillBrowseFileResponse = Readonly<{
  root: string;
  file: string;
  encoding: 'utf8' | 'base64' | string;
  truncated: boolean;
  size: number;
  content: string;
}>;

export type PermissionRow = { key: string; read: boolean; write: boolean; execute: boolean };

export type AIProviderModelRow = {
  model_name: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
};

export type AIProviderRow = {
  id: string;
  name: string;
  type: AIProviderType;
  base_url: string;
  models: AIProviderModelRow[];
};

export type AIProviderModelPreset = Readonly<{
  model_name: string;
  context_window: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
  note?: string;
}>;

export type AIProviderPreset = Readonly<{
  type: AIProviderType;
  name: string;
  default_base_url: string;
  models: readonly AIProviderModelPreset[];
}>;

export type AIProviderDialogMode = 'create' | 'edit';

export type AIPreservedUIFields = {
  mode?: 'act' | 'plan';
  tool_recovery_enabled?: boolean;
  tool_recovery_max_steps?: number;
  tool_recovery_allow_path_rewrite?: boolean;
  tool_recovery_allow_probe_tools?: boolean;
  tool_recovery_fail_on_repeated_signature?: boolean;
};
