import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Search, X } from '@floegence/floe-webapp-core/icons';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import { RefreshIcon } from '@floegence/floe-webapp-core/icons';

import { EnvSettingsPageProvider, useEnvSettingsPage } from './settings/EnvSettingsPageContext';
import { SETTINGS_NAV_ITEMS, SETTINGS_GROUPS, settingsSectionElementID, type SettingsNavItem } from './settings/settingsStructure';
import { FieldLabel } from './settings/SettingsPrimitives';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import type { EnvSettingsSection } from './EnvContext';

import { ConfigFileSection } from './settings/sections/ConfigFileSection';
import { ConnectionSection } from './settings/sections/ConnectionSection';
import { RuntimeStatusSection } from './settings/sections/RuntimeStatusSection';
import { RuntimeConfigSection } from './settings/sections/RuntimeConfigSection';
import { LoggingSection } from './settings/sections/LoggingSection';
import { CodespacesSection } from './settings/sections/CodespacesSection';
import { PermissionPolicySection } from './settings/sections/PermissionPolicySection';
import { FlowerSection } from './settings/sections/FlowerSection';
import { SkillsSection } from './settings/sections/SkillsSection';
import { CodexSection } from './settings/sections/CodexSection';
import { DebugConsoleSection } from './settings/sections/DebugConsoleSection';

// ── Search keywords for nav items ──
const NAV_SEARCH_KEYWORDS: Record<EnvSettingsSection, string[]> = {
  config: ['path', 'config file', 'configuration', 'json', 'config_path', 'toml'],
  connection: ['url', 'e2ee', 'psk', 'encryption', 'websocket', 'ws', 'channel', 'environment id', 'instance id', 'control plane'],
  agent: ['version', 'restart', 'upgrade', 'update', 'status', 'maintenance', 'health', 'runtime status', 'compatibility', 'release'],
  runtime: ['shell', 'bash', 'zsh', 'home', 'workspace', 'filesystem', 'root', 'directory', 'folder', 'read', 'write', 'permission'],
  logging: ['log', 'format', 'level', 'debug', 'info', 'warn', 'error', 'json', 'text', 'verbose'],
  codespaces: ['code server', 'browser editor', 'port', 'vscode', 'editor', 'ide', 'code runtime'],
  permission_policy: ['permission', 'policy', 'security', 'read', 'write', 'execute', 'by_user', 'by_app', 'local_max', 'schema'],
  ai: ['api key', 'model', 'provider', 'openai', 'anthropic', 'flower', 'llm', 'gpt', 'claude', 'deepseek', 'execution policy', 'approval', 'dangerous'],
  skills: ['skill', 'catalog', 'github', 'install', 'extension', 'plugin', 'agent skill', 'tool'],
  codex: ['codex', 'host', 'binary', 'diagnostics', 'bridge'],
  debug_console: ['debug', 'console', 'floating', 'overlay', 'frontend', 'performance', 'request'],
};

function filterNavItems(query: string): SettingsNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SETTINGS_NAV_ITEMS];
  return SETTINGS_NAV_ITEMS.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    const keywords = NAV_SEARCH_KEYWORDS[item.id] ?? [];
    return keywords.some((kw) => kw.includes(q));
  });
}

// ── Section Renderer ──
function SectionRenderer(props: { section: EnvSettingsSection }) {
  switch (props.section) {
    case 'config': return <ConfigFileSection />;
    case 'connection': return <ConnectionSection />;
    case 'agent': return <RuntimeStatusSection />;
    case 'runtime': return <RuntimeConfigSection />;
    case 'logging': return <LoggingSection />;
    case 'codespaces': return <CodespacesSection />;
    case 'permission_policy': return <PermissionPolicySection />;
    case 'ai': return <FlowerSection />;
    case 'skills': return <SkillsSection />;
    case 'codex': return <CodexSection />;
    case 'debug_console': return <DebugConsoleSection />;
    default: return null;
  }
}

