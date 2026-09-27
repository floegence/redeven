import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { FlowerManagedBrowser } from '../../../../flower_ui/src/FlowerManagedBrowser';
import { computerUseEnUS as copy, type FlowerComputerCopy } from '../../../../flower_ui/src/computerUseCopy';
import type { FlowerBrowserInstallation, FlowerBrowserInstallationSnapshot, FlowerComputerManagement } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
import deDE from './i18n/locales/catalogs/de-DE.json';

let dispose: (() => void) | undefined;
afterEach(async () => { dispose?.(); dispose = undefined; document.documentElement.classList.remove('dark'); await page.viewport(1280, 800); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
const wait = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 4000 });
function mount(options: { pending?: boolean; upload?: boolean; state?: FlowerBrowserInstallation['state']; launch?: FlowerBrowserInstallation['launch']; copy?: FlowerComputerCopy; size?: number } = {}) {
  let state: FlowerBrowserInstallationSnapshot = { storage_bytes: 999495418, enabled: true, state: options.state ?? 'not_installed', launch: options.launch ?? { state: options.state === 'installed' ? 'ready' : 'installation_required' }, directory: '/environment/state/computer/browser', received_bytes: 0,
    package: { name: 'Chrome for Testing', id: 'chromium-1223-linux-amd64', platform: 'linux', architecture: 'amd64', version: '148.0.7778.96', url: 'https://cdn.playwright.dev/example.zip', sha256: 'a'.repeat(64), size_bytes: options.size ?? 183945705, installed_bytes: 393407709 } };
  const observers = new Set<(value: FlowerBrowserInstallationSnapshot) => void>();
  const management: FlowerComputerManagement = {
    subscribeBrowserInstallation: listener => { observers.add(listener); return () => { observers.delete(listener); }; },
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    browserDesktopAvailable: options.upload ?? true,
    loadBrowserInstallation: vi.fn(async () => ({ ...state })),
    saveBrowserEnabled: vi.fn(async enabled => { state = { ...state, enabled, state: state.state === 'uploading' ? 'cancelled' : state.state }; return state; }),
    installBrowser: vi.fn(async request => {
      if (request.action === 'prepare_system') state = { ...state, state: 'awaiting_authorization', operation_id: 'system-1', authorization_command: 'redeven browser-system-authorize /private/fixture/authorize' };
      if (request.action === 'start') state = { ...state, state: request.source === 'upload' ? 'uploading' : 'downloading', operation_id: 'install-1' };
      if (request.action === 'chunk') state = { ...state, received_bytes: request.offset! + atob(request.data!).length };
      if (request.action === 'complete') state = { ...state, state: 'installed', launch: { state: 'ready' as const } };
      if (request.action === 'cancel') state = { ...state, state: 'cancelled' };
      return { ...state };
    }),
  };
  const [continuationKey, setContinuationKey] = createSignal('interaction-1');
  const onContinue = vi.fn().mockResolvedValue(undefined), labels = options.copy ?? copy;
  const host = document.createElement('div'); document.body.append(host);
  const stop = render(() => <FloeConfigProvider><LayoutProvider><Dialog open onOpenChange={() => undefined} title={labels.managed} closeLabel={labels.close}
    class="flower-computer-dialog w-[min(42rem,94vw)] max-w-[42rem]" contentClass="flower-computer-content">
    <div class="flower-computer-panel"><div class="flower-computer-environment"><span>{labels.environmentTitle}</span><span>Build Server</span></div>
      <FlowerManagedBrowser continuationKey={continuationKey()} management={management} copy={labels} canMutate onContinue={options.pending ? onContinue : undefined} />
    </div>
  </Dialog></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  return { management, onContinue, setContinuationKey, update: (value: Partial<FlowerBrowserInstallationSnapshot>) => { state = { ...state, ...value }; for (const observer of observers) observer(state); } };
}
const ready = () => wait(() => Boolean(document.querySelector('[role="switch"]:not(:disabled)')));
it('keeps default-on, status reads and source selection free of downloads', async () => {
  const { management } = mount(); await ready();
  const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')!;
  expect(toggle.checked).toBe(true); expect(document.body.textContent).toContain('Chrome for Testing');
  expect(document.body.textContent).toContain('184 MB download');
  document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();
  expect(management.installBrowser).not.toHaveBeenCalled(); toggle.click(); await wait(() => !toggle.disabled);
  expect(document.querySelector('input[type="radio"]')).toBeNull(); expect(document.body.textContent).toContain(copy.browserDisabledHint);
  toggle.click(); await wait(() => !toggle.disabled); expect(management.installBrowser).not.toHaveBeenCalled();
  expect(management.saveBrowserEnabled).toHaveBeenNthCalledWith(1, false); expect(management.saveBrowserEnabled).toHaveBeenNthCalledWith(2, true);
});
it('requires explicit confirmation and resumes only after confirmed installation', async () => {
  const { management, onContinue, update } = mount({ pending: true, upload: false }); await ready();
  button(copy.browserConfirmDownload).click(); await wait(() => !!button(copy.browserCancelInstallation));
  expect(management.installBrowser).toHaveBeenCalledExactlyOnceWith({ action: 'start', package_id: 'chromium-1223-linux-amd64', source: 'download' });
  expect(onContinue).not.toHaveBeenCalled(); update({ state: 'installed', launch: { state: 'ready' as const } });
  await wait(() => onContinue.mock.calls.length === 1); expect(onContinue).toHaveBeenCalledWith(true);
});
it('continues without the browser only after switching it off', async () => {
  const { onContinue } = mount({ pending: true }); await ready();
  document.querySelector<HTMLInputElement>('[role="switch"]')!.click();
  await wait(() => !!button(copy.browserContinueWithout) && !button(copy.browserContinueWithout).disabled);
  expect(onContinue).not.toHaveBeenCalled(); button(copy.browserContinueWithout).click();
  await wait(() => onContinue.mock.calls.length === 1); expect(onContinue).toHaveBeenCalledWith(false);
});
it('does not auto-resume merely by opening an installed browser', async () => {
  const { management, onContinue } = mount({ pending: true, state: 'installed' }); await ready();
  expect(document.querySelector('input[type="radio"]')).toBeNull(); expect(management.installBrowser).not.toHaveBeenCalled();
  expect(onContinue).not.toHaveBeenCalled(); button(copy.browserContinue).click(); await wait(() => onContinue.mock.calls.length === 1);
});
it('starts Desktop installation without a file and keeps it alive after closing', async () => {
  const { management, onContinue, update } = mount({ pending: true }); await ready();
  button(copy.browserConfirmUpload).click(); await wait(() => !!button(copy.browserCancelInstallation));
  expect(management.installBrowser).toHaveBeenCalledExactlyOnceWith({ action: 'start', source: 'upload', package_id: 'chromium-1223-linux-amd64' });
  expect(document.querySelector('input[type="file"]')).toBeNull();
  dispose?.(); dispose = undefined; update({ state: 'installed', launch: { state: 'ready' as const } });
  expect(management.installBrowser).toHaveBeenCalledTimes(1); expect(onContinue).not.toHaveBeenCalled();
});
it('does not cancel a start response arriving after the panel closes', async () => {
  const { management, onContinue } = mount({ pending: true }); await ready();
  let finish!: (value: FlowerBrowserInstallation) => void;
  const current = await management.loadBrowserInstallation!();
  vi.mocked(management.installBrowser!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  button(copy.browserConfirmUpload).click(); await wait(() => !!finish); dispose?.(); dispose = undefined;
  finish({ ...current, state: 'uploading', operation_id: 'late' });
  await Promise.resolve(); expect(management.installBrowser).toHaveBeenCalledTimes(1); expect(onContinue).not.toHaveBeenCalled();
});
it('explains the web upload limitation and supports keyboard toggling', async () => {
  const { management } = mount({ upload: false }); await ready();
  expect(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].disabled).toBe(true);
  const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')!; toggle.focus();
  await userEvent.keyboard(' '); await wait(() => vi.mocked(management.saveBrowserEnabled!).mock.calls.length === 1);
  expect(management.installBrowser).not.toHaveBeenCalled();
});
for (const [locale, labels, width, dark] of [['en-US-mobile', copy, 390, false], ['zh-CN-mobile', zhCN.flowerSurface.computer, 390, false], ['zh-CN', zhCN.flowerSurface.computer, 1280, false], ['zh-CN-dark', zhCN.flowerSurface.computer, 1280, true], ['de-DE-mobile', deDE.flowerSurface.computer, 390, false]] as const) {
  it(`keeps installation choices readable in ${locale}`, async () => {
    await page.viewport(width, 850); document.documentElement.classList.toggle('dark', dark);
    mount({ copy: labels }); await ready();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await wait(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    for (const card of dialog.querySelectorAll<HTMLElement>('.flower-browser-source-grid label')) {
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1); expect(getComputedStyle(card).cursor).toBe('pointer');
    }
    expect(button(labels.browserConfirmUpload).getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/browser-install-${locale}.png` });
  });
}

it('offers automatic Desktop installation without selecting a local file', async () => {
  mount(); await ready();
  expect(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].checked).toBe(true);
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(button(copy.browserConfirmUpload).disabled).toBe(false);
});

it('keeps retry consent through the previous failed snapshot and resumes once', async () => {
  const { management, update, onContinue } = mount({ pending: true, state: 'failed' }); await ready();
  const current = await management.loadBrowserInstallation!();
  vi.mocked(management.installBrowser!).mockResolvedValueOnce({ ...current, transfer_active: true });
  button(copy.browserConfirmUpload).click(); await wait(() => !!button(copy.browserCancelInstallation));
  update({ state: 'installed', launch: { state: 'ready' as const }, transfer_active: false });
  await wait(() => onContinue.mock.calls.length === 1);
  update({ state: 'installed', launch: { state: 'ready' as const }, transfer_active: false }); expect(onContinue).toHaveBeenCalledTimes(1);
});
it('revokes continuation when the interaction changes while installation continues', async () => {
  const { update, onContinue, setContinuationKey } = mount({ pending: true }); await ready();
  button(copy.browserConfirmUpload).click(); await wait(() => !!button(copy.browserCancelInstallation));
  setContinuationKey('interaction-2'); update({ state: 'installed', launch: { state: 'ready' as const }, transfer_active: false });
  expect(onContinue).not.toHaveBeenCalled();
});
for (const outcome of ['failed', 'cancelled'] as const) {
  it(`does not continue after ${outcome} even if a later snapshot is installed`, async () => {
    const { update, onContinue } = mount({ pending: true }); await ready();
    button(copy.browserConfirmUpload).click(); await wait(() => !!button(copy.browserCancelInstallation));
    update({ state: outcome, transfer_active: false }); update({ state: 'installed', launch: { state: 'ready' as const } });
    expect(onContinue).not.toHaveBeenCalled();
  });
}

it('renders indeterminate cache checking and verification without assigning a non-finite progress value', async () => {
  const { update } = mount(); await ready();
  update({ transfer_active: true, desktop_progress: { phase: 'checking', received_bytes: 0, total_bytes: 183945705 } });
  await wait(() => !!button(copy.browserCancelInstallation));
  expect(document.querySelector('progress')?.hasAttribute('value')).toBe(false);
  update({ transfer_active: true, desktop_progress: { phase: 'downloading', received_bytes: 1234, total_bytes: 183945705 } });
  expect(document.querySelector('progress')?.value).toBe(1234);
  update({ transfer_active: true, desktop_progress: { phase: 'verifying', received_bytes: 183945705, total_bytes: 183945705 } });
  expect(document.querySelector('progress')?.hasAttribute('value')).toBe(false);
});

it('requires system preparation for installed bytes and continues exactly once after system readiness', async () => {
  const { management, onContinue, update } = mount({ pending: true, upload: false, state: 'installed', launch: { state: 'system_preparation_required', action: 'prepare_system', reason: 'browser_sandbox_unavailable' } });
  await ready();
  expect(button(copy.browserContinue)).toBeUndefined();
  expect(management.installBrowser).not.toHaveBeenCalled();
  button(copy.browserSystemPrepare).click();
  await wait(() => !!button(copy.browserSystemCopy));
  expect(management.installBrowser).toHaveBeenCalledExactlyOnceWith({ action: 'prepare_system', package_id: 'chromium-1223-linux-amd64', source: 'download' });
  expect(document.querySelector('textarea')?.value).toContain('browser-system-authorize');
  expect(onContinue).not.toHaveBeenCalled();
  update({ state: 'preparing_system', authorization_command: undefined });
  expect(onContinue).not.toHaveBeenCalled();
  update({ state: 'installed', launch: { state: 'ready' } });
  await wait(() => onContinue.mock.calls.length === 1);
  update({ state: 'installed', launch: { state: 'ready' } });
  expect(onContinue).toHaveBeenCalledOnce();
});
