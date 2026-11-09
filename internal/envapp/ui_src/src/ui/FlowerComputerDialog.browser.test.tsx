import { controlText } from '../testSupport/controlText';
import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Show, createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { FlowerComputerConnections } from '../../../../flower_ui/src/FlowerComputerConnections';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
import deDE from './i18n/locales/catalogs/de-DE.json';
import zhTW from './i18n/locales/catalogs/zh-TW.json';
import { computerUseEnUS as copy, type FlowerComputerCopy } from '../../../../flower_ui/src/computerUseCopy';
import type { FlowerManagedProfile, FlowerComputerAccess, FlowerComputerCapability, FlowerComputerEnvironment } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { SettingsPanelContext, type SettingsPanelRegistration } from '../../../../settings_ui/src/SettingsPanelHost';
import type { SettingsTarget } from '../../../../settings_ui/src/settingsSession';

let dispose: (() => void) | undefined;
afterEach(async () => { dispose?.(); dispose = undefined; document.documentElement.classList.remove('dark'); await page.viewport(1280, 720); });
const waitFor = async (predicate: () => boolean) => {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 3000 });
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => controlText(item) === text)!;
const environment: FlowerComputerEnvironment = { hostname: 'Work Mac', platform: 'darwin', managed: { state: 'on_demand' }, desktop: { state: 'permission_required', reason: 'screen_recording_required' }, chrome: { installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [] } };
function mount(options: { current?: string; fullAccess?: boolean; readonly?: boolean; connectionOnly?: boolean; embedded?: boolean; installationOnly?: boolean; desktopSetup?: boolean; copy?: FlowerComputerCopy; environment?: FlowerComputerEnvironment } = {}) {
  const management = {
    loadEnvironment: vi.fn().mockResolvedValue(options.environment ?? environment),
    verifyDesktop: vi.fn<() => Promise<FlowerComputerCapability>>().mockResolvedValue({ state: 'ready' }),
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: options.current ?? 'lost-page', candidates: [
      { candidate_ref: 'next', target_id: 'next-page', kind: 'browser.connected', display_name: 'Work', title: 'Existing draft', state: 'ready', url: 'https://example.test' },
      { candidate_ref: 'window', target_id: 'notes', kind: 'desktop.window', display_name: 'Notes — Project', app_bundle_id: 'dev.fixture.Notes', state: 'ready' },
      { candidate_ref: 'private', target_id: 'xvfb-main', kind: 'xvfb.desktop', display_name: 'Private desktop', state: 'stopped' },
    ] }),
    selectCandidate: vi.fn().mockResolvedValue({ id: 'next-page', kind: 'browser.connected', display_name: 'Work', ready: true }),
    discoverBrowser: vi.fn(),
    loadAccess: vi.fn<(thread: string) => Promise<FlowerComputerAccess>>().mockResolvedValue({ origins: [], apps: [], allow_foreground: false }), saveAccess: vi.fn(),

    listManagedProfiles: vi.fn<() => Promise<FlowerManagedProfile[]>>().mockResolvedValue([{ id: 'browser-main', name: 'Default' }]),
    manageBrowserProfile: vi.fn(),
    createManagedProfile: vi.fn().mockResolvedValue([{ id: 'browser-main', name: 'Default' }, { id: 'work', name: 'Work' }]),
    setupExtension: vi.fn(), openExtension: vi.fn(), loadExtensionStatus: vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [] }),
  };
  const [thread, setThread] = createSignal('thread');
  const [open, setOpen] = createSignal(true);
  const onContinue = vi.fn().mockResolvedValue(undefined);
  const onInstallDesktopWithFlower = vi.fn().mockResolvedValue(undefined);
  const editPermission = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections embedded={options.embedded} installationOnly={options.installationOnly} desktopSetup={options.desktopSetup} open={open()} fullAccess={options.fullAccess} threadID={thread()} onOpenChange={setOpen}
    connectionOnly={options.connectionOnly} onContinue={onContinue} onInstallDesktopWithFlower={onInstallDesktopWithFlower} onEditPermissionMode={editPermission}
    requested={{ origin: 'https://example.com', app: 'dev.fixture.Notes', foreground: true }}
    adapter={{ runtime: { display_name: 'Test environment', runtime_id: 'test', runtime_kind: 'env_local', carrier_kind: 'server', subtitle: '' }, canMutate: !options.readonly, computerManagement: management }} copy={options.copy ?? copy} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  return { management, setThread, setOpen, onContinue, onInstallDesktopWithFlower, editPermission, host };
}
async function ready() { await waitFor(() => !!button(copy.browserSettings) && !button(copy.browserSettings).disabled); }

