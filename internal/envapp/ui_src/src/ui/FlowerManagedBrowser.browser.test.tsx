import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { FlowerManagedBrowser } from '../../../../flower_ui/src/FlowerManagedBrowser';
import { computerUseEnUS as copy, type FlowerComputerCopy } from '../../../../flower_ui/src/computerUseCopy';
import type { FlowerBrowserInstallation, FlowerComputerManagement } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
import deDE from './i18n/locales/catalogs/de-DE.json';

let dispose: (() => void) | undefined;
afterEach(async () => { dispose?.(); dispose = undefined; document.documentElement.classList.remove('dark'); await page.viewport(1280, 800); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
const wait = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 4000 });
function mount(options: { pending?: boolean; upload?: boolean; state?: FlowerBrowserInstallation['state']; copy?: FlowerComputerCopy; size?: number } = {}) {
  let state: FlowerBrowserInstallation = { enabled: true, state: options.state ?? 'not_installed', directory: '/environment/state/computer/browser', received_bytes: 0,
    package: { name: 'Chrome for Testing', id: 'chromium-1223-linux-amd64', platform: 'linux', architecture: 'amd64', version: '148.0.7778.96', url: 'https://cdn.playwright.dev/example.zip', size_bytes: options.size ?? 183945705, installed_bytes: 393407709 } };
  const management: FlowerComputerManagement = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    browserUploadSupported: options.upload ?? true,
    loadBrowserInstallation: vi.fn(async () => ({ ...state })),
    saveBrowserEnabled: vi.fn(async enabled => { state = { ...state, enabled, state: state.state === 'uploading' ? 'cancelled' : state.state }; return state; }),
    installBrowser: vi.fn(async request => {
      if (request.action === 'start') state = { ...state, state: request.source === 'upload' ? 'uploading' : 'downloading', operation_id: 'install-1' };
      if (request.action === 'chunk') state = { ...state, received_bytes: request.offset! + atob(request.data!).length };
      if (request.action === 'complete') state = { ...state, state: 'installed' };
      if (request.action === 'cancel') state = { ...state, state: 'cancelled' };
      return { ...state };
    }),
  };
  const onContinue = vi.fn().mockResolvedValue(undefined), labels = options.copy ?? copy;
  const host = document.createElement('div'); document.body.append(host);
  const stop = render(() => <FloeConfigProvider><LayoutProvider><Dialog open onOpenChange={() => undefined} title={labels.managed} closeLabel={labels.close}
    class="flower-computer-dialog w-[min(42rem,94vw)] max-w-[42rem]" contentClass="flower-computer-content">
    <div class="flower-computer-panel"><div class="flower-computer-environment"><span>{labels.environmentTitle}</span><span>Build Server</span></div>
      <FlowerManagedBrowser management={management} copy={labels} canMutate onContinue={options.pending ? onContinue : undefined} />
    </div>
  </Dialog></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  return { management, onContinue, update: (value: Partial<FlowerBrowserInstallation>) => { state = { ...state, ...value }; } };
}
const ready = () => wait(() => Boolean(document.querySelector('[role="switch"]:not(:disabled)')));
const setFile = (size: number) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(size)], 'browser.zip', { type: 'application/zip' }));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
};
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
  const { management, onContinue, update } = mount({ pending: true }); await ready();
  button(copy.browserConfirmDownload).click(); await wait(() => !!button(copy.cancel));
  expect(management.installBrowser).toHaveBeenCalledExactlyOnceWith({ action: 'start', package_id: 'chromium-1223-linux-amd64', source: 'download' });
  expect(onContinue).not.toHaveBeenCalled(); update({ state: 'installed' });
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
it('rejects mismatched files and uploads matching bytes in ordered bounded chunks', async () => {
  const { management } = mount({ size: 300000 }); await ready();
  document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click(); setFile(3);
  button(copy.browserConfirmUpload).click(); await wait(() => !!document.querySelector('[role="alert"]'));
  expect(management.installBrowser).not.toHaveBeenCalled();
  setFile(300000); button(copy.browserConfirmUpload).click(); await wait(() => document.body.textContent?.includes(copy.browserReadyHint) === true);
  const calls = vi.mocked(management.installBrowser!).mock.calls.map(([request]) => request);
  expect(calls.map(request => request.action)).toEqual(['start', 'chunk', 'chunk', 'complete']);
  expect(calls[1].offset).toBe(0); expect(calls[2].offset).toBe(262144);
  expect(atob(calls[1].data!).length).toBe(262144); expect(atob(calls[2].data!).length).toBe(37856);
});
it('cancels an upload whose start completes after the dialog closes', async () => {
  const { management } = mount({ size: 32 }); await ready();
  let finish!: (value: FlowerBrowserInstallation) => void;
  const current = await management.loadBrowserInstallation!();
  vi.mocked(management.installBrowser!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click(); setFile(32);
  button(copy.browserConfirmUpload).click(); await wait(() => !!finish); dispose?.(); dispose = undefined;
  finish({ ...current, state: 'uploading', operation_id: 'late' });
  await wait(() => vi.mocked(management.installBrowser!).mock.calls.length === 2);
  expect(management.installBrowser).toHaveBeenLastCalledWith({ action: 'cancel', operation_id: 'late' });
});
it('explains the web upload limitation and supports keyboard toggling', async () => {
  const { management } = mount({ upload: false }); await ready();
  expect(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].disabled).toBe(true);
  const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')!; toggle.focus();
  await userEvent.keyboard(' '); await wait(() => vi.mocked(management.saveBrowserEnabled!).mock.calls.length === 1);
  expect(management.installBrowser).not.toHaveBeenCalled();
});
for (const [locale, labels, width, dark] of [['zh-CN', zhCN.flowerSurface.computer, 1280, false], ['zh-CN-dark', zhCN.flowerSurface.computer, 1280, true], ['de-DE-mobile', deDE.flowerSurface.computer, 390, false]] as const) {
  it(`keeps installation choices readable in ${locale}`, async () => {
    await page.viewport(width, 850); document.documentElement.classList.toggle('dark', dark);
    mount({ copy: labels }); await ready();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await wait(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    for (const card of dialog.querySelectorAll<HTMLElement>('.flower-browser-source-grid label')) {
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1); expect(getComputedStyle(card).cursor).toBe('pointer');
    }
    expect(button(labels.browserConfirmDownload).getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    if (import.meta.env.VITE_FLOWER_COMPUTER_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/browser-install-${locale}.png` });
  });
}
