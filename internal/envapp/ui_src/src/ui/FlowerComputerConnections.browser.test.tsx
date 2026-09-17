import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import type { FlowerComputerAccess } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerComputerConnections } from '../../../../flower_ui/src/FlowerComputerConnections';
import { FlowerProfileConnection } from '../../../../flower_ui/src/FlowerProfileConnection';
import { computerUseEnUS } from '../../../../flower_ui/src/computerUseCopy';
import { adapter, waitFor } from './FlowerSurface.navigation.testHarness';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; });

it('claims the exact extension tab shown in the selected inventory', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const connect = vi.fn().mockResolvedValue({ ready: true });
  const selected = { id: '7', profile_id: 'work', title: 'Draft with unsaved changes', url: 'https://example.test/draft' };
  const management = {
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: '', candidates: [] }), selectCandidate: vi.fn(),
    listTargets: vi.fn(), loadTarget: vi.fn(), selectTarget: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(), listBrowserTabs: vi.fn(),
    listExtensionProfiles: vi.fn().mockResolvedValue([{ id: 'work', name: 'Work' }]),
    listExtensionTabs: vi.fn().mockResolvedValue([selected]),
  };
  const stop = render(() => <FloeConfigProvider><FlowerProfileConnection management={management} connect={connect} copy={computerUseEnUS} onConnected={() => undefined} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => Boolean(host.querySelector('select')));
  const profile = host.querySelector('select')!;
  profile.value = 'work'; profile.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => host.querySelectorAll('select').length === 2);
  const tab = host.querySelectorAll('select')[1];
  tab.value = selected.id; tab.dispatchEvent(new Event('change', { bubbles: true }));
  const button = (text: string) => Array.from(host.querySelectorAll('button')).find(value => value.textContent === text)!;
  button(computerUseEnUS.connect).click();
  await waitFor(() => connect.mock.calls.length === 1);
  expect(connect).toHaveBeenLastCalledWith({ extension_profile_id: 'work', tab_id: selected.id, tab_title: selected.title, tab_url: selected.url });
  await waitFor(() => !button(computerUseEnUS.newTab).disabled);
  button(computerUseEnUS.newTab).click();
  await waitFor(() => connect.mock.calls.length === 2);
  expect(connect).toHaveBeenLastCalledWith({ extension_profile_id: 'work', new_tab: true });
});

it('shows automatic selection, offers grouped search, and saves access only on confirmation', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const selectTarget = vi.fn().mockResolvedValue(undefined), saveAccess = vi.fn().mockResolvedValue(undefined);
  const base = adapter(true);
  const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === text)!;
  const management = {
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: '', candidates: [
      { candidate_ref: 'candidate-managed', kind: 'browser.managed', display_name: 'Managed browser', new_tab: true, state: 'ready' },
      { candidate_ref: 'candidate-window', target_id: 'window', kind: 'desktop.window', display_name: 'Notes — Project', app_bundle_id: 'dev.fixture.Notes', state: 'ready' },
      { candidate_ref: 'candidate-desktop', kind: 'desktop.screen', display_name: 'macOS Desktop', state: 'permission_required' },
    ] }), selectCandidate: vi.fn().mockResolvedValue({ id: 'window', kind: 'desktop.window', display_name: 'Notes — Project', ready: true }),
    listTargets: vi.fn().mockResolvedValue([
      { id: 'managed', kind: 'browser.managed', display_name: 'Managed browser', state: 'stopped', ready: false },
      { id: 'window', kind: 'desktop.window', display_name: 'Notes — Project', state: 'ready', ready: true, app_bundle_id: 'dev.fixture.Notes' },
      { id: 'desktop-main', kind: 'desktop.screen', display_name: 'macOS Desktop', state: 'permission_required', ready: false },
    ]),
    loadTarget: vi.fn().mockResolvedValue({ target_id: 'managed' }), selectTarget,
    loadAccess: vi.fn().mockResolvedValue({ origins: [], apps: [], allow_foreground: false }), saveAccess,
    listBrowserTabs: vi.fn().mockResolvedValue([]),
  };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open onOpenChange={() => undefined} threadID="thread-one"
    adapter={{ ...base, computerManagement: management }} copy={computerUseEnUS} requested={{ origin: 'https://example.com', app: 'dev.fixture.Notes', foreground: true }} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !button(computerUseEnUS.switchTarget).disabled);
  expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(document.querySelector('input[type="search"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(computerUseEnUS.automatic);
  expect(selectTarget).not.toHaveBeenCalled(); expect(saveAccess).not.toHaveBeenCalled();
  button(computerUseEnUS.switchTarget).click();
  await waitFor(() => !!document.querySelector('input[type="search"]'));
  expect(document.body.textContent).toContain(computerUseEnUS.browserPages);
  expect(document.body.textContent).toContain(computerUseEnUS.applicationWindows);
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = 'Notes'; search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('[aria-label="' + computerUseEnUS.switchTarget + '"]')?.textContent).not.toContain('Managed browser');
  const choose = [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.includes('Notes — Project'))!;
  choose.click();
  await waitFor(() => management.selectCandidate.mock.calls.length === 1);
  expect(management.selectCandidate).toHaveBeenCalledWith('thread-one', 'candidate-window');
  await waitFor(() => !button(computerUseEnUS.grantRequested).disabled);
  button(computerUseEnUS.grantRequested).click();
  expect(saveAccess).not.toHaveBeenCalled();
  button(computerUseEnUS.save).click();
  await waitFor(() => saveAccess.mock.calls.length === 1);
  expect(saveAccess).toHaveBeenCalledWith('thread-one', { origins: ['https://example.com'], apps: ['dev.fixture.Notes'], allow_foreground: true });
  await waitFor(() => Boolean(document.querySelector('[role="status"]')));
  button(computerUseEnUS.revokeAll).click();
  await waitFor(() => saveAccess.mock.calls.length === 2);
  expect(saveAccess).toHaveBeenLastCalledWith('thread-one', { origins: [], apps: [], allow_foreground: false });
});

