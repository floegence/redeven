import { createFlowerContextTarget, registerFlowerPageReader } from '../flower/FlowerContextSource';
import './runtime-settings-compact.css';
import { For, Show, createMemo, onCleanup, onMount, type JSX } from 'solid-js';
import { cn, createUIFirstSelection } from '@floegence/floe-webapp-core';
import { ChevronLeft, ChevronRight, Search, X, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Select, SettingsLayout, SettingsNavigation } from '@floegence/floe-webapp-core/ui';

import { EnvSettingsPageCtx, EnvSettingsPageProvider, useEnvSettingsPage, type EnvSettingsPageContextValue } from './settings/EnvSettingsPageContext';
import { SETTINGS_NAV_ITEMS, SETTINGS_GROUPS, type SettingsGroupID, type SettingsNavItem } from './settings/settingsStructure';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { useI18n } from '../i18n';
import type { EnvSettingsSection } from './EnvContext';
import { UIFirstKeepAlivePanel } from '../primitives/UIFirstKeepAlivePanel';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';

import { SettingsList, SettingRow } from './settings/SettingsPrimitives';
import { ConfigFileSection } from './settings/sections/ConfigFileSection';
import { ConnectionSection } from './settings/sections/ConnectionSection';
import { RuntimeStatusSection } from './settings/sections/RuntimeStatusSection';
import { RuntimeConfigSection } from './settings/sections/RuntimeConfigSection';
import { LoggingSection } from './settings/sections/LoggingSection';
import { CodespacesSection } from './settings/sections/CodespacesSection';
import { PermissionPolicySection } from './settings/sections/PermissionPolicySection';
import { FlowerSection } from './settings/sections/FlowerSection';
import { DebugConsoleSection } from './settings/sections/DebugConsoleSection';