it('embeds browser settings without extra outer padding or a category-root Back action', async () => {
  const { host } = mount({ embedded: true }); await ready();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(button(copy.back)).toBeUndefined();
  expect(getComputedStyle(host.querySelector<HTMLElement>('.flower-computer-content')!).padding).toBe('0px');
  await userEvent.click(button(copy.manage));
  const navigation = host.querySelector<HTMLElement>('[data-computer-subpage-navigation]')!;
  expect(navigation).not.toBeNull();
  expect(navigation.querySelector('h3')?.textContent).toBe(copy.chromeTitle);
  expect(navigation.compareDocumentPosition(host.querySelector('[data-flower-computer-panel]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(button(copy.setupChrome));
  await userEvent.click(button(copy.back));
  expect(host.querySelector('[data-flower-computer-panel]')?.getAttribute('data-flower-computer-panel')).toBe('chrome');
  await userEvent.click(button(copy.back));
  expect(host.querySelector('[data-flower-computer-panel]')?.getAttribute('data-flower-computer-panel')).toBe('overview');
  expect(button(copy.back)).toBeUndefined();
});

it.each([{ installationOnly: true }, { desktopSetup: true }])('omits misleading Back actions at embedded focused roots: %j', async focused => {
  const { host } = mount({ embedded: true, ...focused });
  await waitFor(() => !!host.querySelector('[data-flower-computer-panel]'));
  expect(button(copy.back)).toBeUndefined();
  expect(host.querySelector('[data-computer-subpage-navigation]')).toBeNull();
});

it('uses embedded presentation when a contextual setup is registered with the Settings host', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [target, setTarget] = createSignal<SettingsTarget | null>(null);
  const [entry, setEntry] = createSignal<SettingsPanelRegistration>();
  const close = vi.fn();
  const stop = render(() => <FloeConfigProvider><LayoutProvider><SettingsPanelContext.Provider value={{
    open: setTarget, close, target, present: () => true, register: value => { setEntry(value); return () => setEntry(undefined); },
  }}><FlowerComputerConnections open installationOnly threadID="thread" onOpenChange={close} copy={copy}
    adapter={{ runtime: { display_name: 'Test environment', runtime_id: 'test', runtime_kind: 'env_local', carrier_kind: 'server', subtitle: '' }, canMutate: true }} />
    <Show when={entry()}>{current => current().render()}</Show>
  </SettingsPanelContext.Provider></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!host.querySelector('[data-flower-computer-panel]'));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(button(copy.back)).toBeUndefined();
  expect(getComputedStyle(host.querySelector<HTMLElement>('.flower-computer-content')!).padding).toBe('0px');
  expect(close).not.toHaveBeenCalled();
});

for (const width of [1000, 390]) {
  it(`hands missing Ubuntu desktop components to Flower at ${width}px`, async () => {
    await page.viewport(width, 800);
    const labels = zhCN.flowerSurface.computer;
    const command = 'sudo apt-get install --reinstall --no-install-recommends --no-remove openbox xdotool imagemagick-7.q16';
    const missing: FlowerComputerEnvironment = { ...environment, hostname: 'udesk26', platform: 'linux', desktop: { state: 'setup_required', reason: 'window_manager_missing', repair: 'ubuntu_apt', setup_command: command,
      components: [{ id: 'window_manager', path: '/usr/bin/openbox' }, { id: 'x11_input', path: '/usr/bin/xdotool' }, { id: 'x11_capture', path: '/usr/bin/import' }] } };
    const { management, onInstallDesktopWithFlower, setOpen } = mount({ copy: labels, environment: missing });
    await waitFor(() => !!button(labels.details) && !button(labels.details).disabled);
    button(labels.details).click();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.innerText).toContain('/usr/bin/openbox');
    expect(dialog.innerText).toContain('/usr/bin/xdotool');
    expect(dialog.innerText).toContain('/usr/bin/import');
    expect(dialog.innerText).not.toContain(command);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/desktop-missing-${width}.png` });
    button(labels.desktopInstallWithFlower).click();
    await waitFor(() => onInstallDesktopWithFlower.mock.calls.length === 1);
    expect(onInstallDesktopWithFlower).toHaveBeenCalledWith(missing);
    expect(management.verifyDesktop).not.toHaveBeenCalled();
    expect(button(labels.desktopVerify)).toBeUndefined();
    await waitFor(() => !document.querySelector('[role="dialog"]'));
    management.loadEnvironment.mockResolvedValue({ ...missing, desktop: { state: 'on_demand' } });
    setOpen(true);
    await waitFor(() => !!button(labels.details) && !button(labels.details).disabled);
    button(labels.details).click();
    await waitFor(() => !!button(labels.desktopVerify));
    const repairedDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(management.verifyDesktop).not.toHaveBeenCalled();
    button(labels.desktopVerify).click();
    await waitFor(() => repairedDialog.innerText.includes(labels.desktopVerified));
    expect(management.verifyDesktop).toHaveBeenCalledTimes(1);
    expect(management.selectCandidate).not.toHaveBeenCalled();
    expect(repairedDialog.scrollWidth).toBeLessThanOrEqual(repairedDialog.clientWidth + 1);
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: repairedDialog, path: `__screenshots__/desktop-setup-${width}.png` });
  });
}

it('offers Flower help for custom paths and other systems and keeps verification failures distinct', async () => {
  const custom: FlowerComputerEnvironment = { ...environment, platform: 'linux', desktop: { state: 'setup_required', reason: 'x11_input_missing', repair: 'custom_path', components: [{ id: 'x11_input', path: '/custom/xdotool', overridden: true }] } };
  const { management } = mount({ environment: custom });
  await ready(); button(copy.details).click();
  expect(button(copy.desktopInstallWithFlower)).toBeTruthy();
  management.loadEnvironment.mockResolvedValue({ ...custom, desktop: { ...custom.desktop, repair: 'unsupported_platform' } });
  button(copy.refresh).click(); await waitFor(() => management.loadEnvironment.mock.calls.length === 2 && !button(copy.refresh).disabled);
  management.loadEnvironment.mockResolvedValue({ ...custom, desktop: { state: 'on_demand' } });
  button(copy.refresh).click(); await waitFor(() => !!button(copy.desktopVerify));
  management.verifyDesktop.mockResolvedValueOnce({ state: 'in_use', reason: 'desktop_in_use' }).mockResolvedValueOnce({ state: 'setup_required', reason: 'atspi_connection_failed' });
  button(copy.desktopVerify).click(); await waitFor(() => document.body.textContent?.includes(copy.desktopVerifyInUse) === true && !button(copy.desktopVerify)?.disabled);
  button(copy.desktopVerify).click(); await waitFor(() => document.body.textContent?.includes(copy.desktopVerifyFailed) === true);
  expect(document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${copy.diagnostics}"]`)?.value).toContain('atspi_connection_failed');
});