it('discards delayed permission results from a previous thread and keeps read-only controls disabled', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let first: (value: { origins: string[]; apps: string[]; allow_foreground: boolean }) => void = () => undefined;
  const [threadID, setThreadID] = createSignal('one');
  const loadAccess = vi.fn((thread: string) => thread === 'one' ? new Promise<FlowerComputerAccess>(resolve => { first = resolve; }) : Promise.resolve({ origins: ['https://second.example'], apps: [], allow_foreground: false }));
  const management = {
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: '', candidates: [] }), selectCandidate: vi.fn(), listTargets: vi.fn().mockResolvedValue([]), listBrowserTabs: vi.fn(), loadAccess,
    loadTarget: vi.fn().mockResolvedValue({ target_id: '' }), selectTarget: vi.fn(), saveAccess: vi.fn() };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open onOpenChange={() => undefined} threadID={threadID()}
    adapter={{ ...adapter(true), canMutate: false, computerManagement: management }} copy={computerUseEnUS} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => loadAccess.mock.calls.length === 1);
  setThreadID('two');
  await waitFor(() => document.body.textContent?.includes('https://second.example') === true);
  first({ origins: ['https://first.example'], apps: [], allow_foreground: true });
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.body.textContent).not.toContain('https://first.example');
  const save = Array.from(document.querySelectorAll('button')).find(button => button.textContent === computerUseEnUS.save)!;
  expect(save.disabled).toBe(true);
  expect(management.saveAccess).not.toHaveBeenCalled();
});

it('loads managed profiles, requires an explicit tab, creates a background tab, and disconnects it', async () => {
  const { userEvent } = await import('vitest/browser');
  const host = document.createElement('div'); host.style.transform = 'translate(20px, 10px) scale(0.9)'; document.body.append(host);
  const base = adapter(true);
  const target = { id: 'managed-tab', kind: 'browser.managed', display_name: 'Work profile', state: 'ready', ready: true };
  const connect = vi.fn().mockResolvedValue(target);
  const management = {
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: target.id, candidates: [{ ...target, target_id: target.id, candidate_ref: 'managed-candidate' }] }), selectCandidate: vi.fn(),
    listTargets: vi.fn().mockResolvedValue([target]), loadTarget: vi.fn().mockResolvedValue({ target_id: '' }), selectTarget: vi.fn(),
    loadAccess: vi.fn().mockResolvedValue({ origins: [], apps: [], allow_foreground: false }), saveAccess: vi.fn(), listBrowserTabs: vi.fn(),
    listManagedProfiles: vi.fn().mockResolvedValue([{ id: 'default', name: 'Default' }]),
    listManagedTabs: vi.fn().mockResolvedValue([{ id: 'one', profile_id: 'default', title: 'Existing work', url: 'https://example.test' }]),
    createManagedProfile: vi.fn().mockResolvedValue([{ id: 'default', name: 'Default' }, { id: 'work', name: 'Work' }]),
    disconnectBrowser: vi.fn().mockResolvedValue(undefined),
  };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open onOpenChange={() => undefined} threadID="managed-thread"
    adapter={{ ...base, computerManagement: management, connectComputerBrowser: connect }} copy={computerUseEnUS} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  const manage = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === computerUseEnUS.manageConnections)!;
  await waitFor(() => !!manage()); manage().click();
  await waitFor(() => Boolean(document.querySelector('select')));
  expect(management.listManagedProfiles).toHaveBeenCalledTimes(1);
  const profile = document.querySelector<HTMLSelectElement>('select')!;
  expect(profile.value).toBe(''); expect(connect).not.toHaveBeenCalled();
  profile.value = 'default'; profile.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => management.listManagedTabs.mock.calls.length === 1);
  await waitFor(() => document.querySelectorAll('select').length === 2);
  const button = (text: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent === text)!;
  expect(button(computerUseEnUS.connect).disabled).toBe(true);
  const tab = document.querySelectorAll<HTMLSelectElement>('select')[1];
  tab.value = 'one'; tab.dispatchEvent(new Event('change', { bubbles: true }));
  button(computerUseEnUS.connect).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => connect.mock.calls.length === 1);
  expect(connect).toHaveBeenLastCalledWith({ managed_profile_id: 'default', tab_id: 'one' });
  await waitFor(() => !button(computerUseEnUS.newTab).disabled);
  button(computerUseEnUS.newTab).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => connect.mock.calls.length === 2);
  expect(connect).toHaveBeenLastCalledWith({ managed_profile_id: 'default', new_tab: true });
  await waitFor(() => management.selectTarget.mock.calls.length === 2);
  expect(management.selectTarget).toHaveBeenLastCalledWith('managed-thread', 'managed-tab');
  const name = document.querySelector<HTMLInputElement>(`input[aria-label="${computerUseEnUS.profileName}"]`)!;
  name.value = 'Work'; name.dispatchEvent(new Event('input', { bubbles: true }));
  button(computerUseEnUS.createProfile).focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => management.createManagedProfile.mock.calls.length === 1);
  expect(management.createManagedProfile).toHaveBeenCalledWith('Work');
  await waitFor(() => profile.options.length === 3);
  expect(profile.value, 'creating a profile must not silently select another target').toBe('default');
  await waitFor(() => !button(computerUseEnUS.disconnect).disabled);
  button(computerUseEnUS.disconnect).click();
  await waitFor(() => management.disconnectBrowser.mock.calls.length === 1);
  expect(management.disconnectBrowser).toHaveBeenCalledWith('managed-tab');
  expect(management.saveAccess).not.toHaveBeenCalled();
});


