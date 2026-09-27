import type { FlowerChromeStatus } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { FlowerComputerConnections } from '../../../../flower_ui/src/FlowerComputerConnections';
import { FlowerChromeConnection } from '../../../../flower_ui/src/FlowerChromeConnection';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
import deDE from './i18n/locales/catalogs/de-DE.json';
import jaJP from './i18n/locales/catalogs/ja-JP.json';
import { computerUseEnUS } from '../../../../flower_ui/src/computerUseCopy';
import { adapter, waitFor } from './FlowerSurface.navigation.testHarness';

function buttonText(button: Element): string {
  const content = button.cloneNode(true) as Element;
  content.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
  return content.textContent ?? '';
}

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; });

it('offers a separate browser without pretending that preparation connected or authorized a page', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const prepared = vi.fn(), connected = vi.fn();
  const management = {
    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture', extension_home_path: ['fixture'], platform: 'linux', native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn(), prepareRemoteBrowser: vi.fn().mockResolvedValue(undefined),
    loadExtensionStatus: vi.fn().mockResolvedValue({ platform: 'linux', installations: [{ id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chromium_snap', name: 'Chromium (Snap)', installed: true, prepared: true, connected: false, reason: 'desktop_session_unavailable' }], profiles: [] }),
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection management={management} copy={computerUseEnUS} onConnected={connected} onRemoteBrowserPrepared={prepared} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text);
  await waitFor(() => Boolean(button(computerUseEnUS.chromeRemotePrepare)));
  expect(button(computerUseEnUS.openExtensions)).toBeUndefined();
  expect(host.textContent).not.toContain(computerUseEnUS.chromeDesktopHint);
  expect(management.prepareRemoteBrowser).not.toHaveBeenCalled();
  button(computerUseEnUS.chromeRemotePrepare)!.click();
  await waitFor(() => prepared.mock.calls.length === 1);
  expect(management.prepareRemoteBrowser).toHaveBeenCalledExactlyOnceWith('browser-aaaaaaaaaaaaaaaaaaaaaaaa', expect.any(AbortSignal));
  expect(connected).not.toHaveBeenCalled(); expect(management.openExtension).not.toHaveBeenCalled();
});

it('cancels only the pending handoff when the browser guide closes', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let finish!: () => void;
  const prepared = vi.fn();
  const management = {
    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture', extension_home_path: ['fixture'], platform: 'linux', native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn(), prepareRemoteBrowser: vi.fn((_id: string, _signal: AbortSignal) => new Promise<void>(resolve => { finish = resolve; })),
    loadExtensionStatus: vi.fn().mockResolvedValue({ platform: 'linux', installations: [{ id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chromium_snap', name: 'Chromium (Snap)', installed: true, prepared: true, connected: false }], profiles: [] }),
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection management={management} copy={computerUseEnUS} onConnected={vi.fn()} onRemoteBrowserPrepared={prepared} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!host.querySelector('[data-remote-browser-setup] button'));
  host.querySelector<HTMLButtonElement>('[data-remote-browser-setup] button')!.click();
  await waitFor(() => !!finish);
  const signal = management.prepareRemoteBrowser.mock.calls[0][1];
  dispose(); dispose = undefined; finish(); await Promise.resolve();
  expect(signal.aborted).toBe(true); expect(prepared).not.toHaveBeenCalled();
});

it('prepares Chrome automatically and continues only after a real connection', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const connected = vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [] });
  const continued = vi.fn().mockResolvedValue(undefined);
  const management = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser fixture', platform: 'darwin', extension_home_path: ['Redeven', 'Flower Browser fixture'], native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn().mockResolvedValue(undefined), loadExtensionStatus: connected,
  };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open connectionOnly onContinue={continued} onOpenChange={() => undefined} threadID="thread"
    adapter={{ ...adapter(true), computerManagement: management }} copy={computerUseEnUS} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item => buttonText(item) === text)!;
  await waitFor(() => management.setupExtension.mock.calls.length === 1);
  await waitFor(() => !!button(computerUseEnUS.openExtensions));
  expect(button(computerUseEnUS.openConnection), 'connection action waits until the installation step is complete').toBeUndefined();
  expect(document.querySelector<HTMLInputElement>('input[readonly]')?.checkVisibility(), 'technical paths stay out of the initial guide').toBe(false);
  expect(document.body.textContent).not.toContain('fixture.host');
  expect(document.querySelector('select')).toBeNull();
  expect(continued).not.toHaveBeenCalled();
  button(computerUseEnUS.openExtensions).click();
  await waitFor(() => management.openExtension.mock.calls.length === 1);
  expect(management.openExtension).toHaveBeenCalledWith('extensions', 'browser-aaaaaaaaaaaaaaaaaaaaaaaa');
  await waitFor(() => document.body.textContent?.includes('Developer mode') === true);
  expect(document.body.textContent).toContain('Load unpacked');
  button(computerUseEnUS.setupInstalled).click();
  expect(button(computerUseEnUS.openExtensions)).toBeUndefined();
  expect(continued).not.toHaveBeenCalled();
  button(computerUseEnUS.openConnection).click();
  await waitFor(() => management.openExtension.mock.calls.length === 2);
  expect(management.openExtension).toHaveBeenLastCalledWith('connect', 'browser-aaaaaaaaaaaaaaaaaaaaaaaa');
  expect(continued).not.toHaveBeenCalled();
  connected.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'profile', name: 'Chrome' }] });
  await waitFor(() => continued.mock.calls.length === 1);
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(management.listCandidates).not.toHaveBeenCalled(); expect(management.loadAccess).not.toHaveBeenCalled();
});