it('keeps diagnostics open after a failed Flower handoff and permits retry', async () => {
  const { onInstallDesktopWithFlower, onContinue } = mount({ environment: { ...environment, platform: 'linux', desktop: { state: 'setup_required' } } });
  onInstallDesktopWithFlower.mockRejectedValueOnce(new Error('Handler unavailable'));
  await ready(); button(copy.details).click();
  button(copy.desktopInstallWithFlower).click();
  await waitFor(() => document.body.textContent?.includes(copy.desktopRepairUnavailable) === true && !button(copy.desktopInstallWithFlower)?.disabled);
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  button(copy.desktopInstallWithFlower).click();
  await waitFor(() => !document.querySelector('[role="dialog"]'));
  expect(onInstallDesktopWithFlower).toHaveBeenCalledTimes(2);
  expect(onContinue).not.toHaveBeenCalled();
});

it('does not install desktop components through a read-only connection', async () => {
  const { onInstallDesktopWithFlower } = mount({ readonly: true, environment: { ...environment, platform: 'linux', desktop: { state: 'setup_required' } } });
  await waitFor(() => !!button(copy.details)); button(copy.details).click();
  expect(button(copy.desktopInstallWithFlower).disabled).toBe(true);
  button(copy.desktopInstallWithFlower).click();
  expect(onInstallDesktopWithFlower).not.toHaveBeenCalled();
});

