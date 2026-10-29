export type AgentPluginSource = { type: 'local' | 'github'; directory?: string; repository?: string; ref?: string; path?: string; commit?: string };
export type AgentPluginPackage = {
  manifest: { name: string; version?: string; description?: string; author?: { name?: string }; license?: string };
  skills: { key: string; name: string; description: string; path: string }[];
  mcp: Record<string, { type: string; command?: string; args?: string[]; cwd?: string; url?: string; env?: Record<string, string>; headers?: Record<string, string> }>;
  diagnostics: { component: string; code: string; detail?: string }[];
};
export type AgentPluginInstall = {
  auto_check?: boolean; update?: { available: boolean; failed: boolean; checked_at: number };
  id: string; revision: number; source: AgentPluginSource; digest: string; package: AgentPluginPackage; enabled: boolean;
  components: Record<string, { enabled: boolean; credential_keys?: string[] }>;
  health?: Record<string, { status: string; checked_at: number; tools: number }>;
};
export type AgentPluginOperation = {
  id: string; kind: string; status: string; install_id: string; expected_revision: number; source: AgentPluginSource;
  digest?: string; package?: AgentPluginPackage; previous?: AgentPluginPackage; expires_at: number; error?: string;
};
export type AgentPluginCatalogSource = { id: string; name: string; url: string };
export type AgentPluginCatalog = { id: string; plugins: { id: string; source: AgentPluginSource }[] };
export type AgentPluginListing = {
  items: AgentPluginInstall[]; sources: AgentPluginCatalogSource[]; operations: AgentPluginOperation[] | null;
  revision: number; target: string; can_launch: boolean;
};
export type AgentPluginsAdapter = Readonly<{
  list: () => Promise<AgentPluginListing>;
  prepare: (input: { request_id: string; source: AgentPluginSource; install_id?: string; revision: number }) => Promise<AgentPluginOperation>;
  operation: (id: string) => Promise<AgentPluginOperation>;
  commit: (input: { operation_id: string; digest: string; enabled: boolean; components: string[] }) => Promise<AgentPluginInstall>;
  change: (input: { id: string; revision: number; enabled?: boolean; auto_check?: boolean; component?: string }) => Promise<AgentPluginInstall>;
  remove: (input: { id: string; revision: number; delete_data: boolean }) => Promise<void>;
  check: (input: { id: string; revision: number; component: string }) => Promise<void>;
  credentials: (input: { id: string; revision: number; component: string; values: Record<string, string> }) => Promise<AgentPluginInstall>;
  addSource: (input: { url: string; revision: number }) => Promise<AgentPluginCatalogSource>;
  removeSource: (input: { id: string; revision: number }) => Promise<void>;
  catalog: (id: string) => Promise<AgentPluginCatalog>;
}>;