it('starts with reconnection after prior setup and keeps installation available as a separate action', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const loadExtensionStatus = vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], prepared: true, profiles: [] });
  const continued = vi.fn().mockResolvedValue(undefined);
  const management = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser fixture', platform: 'darwin', extension_home_path: ['Redeven', 'Flower Browser fixture'], native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn(), loadExtensionStatus,
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection reuseConnected
    management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === text);
  await waitFor(() => Boolean(button(computerUseEnUS.openConnection)));
  expect(button(computerUseEnUS.openExtensions)).toBeUndefined();
  expect(host.textContent).not.toContain(computerUseEnUS.extensionHint);
  expect(continued).not.toHaveBeenCalled();
  button(computerUseEnUS.setupBack)!.click();
  expect(button(computerUseEnUS.openExtensions)).toBeDefined();
  loadExtensionStatus.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], prepared: true, profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'restored', name: 'Chrome' }] });
  await waitFor(() => continued.mock.calls.length === 1);
  expect(management.openExtension).not.toHaveBeenCalled();
});

it('does not continue a closed guide when profile discovery finishes late', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let resolve!: (value: FlowerChromeStatus) => void;
  const continued = vi.fn();
  const management = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser fixture', platform: 'darwin', extension_home_path: ['Redeven', 'Flower Browser fixture'], native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn(), loadExtensionStatus: vi.fn(() => new Promise<FlowerChromeStatus>(done => { resolve = done; })),
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection reuseConnected
    management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  await waitFor(() => !!resolve);
  stop(); host.remove();
  resolve({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'profile', name: 'Chrome' }] });
  await new Promise(done => setTimeout(done, 50));
  expect(continued).not.toHaveBeenCalled();
});

