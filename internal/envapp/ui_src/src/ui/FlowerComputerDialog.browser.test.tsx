import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { FlowerComputerConnections } from '../../../../flower_ui/src/FlowerComputerConnections';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
import deDE from './i18n/locales/catalogs/de-DE.json';
import ruRU from './i18n/locales/catalogs/ru-RU.json';
import zhTW from './i18n/locales/catalogs/zh-TW.json';
import { computerUseEnUS as copy, type FlowerComputerCopy } from '../../../../flower_ui/src/computerUseCopy';
import type { FlowerComputerAccess, FlowerComputerEnvironment } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let dispose: (() => void) | undefined;
afterEach(async () => { dispose?.(); dispose = undefined; document.documentElement.classList.remove('dark'); await page.viewport(1280, 720); });
const waitFor = async (predicate: () => boolean) => {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 3000 });
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!;
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const environment: FlowerComputerEnvironment = { hostname: 'Work Mac', platform: 'darwin', managed: { state: 'on_demand' }, desktop: { state: 'permission_required', reason: 'screen_recording_required' }, chrome: { profiles: [] } };
const manyTargets = () => [
  { candidate_ref: 'new', target_id: '', kind: 'browser.connected', display_name: 'Chrome', profile_name: 'Chrome', new_tab: true, state: 'ready' },
  ...Array.from({ length: 40 }, (_, index) => ({ candidate_ref: `page-${index}`, target_id: `page-${index}`, kind: 'browser.connected', display_name: 'Chrome', profile_name: 'Chrome', title: ['DeepSeek', 'floegence/floebrowser', 'API console', 'Project dashboard'][index % 4], url: `https://example.test/workspace/project-${index}/overview`, state: index === 2 ? 'in_use' : 'ready' })),
  { candidate_ref: 'notes', target_id: 'notes', kind: 'desktop.window', display_name: 'Notes — Project plan', app_bundle_id: 'com.apple.Notes', state: 'ready' },
];
function mount(options: { current?: string; fullAccess?: boolean; readonly?: boolean; connectionOnly?: boolean; copy?: FlowerComputerCopy; environment?: FlowerComputerEnvironment } = {}) {
  const management = {
    loadEnvironment: vi.fn().mockResolvedValue(options.environment ?? environment),
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: options.current ?? 'lost-page', candidates: [
      { candidate_ref: 'next', target_id: 'next-page', kind: 'browser.connected', display_name: 'Work', title: 'Existing draft', state: 'ready', url: 'https://example.test' },
      { candidate_ref: 'window', target_id: 'notes', kind: 'desktop.window', display_name: 'Notes — Project', app_bundle_id: 'dev.fixture.Notes', state: 'ready' },
      { candidate_ref: 'private', target_id: 'xvfb-main', kind: 'xvfb.desktop', display_name: 'Private desktop', state: 'stopped' },
    ] }),
    selectCandidate: vi.fn().mockResolvedValue({ id: 'next-page', kind: 'browser.connected', display_name: 'Work', ready: true }),
    discoverBrowser: vi.fn(),
    loadAccess: vi.fn<(thread: string) => Promise<FlowerComputerAccess>>().mockResolvedValue({ origins: [], apps: [], allow_foreground: false }), saveAccess: vi.fn(),

    listManagedProfiles: vi.fn().mockResolvedValue([{ id: 'browser-main', name: 'Default' }]),
    createManagedProfile: vi.fn().mockResolvedValue([{ id: 'browser-main', name: 'Default' }, { id: 'work', name: 'Work' }]),
    setupExtension: vi.fn(), openExtension: vi.fn(), loadExtensionStatus: vi.fn().mockResolvedValue({ profiles: [] }),
  };
  const [thread, setThread] = createSignal('thread');
  const [open, setOpen] = createSignal(true);
  const onContinue = vi.fn().mockResolvedValue(undefined);
  const editPermission = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open={open()} fullAccess={options.fullAccess} threadID={thread()} onOpenChange={setOpen}
    connectionOnly={options.connectionOnly} onContinue={onContinue} onEditPermissionMode={editPermission}
    requested={{ origin: 'https://example.com', app: 'dev.fixture.Notes', foreground: true }}
    adapter={{ runtime: { display_name: 'Test environment', runtime_id: 'test', runtime_kind: 'env_local', carrier_kind: 'server', subtitle: '' }, canMutate: !options.readonly, computerManagement: management }} copy={options.copy ?? copy} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  return { management, setThread, setOpen, onContinue, editPermission };
}
async function ready() { await waitFor(() => !!button(copy.switchTarget) && !button(copy.switchTarget).disabled); }
async function picker() { button(copy.switchTarget).click(); await waitFor(() => radios().length > 0 && !radios()[0].disabled); }

