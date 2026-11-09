import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createDesktopI18n } from '../shared/i18n';
import { DesktopSettingsDialog } from './DesktopSettingsDialog';
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog';
import { createEnvironmentSettingsController } from './environmentSettingsSession';
import { runtimeConnectionFixture } from '../testSupport/runtimeConnectionFixture';
import { SettingsPanelContext, type SettingsPanelRegistration } from '../../../internal/settings_ui/src/SettingsPanelHost';
import { createSettingsSession } from '../../../internal/settings_ui/src/settingsSession';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('retargets the canonical connection form, preserves locale drafts and cancels the exact opening on close', async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); HTMLElement.prototype.scrollIntoView = vi.fn();
  const a = runtimeConnectionFixture({ kind: 'ssh_environment' }).snapshot.environments.find(entry => entry.kind === 'ssh_environment' && entry.can_edit)!;
  const b = { ...a, id: 'environment-b', label: 'Environment B' };
  const closed = vi.fn(); const adapter = vi.fn();
  let session!: ReturnType<typeof createSettingsSession>;
  let controller!: ReturnType<typeof createEnvironmentSettingsController<string>>;
  let locale!: (value: 'en-US' | 'zh-CN') => void;
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => {
    session = createSettingsSession();
    controller = createEnvironmentSettingsController<string>({ load: async () => ({ ok: false, error: 'unused' }), save: async () => ({ ok: false, error: 'unused' }), closed, lateError: () => undefined });
    const [panels, setPanels] = createSignal<readonly SettingsPanelRegistration[]>([]);
    const [language, setLanguage] = createSignal<'en-US' | 'zh-CN'>('en-US'); locale = setLanguage;
    const registry = { ...session, register: (entry: SettingsPanelRegistration) => { setPanels(items => [...items, entry]); return () => setPanels(items => items.filter(item => item !== entry)); } };
    return <FloeProvider><SettingsPanelContext.Provider value={registry}>
      <EnvironmentSettingsDialog open={!!controller.session()} environment={controller.session()?.environment ?? null} tab="connection" i18n={createDesktopI18n(language())}
        onClose={controller.close} onTabChange={() => undefined} connection={<input aria-label="Connection draft" />} access={null} />
      <DesktopSettingsDialog session={session} panels={panels()} i18n={createDesktopI18n(language())} flowerScope="" available={false} createFlowerAdapter={adapter} changed={() => undefined} appearance={() => <input aria-label="Appearance draft" />} connections={() => <span>Connection list</span>} />
    </SettingsPanelContext.Provider></FloeProvider>;
  }, host);
  controller.open(a, 'a'); await vi.waitFor(() => expect(document.querySelector('[aria-label="Connection draft"]')).not.toBeNull());
  const input = document.querySelector<HTMLInputElement>('[aria-label="Connection draft"]')!; input.value = 'unsaved';
  const token = controller.session()!.token; locale('zh-CN');
  expect(document.querySelector('[aria-label="Connection draft"]')).toBe(input); expect(input.value).toBe('unsaved');
  session.open({ section: 'appearance' }); session.open({ section: 'connection', resource: a.id });
  expect(document.querySelector('[aria-label="Connection draft"]')).toBe(input);
  controller.open(b, 'b'); await vi.waitFor(() => expect(session.target()?.resource).toBe(b.id));
  expect(closed).toHaveBeenCalledWith(token); expect(document.body.textContent).toContain('Environment B');
  const nextToken = controller.session()!.token; session.close(); await vi.waitFor(() => expect(controller.session()).toBeNull());
  expect(closed).toHaveBeenCalledWith(nextToken);
  session.open({ section: 'browser', resource: 'removed-thread' });
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
  expect(adapter).not.toHaveBeenCalled();
});

it('gives appearance one dialog identity and no separate scope strip', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const host = document.createElement('div'); document.body.append(host);
  const session = createSettingsSession();
  dispose = render(() => <FloeProvider><DesktopSettingsDialog session={session} panels={[]} i18n={createDesktopI18n('en-US')}
    flowerScope="local" available={false} createFlowerAdapter={vi.fn()} changed={() => undefined}
    appearance={() => <span data-appearance-content />} connections={() => <span />} /></FloeProvider>, host);
  session.open({ section: 'appearance' });
  await vi.waitFor(() => expect(document.querySelector('[data-appearance-content]')).not.toBeNull());
  expect(document.querySelector('.floe-settings-navigation__item[aria-current]')?.textContent).toBe('Appearance & Language');
  const groups = [...document.querySelectorAll('.floe-settings-navigation__group')];
  expect(groups).toHaveLength(2);
  expect(groups[1].querySelector('.floe-settings-navigation__label')?.textContent).toBe('Flower');
  expect([...groups[1].querySelectorAll('button')].map(node => node.textContent)).toEqual(['Flower Settings', 'Extensions', 'Browser and desktop']);
  expect(document.querySelector('.redeven-unified-settings-dialog-header')?.textContent).toContain('Appearance & Language');
  document.querySelector<HTMLButtonElement>('.redeven-settings-dialog-mobile [role=combobox]')!.click();
  await vi.waitFor(() => expect(document.querySelectorAll('[role=listbox]')).toHaveLength(1));
  const revision = session.revision();
  const option = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(node => node.textContent?.trim() === 'Environment settings')!;
  option.click();
  expect(session.target()?.section).toBe('connection');
  expect(session.revision()).toBe(revision + 1);
  session.open({ section: 'browser' });
  expect(document.querySelector('.redeven-unified-settings-dialog-root')?.textContent).not.toContain('Local Environment');
});
