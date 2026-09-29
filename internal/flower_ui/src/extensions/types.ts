export type ExtensionIconSource = Readonly<{ src: string; theme?: 'light' | 'dark' }>;

export type SkillCatalogNotice = Readonly<{
  name?: string;
  path?: string;
  message?: string;
  winner_path?: string;
}>;

export type SkillCatalogEntry = Readonly<{
  id: string;
  icons?: readonly ExtensionIconSource[];
  name: string;
  description: string;
  path: string;
  scope: string;
  priority?: number;
  permission_hints?: string[];
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
export type FlowerExtensionsAdapter = Readonly<{
  canInteract: () => boolean;
  canAdmin: () => boolean;
  listSkills: (reload?: boolean) => Promise<SkillsCatalogResponse>;
  listSkillSources: () => Promise<SkillSourcesResponse>;
  toggleSkill: (path: string, enabled: boolean) => Promise<SkillsCatalogResponse>;
  createSkill: (input: { scope: string; name: string; description: string; body: string }) => Promise<SkillsCatalogResponse>;
  deleteSkill: (input: { scope: string; name: string }) => Promise<SkillsCatalogResponse>;
  reinstallSkill: (path: string) => Promise<SkillReinstallResponse>;
  validateSkillImport: (input: SkillImportInput) => Promise<SkillGitHubValidateResponse>;
  importSkills: (input: SkillImportInput) => Promise<SkillGitHubImportResponse>;
  browseSkillTree: (skillPath: string, dir: string) => Promise<SkillBrowseTreeResponse>;
  browseSkillFile: (skillPath: string, file: string) => Promise<SkillBrowseFileResponse>;
  listMCP: () => Promise<MCPCatalog>;
  saveMCP: (input: MCPServerInput) => Promise<MCPCatalog>;
  checkMCP: (input: MCPServerIdentity) => Promise<MCPCatalog>;
  deleteMCP: (input: MCPServerIdentity) => Promise<MCPCatalog>;
}>;
export type SkillImportInput = Readonly<{ scope: string; url: string; repo: string; ref: string; paths: string[]; overwrite: boolean }>;
export type MCPServerIdentity = Readonly<{ id: string; revision: number }>;
export type MCPServerInput = MCPServerIdentity & Readonly<{
  name: string; transport: 'stdio' | 'http'; enabled: boolean;
  url?: string; command?: string; args?: string[];
  headers?: Record<string, string>; env?: Record<string, string>;
}>;
export type MCPServer = Readonly<{
  icons?: readonly ExtensionIconSource[];
  id: string; revision: number; name: string; transport: 'stdio' | 'http';
  url?: string; command?: string; args?: string[];
  header_keys: string[]; env_keys: string[]; enabled: boolean;
  checked_at: number; tools: readonly { name: string; description: string }[];
}>;
export type MCPCatalog = Readonly<{ servers: readonly MCPServer[] }>;