it('allows adding a second Chrome profile without treating the existing connection as completion', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const profiles = vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'first', name: 'Personal' }] });
  const continued = vi.fn().mockResolvedValue(undefined);
  const management = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser fixture', platform: 'darwin', extension_home_path: ['Redeven', 'Flower Browser fixture'], native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn(), loadExtensionStatus: profiles,
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => management.setupExtension.mock.calls.length === 1);
  expect(continued).not.toHaveBeenCalled();
  expect(host.querySelector('[data-flower-chrome-connection]')).not.toBeNull();
  profiles.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'first', name: 'Personal' }, { installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'second', name: 'Work' }] });
  await waitFor(() => continued.mock.calls.length === 1);
  expect(host.textContent).toContain(computerUseEnUS.pairingSaved);
  expect(management.selectCandidate).not.toHaveBeenCalled();
  expect(management.saveAccess).not.toHaveBeenCalled();
});

it('stops after a failed automatic continuation and exposes explicit retry without leaking errors', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const continued = vi.fn().mockRejectedValue(new Error('private adapter details'));
  const management = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

    loadExtensionStatus: vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'first', name: 'Personal' }] }),
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection reuseConnected management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!host.querySelector('[role="alert"]'));
  expect(continued).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain('private adapter details');
  expect(management.loadExtensionStatus).toHaveBeenCalledTimes(1);
  continued.mockResolvedValue(undefined);
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => buttonText(button) === computerUseEnUS.continueTask)!.click();
  await waitFor(() => continued.mock.calls.length === 2);
});