it('keeps a long picker compact with search and confirmation outside the list scroll', async () => {
  await page.viewport(1280, 900);
  const { management } = mount({ current: 'page-0' });
  management.listCandidates.mockResolvedValue({ current_target_id: 'page-0', candidates: manyTargets() });
  await ready(); await picker();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
  expect(radios()).toHaveLength(42);
  expect(dialog.getBoundingClientRect().height).toBeLessThanOrEqual(620);
  const list = dialog.querySelector<HTMLElement>('[role="radiogroup"]')!;
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const search = dialog.querySelector<HTMLInputElement>('input[type="search"]')!;
  const searchTop = search.getBoundingClientRect().top;
  const confirmTop = button(copy.confirmTarget).getBoundingClientRect().top;
  list.scrollTop = list.scrollHeight;
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(search.getBoundingClientRect().top).toBe(searchTop);
  expect(button(copy.confirmTarget).getBoundingClientRect().top).toBe(confirmTop);
  expect(dialog.querySelector<HTMLElement>('.flower-computer-content')!.scrollTop).toBe(0);
  radios().at(-1)!.click();
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(button(copy.confirmTarget).disabled).toBe(false);
});

it('filters directly to applications, combines search, and preserves an explicit staged choice', async () => {
  const { management } = mount({ current: 'page-0' });
  management.listCandidates.mockResolvedValue({ current_target_id: 'page-0', candidates: manyTargets() });
  await ready(); await picker();
  const filters = [...document.querySelectorAll<HTMLButtonElement>('.flower-computer-picker-filters button')];
  expect(filters.map(item => item.textContent)).toEqual([`${copy.allTargets}42`, `${copy.targetPages}41`, `${copy.targetApps}1`]);
  filters[2].click();
  expect(radios()).toHaveLength(1);
  expect(radios()[0].value).toBe('notes');
  radios()[0].focus(); await userEvent.keyboard(' ');
  expect(document.querySelector('.flower-computer-picker-selection')?.textContent).toBe('Notes — Project plan');
  filters[1].click();
  expect(radios()).toHaveLength(41);
  expect(radios().find(item => item.value === 'page-2')!.disabled).toBe(true);
  expect(document.querySelector('.flower-computer-target-current')?.textContent).toBe(copy.currentTarget);
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = 'project-39'; search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(radios()).toHaveLength(1);
  expect(radios()[0].value).toBe('page-39');
  filters[2].click();
  expect(radios()).toHaveLength(0);
  expect(document.body.textContent).toContain(copy.noMatchingTargets);
  expect(management.selectCandidate).not.toHaveBeenCalled();
  button(copy.confirmTarget).click();
  await waitFor(() => management.selectCandidate.mock.calls.length === 1);
  expect(management.selectCandidate).toHaveBeenCalledWith('thread', 'notes');
});