const NAV_SEARCH_KEYWORDS: Record<EnvSettingsSection, string[]> = {
  appearance: ['theme', 'language', 'appearance'],
  terminal: ['terminal', 'history', 'font', 'input'],
  browser: ['browser', 'chrome', 'chromium'],
  applications: ['applications', 'desktop', 'access'],
  containers: ['containers', 'docker', 'podman', 'proxy', 'credentials'],
  services: ['services', 'network', 'storage', 'resources'],
  extensions: ['skills', 'mcp', 'agent plugins'],
  plugins: ['plugin', 'connections'],
  storage: ['storage', 'data', 'space', 'usage'],
  flower_recovery: ['flower', 'status', 'health', 'diagnostics'],
  config: ['path', 'config file', 'configuration', 'json', 'config_path', 'toml'],
  connection: ['url', 'e2ee', 'psk', 'encryption', 'websocket', 'ws', 'channel', 'environment id', 'instance id', 'control plane'],
  agent: ['version', 'restart', 'upgrade', 'update', 'status', 'maintenance', 'health', 'runtime status', 'compatibility', 'release'],
  runtime: ['shell', 'bash', 'zsh', 'home', 'workspace', 'filesystem', 'root', 'directory', 'folder', 'read', 'write', 'permission'],
  logging: ['log', 'format', 'level', 'debug', 'info', 'warn', 'error', 'json', 'text', 'verbose'],
  codespaces: ['code server', 'browser editor', 'port', 'vscode', 'editor', 'ide', 'code runtime'],
  permission_policy: ['permission', 'policy', 'security', 'read', 'write', 'execute', 'by_user', 'by_app', 'local_max', 'schema'],
  ai: ['api key', 'model', 'provider', 'openai', 'anthropic', 'flower', 'llm', 'gpt', 'claude', 'deepseek', 'execution policy', 'approval', 'dangerous'],
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
    case 'appearance': return t('settings.nav.appearance');
    case 'terminal': return t('settings.nav.terminal');
    case 'browser': return t('settings.nav.browser');
    case 'applications': return t('settings.nav.applications');
    case 'containers': return t('settings.nav.containers');
    case 'services': return t('settings.nav.services');
    case 'extensions': return t('settings.nav.extensions');
    case 'plugins': return t('settings.plugins.target');
    case 'flower_recovery': return t('storage.flower');
    case 'storage': return t('storage.title');
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

const sectionComponents: Partial<Record<EnvSettingsSection, () => JSX.Element>> = {
  config: ConfigFileSection,
  connection: ConnectionSection,
  agent: RuntimeStatusSection,
  runtime: RuntimeConfigSection,
  logging: LoggingSection,
  codespaces: CodespacesSection,
  permission_policy: PermissionPolicySection,
  ai: FlowerSection,
  debug_console: DebugConsoleSection,
};

type EnvSettingsPageProps = {
  resourceHeader?: JSX.Element;
  initialSection?: EnvSettingsSection;
  context?: EnvSettingsPageContextValue;
  panels?: Partial<Record<EnvSettingsSection, () => JSX.Element>>;
  onNavigate?: (section: EnvSettingsSection) => void;
  onHeaderChange?: (header: JSX.Element) => void;
};

function EnvSettingsPageContent(props: EnvSettingsPageProps = {}) {
  const ctx = props.context ?? useEnvSettingsPage();
  registerFlowerPageReader(() => ({ section: ctx.activeSection() }));
  const i18n = useI18n();

  const localizedItems = createMemo(() => (
    SETTINGS_NAV_ITEMS.map((item) => ({
      ...item,
      label: navLabel(item.id, item.label, i18n.t),
    }))
  ));
  const filteredItems = createMemo(() => filterNavItems(ctx.searchQuery(), localizedItems()));
  const sectionSelection = createUIFirstSelection<EnvSettingsSection>({
    committed: ctx.activeSection,
    commit: section => { ctx.setActiveSection(section); props.onNavigate?.(section); },
    onEvent: createUIPresentationEventRecorder({
      surface: 'settings',
      source: 'section-nav',
    }),
  });
  const returnToFlower = createMemo(() => ctx.env.settingsOrigin()?.kind === 'flower');

  // IMPORTANT: One controller owns navigation, refresh and the projected header.
  // Moving its DOM into the dialog slot must not create a second settings owner.
  // IMPORTANT: A modal category root has one close action. Domain refresh stays
  // beside its resource; this generic fetch does not refresh those owners.
  const header = (
      <div class="redeven-settings-header flex items-center justify-between gap-3 shrink-0">
        <div class="flex flex-1 items-center gap-3 min-w-0">
          <Show when={!props.onHeaderChange && returnToFlower()}>
            <button
              type="button"
              class="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={i18n.t('settings.backToFlower')}
              title={i18n.t('settings.backToFlower')}
              onClick={() => ctx.env.returnFromSettingsOrigin()}
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
          </Show>
          <div class="redeven-settings-breadcrumb flex min-w-0 items-center gap-3">
          <span class="shrink-0 text-sm font-semibold">{i18n.t('settings.runtimeTitle')}</span>
          <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
          <span class="truncate text-sm text-muted-foreground" title={navLabel(sectionSelection.visual(), '', i18n.t)}>{navLabel(sectionSelection.visual(), '', i18n.t)}</span>
          </div>
          <div class="redeven-settings-mobile-nav min-w-0 flex-1"><Select
          value={sectionSelection.visual()}
          onChange={(v) => v && sectionSelection.request(v as EnvSettingsSection)}
          options={localizedItems().map((it) => ({ value: it.id, label: it.label }))}
          ariaLabel={i18n.t('settings.runtimeTitle')} class="w-full"
        /></div>
        </div>
        <Show when={props.resourceHeader}><div class="redeven-settings-header-resource">{props.resourceHeader}</div></Show>
        <Show when={!props.onHeaderChange || !props.panels?.[ctx.activeSection()]}><Button size="sm" variant="ghost" onClick={() => void ctx.refreshSettingsPage()} disabled={ctx.settings.loading} aria-label={i18n.t('common.actions.refresh')} class="gap-1.5 shrink-0">
          <RefreshIcon class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">{i18n.t('common.actions.refresh')}</span>
        </Button></Show>
      </div>
  );
  if (props.onHeaderChange) {
    onMount(() => props.onHeaderChange?.(header));
    onCleanup(() => props.onHeaderChange?.(null));
  }

  return (
    <div class={cn('redeven-settings-shell relative h-full min-h-0 flex flex-col', redevenSurfaceRoleClass('main'))}>
      <Show when={!props.onHeaderChange}>{header}</Show>

      <SettingsLayout class="redeven-settings-body"
        sidebar={<SettingsNavigation
          label={i18n.t('settings.runtimeTitle')}
          value={sectionSelection.visual()}
          onChange={(id) => sectionSelection.request(id as EnvSettingsSection)}
          groups={SETTINGS_GROUPS.map((group) => ({
            id: group.id,
            label: groupTitle(group.id, group.title, i18n.t),
            items: group.sections.flatMap(id => filteredItems().filter(item => item.id === id)).map((item) => ({
              ...item,
              // IMPORTANT: Floe buttons keep one-line labels. The product sidebar
              // bounds long localized labels through the public item slot; title
              // and the accessible name retain the complete destination.
              attributes: { 'data-settings-nav-item': item.id, class: 'min-w-0 [&>span]:truncate', title: item.label, ref: createFlowerContextTarget(() => ({ id: item.id, label: item.label, state: { navigation: item.id } })) },
            })),
          }))}
          search={<div class="relative">
            <Input
              type="search"
              size="sm"
              value={ctx.searchQuery()}
              onInput={(e) => ctx.setSearchQuery(e.currentTarget.value)}
              aria-label={i18n.t('settings.searchPlaceholder')}
              placeholder={i18n.t('settings.searchPlaceholder')}
              leftIcon={<Search class="h-3.5 w-3.5" />}
              class="redeven-settings-search pr-8 text-xs"
            />
            <Show when={ctx.searchQuery()}><button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--floe-ink-quiet)] transition-colors duration-[var(--floe-duration-fast)] ease-[var(--floe-ease-out)] hover:text-[var(--floe-ink)]"
              aria-label={i18n.t('settingsDesign.clearSearch')} onClick={() => ctx.setSearchQuery('')}><X class="h-3 w-3" /></button></Show>
          </div>}
          empty={<p role="status" class="px-3 py-5 text-xs text-muted-foreground">{i18n.t('settings.filteredSections', { visible: 0, total: SETTINGS_NAV_ITEMS.length })}</p>}
        />}

      >
        <div class="redeven-settings-content absolute inset-0">
          <For each={SETTINGS_NAV_ITEMS}>
            {(item) => {
              const Section = props.panels?.[item.id] ?? sectionComponents[item.id];
              return (
                <UIFirstKeepAlivePanel
                  active={ctx.activeSection() === item.id}
                  testId={`settings-section-${item.id}`}
                  class="absolute inset-0 overflow-auto"
                  render={() => (
                    <div ref={createFlowerContextTarget(() => ({ id: item.id, label: navLabel(item.id, item.id, i18n.t), state: { section: item.id } }))} class="floe-settings-page redeven-settings-page">
                      <Show when={ctx.settings.error}>
                        <div role="alert" class="redeven-settings-read-error">
                          <div class="min-w-0 flex-1 break-words text-[length:var(--floe-type-body)] text-destructive">
                            {ctx.settings.error instanceof Error ? ctx.settings.error.message : String(ctx.settings.error)}
                          </div>
                          {/* IMPORTANT: A failed generic read has its own retry even when
                              the active domain owns a different resource refresh. Retry
                              only this read; never replay a mutation or change category. */}
                          <Button size="sm" variant="outline" disabled={ctx.settings.loading} onClick={() => void ctx.refreshSettingsPage()}>{i18n.t('floeControls.retry')}</Button>
                        </div>
                      </Show>
                      {Section ? <Section /> : null}
                      <Show when={['config', 'logging', 'debug_console'].includes(item.id)}>
                        <div class="redeven-settings-related mt-8">
                          <h2 class="mb-3 text-xs font-medium text-muted-foreground">{i18n.t('settingsDesign.relatedSettings')}</h2>
                          <SettingsList>
                            <For each={item.id === 'config' ? ['runtime', 'permission_policy', 'logging'] : item.id === 'logging' ? ['agent', 'debug_console'] : ['logging', 'agent']}>
                              {(target) => <SettingRow title={navLabel(target as EnvSettingsSection, target, i18n.t)}
                                control={<Button size="icon" variant="ghost" icon={ChevronRight} aria-label={navLabel(target as EnvSettingsSection, target, i18n.t)}
                                  onClick={() => sectionSelection.request(target as EnvSettingsSection)} />} />}
                            </For>
                          </SettingsList>
                        </div>
                      </Show>
                    </div>
                  )}
                />
              );
            }}
          </For>
        </div>
      </SettingsLayout>
    </div>
  );
}

export function EnvSettingsPage(props: EnvSettingsPageProps = {}) {
  if (props.context) {
    return (
      <EnvSettingsPageCtx.Provider value={props.context}>
        <EnvSettingsPageContent resourceHeader={props.resourceHeader} context={props.context} panels={props.panels} onNavigate={props.onNavigate} onHeaderChange={props.onHeaderChange} />
      </EnvSettingsPageCtx.Provider>
    );
  }
  return (
    <EnvSettingsPageProvider initialSection={props.initialSection}>
      <EnvSettingsPageContent resourceHeader={props.resourceHeader} panels={props.panels} onNavigate={props.onNavigate} onHeaderChange={props.onHeaderChange} />
    </EnvSettingsPageProvider>
  );
}