for (const [locale, copy, platform] of [['en-US', computerUseEnUS, 'darwin'], ['zh-CN', zhCN.flowerSurface.computer, 'darwin'], ['de-DE', deDE.flowerSurface.computer, 'linux'], ['ja-JP', jaJP.flowerSurface.computer, 'darwin']] as const) {
  it(`keeps Chrome guidance focused and supports skip, back, help and open failure in ${locale}`, async () => {
    const { page, userEvent } = await import('vitest/browser');
    const host = document.createElement('div'); document.body.append(host);
    const continued = vi.fn();
    const management = {
      listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

      setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser 123456789abcdef0', platform, extension_home_path: ['Redeven', 'Flower Browser 123456789abcdef0'], native_host: 'fixture.host', extension_id: 'fixture' }),
      openExtension: vi.fn().mockRejectedValueOnce(new Error('private open details')).mockResolvedValue(undefined),
      loadExtensionStatus: vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [] }),
    };
    const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open connectionOnly onContinue={continued} onOpenChange={() => undefined} threadID="guided-thread"
      adapter={{ ...adapter(true), computerManagement: management }} copy={copy} /></LayoutProvider></FloeConfigProvider>, host);
    dispose = () => { stop(); host.remove(); };
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => buttonText(item) === text)!;
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
    const primary = () => [...dialog().querySelectorAll<HTMLButtonElement>('button.bg-primary')].filter(item => item.checkVisibility());
    try {
      await page.viewport(1000, 720);
      await waitFor(() => !!button(copy.openExtensions));
      await waitFor(() => dialog().getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'));
      expect(primary()).toHaveLength(1);
      expect(buttonText(primary()[0])).toBe(copy.openExtensions);
      expect(dialog().getBoundingClientRect().height).toBeLessThan(400);
      expect(dialog().innerText).not.toContain(copy.setupHostHint);
      expect(dialog().innerText).not.toContain('/fixture/');
      if (import.meta.env.VITE_CHROME_GUIDE_SCREENSHOT === '1') await page.screenshot({ element: dialog(), path: `__screenshots__/chrome-guide-${locale}-start.png` });
      button(copy.openExtensions).click();
      await waitFor(() => !!dialog().querySelector('[role="alert"]'));
      expect(dialog().innerText).not.toContain('private open details');
      expect(dialog().querySelector('[aria-current="step"]')?.textContent).toContain(copy.setupInstallTitle);
      button(copy.setupAlreadyInstalled).focus(); await userEvent.keyboard('{Enter}');
      expect(primary()).toHaveLength(1);
      expect(buttonText(primary()[0])).toBe(copy.openConnection);
      expect(dialog().querySelector('[role="alert"]')).toBeNull();
      button(copy.setupBack).focus(); await userEvent.keyboard('{Enter}');
      button(copy.openExtensions).click();
      await waitFor(() => !!button(copy.setupInstalled));
      expect(primary()).toHaveLength(1);
      expect(dialog().innerText).toContain(copy.setupDeveloperMode);
      expect(dialog().innerText).not.toContain(copy.setupLoadUnpacked);
      expect(dialog().innerText).toContain(copy.setupDragFolderHint);
      expect(dialog().innerText).toContain(copy.setupInstallDone);
      expect(dialog().querySelector('[data-extension-folder-route]')?.textContent).toContain('Redeven');
      expect(dialog().querySelector('[data-extension-folder-route]')?.textContent).toContain('Flower Browser 123456789abcdef0');
      expect(button(copy.copyExtensionPath).checkVisibility()).toBe(false);
      expect(dialog().innerText).toContain(copy.setupFolderHint);
      if (import.meta.env.VITE_CHROME_GUIDE_SCREENSHOT === '1') await page.screenshot({ element: dialog(), path: `__screenshots__/chrome-guide-${locale}-install.png` });
      button(copy.openExtensionFolder).focus(); await userEvent.keyboard('{Enter}');
      await waitFor(() => !button(copy.openExtensionFolder).disabled);
      expect(management.openExtension).toHaveBeenLastCalledWith('folder', 'browser-aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(continued).not.toHaveBeenCalled();
      const manual = [...dialog().querySelectorAll('summary')].find(item => item.textContent === copy.setupManualInstall)!;
      expect(manual.parentElement?.hasAttribute('open')).toBe(false);
      manual.focus(); await userEvent.keyboard('{Enter}');
      expect(dialog().innerText).toContain(copy.setupLoadUnpacked);
      expect(dialog().innerText).toContain(copy.setupChooseFolder);
      expect(manual.parentElement?.querySelector('kbd')?.textContent).toBe(platform === 'darwin' ? '⌘⇧H' : 'Alt+Home');
      if (import.meta.env.VITE_CHROME_GUIDE_SCREENSHOT === '1') await page.screenshot({ element: dialog(), path: `__screenshots__/chrome-guide-${locale}-manual.png` });
      manual.focus(); await userEvent.keyboard('{Enter}');
      expect(dialog().innerText).not.toContain(copy.setupLoadUnpacked);
      const summary = [...dialog().querySelectorAll('summary')].find(item => item.textContent === copy.setupHelp)!;
      summary.focus(); await userEvent.keyboard('{Enter}');
      const path = dialog().querySelector<HTMLInputElement>('input[readonly]')!;
      expect(path.checkVisibility()).toBe(true);
      expect(path.value).toContain('/fixture/');
      summary.focus(); await userEvent.keyboard('{Enter}');
      expect(path.checkVisibility()).toBe(false);
      await page.viewport(390, 720);
      expect(dialog().scrollWidth).toBeLessThanOrEqual(dialog().clientWidth + 1);
      await expect.poll(() => button(copy.setupInstalled).getBoundingClientRect().right).toBeLessThanOrEqual(390);
      if (import.meta.env.VITE_CHROME_GUIDE_SCREENSHOT === '1') await page.screenshot({ element: dialog(), path: `__screenshots__/chrome-guide-${locale}-narrow.png` });
      button(copy.setupInstalled).click();
      expect(continued).not.toHaveBeenCalled();
      button(copy.openConnection).click();
      await waitFor(() => management.openExtension.mock.calls.length === 4);
      await waitFor(() => dialog().querySelector('[role="status"]')?.textContent === copy.setupConfirming);
      expect(continued).not.toHaveBeenCalled();
      expect(primary()).toHaveLength(1);
      await page.viewport(1000, 720);
      if (import.meta.env.VITE_CHROME_GUIDE_SCREENSHOT === '1') await page.screenshot({ element: dialog(), path: `__screenshots__/chrome-guide-${locale}-connect.png` });
    } finally { await page.viewport(1280, 720); }
  });
}


