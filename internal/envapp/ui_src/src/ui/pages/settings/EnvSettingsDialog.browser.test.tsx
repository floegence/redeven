import '../../../index.css';
import '../../flower-feature.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvSettingsDialog } from './EnvSettingsDialog';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import type { FlowerSettingsSnapshot } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { TerminalSettingsAttachmentsProvider, terminalSettingsResource, useTerminalSettingsAttachments, type TerminalSettingsAttachment } from '../../services/terminalSettingsTargets';
import { envComputerViewerFrameRate } from '../../services/computerViewerPreferences';
import { readWorkbenchLocalPreferences, writeWorkbenchTheme } from '../../services/workbenchLocalPreferences';
import { useTerminalPreferences } from '../../services/terminalPreferences';
import type { EnvSettingsPageContextValue } from './EnvSettingsPageContext';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { agentPluginsFixture } from '../../flower/agentPluginsFixture';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
let session: ReturnType<typeof createSettingsSession>;
let dispose: (() => void) | undefined;
let admin: () => boolean;
let setAdmin: (value: boolean) => void;
let loading: () => boolean;
let setLoading: (value: boolean) => void;
let settingsError: () => Error | null;
let setSettingsError: (value: Error | null) => void;
let fromFlower = false;
const changes = vi.fn();
const refresh = vi.fn(async () => undefined);
const returnToFlower = vi.fn(() => session.close());
const snapshot: FlowerSettingsSnapshot = {
  defaults: { permission_type: 'approval_required' },
  model_profile: { schema_version: 1, current_model_id: 'openai/gpt-5.2', providers: [{ id: 'openai', name: 'OpenAI', type: 'openai', models: [{ model_name: 'gpt-5.2', context_window: 400000, input_modalities: ['text'] }] }] },
  provider_secrets: [{ provider_id: 'openai', provider_api_key_configured: true, web_search_api_key_configured: false }],
};
const storageNavigation = vi.hoisted(() => ({ plugins: vi.fn(), surface: vi.fn(), files: vi.fn(), workbench: vi.fn(), canvas: vi.fn() }));
const terminals = vi.hoisted(() => ({ attach: vi.fn(), takeover: vi.fn(), configure: vi.fn(), getLayout: vi.fn(), putWidget: vi.fn(), stream: vi.fn(), refresh: vi.fn() }));
const retention = { effective: { max_lines: 1000, max_bytes: 1048576 }, defaults: { max_lines: 1000, max_bytes: 1048576 }, overrides: null };
const layout = { seq: 1, revision: 1, updated_at_unix_ms: 1, widgets: [{ widget_id: 'widget-a', widget_type: 'redeven.terminal', x: 0, y: 0, width: 600, height: 400, z_index: 1, created_at_unix_ms: 1 }], widget_states: [{ widget_id: 'widget-a', widget_type: 'redeven.terminal', revision: 1, updated_at_unix_ms: 1, state: { kind: 'terminal', session_ids: ['session-a'], font_size: 14, font_family_id: 'jetbrains' } }], sticky_notes: [], annotations: [], background_layers: [] };
vi.mock('../../services/terminalSessionCatalog', () => ({ useTerminalSessionCatalog: () => ({ sessions: () => [{ id: 'session-a', name: 'Workspace terminal' }, { id: 'unattached', name: 'Unattached terminal' }], refresh: terminals.refresh }) }));
vi.mock('../../services/workbenchLayoutApi', async original => ({ ...await original<object>(), getWorkbenchLayoutSnapshot: terminals.getLayout, putWorkbenchWidgetState: terminals.putWidget, connectWorkbenchLayoutEventStream: terminals.stream }));
function LiveTerminalFixture() {
  const registry = useTerminalSettingsAttachments()!;
  onCleanup(registry.register({ widgetID: 'widget-a', ready: () => true, controllers: () => new Map([['session-a', 'controller-a']]), transport: { attach: terminals.attach, takeover: terminals.takeover, historyRetention: async () => retention, configureHistoryRetention: terminals.configure } } as unknown as TerminalSettingsAttachment));
  onCleanup(registry.register({ widgetID: null, ready: () => true, controllers: () => new Map([['exec-a', 'controller-exec']]), sessions: () => [{ id: 'exec-a', name: 'Container shell' }], transport: { attach: terminals.attach, takeover: terminals.takeover, historyRetention: async () => retention, configureHistoryRetention: terminals.configure } } as unknown as TerminalSettingsAttachment));
  return null;
}
const save = vi.fn(async () => { setLoading(true); return snapshot; });
const adapter = { runtime: { display_name: 'Test environment' }, computerManagement: { loadEnvironment: async () => ({ hostname: 'Test environment', platform: 'linux', managed: { state: 'ready' }, desktop: { state: 'ready' }, chrome: { installations: [], profiles: [] } }) }, loadSettings: async () => snapshot, canMutate: true, saveDefaultPermission: save, saveModelProfile: save, extensions: {
  canInteract: () => true, canAdmin: () => true, plugins: agentPluginsFixture(),
  listSkills: async () => ({ skills: [], catalog_version: 1 }), listSkillSources: async () => ({ items: [] }), listMCP: async () => ({ servers: [] }),
} };
const env = {
  openSurface: storageNavigation.surface, openFileBrowserAtPath: storageNavigation.files, setViewMode: storageNavigation.workbench,
  env_id: () => 'one', flowerScopeKey: () => 'one:incarnation', env: () => ({ permissions: { can_admin: true, can_read: true, can_write: true, can_execute: true } }),
  settingsSeq: () => 0, settingsOrigin: () => fromFlower ? { kind: 'flower' } : null, returnFromSettingsOrigin: returnToFlower, settingsFocusSeq: () => session.revision(), settingsFocusSection: () => session.target()?.section,
  openSettings: (section: string, target?: { resource?: string }) => session.open({ section: section as never, ...target }), bumpSettingsSeq: changes,
  createSettingsFlowerAdapter: async () => adapter,
};
vi.mock('../EnvContext', async original => ({ ...await original<object>(), useEnvContext: () => env }));
vi.mock('./EnvSettingsPageContext', async original => {
  const actual = await original<typeof import('./EnvSettingsPageContext')>();
  return { ...actual, EnvSettingsPageProvider: (props: { children: import('solid-js').JSX.Element }) => {
    const [searchQuery, setSearchQuery] = createSignal('');
    const settings = Object.defineProperties(() => ({ runtime: { agent_home_dir: '/workspace', shell: '/bin/zsh' } }), { loading: { get: loading }, error: { get: settingsError } });
    const value = { env, protocol: { status: () => 'connected' }, activeSection: () => session.target()?.section ?? 'appearance', setActiveSection: () => {}, searchQuery, setSearchQuery,
      settings, canAdmin: () => admin(), canInteract: () => !loading() && !settingsError(), refreshSettingsPage: refresh, } as unknown as EnvSettingsPageContextValue;
    return <actual.EnvSettingsPageCtx.Provider value={value}>{props.children}</actual.EnvSettingsPageCtx.Provider>;
  } };
});
vi.mock('./sections/ConnectionSection', () => ({ ConnectionSection: () => <p>Generic current connection</p> }));
vi.mock('../../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: async (url: string) => {
  if (url.endsWith('/storage')) return { entries: ['plugins', 'skills', 'flower', 'snapshots', 'task_files'].map(id => ({ id, path: `/environment/${id}`, kind: 'persistent', backup: 'environment', bytes: 1000, present: true, complete: true })) };
  if (url.includes('history-retention?')) return retention;
  if (url.includes('history-retention')) return { supported: true, can_manage: true, defaults: { max_lines: 1000, max_bytes: 1048576 } };
  throw new Error(`Unexpected settings request: ${url}`);
} }));
beforeEach(async () => { fromFlower = false; writeStoredLanguagePreference('en-US'); vi.spyOn(console, 'warn'); await page.viewport(1440, 1000); terminals.getLayout.mockResolvedValue(layout); terminals.stream.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))); });
afterEach(() => { dispose?.(); localStorage.clear(); document.body.replaceChildren(); window.history.replaceState({}, '', '/'); vi.clearAllMocks(); vi.restoreAllMocks(); });
function mount(section: 'terminal' | 'ai' | 'runtime' | 'extensions' | 'browser' | 'appearance' | 'storage') {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => {
    session = createSettingsSession({ history: true });
    [loading, setLoading] = createSignal(false);
    [settingsError, setSettingsError] = createSignal<Error | null>(null);
    [admin, setAdmin] = createSignal(true);
    if (!session.target()) session.open({ section });
    return <I18nProvider><FloeProvider><TerminalSettingsAttachmentsProvider><LiveTerminalFixture /><SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}><EnvSettingsDialog onOpenServiceCanvas={storageNavigation.canvas} onOpenPluginCenter={storageNavigation.plugins} session={session} panels={[]} onThemeSourceChange={() => true} onShellThemeChange={() => true} /></SettingsPanelContext.Provider></TerminalSettingsAttachmentsProvider></FloeProvider></I18nProvider>;
  }, host);
}
it('retries a failed generic settings read within the current domain category', async () => {
  mount('appearance');
  setSettingsError(new Error('Settings connection interrupted'));
  await expect.element(page.getByRole('alert')).toHaveTextContent('Settings connection interrupted');
  expect(document.querySelector('[data-floe-dialog-header] button[aria-label="Refresh"]')).toBeNull();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect.element(retry).toBeEnabled();
  refresh.mockImplementationOnce(async () => { setLoading(true); });
  await retry.click();
  expect(refresh).toHaveBeenCalledOnce();
  await expect.element(retry).toBeDisabled();
  setLoading(false); setSettingsError(null);
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
  expect(session.target()?.section).toBe('appearance');
});
it('dismisses from the backdrop without saving or losing a retained draft and restores focus', async () => {
  const opener = document.createElement('button'); opener.textContent = 'Open settings';
  const backgroundAction = vi.fn(); opener.addEventListener('click', backgroundAction);
  opener.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(opener); opener.focus();
  mount('terminal');
  await expect.poll(() => document.querySelector('[data-terminal-history-settings] input')).not.toBeNull();
  const field = document.querySelector<HTMLInputElement>('[data-terminal-history-settings] input')!;
  await userEvent.fill(field, '2345');
  expect(session.target()?.section).toBe('terminal');
  await userEvent.click(document.querySelector<HTMLElement>('.floe-floating-backdrop')!, { position: { x: 5, y: 100 } });
  await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(0);
  await expect.poll(() => document.activeElement).toBe(opener);
  expect(session.target()).toBeNull();
  expect(new URL(location.href).searchParams.has('settings')).toBe(false);
  expect(terminals.configure).not.toHaveBeenCalled();
  expect(backgroundAction).not.toHaveBeenCalled();
  session.open({ section: 'terminal' });
  await expect.poll(() => field.checkVisibility()).toBe(true);
  expect(document.querySelector('[data-terminal-history-settings] input')).toBe(field);
  expect(field.value).toBe('2345');
});
it('dismisses only the top nested dialog when its backdrop is clicked', async () => {
  mount('runtime');
  await page.getByRole('button', { name: 'Add Root', exact: true }).click();
  await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(2);
  const backdrops = [...document.querySelectorAll<HTMLElement>('.floe-floating-backdrop')];
  await userEvent.click(backdrops.at(-1)!, { position: { x: 5, y: 100 } });
  await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
  expect(session.target()?.section).toBe('runtime');
});
it.each([1440, 390])('places category navigation and close in one dialog header at %ipx', async width => {
  await page.viewport(width, 1000);
  const opener = document.createElement('button'); opener.textContent = 'Open settings';
  document.body.append(opener); opener.focus();
  mount('appearance');
  await expect.element(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  const dialog = document.querySelector<HTMLElement>('.redeven-unified-settings-dialog')!;
  const header = dialog.querySelector<HTMLElement>('[data-floe-dialog-header]')!;
  expect(dialog.querySelectorAll('[data-floe-dialog-header]')).toHaveLength(1);
  expect(header.querySelector('.redeven-settings-header')).not.toBeNull();
  expect(dialog.querySelector('[data-floe-dialog-body] .redeven-settings-header')).toBeNull();
  const refreshButton = header.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
  const closeButton = header.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
  expect(refreshButton).toBeNull(); expect(closeButton).not.toBeNull();
  expect(dialog.querySelectorAll(`#${CSS.escape(dialog.getAttribute('aria-labelledby')!)}`)).toHaveLength(1);
  expect(header.getBoundingClientRect().height).toBeLessThan(70);
  expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
  expect(closeButton.getBoundingClientRect().bottom).toBeLessThanOrEqual(header.getBoundingClientRect().bottom);
  if (width < 768) {
    await choose('Settings', 'Terminal');
    await expect.poll(() => session.target()?.section).toBe('terminal');
    await expect.element(page.getByRole('combobox', { name: 'Settings', exact: true })).toHaveTextContent('Terminal');
  } else {
    expect(header.querySelector('.redeven-settings-breadcrumb')!.textContent).toContain('Appearance & Language');
  }
  expect(refresh).not.toHaveBeenCalled();
  await userEvent.click(closeButton);
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(0);
  await expect.poll(() => document.activeElement).toBe(opener);
  session.open({ section: 'appearance' });
  await expect.poll(() => header.isConnected).toBe(true);
  expect(document.querySelector('[data-floe-dialog-header]')).toBe(header);
  expect(vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).includes('computations created outside'))).toHaveLength(0);
});
it.each([1440, 320])('fits a localized category and actions within the single header at %ipx', async width => {
  await page.viewport(width, 1000); writeStoredLanguagePreference('de-DE');
  mount('appearance');
  await expect.element(page.getByRole('dialog', { name: 'Einstellungen', exact: true })).toBeVisible();
  const header = document.querySelector<HTMLElement>('[data-floe-dialog-header]')!;
  const refreshButton = header.querySelector<HTMLElement>('button[aria-label="Aktualisieren"]')!;
  const closeButton = header.querySelector<HTMLElement>('button[aria-label="Schließen"]')!;
  expect(refreshButton).toBeNull(); expect(closeButton.checkVisibility()).toBe(true);
  expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
  expect(header.getBoundingClientRect().height).toBeLessThan(70);
  expect(closeButton.getBoundingClientRect().right).toBeLessThanOrEqual(header.getBoundingClientRect().right);
  if (width < 768) {
    const navigation = page.getByRole('combobox', { name: 'Einstellungen', exact: true });
    await expect.element(navigation).toHaveTextContent('Darstellung & Sprache');
    await navigation.click();
    await expect.element(page.getByRole('option', { name: 'Host-Anwendungen & Desktop', exact: true })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(session.target()?.section).toBe('appearance');
  } else {
    expect(header.querySelector('.redeven-settings-breadcrumb')!.textContent).toContain('Darstellung & Sprache');
  }
});
it('uses one close action without unrelated refresh or root back navigation', async () => {
  fromFlower = true; mount('appearance');
  await expect.element(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  const header = document.querySelector<HTMLElement>('[data-floe-dialog-header]')!;
  expect(header.querySelector('[aria-label="Back to Flower"]')).toBeNull();
  expect(header.querySelector('[aria-label="Refresh"]')).toBeNull();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(0);
  expect(returnToFlower).not.toHaveBeenCalled();
});
it('presents language, canvas and markdown as compact Floe setting rows', async () => {
  mount('appearance');
  await expect.element(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  const panel = document.querySelector('[data-testid="settings-section-appearance"]')!;
  expect(panel.querySelector('[data-envapp-language-menu="inline"]')).toBeNull();
  expect(panel.querySelectorAll('.floe-setting-row').length).toBeGreaterThanOrEqual(3);
  expect(panel.querySelector('h1')).toBeNull();
});
it('retains actual terminal history drafts across categories, invalid resources and browser history', async () => {
  mount('terminal');
  await expect.poll(() => document.querySelectorAll('[data-terminal-history-settings] input').length).toBe(2);
  const field = document.querySelector<HTMLInputElement>('[data-terminal-history-settings] input')!;
  await userEvent.fill(field, '2345');
  session.open({ section: 'appearance' }); session.open({ section: 'terminal' });
  await expect.poll(() => field.checkVisibility()).toBe(true);
  expect(document.querySelector('[data-terminal-history-settings] input')).toBe(field); expect(field.value).toBe('2345');
  session.open({ section: 'connection', resource: 'other-environment' });
  await expect.element(page.getByRole('alert')).toBeVisible(); expect(document.body.innerText).not.toContain('Generic current connection');
  window.history.back();
  await expect.poll(() => session.target()?.section).toBe('terminal');
  expect(document.querySelector('[data-terminal-history-settings] input')).toBe(field); expect(field.value).toBe('2345');
  window.history.forward(); await expect.poll(() => session.target()?.resource).toBe('other-environment');
  session.open({ section: 'terminal' }); expect(field.value).toBe('2345');
});
it('hides retained runtime root editors when the host closes and restores their drafts', async () => {
  mount('runtime');
  await page.getByRole('button', { name: 'Add Root', exact: true }).click();
  await page.getByPlaceholder('/path/to/folder').fill('/unsaved/root');
  session.close();
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(0);
  session.open({ section: 'runtime' });
  await expect.element(page.getByPlaceholder('/path/to/folder')).toHaveValue('/unsaved/root');
  await expect.element(page.getByPlaceholder('/path/to/folder')).toBeVisible();
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(2);
  expect([...document.querySelectorAll('[data-floe-dialog-mode]')].map(node => node.getAttribute('data-floe-dialog-mode'))).toEqual(['global', 'global']);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(1);
  expect(session.target()?.section).toBe('runtime');
});
it('hides extension portals on invalid targets and restores the original draft', async () => {
  mount('extensions');
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  await page.getByRole('textbox', { name: 'Endpoint URL', exact: true }).fill('https://draft.example.com/mcp');
  session.open({ section: 'extensions', resource: 'unsupported' });
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(1);
  await expect.element(page.getByRole('alert')).toBeVisible();
  session.open({ section: 'extensions' });
  await expect.element(page.getByRole('textbox', { name: 'Endpoint URL', exact: true })).toHaveValue('https://draft.example.com/mcp');
});
it('confirms a provider save exactly once while parent settings refreshes', async () => {
  mount('ai');
  await expect.poll(() => document.querySelectorAll('[role="radio"]').length).toBeGreaterThan(0);
  const readonly = document.querySelector<HTMLButtonElement>('[role="radio"]')!;
  await userEvent.click(readonly);
  await expect.poll(() => save.mock.calls.length).toBe(1);
  await expect.poll(() => changes.mock.calls.length).toBe(1);
  expect(loading()).toBe(true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it('restores a provider deep link, gates its nested portal and retains unsaved credentials', async () => {
  window.history.replaceState({}, '', '/?settings=ai&settings_resource=' + encodeURIComponent(JSON.stringify({ providerID: 'openai', modelName: '' })));
  mount('ai');
  await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(2);
  const input = document.querySelector<HTMLInputElement>('.flower-provider-dialog input[type="password"]')!;
  expect(input).not.toBeNull(); await userEvent.fill(input, 'unsaved-secret');
  session.open({ section: 'appearance' });
  await expect.poll(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(node => node.checkVisibility() && !node.inert).length).toBe(1);
  session.open({ section: 'ai' });
  await expect.poll(() => document.querySelector<HTMLInputElement>('.flower-provider-dialog input[type="password"]')?.value).toBe('unsaved-secret');
  session.close(); await expect.poll(() => document.querySelectorAll('[role="dialog"]').length).toBe(0);
});

it('revokes retained terminal history mutation authority without losing its draft', async () => {
  mount('terminal');
  await expect.poll(() => document.querySelectorAll('[data-terminal-history-settings] input').length).toBe(2);
  const field = document.querySelector<HTMLInputElement>('[data-terminal-history-settings] input')!;
  await userEvent.fill(field, '2345');
  const saveDefaults = page.getByRole('button', { name: 'Save for new sessions', exact: true });
  await expect.element(saveDefaults).toBeEnabled();
  setAdmin(false); await expect.element(saveDefaults).toBeDisabled();
  expect(field.value).toBe('2345');
  setAdmin(true); await expect.element(saveDefaults).toBeEnabled();
  expect(field.value).toBe('2345');
});

async function choose(label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
function visibleTerminalBody() {
  return [...document.querySelectorAll<HTMLElement>('.terminal-settings-body')].find(body => body.checkVisibility())!;
}
it('discovers terminal targets in the actual dialog without attaching, taking control or changing a widget', async () => {
  mount('terminal');
  await expect.element(page.getByRole('combobox', { name: 'Settings target', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Settings target', exact: true }).click();
  for (const name of ['Default preferences', 'Workspace terminal', 'Unattached terminal', 'Container shell', 'Workbench terminal 1']) {
    await expect.element(page.getByRole('option', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('option', { name: 'Unattached terminal', exact: true }).click();
  expect(session.target()?.resource).toBe(terminalSettingsResource({ kind: 'session', id: 'unattached' }));
  await expect.element(page.getByText('Attach this session in Terminal before changing its history limits. Viewing settings never takes terminal control.', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Apply to current session', exact: true })).toBeDisabled();
  await choose('Settings target', 'Workbench terminal 1');
  await expect.element(page.getByRole('combobox', { name: 'Session history', exact: true })).toBeVisible();
  expect(visibleTerminalBody().querySelector<HTMLElement>('.terminal-settings-preview')!.style.fontSize).toBe('14px');
  await choose('Session history', 'Workspace terminal');
  expect(session.target()?.resource).toBe(terminalSettingsResource({ kind: 'widget', id: 'widget-a', sessionId: 'session-a' }));
  await expect.element(page.getByRole('button', { name: 'Apply to current session', exact: true })).toBeEnabled();
  expect(terminals.attach).not.toHaveBeenCalled(); expect(terminals.takeover).not.toHaveBeenCalled(); expect(terminals.configure).not.toHaveBeenCalled(); expect(terminals.putWidget).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).includes('computations created outside'))).toHaveLength(0);
});

it('keeps separate native radio groups for retained terminal targets and updates their shared preference', async () => {
  mount('terminal');
  await expect.poll(() => visibleTerminalBody()?.querySelectorAll('input[type="radio"]').length ?? 0).toBeGreaterThan(1);
  const defaultsBody = visibleTerminalBody();
  const defaultsInput = defaultsBody.querySelector<HTMLInputElement>('input[type="radio"]')!;
  await choose('Settings target', 'Workbench terminal 1');
  const widgetBody = visibleTerminalBody();
  expect(widgetBody).not.toBe(defaultsBody);
  const widgetInput = widgetBody.querySelector<HTMLInputElement>('input[type="radio"]')!;
  expect(widgetInput.name).not.toBe(defaultsInput.name);
  await userEvent.click(widgetBody.querySelector('details[data-terminal-preview="theme"] summary')!);
  const theme = widgetBody.querySelector<HTMLInputElement>('input[type="radio"][value="monokai"]')!;
  await userEvent.click(theme.closest('label')!);
  expect(useTerminalPreferences().userTheme()).toBe('monokai');
  expect(widgetBody.querySelectorAll('input[type="radio"]:checked')).toHaveLength(1);
  expect(defaultsBody.querySelectorAll('input[type="radio"]:checked')).toHaveLength(1);
  expect(defaultsBody.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.value).toBe('monokai');
  await choose('Settings target', 'Default preferences');
  expect(visibleTerminalBody()).toBe(defaultsBody);
  expect(vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).includes('computations created outside'))).toHaveLength(0);
  expect(terminals.attach).not.toHaveBeenCalled(); expect(terminals.takeover).not.toHaveBeenCalled();
});

it.each([1440, 390])('makes browser cadence and Workbench appearance reachable in the same settings dialog at %ipx', async width => {
  await page.viewport(width, 1000);
  envComputerViewerFrameRate.write(5);
  writeWorkbenchTheme('workbench:local_preferences:one', 'mica');
  mount('browser');
  await expect.element(page.getByRole('combobox', { name: 'Frame rate', exact: true })).toBeVisible();
  await choose('Frame rate', '15 FPS');
  expect(envComputerViewerFrameRate.read()).toBe(15);
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  session.open({ section: 'appearance' });
  await expect.element(page.getByRole('combobox', { name: 'Workbench canvas theme', exact: true })).toBeVisible();
  await choose('Workbench canvas theme', 'Aurora');
  expect(readWorkbenchLocalPreferences('workbench:local_preferences:one').theme).toBe('aurora');
  writeWorkbenchTheme('workbench:local_preferences:one', 'midnight');
  await expect.element(page.getByRole('combobox', { name: 'Workbench canvas theme', exact: true })).toHaveTextContent('Midnight');
  envComputerViewerFrameRate.write(30);
  session.open({ section: 'browser' });
  await expect.element(page.getByRole('combobox', { name: 'Frame rate', exact: true })).toHaveTextContent('30 FPS');
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(width);
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(terminals.attach).not.toHaveBeenCalled(); expect(terminals.takeover).not.toHaveBeenCalled();
});

it('keeps storage overview separate and opens exact owner destinations', async () => {
  mount('storage');
  const panel = page.getByTestId('settings-section-storage');
  await expect.element(panel.getByRole('button', { name: 'Manage Application plugins' })).toBeVisible();
  expect(document.querySelector('.ai-readiness-settings')).toBeNull();
  await panel.getByRole('button', { name: 'Manage Application plugins' }).click();
  expect(storageNavigation.plugins).toHaveBeenCalledOnce();
  await panel.getByRole('button', { name: 'Manage Recovery snapshots' }).click();
  expect(session.target()?.section).toBe('flower_recovery');
  await expect.element(page.getByTestId('settings-section-flower_recovery')).toBeVisible();
  session.open({ section: 'storage' });
  await panel.getByRole('button', { name: 'Manage Task working files' }).click();
  expect(session.target()).toBeNull();
  expect(storageNavigation.files).toHaveBeenCalledWith('/environment/task_files');
});