it('explains full access without redundant grant controls and keeps target selection available', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [fullAccess, setFullAccess] = createSignal(true);
  const management = {
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: '', candidates: [] }), selectCandidate: vi.fn(),
    listTargets: vi.fn().mockResolvedValue([{ id: 'managed', kind: 'browser.managed', display_name: 'Task browser', ready: true }]),
    loadTarget: vi.fn().mockResolvedValue({ target_id: 'managed' }), selectTarget: vi.fn(),
    loadAccess: vi.fn().mockResolvedValue({ origins: ['https://saved.test'], apps: [], allow_foreground: false }), saveAccess: vi.fn(),
    listBrowserTabs: vi.fn().mockResolvedValue([]),
  };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open onOpenChange={() => undefined}
    fullAccess={fullAccess()} threadID="full-task" adapter={{ ...adapter(true), computerManagement: management }} copy={computerUseEnUS} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('button')].some(value => value.textContent === computerUseEnUS.switchTarget && !value.disabled));
  expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(computerUseEnUS.fullAccessHint);
  expect(document.querySelector('input[type="url"]')).toBeNull();
  expect([...document.querySelectorAll('button')].some(button => button.textContent === computerUseEnUS.save)).toBe(false);
  setFullAccess(false);
  await waitFor(() => !!document.querySelector('input[type="url"]'));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('https://saved.test');
  expect(management.saveAccess).not.toHaveBeenCalled();
});

it('keeps the current page after a stale selection and supports keyboard switching on a narrow screen', async () => {
  const { page, userEvent } = await import('vitest/browser');
  await page.viewport(390, 720);
  const host = document.createElement('div'); document.body.append(host);
  const management = {
    listCandidates: vi.fn().mockResolvedValue({ current_target_id: 'draft', candidates: [
      { candidate_ref: 'draft-ref', target_id: 'draft', kind: 'browser.connected', display_name: 'Personal', profile_name: 'Personal', title: 'Unsaved draft', url: 'https://example.test/draft', state: 'ready' },
      { candidate_ref: 'child-ref', target_id: 'child', kind: 'browser.connected', display_name: 'Personal', title: 'Details page', url: 'https://example.test/details', state: 'ready' },
    ] }),
    selectCandidate: vi.fn().mockRejectedValue(Object.assign(new Error('private adapter details'), { code: 'target_selection_stale' })),
    loadAccess: vi.fn().mockResolvedValue({ origins: [], apps: [], allow_foreground: false }),
    listTargets: vi.fn(), loadTarget: vi.fn(), selectTarget: vi.fn(), saveAccess: vi.fn(), listBrowserTabs: vi.fn(),
  };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open fullAccess onOpenChange={() => undefined} threadID="draft-thread"
    adapter={{ ...adapter(true), computerManagement: management }} copy={computerUseEnUS} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  try {
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
    const switcher = () => buttons().find(button => button.textContent === computerUseEnUS.switchTarget)!;
    await waitFor(() => !!switcher() && !switcher().disabled);
    switcher().focus(); await userEvent.keyboard('{Enter}');
    await waitFor(() => buttons().some(button => button.textContent?.includes('Details page')));
    buttons().find(button => button.textContent?.includes('Details page'))!.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => document.querySelector('[role="alert"]')?.textContent === computerUseEnUS.selectionStale);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Unsaved draft');
    expect(document.body.textContent).not.toContain('private adapter details');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    expect(management.selectCandidate).toHaveBeenCalledWith('draft-thread', 'child-ref');
  } finally { await page.viewport(1280, 720); }
});