it('routes an incompatible installed extension back to update without continuing the task', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const continued = vi.fn();
  const loadExtensionStatus = vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [] });
  const management = {
    listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),

    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser fixture', platform: 'darwin', extension_home_path: ['Redeven', 'Flower Browser fixture'], native_host: 'fixture.host', extension_id: 'fixture' }),
    openExtension: vi.fn().mockResolvedValue(undefined), loadExtensionStatus,
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection reuseConnected management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => buttonText(item) === text)!;
  await waitFor(() => !!button(computerUseEnUS.setupAlreadyInstalled));
  button(computerUseEnUS.setupAlreadyInstalled).click();
  button(computerUseEnUS.openConnection).click();
  loadExtensionStatus.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false, reason: 'extension_update_required' }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'stale', name: 'Outdated Chrome' }] });
  await waitFor(() => host.textContent?.includes(computerUseEnUS.setupUpdateTitle) === true);
  expect(host.textContent).toContain(computerUseEnUS.setupUpdateHint);
  expect(button(computerUseEnUS.setupAlreadyInstalled)).toBeUndefined();
  expect(continued).not.toHaveBeenCalled();
  button(computerUseEnUS.openExtensions).click();
  await waitFor(() => !!button(computerUseEnUS.setupInstalled));
  expect(host.querySelector('[data-extension-folder-route]')?.textContent).toContain('Flower Browser fixture');
  button(computerUseEnUS.setupInstalled).click();
  loadExtensionStatus.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [] });
  button(computerUseEnUS.openConnection).click();
  expect(continued).not.toHaveBeenCalled();
  loadExtensionStatus.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'updated', name: 'Chrome' }] });
  await waitFor(() => continued.mock.calls.length === 1);
});

it('explains missing Chrome resources before preparation and copies only safe diagnosis fields', async () => {
  const { page } = await import('vitest/browser');
  const host = document.createElement('div'); document.body.append(host);
  const management = { listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    setupExtension: vi.fn(), openExtension: vi.fn(), loadExtensionStatus: vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [], hostname: 'udesk26', platform: 'linux', browser_installed: true,
      diagnostic: { stage: 'prepare', reason: 'browser_resources_missing', detail: '/private/secret' } }) };
  const continued = vi.fn();
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open connectionOnly threadID="thread" onOpenChange={() => undefined}
    adapter={{ ...adapter(true), computerManagement: management }} copy={zhCN.flowerSurface.computer} onContinue={continued} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!document.querySelector('[data-chrome-diagnostic]'));
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.innerText).toContain('udesk26');
  expect(dialog.innerText).toContain(zhCN.flowerSurface.computer.chromeResourcesTitle);
  expect(dialog.innerText).toContain(zhCN.flowerSurface.computer.chromeBrowserDetected);
  expect(dialog.innerText).not.toContain(zhCN.flowerSurface.computer.setupFailed);
  expect(management.setupExtension).not.toHaveBeenCalled();
  expect(continued).not.toHaveBeenCalled();
  [...dialog.querySelectorAll('summary')].find(item => item.textContent === zhCN.flowerSurface.computer.details)!.click();
  const details = [...dialog.querySelectorAll('summary')].find(item => item.textContent === zhCN.flowerSurface.computer.chromeDiagnostics)!;
  details.click();
  const diagnostic = dialog.querySelector('textarea')!;
  expect(diagnostic.value).toContain('browser_resources_missing');
  expect(diagnostic.value).not.toContain('/private/secret');
  await page.viewport(390, 720);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  if (import.meta.env.VITE_CHROME_GUIDE_SCREENSHOT === '1') await page.screenshot({ element: dialog, path: '__screenshots__/chrome-diagnostics-missing-resources.png' });
  await page.viewport(1280, 720);
});