for (const width of [1000, 390]) {
  it(`shows the actual Chrome blocker once above the unchanged installation guide at ${width}px`, async () => {
    await page.viewport(width, 850);
    document.documentElement.classList.add('dark');
    const localized = zhCN.flowerSurface.computer;
    const chrome = { installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [], hostname: 'udesk26', platform: 'linux', browser_installed: true,
      diagnostic: { stage: 'open' as const, reason: 'desktop_session_unavailable' } };
    const { management } = mount({ copy: localized, environment: { ...environment, hostname: 'udesk26', platform: 'linux', chrome } });
    await waitFor(() => !!button(localized.browserSettings) && !button(localized.browserSettings).disabled);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const card = [...dialog.querySelectorAll('section')].find(item => item.querySelector('h4')?.textContent === localized.chromeTitle)!;
    card.querySelector('button')!.click();
    expect(dialog.innerText).toContain(localized.chromeDesktopTitle);
    expect(dialog.innerText).toContain(localized.chromeBrowserDetected);
    expect(dialog.innerText).not.toContain(localized.pairingPersistence);
    expect(management.setupExtension).not.toHaveBeenCalled();
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/chrome-readiness-overview-${width}.png` });
    management.loadExtensionStatus.mockResolvedValue(chrome);
    management.setupExtension.mockResolvedValue({ extension_path: '/home/tang/Redeven/Flower Browser fixture', extension_home_path: ['Redeven', 'Flower Browser fixture'], platform: 'linux', extension_id: 'fixture', native_host: 'fixture.host' });
    button(localized.setupChrome).click();
    await waitFor(() => !!button(localized.setupInstalled));
    expect(dialog.innerText.match(/udesk26/gu)).toHaveLength(1);
    const readiness = dialog.querySelector<HTMLElement>('[data-chrome-readiness]')!;
    expect(readiness.innerText).toContain(localized.chromeDesktopTitle);
    expect(readiness.getBoundingClientRect().height).toBeLessThan(260);
    expect(dialog.innerText).toContain(localized.setupDeveloperMode);
    expect(dialog.innerText).toContain(localized.setupDragTitle);
    expect(dialog.querySelector('.flower-chrome-install-action[data-action="folder"]')?.textContent).toContain('Flower Browser fixture');
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/chrome-readiness-setup-${width}.png` });
  });
}

it('uses Chromium identity and aligned full-row capability actions', async () => {
  await page.viewport(1100, 900);
  mount(); await ready();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
  const rows = [...document.querySelectorAll<HTMLElement>('.flower-computer-capability')];
  expect(rows).toHaveLength(3);
  expect(rows[0].querySelector('[data-computer-brand="chromium"]')).toBeTruthy();
  expect(rows[1].querySelector('[data-computer-brand="chrome"]')).toBeTruthy();
  const states = rows.map(row => row.querySelector<HTMLElement>('.flower-computer-status')!);
  const stateBounds = states.map(state => state.getBoundingClientRect());
  expect(Math.max(...stateBounds.map(rect => rect.left)) - Math.min(...stateBounds.map(rect => rect.left))).toBeLessThan(1);
  for (const [index, row] of rows.entries()) {
    const action = row.querySelector<HTMLButtonElement>('button')!;
    const bounds = row.getBoundingClientRect();
    const actionBounds = action.getBoundingClientRect();
    expect(actionBounds.width).toBeCloseTo(bounds.width, 0);
    expect(Math.abs(actionBounds.height - bounds.height)).toBeLessThanOrEqual(1);
    expect(getComputedStyle(action).cursor).toBe('pointer');
    expect(getComputedStyle(states[index]).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(Math.abs(stateBounds[index].top + stateBounds[index].height / 2 - (bounds.top + bounds.height / 2))).toBeLessThan(1);
  }
  await userEvent.keyboard('{Tab}'); button(copy.browserSettings).focus();
  expect(button(copy.browserSettings).matches(':focus-visible')).toBe(true);
  expect(getComputedStyle(button(copy.browserSettings)).outlineStyle).toBe('solid');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => document.querySelector('[data-flower-computer-panel]')?.getAttribute('data-flower-computer-panel') === 'managed');
  expect(document.querySelector('.flower-computer-title [data-computer-brand="chromium"]')).toBeTruthy();
  button(copy.back).click();
  await userEvent.click(button(copy.manage));
  expect(document.querySelector('[data-flower-computer-panel]')?.getAttribute('data-flower-computer-panel')).toBe('chrome');
  button(copy.back).click();
  button(copy.details).focus();
  await userEvent.keyboard(' ');
  expect(document.querySelector('[data-flower-computer-panel]')?.getAttribute('data-flower-computer-panel')).toBe('diagnostics');
});

it('keeps conversation state out of settings without changing the selection', async () => {
  const { management } = mount();
  await ready();
  expect(button(copy.switchTarget)).toBeUndefined();
  expect(button(copy.advanced)).toBeUndefined();
  expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  expect(document.querySelector('.flower-computer-selection')).toBeNull();
  expect(document.body.textContent).not.toContain(copy.currentMissing);
  expect(document.body.textContent).not.toContain(copy.automaticHint);
  expect(document.body.textContent).toContain('Work Mac');
  expect(document.body.textContent).toContain(copy.chromeOffline);
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(management.discoverBrowser).not.toHaveBeenCalled();
  expect(management.loadAccess).not.toHaveBeenCalled();
  expect(management.listCandidates).not.toHaveBeenCalled();
});
it('returns a remote user to chat without selecting a replacement or resuming a task', async () => {
  const { management, onContinue } = mount(); await ready();
  expect(document.body.textContent).not.toContain(copy.currentMissingHint);
  await page.getByRole('button', { name: copy.close, exact: true }).click();
  await waitFor(() => !document.querySelector('[data-flower-computer-panel]'));
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(management.createManagedProfile).not.toHaveBeenCalled();
  expect(onContinue).not.toHaveBeenCalled();
});

