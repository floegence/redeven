import '../../../index.css';
import '../../flower-feature.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvSettingsDialog } from './EnvSettingsDialog';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import { settingsSnapshot } from '../../FlowerSurface.navigation.testHarness';
import type { EnvSettingsPageContextValue } from './EnvSettingsPageContext';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { agentPluginsFixture } from '../../flower/agentPluginsFixture';
let session: ReturnType<typeof createSettingsSession>;
let dispose: (() => void) | undefined;
let admin: () => boolean;
let setAdmin: (value: boolean) => void;
let loading: () => boolean;
let setLoading: (value: boolean) => void;
const changes = vi.fn();
const snapshot = settingsSnapshot();
const save = vi.fn(async () => { setLoading(true); return snapshot; });
const adapter = { loadSettings: async () => snapshot, canMutate: true, saveDefaultPermission: save, saveModelProfile: save, extensions: {
  canInteract: () => true, canAdmin: () => true, plugins: agentPluginsFixture(),
  listSkills: async () => ({ skills: [], catalog_version: 1 }), listSkillSources: async () => ({ items: [] }), listMCP: async () => ({ servers: [] }),
} };
const env = {
  env_id: () => 'one', flowerScopeKey: () => 'one:incarnation', env: () => ({ permissions: { can_admin: true, can_read: true, can_write: true, can_execute: true } }),
  settingsSeq: () => 0, settingsOrigin: () => null, settingsFocusSeq: () => session.revision(), settingsFocusSection: () => session.target()?.section,
  openSettings: (section: string) => session.open({ section: section as never }), bumpSettingsSeq: changes,
  createSettingsFlowerAdapter: async () => adapter,
};
vi.mock('../EnvContext', async original => ({ ...await original<object>(), useEnvContext: () => env }));
vi.mock('./EnvSettingsPageContext', async original => {
  const actual = await original<typeof import('./EnvSettingsPageContext')>();
  return { ...actual, EnvSettingsPageProvider: (props: { children: import('solid-js').JSX.Element }) => {
    const [searchQuery, setSearchQuery] = createSignal('');
    const settings = Object.assign(() => ({ runtime: { agent_home_dir: '/workspace', shell: '/bin/zsh' } }), { get loading() { return loading(); }, error: null });
    const value = { env, protocol: { status: () => 'connected' }, activeSection: () => session.target()?.section ?? 'appearance', setActiveSection: () => {}, searchQuery, setSearchQuery,
      settings, canAdmin: () => admin(), canInteract: () => !loading(), refreshSettingsPage: async () => {}, } as unknown as EnvSettingsPageContextValue;
    return <actual.EnvSettingsPageCtx.Provider value={value}>{props.children}</actual.EnvSettingsPageCtx.Provider>;
  } };
});
vi.mock('./sections/ConnectionSection', () => ({ ConnectionSection: () => <p>Generic current connection</p> }));
vi.mock('../../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: async (url: string) => {
  if (url.includes('history-retention')) return { supported: true, can_manage: true, defaults: { max_lines: 1000, max_bytes: 1048576 } };
  throw new Error(`Unexpected settings request: ${url}`);
} }));
afterEach(() => { dispose?.(); document.body.replaceChildren(); window.history.replaceState({}, '', '/'); vi.clearAllMocks(); });
function mount(section: 'terminal' | 'ai' | 'runtime' | 'extensions') {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => {
    session = createSettingsSession({ history: true });
    [loading, setLoading] = createSignal(false);
    [admin, setAdmin] = createSignal(true);
    if (!session.target()) session.open({ section });
    return <FloeProvider><SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}><EnvSettingsDialog session={session} panels={[]} renderPlugins={() => null} onThemeSourceChange={() => true} onShellThemeChange={() => true} /></SettingsPanelContext.Provider></FloeProvider>;
  }, host);
}
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