// ── Inner Content (has context access) ──
function EnvSettingsPageContent() {
  const ctx = useEnvSettingsPage();

  const filteredItems = createMemo(() => filterNavItems(ctx.searchQuery()));

  const currentNavLabel = createMemo(() => {
    const item = SETTINGS_NAV_ITEMS.find((it) => it.id === ctx.activeSection());
    return item?.label ?? 'Settings';
  });

  return (
    <div class={cn('relative h-full min-h-0 flex flex-col', redevenSurfaceRoleClass('main'))}>
      {/* Top bar */}
      <div class={cn('flex items-center justify-between gap-3 border-b px-4 py-2.5 shrink-0', redevenSurfaceRoleClass('panelStrong'))}>
        <div class="flex items-center gap-3 min-w-0">
          <h1 class="text-sm font-semibold text-foreground tracking-tight truncate">Runtime Settings</h1>
          <span class="hidden sm:inline text-[11px] text-muted-foreground truncate">/ {currentNavLabel()}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => void ctx.refreshSettingsPage()} disabled={ctx.settings.loading} class="gap-1.5 shrink-0">
          <RefreshIcon class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <div class="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <div class={cn('hidden md:flex flex-col border-r w-56 shrink-0 h-full overflow-hidden', redevenSurfaceRoleClass('panel'))}>
          {/* Search */}
          <div class={cn('p-3 border-b', redevenSurfaceRoleClass('panel'))}>
            <div class="relative">
              <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={ctx.searchQuery()}
                onInput={(e) => ctx.setSearchQuery(e.currentTarget.value)}
                placeholder="Search settings..."
                class="w-full rounded-md border bg-background py-1.5 pl-8 pr-7 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <Show when={ctx.searchQuery()}>
                <button
                  type="button"
                  class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"
                  onClick={() => ctx.setSearchQuery('')}
                >
                  <X class="h-3 w-3" />
                </button>
              </Show>
            </div>
            <Show when={ctx.searchQuery()}>
              <p class="mt-1.5 text-[10px] text-muted-foreground">{filteredItems().length} of {SETTINGS_NAV_ITEMS.length} sections</p>
            </Show>
          </div>

          {/* Nav items grouped */}
          <div class="flex-1 overflow-y-auto py-1">
            <For each={SETTINGS_GROUPS}>
              {(group) => {
                const groupItems = createMemo(() =>
                  filteredItems().filter((item) => group.sections.includes(item.id as any)),
                );
                return (
                  <Show when={groupItems().length > 0}>
                    <div>
                      <div class="px-3 pt-3 pb-1">
                        <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{group.title}</span>
                      </div>
                      <For each={groupItems()}>
                        {(item) => {
                          const Icon = item.icon;
                          const isActive = () => ctx.activeSection() === item.id;
                          return (
                            <button
                              type="button"
                              class={cn(
                                'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors',
                                isActive()
                                  ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border-r-2 border-transparent',
                              )}
                              onClick={() => ctx.setActiveSection(item.id)}
                            >
                              <Icon class={cn('h-3.5 w-3.5 shrink-0', isActive() ? 'text-primary' : 'text-muted-foreground')} />
                              <span class="truncate">{item.label}</span>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                );
              }}
            </For>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        <div class={cn('md:hidden border-b px-3 py-2 shrink-0', redevenSurfaceRoleClass('panel'))}>
          <div class="flex gap-2">
            <div class="relative flex-1">
              <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={ctx.searchQuery()}
                onInput={(e) => ctx.setSearchQuery(e.currentTarget.value)}
                placeholder="Search..."
                class="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <Select
              value={ctx.activeSection()}
              onChange={(v) => v && ctx.setActiveSection(v as EnvSettingsSection)}
              options={filteredItems().map((it) => ({ value: it.id, label: it.label }))}
              class="w-44 shrink-0"
            />
          </div>
        </div>

        {/* Main content area */}
        <div class="flex-1 min-w-0 overflow-auto">
          <div class="max-w-4xl mx-auto p-4 sm:p-6 pb-16">
            <Show when={ctx.settings.error}>
              <div class="flex items-start gap-2.5 p-4 rounded-lg bg-destructive/10 border border-destructive/20 mb-6">
                <div class="w-1 h-full min-h-4 rounded-full bg-destructive/60 flex-shrink-0" />
                <div class="text-sm text-destructive">
                  {ctx.settings.error instanceof Error ? ctx.settings.error.message : String(ctx.settings.error)}
                </div>
              </div>
            </Show>
            <SectionRenderer section={ctx.activeSection()} />
          </div>
        </div>
      </div>

      {/* Loading Curtain */}
      <RedevenLoadingCurtain
        visible={false}
      />
    </div>
  );
}

// ── Exported Page ──
export function EnvSettingsPage() {
  return (
    <EnvSettingsPageProvider>
      <EnvSettingsPageContent />
    </EnvSettingsPageProvider>
  );
}