it('keeps installation guidance during a failed status check and resumes only a real connection', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const continued = vi.fn().mockResolvedValue(undefined);
  const status = vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false, reason: 'desktop_session_unavailable' }], profiles: [], hostname: 'udesk26', platform: 'linux', browser_installed: true });
  const management = { listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    loadExtensionStatus: status, openExtension: vi.fn(), setupExtension: vi.fn().mockResolvedValue({ extension_path: '/home/tang/Redeven/Flower Browser fixture', extension_home_path: ['Redeven', 'Flower Browser fixture'], platform: 'linux', extension_id: 'mgfbpkkmocckooenpdfpefknffjanjce', native_host: 'dev.floegence.redeven.r123456789abcdef0' }) };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection reuseConnected management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!host.querySelector('input[readonly]'));
  expect(host.textContent).toContain(computerUseEnUS.chromeDesktopTitle);
  expect(management.setupExtension).toHaveBeenCalledOnce();
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonText(button) === computerUseEnUS.setupInstalled)!.click();
  expect([...host.querySelectorAll('button')].some(button => buttonText(button) === computerUseEnUS.chromeCopyConnectionLink)).toBe(true);
  expect([...host.querySelectorAll('input')].some(input => input.value === 'chrome-extension://mgfbpkkmocckooenpdfpefknffjanjce/popup.html#dev.floegence.redeven.r123456789abcdef0')).toBe(true);
  expect(management.openExtension).not.toHaveBeenCalled();
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonText(button) === computerUseEnUS.setupBack)!.click();
  status.mockRejectedValue(new Error('private transport detail'));
  await waitFor(() => host.textContent?.includes(computerUseEnUS.chromeCheckFailed) === true);
  expect([...host.querySelectorAll('button')].some(button => buttonText(button) === computerUseEnUS.openExtensions)).toBe(true);
  expect(host.querySelector('input[readonly]')).not.toBeNull();
  expect(host.textContent).not.toContain('private transport detail');
  status.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'connected', name: 'Chrome' }] });
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonText(button) === computerUseEnUS.retryConnection)!.click();
  await waitFor(() => continued.mock.calls.length === 1);
});

it('keeps an application launch failure visible with its diagnostic ID', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const management = { listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    loadExtensionStatus: vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [] }),
    setupExtension: vi.fn().mockResolvedValue({ extension_path: '/fixture/Redeven/Flower Browser fixture', extension_home_path: ['Redeven', 'Flower Browser fixture'], platform: 'linux' }),
    openExtension: vi.fn().mockRejectedValue({ code: 'browser_start_failed', data: { stage: 'open', reason: 'browser_start_failed', diagnostic_id: 'launch-fixture-123', stderr: 'secret launch details' } }) };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection management={management} copy={computerUseEnUS} onConnected={vi.fn()} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!host.querySelector('button'));
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonText(button) === computerUseEnUS.openExtensions)!.click();
  await waitFor(() => host.textContent?.includes(computerUseEnUS.chromeLaunchTitle) === true);
  expect(host.querySelector('textarea')?.value).toContain('launch-fixture-123');
  expect(host.querySelector('textarea')?.value).not.toContain('secret launch details');
  expect(host.textContent).not.toContain(computerUseEnUS.setupTimeout);
});