it('explains the headless browser before offering optional account groups', async () => {
  const { management } = mount(); await ready(); button(copy.browserSettings).click();
  await waitFor(() => !!document.querySelector('details'));
  expect(management.listManagedProfiles).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(copy.managedModeValue);
  expect(document.body.textContent).not.toContain('Default');
  const details = document.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('form')!.checkVisibility()).toBe(false);
  (details.querySelector('summary') as HTMLElement).click();
  await waitFor(() => management.listManagedProfiles.mock.calls.length === 1 && !document.querySelector('[aria-busy="true"]'));
  expect(details.textContent).toContain(copy.profileDefault);
  expect(getComputedStyle(details.querySelector('.flower-computer-profile-card')!).fontSize).toBe('12px');
  expect(details.textContent).toContain(copy.profileIsolationHint);
  expect(management.createManagedProfile).not.toHaveBeenCalled();
});
it('saves grants only on explicit confirmation without selecting a target', async () => {
  const { management } = mount({ current: '' });
  await ready(); button(copy.permissions).click();
  await waitFor(() => !!button(copy.grantRequested) && !button(copy.grantRequested).disabled);
  button(copy.grantRequested).click(); expect(management.saveAccess).not.toHaveBeenCalled();
  button(copy.save).click();
  await waitFor(() => management.saveAccess.mock.calls.length === 1);
  expect(management.saveAccess).toHaveBeenCalledWith('thread', { origins: ['https://example.com'], apps: ['dev.fixture.Notes'], allow_foreground: true });
  await waitFor(() => !button(copy.revokeAll).disabled); button(copy.revokeAll).click();
  await waitFor(() => management.saveAccess.mock.calls.length === 2);
  expect(management.saveAccess).toHaveBeenLastCalledWith('thread', { origins: [], apps: [], allow_foreground: false });
  expect(management.selectCandidate).not.toHaveBeenCalled();
});
it('discards late access results across threads and still permits read-only inspection', async () => {
  const { management, setThread } = mount({ readonly: true });
  let finish!: (access: FlowerComputerAccess) => void;
  management.loadAccess.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => !!button(copy.permissions) && !button(copy.permissions).disabled);
  button(copy.permissions).click(); await waitFor(() => !!finish);
  management.loadAccess.mockResolvedValue({ origins: ['https://second.test'], apps: [], allow_foreground: false });
  setThread('second');
  await waitFor(() => !!button(copy.permissions) && !button(copy.permissions).disabled);
  button(copy.permissions).click();
  await waitFor(() => document.body.textContent?.includes('https://second.test') === true);
  finish({ origins: ['https://first.test'], apps: [], allow_foreground: true });
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.body.textContent).not.toContain('https://first.test');
  expect(button(copy.save).disabled).toBe(true);
  expect(management.saveAccess).not.toHaveBeenCalled();
});
it('creates separate managed profiles without connecting a page or changing grants', async () => {
  const { management } = mount(); await ready();
  button(copy.browserSettings).click(); await waitFor(() => !!document.querySelector('summary'));
  await waitFor(() => !button(copy.createProfile).closest('form')?.querySelector('input')?.disabled);
  (document.querySelector('summary') as HTMLElement).click();
  await waitFor(() => management.listManagedProfiles.mock.calls.length === 1 && !document.querySelector('[aria-busy="true"]'));
  const input = document.querySelector<HTMLInputElement>('form input')!;
  input.value = 'Work'; input.dispatchEvent(new Event('input', { bubbles: true }));
  button(copy.createProfile).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => management.createManagedProfile.mock.calls.length === 1);
  expect(management.createManagedProfile).toHaveBeenCalledWith('Work');
  expect(management.selectCandidate).not.toHaveBeenCalled(); expect(management.saveAccess).not.toHaveBeenCalled();
  expect(document.querySelector('select')).toBeNull();
});
it('keeps full access separate from system permission and uses the existing mode editor', async () => {
  const { editPermission } = mount({ fullAccess: true }); await ready();
  expect(document.body.textContent).toContain(copy.permissionRequired);
  button(copy.permissions).click();
  expect(document.body.textContent).toContain(copy.fullAccessHint);
  expect(document.querySelector('input[type="url"]')).toBeNull();
  expect(button(copy.save)).toBeUndefined();
  await waitFor(() => !button(copy.editPermissions).disabled);
  button(copy.editPermissions).click(); expect(editPermission).toHaveBeenCalledTimes(1);
});
it('only refreshes diagnostics and never creates profiles or configures Chrome', async () => {
  const { management } = mount(); await ready();
  button(copy.details).click(); button(copy.refresh).click();
  await waitFor(() => management.loadEnvironment.mock.calls.length === 2);
  expect(document.body.textContent).toContain(copy.desktopPermissionHint);
  expect(management.setupExtension).not.toHaveBeenCalled();
  expect(management.createManagedProfile).not.toHaveBeenCalled();
  expect(management.selectCandidate).not.toHaveBeenCalled();
});