for (const [locale, labels, width, dark] of [['zh-CN', zhCN.flowerSurface.computer, 1280, false], ['zh-CN-dark', zhCN.flowerSurface.computer, 1280, true], ['de-DE-mobile', deDE.flowerSurface.computer, 390, false], ['ru-RU-mobile', ruRU.flowerSurface.computer, 390, false]] as const) {
  it(`keeps dense target rows and fixed actions readable in ${locale}`, async () => {
    await page.viewport(width, 800); document.documentElement.classList.toggle('dark', dark);
    const { management } = mount({ copy: labels, current: 'page-0' });
    management.listCandidates.mockResolvedValue({ current_target_id: 'page-0', candidates: manyTargets() });
    await waitFor(() => !!button(labels.switchTarget) && !button(labels.switchTarget).disabled);
    button(labels.switchTarget).click();
    await waitFor(() => radios().length === 42 && !radios()[0].disabled);
    radios()[2].click();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    const content = dialog.querySelector<HTMLElement>('.flower-computer-content')!;
    expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight + 1);
    const filters = dialog.querySelector<HTMLElement>('.flower-computer-picker-filters')!;
    expect(filters.scrollWidth).toBeLessThanOrEqual(filters.clientWidth + 1);
    for (const filter of filters.querySelectorAll('button')) {
      const [label, count] = filter.querySelectorAll('span');
      expect(label.getBoundingClientRect().height).toBeLessThanOrEqual(20);
      expect(count.getBoundingClientRect().left).toBeGreaterThan(label.getBoundingClientRect().right);
      expect(Math.abs(count.getBoundingClientRect().top - label.getBoundingClientRect().top)).toBeLessThanOrEqual(3);
    }
    for (const row of dialog.querySelectorAll<HTMLElement>('.flower-computer-target')) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(width === 390 ? 64 : 48);
    }
    const first = dialog.querySelector<HTMLElement>('.flower-computer-target')!;
    expect(getComputedStyle(first).cursor).toBe('pointer');
    expect(button(labels.confirmTarget).getBoundingClientRect().bottom).toBeLessThanOrEqual(800);
    expect(button(labels.confirmTarget).disabled).toBe(false);
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/compact-picker-${locale}.png` });
  });
}

it('gives capability actions visible button boundaries before hover', async () => {
  mount(); await ready();
  const actions = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(item => [copy.browserSettings, copy.manage, copy.details].includes(item.textContent?.trim() ?? ''));
  expect(actions).toHaveLength(3);
  for (const action of actions) {
    const style = getComputedStyle(action);
    expect(parseFloat(style.borderTopWidth)).toBeGreaterThanOrEqual(1);
    expect(style.borderTopStyle).toBe('solid');
    expect(style.cursor).toBe('pointer');
    expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  }
});

it('never describes a missing persisted page as automatic selection', async () => {
  const { management } = mount();
  await ready();
  expect(document.querySelector('[role="status"]')?.textContent).toContain(copy.currentMissing);
  expect(document.querySelector('[role="status"]')?.textContent).not.toContain(copy.automaticHint);
  expect(document.body.textContent).toContain('Work Mac');
  expect(document.body.textContent).toContain(copy.chromeOffline);
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(management.loadAccess).not.toHaveBeenCalled();
});
it('returns a remote user to chat without selecting a replacement or resuming a task', async () => {
  const { management, onContinue } = mount(); await ready();
  expect(document.querySelector('[role="status"]')?.textContent).toContain(copy.currentMissingHint);
  button(copy.backToChat).click();
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
  expect(details.textContent).toContain(copy.profileIsolationHint);
  expect(management.createManagedProfile).not.toHaveBeenCalled();
});
it('stages a page choice until confirmation and cancels without binding it', async () => {
  const { management } = mount({ current: '' });
  await ready(); await picker(); radios()[0].click();
  expect(management.selectCandidate).not.toHaveBeenCalled();
  button(copy.cancel).click();
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toContain(copy.automatic);
  await picker();
  expect(radios().every(radio => !radio.checked)).toBe(true);
  radios()[0].click(); button(copy.confirmTarget).click();
  await waitFor(() => management.selectCandidate.mock.calls.length === 1);
  expect(management.selectCandidate).toHaveBeenCalledWith('thread', 'next');
  expect(management.saveAccess).not.toHaveBeenCalled();
});
it('supports grouped search and saves grants only on explicit confirmation', async () => {
  const { management } = mount({ current: '' });
  await ready(); await picker();
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = 'Notes'; search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(radios()).toHaveLength(1);
  expect(radios()[0].closest('label')?.textContent).toContain('Notes');
  button(copy.cancel).click(); button(copy.permissions).click();
  await waitFor(() => !!button(copy.grantRequested) && !button(copy.grantRequested).disabled);
  button(copy.grantRequested).click(); expect(management.saveAccess).not.toHaveBeenCalled();
  button(copy.save).click();
  await waitFor(() => management.saveAccess.mock.calls.length === 1);
  expect(management.saveAccess).toHaveBeenCalledWith('thread', { origins: ['https://example.com'], apps: ['dev.fixture.Notes'], allow_foreground: true });
  await waitFor(() => !button(copy.revokeAll).disabled); button(copy.revokeAll).click();
  await waitFor(() => management.saveAccess.mock.calls.length === 2);
  expect(management.saveAccess).toHaveBeenLastCalledWith('thread', { origins: [], apps: [], allow_foreground: false });
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
  button(copy.fullAccessTitle).click();
  expect(document.body.textContent).toContain(copy.fullAccessHint);
  expect(document.querySelector('input[type="url"]')).toBeNull();
  expect(button(copy.save)).toBeUndefined();
  await waitFor(() => !button(copy.editPermissions).disabled);
  button(copy.editPermissions).click(); expect(editPermission).toHaveBeenCalledTimes(1);
});
it('preserves the old page on stale selection and supports keyboard operation at 390px', async () => {
  await page.viewport(390, 720);
  const { management } = mount({ current: 'next-page' });
  management.selectCandidate.mockRejectedValue(Object.assign(new Error('private adapter details'), { code: 'target_selection_stale' }));
  await ready(); await picker();
  radios()[1].focus(); await userEvent.keyboard(' ');
  button(copy.confirmTarget).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent === copy.selectionStale);
  expect(management.selectCandidate).toHaveBeenCalledWith('thread', 'window');
  expect(document.body.textContent).not.toContain('private adapter details');
  button(copy.cancel).click();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Existing draft');
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
});
it('does not select stale inventory after a failed refresh', async () => {
  const { management } = mount(); await ready();
  management.listCandidates.mockRejectedValue(new Error('offline'));
  button(copy.switchTarget).click();
  await waitFor(() => !!document.querySelector('[role="alert"]'));
  expect(radios().every(radio => radio.disabled)).toBe(true);
  expect(button(copy.confirmTarget).disabled).toBe(true);
  expect(management.selectCandidate).not.toHaveBeenCalled();
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
it('discovers advanced pages into the same staged selector without binding', async () => {
  const { management } = mount(); await ready();
  management.discoverBrowser.mockResolvedValue({ current_target_id: 'lost-page', candidates: [{ candidate_ref: 'cdp', kind: 'browser.connected', display_name: 'Debug page', state: 'ready' }] });
  button(copy.advanced).click();
  const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
  input.value = 'http://127.0.0.1:9222'; input.dispatchEvent(new Event('input', { bubbles: true }));
  button(copy.listTabs).click();
  await waitFor(() => radios().length === 1 && !radios()[0].disabled);
  expect(management.discoverBrowser).toHaveBeenCalledWith('thread', 'http://127.0.0.1:9222');
  radios()[0].click(); button(copy.cancel).click();
  expect(management.selectCandidate).not.toHaveBeenCalled();
});
it('does not resume another conversation when a Chrome guide finishes late', async () => {
  const { management, setThread, onContinue, setOpen } = mount({ connectionOnly: true });
  let finish!: (value: unknown) => void;
  management.loadExtensionStatus.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => !!finish);
  setThread('second'); setOpen(false);
  finish({ profiles: [{ id: 'late', name: 'Chrome' }] });
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
    await waitFor(() => !!button(localizedCopy.switchTarget) && !button(localizedCopy.switchTarget).disabled);
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
    }
    if (width > 800) {
      expect(Math.max(...bounds.map(rect => rect.top)) - Math.min(...bounds.map(rect => rect.top))).toBeLessThan(1);
      expect(Math.max(...bounds.map(rect => rect.width)) - Math.min(...bounds.map(rect => rect.width))).toBeLessThan(1);
      const actionBottoms = capabilities.map(item => item.querySelector('button')!.getBoundingClientRect().bottom);
      expect(Math.max(...actionBottoms) - Math.min(...actionBottoms)).toBeLessThan(1);
    } else {
      expect(bounds[1].top).toBeGreaterThanOrEqual(bounds[0].bottom);
      expect(bounds[2].top).toBeGreaterThanOrEqual(bounds[1].bottom);
    }
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') {
      await page.screenshot({ element: dialog, path: `__screenshots__/flower-computer-${locale}-${width}.png` });
    }
    button(localizedCopy.switchTarget).click();
    await waitFor(() => radios().length > 0 && !radios()[0].disabled);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    expect(button(localizedCopy.confirmTarget).getBoundingClientRect().right).toBeLessThanOrEqual(width);
  });
}

it('keeps the connected overview and its settings pages balanced in Chinese', async () => {
  await page.viewport(1100, 900);
  const localizedCopy = zhCN.flowerSurface.computer;
  mount({ fullAccess: true, copy: localizedCopy, environment: { ...environment, hostname: 'MacBook-Pro.local', desktop: { state: 'ready' }, chrome: { profiles: [{ id: 'chrome', name: 'Chrome' }] } } });
  await waitFor(() => !!button(localizedCopy.switchTarget) && !button(localizedCopy.switchTarget).disabled);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await waitFor(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
  expect(dialog.textContent).toContain(localizedCopy.connected);
  expect(dialog.textContent).toContain(localizedCopy.available);
  const footer = dialog.querySelector<HTMLElement>('.flower-computer-footer')!;
  expect(footer.getBoundingClientRect().width).toBeGreaterThan(dialog.clientWidth * 0.9);
  const screenshot = async (name: string) => {
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-computer-polish-${name}.png` });
  };
  await screenshot('zh-CN-overview');
  for (const [name, action] of [['managed', localizedCopy.browserSettings], ['diagnostics', localizedCopy.details], ['help', localizedCopy.help], ['advanced', localizedCopy.advanced], ['access', localizedCopy.fullAccessTitle]] as const) {
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
it('reconciles a lost selection response by reading inventory without retrying the write', async () => {
  const { management } = mount({ current: '' }); await ready(); await picker();
  management.selectCandidate.mockRejectedValue(new Error('response lost'));
  radios()[0].click(); button(copy.confirmTarget).click();
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent === copy.selectionFailed);
  management.listCandidates.mockResolvedValue({ current_target_id: 'next-page', candidates: [{ candidate_ref: 'confirmed', target_id: 'next-page', kind: 'browser.connected', display_name: 'Confirmed page', state: 'ready' }] });
  button(copy.refresh).click();
  await waitFor(() => radios().length === 1 && !radios()[0].disabled);
  button(copy.cancel).click();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Confirmed page');
  expect(management.selectCandidate).toHaveBeenCalledTimes(1);
});

it('keeps narrow settings pages and long resource names inside their scroll viewport', async () => {
  await page.viewport(390, 720);
  const localizedCopy = deDE.flowerSurface.computer;
  const { management } = mount({ copy: localizedCopy, environment: { ...environment, hostname: 'runtime-with-a-long-workspace-and-device-name.example.test', chrome: { profiles: [{ id: 'work', name: 'Work-profile-with-a-long-unbroken-name-for-layout-qualification' }] } } });
  management.listManagedProfiles.mockResolvedValue([{ id: 'work', name: 'Work-profile-with-a-long-unbroken-name-for-layout-qualification' }]);
  await waitFor(() => !!button(localizedCopy.switchTarget) && !button(localizedCopy.switchTarget).disabled);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const inspect = () => {
    const content = dialog.querySelector<HTMLElement>('.flower-computer-content')!;
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth + 1);
    for (const action of dialog.querySelectorAll<HTMLButtonElement>('.flower-computer-panel button, .flower-computer-footer button')) {
      if (action.checkVisibility()) {
        expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth + 1);
        expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
    }
  };
  for (const action of [localizedCopy.browserSettings, localizedCopy.details, localizedCopy.help, localizedCopy.advanced, localizedCopy.permissions]) {
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