it('restarts connection observation when a manual connection link is copied after a status failure', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const continued = vi.fn().mockResolvedValue(undefined);
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  const status = vi.fn().mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false, reason: 'desktop_session_unavailable' }], profiles: [] });
  const management = { listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    loadExtensionStatus: status, openExtension: vi.fn(), setupExtension: vi.fn().mockResolvedValue({
      extension_path: '/fixture/Flower Browser', extension_home_path: ['Flower Browser'], platform: 'linux',
      extension_id: 'mgfbpkkmocckooenpdfpefknffjanjce', native_host: 'dev.floegence.redeven.r123456789abcdef0',
    }) };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection reuseConnected management={management} copy={computerUseEnUS} onConnected={continued} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); clipboard.mockRestore(); };
  await waitFor(() => host.textContent?.includes(computerUseEnUS.setupInstalled) === true);
  status.mockRejectedValue(new Error('connection temporarily unavailable'));
  await waitFor(() => host.textContent?.includes(computerUseEnUS.chromeCheckFailed) === true);
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonText(button) === computerUseEnUS.setupInstalled)!.click();
  status.mockResolvedValue({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: false, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'confirmed', name: 'Chrome' }] });
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonText(button) === computerUseEnUS.chromeCopyConnectionLink)!.click();
  await waitFor(() => continued.mock.calls.length === 1);
  expect(clipboard).toHaveBeenCalledWith('chrome-extension://mgfbpkkmocckooenpdfpefknffjanjce/popup.html#dev.floegence.redeven.r123456789abcdef0');
  expect(management.setupExtension).toHaveBeenCalledOnce();
  expect(management.openExtension).not.toHaveBeenCalled();
});

it('retries a recorded preparation failure for the selected installation after repair', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const setupExtension = vi.fn().mockResolvedValue({ extension_path: '/fixture', extension_home_path: ['fixture'], platform: 'linux', extension_id: 'fixture', native_host: 'fixture' });
  const status = { installations: [{ id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chromium_snap' as const, name: 'Chromium (Snap)', installed: true, prepared: false, connected: false,
    reason: 'extension_setup_failed', diagnostic: { stage: 'prepare' as const, reason: 'extension_setup_failed', diagnostic_id: 'repair-fixture' } }], profiles: [] };
  const management = { listCandidates: vi.fn(), selectCandidate: vi.fn(), loadAccess: vi.fn(), saveAccess: vi.fn(),
    setupExtension, openExtension: vi.fn(), loadExtensionStatus: vi.fn().mockResolvedValue(status) };
  const stop = render(() => <FloeConfigProvider><LayoutProvider><FlowerComputerConnections open connectionOnly threadID="thread" onOpenChange={() => undefined}
    adapter={{ ...adapter(true), computerManagement: management }} copy={computerUseEnUS} /></LayoutProvider></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => setupExtension.mock.calls.length === 1);
  expect(setupExtension).toHaveBeenCalledWith('browser-aaaaaaaaaaaaaaaaaaaaaaaa');
});


it('keeps desktop-only instructions out of the separate-browser preparation transition', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let finish!: (value: import('../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerComputerExtensionSetup) => void;
  const management = {
    setupExtension: vi.fn(() => new Promise<import('../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerComputerExtensionSetup>(resolve => { finish = resolve; })),
    openExtension: vi.fn(), prepareRemoteBrowser: vi.fn(),
    loadExtensionStatus: vi.fn().mockResolvedValue({ platform: 'linux', installations: [{ id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', kind: 'chromium_snap', name: 'Chromium (Snap)', installed: true, prepared: true, connected: false, reason: 'desktop_session_unavailable' }], profiles: [] }),
  };
  const stop = render(() => <FloeConfigProvider><FlowerChromeConnection management={management} copy={computerUseEnUS} onConnected={vi.fn()} /></FloeConfigProvider>, host);
  dispose = () => { stop(); host.remove(); };
  await waitFor(() => !!finish);
  expect(host.textContent).toContain(computerUseEnUS.setupPreparing);
  expect(host.textContent).not.toContain(computerUseEnUS.chromeDesktopHint);
  expect(host.textContent).not.toContain(computerUseEnUS.setupInstallTitle);
  expect(host.querySelector('[data-remote-browser-setup]')).toBeNull();
  finish({ installation_id: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa', browser_name: 'Chromium (Snap)', extension_path: '/fixture', extension_home_path: ['fixture'], platform: 'linux', native_host: 'fixture.host', extension_id: 'fixture' });
  await waitFor(() => !!host.querySelector('[data-remote-browser-setup]'));
  expect(host.textContent).not.toContain(computerUseEnUS.chromeDesktopHint);
});