it('does not resume another conversation when a Chrome guide finishes late', async () => {
  const { management, setThread, onContinue, setOpen } = mount({ connectionOnly: true });
  let finish!: (value: unknown) => void;
  management.loadExtensionStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => !!finish);
  setThread('second'); setOpen(false);
  finish({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'late', name: 'Chrome' }] });
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(onContinue).not.toHaveBeenCalled();
});

for (const [locale, localizedCopy, width, dark] of [
  ['en-US', copy, 1000, false], ['zh-CN', zhCN.flowerSurface.computer, 1000, true],
  ['de-DE', deDE.flowerSurface.computer, 390, false], ['zh-TW', zhTW.flowerSurface.computer, 390, true],
] as const) {
  it(`keeps the real ${locale} dialog readable at ${width}px`, async () => {
    await page.viewport(width, 800);
    document.documentElement.classList.toggle('dark', dark);
    const { management } = mount({ copy: localizedCopy });
    await waitFor(() => !!button(localizedCopy.browserSettings) && !button(localizedCopy.browserSettings).disabled);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
    expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    expect(dialog.textContent).toContain(localizedCopy.chromeOffline);
    expect(button(localizedCopy.confirmTarget)).toBeUndefined();
    expect(management.selectCandidate).not.toHaveBeenCalled();
    const capabilities = [...dialog.querySelectorAll<HTMLElement>('.flower-computer-capability')];
    const bounds = capabilities.map(item => item.getBoundingClientRect());
    expect(bounds).toHaveLength(3);
    for (const capability of capabilities) {
      expect(capability.scrollWidth).toBeLessThanOrEqual(capability.clientWidth + 1);
      expect(capability.querySelector('button')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(width < 480 ? 44 : 32);
      const status = capability.querySelector<HTMLElement>('.flower-computer-status')!;
      expect(getComputedStyle(status).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      if (width < 480) {
        const text = capability.querySelector('.flower-computer-capability-copy')!.getBoundingClientRect();
        expect(status.getBoundingClientRect().left).toBeCloseTo(text.left, 0);
        expect(status.getBoundingClientRect().top).toBeGreaterThanOrEqual(text.bottom);
      }
    }
    const chevrons = capabilities.map(item => item.querySelector('.flower-computer-capability-chevron')!.getBoundingClientRect());
    expect(Math.max(...chevrons.map(rect => rect.right)) - Math.min(...chevrons.map(rect => rect.right))).toBeLessThan(1);
    expect(Math.max(...bounds.map(rect => rect.width)) - Math.min(...bounds.map(rect => rect.width))).toBeLessThan(1);
    expect(bounds[1].top).toBeGreaterThanOrEqual(bounds[0].bottom - 1);
    expect(bounds[2].top).toBeGreaterThanOrEqual(bounds[1].bottom - 1);
    expect(dialog.querySelector('.flower-computer-selection')).toBeNull();
    expect(dialog.querySelector('[data-computer-brand="apple"]')).toBeTruthy();
    expect(dialog.querySelector('[data-computer-brand="chrome"]')).toBeTruthy();
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') {
      await page.screenshot({ element: dialog, path: `__screenshots__/flower-computer-${locale}-${width}.png` });
    }
    expect(button(localizedCopy.switchTarget)).toBeUndefined();
    expect(button(localizedCopy.advanced)).toBeUndefined();
    expect(management.listCandidates).not.toHaveBeenCalled();
  });
}

it('keeps the connected overview and its settings pages balanced in Chinese', async () => {
  await page.viewport(1100, 900);
  const localizedCopy = zhCN.flowerSurface.computer;
  mount({ fullAccess: true, copy: localizedCopy, environment: { ...environment, hostname: 'MacBook-Pro.local', desktop: { state: 'ready' }, chrome: { installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'chrome', name: 'Chrome' }] } } });
  await waitFor(() => !!button(localizedCopy.browserSettings) && !button(localizedCopy.browserSettings).disabled);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
  expect(dialog.textContent).toContain(localizedCopy.connected);
  expect(dialog.textContent).toContain(localizedCopy.available);
  const content = dialog.querySelector<HTMLElement>('.flower-computer-content')!;
  expect(content.getBoundingClientRect().width).toBeGreaterThan(dialog.clientWidth * 0.9);
  const screenshot = async (name: string) => {
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-computer-polish-${name}.png` });
  };
  await screenshot('zh-CN-overview');
  for (const [name, action] of [['managed', localizedCopy.browserSettings], ['diagnostics', localizedCopy.details], ['help', localizedCopy.help], ['access', localizedCopy.permissions]] as const) {
    button(action).click();
    await waitFor(() => document.querySelector('[data-flower-computer-panel]')?.getAttribute('aria-busy') === 'false');
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    await screenshot(`zh-CN-${name}`);
    button(localizedCopy.back).click();
  }
  const chromeCard = [...dialog.querySelectorAll('section')].find(item => item.querySelector('h4')?.textContent === localizedCopy.chromeTitle)!;
  chromeCard.querySelector('button')!.click();
  await screenshot('zh-CN-chrome');
});
it('keeps narrow settings pages and long resource names inside their scroll viewport', async () => {
  await page.viewport(390, 720);
  const localizedCopy = deDE.flowerSurface.computer;
  const { management } = mount({ copy: localizedCopy, environment: { ...environment, hostname: 'runtime-with-a-long-workspace-and-device-name.example.test', chrome: { installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'work', name: 'Work-profile-with-a-long-unbroken-name-for-layout-qualification' }] } } });
  management.listManagedProfiles.mockResolvedValue([{ id: 'work', name: 'Work-profile-with-a-long-unbroken-name-for-layout-qualification' }]);
  await waitFor(() => !!button(localizedCopy.browserSettings) && !button(localizedCopy.browserSettings).disabled);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const inspect = () => {
    const content = dialog.querySelector<HTMLElement>('.flower-computer-content')!;
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
    for (const action of dialog.querySelectorAll<HTMLButtonElement>('.flower-computer-panel button, .flower-computer-footer button')) {
      if (action.checkVisibility()) {
        expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth + 1);
        expect(action.offsetHeight).toBeGreaterThanOrEqual(44);
      }
    }
  };
  for (const action of [localizedCopy.browserSettings, localizedCopy.details, localizedCopy.help, localizedCopy.permissions]) {
    button(action).click();
    await waitFor(() => document.querySelector('[data-flower-computer-panel]')?.getAttribute('aria-busy') === 'false');
    if (action === localizedCopy.browserSettings) (dialog.querySelector('summary') as HTMLElement).click();
    inspect();
    button(localizedCopy.back).click();
  }
  const chromeCard = [...dialog.querySelectorAll('section')].find(item => item.querySelector('h4')?.textContent === localizedCopy.chromeTitle)!;
  chromeCard.querySelector('button')!.click(); inspect();
  if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: '__screenshots__/flower-computer-polish-de-DE-chrome-390.png' });
});
it('rejects a website path or embedded credentials instead of silently widening its grant', async () => {
  const { management } = mount(); await ready(); button(copy.permissions).click();
  await waitFor(() => !!document.querySelector('input[type="url"]') && !button(copy.save).disabled);
  const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
  for (const value of ['https://example.test/private', 'https://user:secret@example.test', 'ftp://example.test']) {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); button(copy.add).click();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.invalidOrigin);
  }
  input.value = 'https://example.test/'; input.dispatchEvent(new Event('input', { bubbles: true })); button(copy.add).click();
  expect(management.saveAccess).not.toHaveBeenCalled();
  button(copy.save).click();
  await waitFor(() => management.saveAccess.mock.calls.length === 1);
  expect(management.saveAccess).toHaveBeenCalledWith('thread', { origins: ['https://example.test'], apps: [], allow_foreground: false });
});

for (const width of [390, 1280]) it(`manages browser profiles without selecting a task at ${width}px`, async () => {
  await page.viewport(width, 850);
  const { management } = mount();
  management.listManagedProfiles.mockResolvedValue([{ id: 'browser-main', name: 'Default', state: 'stopped' }]);
  management.manageBrowserProfile.mockResolvedValue([{ id: 'browser-main', name: 'Default', state: 'running' }]);
  await ready(); button(copy.browserSettings).click();
  await waitFor(() => !!document.querySelector('details'));
  (document.querySelector('details summary') as HTMLElement).click();
  await waitFor(() => !!button(copy.browserStart) && !button(copy.browserStart).disabled);
  expect(management.manageBrowserProfile).not.toHaveBeenCalled();
  button(copy.browserStart).click();
  await waitFor(() => !!button(copy.browserStop) && !button(copy.browserStop).disabled);
  expect(management.manageBrowserProfile).toHaveBeenCalledWith('browser-main', 'start');
  button(copy.browserStop).click();
  await waitFor(() => document.body.textContent!.includes(copy.browserStopHint));
  expect(management.manageBrowserProfile).toHaveBeenCalledTimes(1);
  button(copy.cancel).click();
  expect(management.manageBrowserProfile).toHaveBeenCalledTimes(1);
  button(copy.browserStop).click();
  management.manageBrowserProfile.mockResolvedValue([{ id: 'browser-main', name: 'Default', state: 'stopped' }]);
  const stops = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent?.trim() === copy.browserStop);
  stops[stops.length - 1].click();
  await waitFor(() => !!button(copy.browserStart));
  expect(management.manageBrowserProfile).toHaveBeenLastCalledWith('browser-main', 'stop');
  expect(management.selectCandidate).not.toHaveBeenCalled();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/browser-lifecycle-${width}.png` });
});
it('retains the profile and explains an unsuccessful stop', async () => {
  const { management } = mount();
  management.listManagedProfiles.mockResolvedValue([{ id: 'browser-main', name: 'Default', state: 'running' }]);
  management.manageBrowserProfile.mockRejectedValue(new Error('managed_browser_in_use'));
  await ready(); button(copy.browserSettings).click();
  await waitFor(() => !!document.querySelector('details'));
  (document.querySelector('details summary') as HTMLElement).click();
  await waitFor(() => !!button(copy.browserStop) && !button(copy.browserStop).disabled);
  button(copy.browserStop).click();
  const stops = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent?.trim() === copy.browserStop);
  stops[stops.length - 1].click();
  await waitFor(() => document.body.textContent!.includes(copy.browserLifecycleFailed));
  expect(document.body.textContent).toContain(copy.browserRunning);
  expect(management.selectCandidate).not.toHaveBeenCalled();
});

