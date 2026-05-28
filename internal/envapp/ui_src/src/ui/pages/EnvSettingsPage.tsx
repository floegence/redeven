import { For, Show, createMemo, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Search, X, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, Select } from '@floegence/floe-webapp-core/ui';

import { EnvSettingsPageProvider, useEnvSettingsPage } from './settings/EnvSettingsPageContext';
import { SETTINGS_NAV_ITEMS, SETTINGS_GROUPS, type SettingsGroupID, type SettingsNavItem } from './settings/settingsStructure';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { useI18n } from '../i18n';
import type { EnvSettingsSection } from './EnvContext';

import { InterfaceSection } from './settings/sections/InterfaceSection';
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

const NAV_SEARCH_KEYWORDS: Record<EnvSettingsSection, string[]> = {
  interface: ['language', 'locale', 'translation', 'ui', 'interface', 'system default'],
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

function filterNavItems(query: string, items: readonly SettingsNavItem[]): SettingsNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    const keywords = NAV_SEARCH_KEYWORDS[item.id] ?? [];
    return keywords.some((kw) => kw.includes(q));
  });
}

function navLabel(section: EnvSettingsSection, fallback: string, t: ReturnType<typeof useI18n>['t']): string {
  switch (section) {
    case 'interface':
      return t('settings.nav.interface');
    case 'config':
      return t('settings.nav.config');
    case 'connection':
      return t('settings.nav.connection');
    case 'agent':
      return t('settings.nav.agent');
    case 'runtime':
      return t('settings.nav.runtime');
    case 'logging':
      return t('settings.nav.logging');
    case 'codespaces':
      return t('settings.nav.codespaces');
    case 'permission_policy':
      return t('settings.nav.permissionPolicy');
    case 'ai':
      return t('settings.nav.flower');
    case 'skills':
      return t('settings.nav.skills');
    case 'codex':
      return t('settings.nav.codex');
    case 'debug_console':
      return t('settings.nav.debugConsole');
    default:
      return fallback;
  }
}

function groupTitle(groupID: SettingsGroupID, fallback: string, t: ReturnType<typeof useI18n>['t']): string {
  switch (groupID) {
    case 'overview':
      return t('settings.groups.overview');
    case 'runtime_configuration':
      return t('settings.groups.runtimeConfiguration');
    case 'codespaces_tooling':
      return t('settings.groups.codespacesTooling');
    case 'security':
      return t('settings.groups.security');
    case 'ai_extensions':
      return t('settings.groups.aiExtensions');
    case 'diagnostics':
      return t('settings.groups.diagnostics');
    default:
      return fallback;
  }
}

const sectionComponents: Record<EnvSettingsSection, () => JSX.Element> = {
  interface: InterfaceSection,
  config: ConfigFileSection,
  connection: ConnectionSection,
  agent: RuntimeStatusSection,
  runtime: RuntimeConfigSection,
  logging: LoggingSection,
  codespaces: CodespacesSection,
  permission_policy: PermissionPolicySection,
  ai: FlowerSection,
  skills: SkillsSection,
  codex: CodexSection,
  debug_console: DebugConsoleSection,
};

function EnvSettingsPageContent() {
  const ctx = useEnvSettingsPage();
  const i18n = useI18n();

  const localizedItems = createMemo(() => (
    SETTINGS_NAV_ITEMS.map((item) => ({
      ...item,
      label: navLabel(item.id, item.label, i18n.t),
    }))
  ));
  const filteredItems = createMemo(() => filterNavItems(ctx.searchQuery(), localizedItems()));
  const ActiveSection = createMemo(() => sectionComponents[ctx.activeSection()]);

  return (
    <div class={cn('relative h-full min-h-0 flex flex-col', redevenSurfaceRoleClass('main'))}>
      <div class={cn('flex items-center justify-between gap-3 border-b px-4 py-2.5 shrink-0', redevenSurfaceRoleClass('panelStrong'))}>
        <div class="flex items-center gap-3 min-w-0">
          <h1 class="text-sm font-semibold text-foreground tracking-tight truncate">{i18n.t('settings.runtimeTitle')}</h1>
        </div>
        <Button size="sm" variant="outline" onClick={() => void ctx.refreshSettingsPage()} disabled={ctx.settings.loading} class="gap-1.5 shrink-0">
          <RefreshIcon class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">{i18n.t('common.actions.refresh')}</span>
        </Button>
      </div>

      <div class="flex-1 min-h-0 flex">
        <div class={cn('hidden md:flex flex-col border-r w-56 shrink-0 h-full overflow-hidden', redevenSurfaceRoleClass('panel'))}>
          <div class="p-3 border-b">
            <div class="relative">
              <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={ctx.searchQuery()}
                onInput={(e) => ctx.setSearchQuery(e.currentTarget.value)}
                placeholder={i18n.t('settings.searchPlaceholder')}
                class="w-full rounded-md border bg-background py-1.5 pl-8 pr-7 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <Show when={ctx.searchQuery()}>
                <button
                  type="button"
                  class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => ctx.setSearchQuery('')}
                >
                  <X class="h-3 w-3" />
                </button>
              </Show>
            </div>
            <Show when={ctx.searchQuery()}>
              <p class="mt-1.5 text-[10px] text-muted-foreground">
                {i18n.t('settings.filteredSections', { visible: filteredItems().length, total: SETTINGS_NAV_ITEMS.length })}
              </p>
            </Show>
          </div>

          <div class="flex-1 overflow-y-auto py-1">
            <For each={SETTINGS_GROUPS}>
              {(group) => {
                const groupItems = createMemo(() =>
                  filteredItems().filter((item) => (group.sections as readonly string[]).includes(item.id)),
                );
                return (
                  <Show when={groupItems().length > 0}>
                    <div data-settings-group={group.id}>
                      <div class="px-3 pt-3 pb-1">
                        <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{groupTitle(group.id, group.title, i18n.t)}</span>
                      </div>
                      <For each={groupItems()}>
                        {(item) => {
                          const Icon = item.icon;
                          const isActive = () => ctx.activeSection() === item.id;
                          return (
                            <button
                              type="button"
                              class={cn(
                                'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer',
                                isActive()
                                  ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border-r-2 border-transparent',
                              )}
                              onClick={() => ctx.setActiveSection(item.id)}
                              data-settings-nav-item={item.id}
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

        <div class={cn('md:hidden border-b px-3 py-2 shrink-0', redevenSurfaceRoleClass('panel'))}>
          <Select
            value={ctx.activeSection()}
            onChange={(v) => v && ctx.setActiveSection(v as EnvSettingsSection)}
            options={filteredItems().map((it) => ({ value: it.id, label: it.label }))}
            class="w-full"
          />
        </div>

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
            {ActiveSection()()}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EnvSettingsPage() {
  return (
    <EnvSettingsPageProvider>
      <EnvSettingsPageContent />
    </EnvSettingsPageProvider>
  );
}