for (const [width, dark] of [[390, false], [430, true], [768, false], [1280, true]] as const) {
  it(`keeps connected browsers and refresh stable at ${width}px in ${dark ? 'dark' : 'light'} mode`, async () => {
    await page.viewport(width, 844);
    document.documentElement.classList.toggle('dark', dark);
    const localized = zhCN.flowerSurface.computer;
    const connected: FlowerComputerEnvironment = { ...environment, hostname: 'MacBook-Pro.local', desktop: { state: 'ready' }, chrome: {
      installations: [{ id: 'chrome', name: 'Google Chrome', kind: 'google_chrome', installed: true, prepared: true, connected: true },
        { id: 'chromium', name: 'Chromium', kind: 'chromium', installed: true, prepared: true, connected: true }],
      profiles: [{ id: 'work', installation_id: 'chrome', library_id: 'work', name: 'Chrome · Work' },
        { id: 'personal', installation_id: 'chromium', library_id: 'personal', name: 'Chromium · Personal' }],
    } };
    const { management } = mount({ copy: localized, environment: connected });
    await waitFor(() => !!button(localized.manage) && !button(localized.manage).disabled);
    expect(management.listCandidates).not.toHaveBeenCalled();
    button(localized.manage).click();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
    expect(dialog.querySelector('.flower-chrome-status')).toBeNull();
    expect(dialog.querySelectorAll('.flower-computer-profile')).toHaveLength(2);
    expect(dialog.querySelector('.flower-computer-profile [data-computer-brand="chrome"]')).toBeTruthy();
    expect(dialog.querySelector('.flower-computer-profile [data-computer-brand="chromium"]')).toBeTruthy();
    const geometry = () => [button(localized.setupChrome), button(localized.refresh), dialog].map(element => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const before = geometry();
    let resolve!: (value: FlowerComputerEnvironment) => void;
    management.loadEnvironment.mockImplementationOnce(() => new Promise<FlowerComputerEnvironment>(done => { resolve = done; }));
    button(localized.refresh).click();
    await waitFor(() => !!resolve);
    expect(dialog.querySelectorAll('.flower-computer-profile')).toHaveLength(2);
    expect(button(localized.refresh).getAttribute('aria-busy')).toBe('true');
    expect(geometry()).toEqual(before);
    resolve(connected);
    await waitFor(() => !button(localized.refresh).disabled);
    expect(geometry()).toEqual(before);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    for (const action of dialog.querySelectorAll<HTMLButtonElement>('button')) {
      if (action.checkVisibility()) expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth + 1);
    }
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-computer-connections-${width}-${dark ? 'dark' : 'light'}.png` });
    expect(management.setupExtension).not.toHaveBeenCalled();
    expect(management.selectCandidate).not.toHaveBeenCalled();
    expect(management.saveAccess).not.toHaveBeenCalled();
  });
}
