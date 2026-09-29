import { expect, it, vi } from 'vitest';
import { browserSourcePort } from './browserSourcePort';
import type { BrowserSourceOperation, BrowserSourceService } from './browserSourceContract';

it('keeps installation chunks and arbitrary host operations outside the browser document', async () => {
  const install = vi.fn(), select = vi.fn();
  const service = { management: { installBrowser: install } } as unknown as BrowserSourceService;
  const bridge = browserSourcePort(service, select, vi.fn());
  for (const operation of [
    { method: 'fetch', url: '/private' },
    { method: 'source.install', request: { action: 'chunk', operation_id: 'op', offset: 0, data: 'AA==' } },
    { method: 'source.openExtension', action: 'execute' },
    { method: 'source.select', selection: { label: 'Bad selection', request: { connection: { extension_profile_id: 'personal', tab_id: '7' } } } },
  ]) await expect(bridge.execute(operation as BrowserSourceOperation, new AbortController().signal)).rejects.toThrow('unavailable');
  expect(install).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
it('subscribes to the environment installer and disposes the existing subscription', async () => {
  const dispose = vi.fn(), updates = vi.fn();
  const subscribe = vi.fn(() => dispose);
  const bridge = browserSourcePort({ management: { subscribeBrowserInstallation: subscribe } } as unknown as BrowserSourceService, vi.fn(), updates);
  const signal = new AbortController().signal;
  await bridge.execute({ method: 'source.watch', enabled: true }, signal);
  expect(subscribe).toHaveBeenCalledWith(updates);
  await bridge.execute({ method: 'source.watch', enabled: true }, signal);
  expect(dispose).toHaveBeenCalledTimes(1);
  bridge.close(); bridge.close();
  expect(dispose).toHaveBeenCalledTimes(2);
});
it('preserves the personal profile selection and strips unrelated request fields', async () => {
  const select = vi.fn();
  const bridge = browserSourcePort({ management: {} } as BrowserSourceService, select, vi.fn());
  await bridge.execute({ method: 'source.select', selection: { label: 'Personal profile', request: { connection: { extension_profile_id: 'personal', injected: 'not forwarded' } } } } as BrowserSourceOperation, new AbortController().signal);
  expect(select).toHaveBeenCalledWith({ label: 'Personal profile', request: { connection: { extension_profile_id: 'personal' } } }, expect.any(AbortSignal));
});

it('rejects renderer executable paths and requires a discovered installation identity', async () => {
  const setup = vi.fn(), open = vi.fn();
  const bridge = browserSourcePort({ management: { setupExtension: setup, openExtension: open } } as unknown as BrowserSourceService, vi.fn(), vi.fn());
  const signal = new AbortController().signal;
  await expect(bridge.execute({ method: 'source.setup', installationID: '/usr/bin/chromium' }, signal)).rejects.toThrow('unavailable');
  await bridge.execute({ method: 'source.setup', installationID: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa' }, signal);
  expect(setup).toHaveBeenCalledExactlyOnceWith('browser-aaaaaaaaaaaaaaaaaaaaaaaa');
  expect(open).not.toHaveBeenCalled();
});

it('limits independent browser preparation to an opaque installation and forwards cancellation', async () => {
  const prepareRemoteBrowser = vi.fn();
  const bridge = browserSourcePort({ management: { prepareRemoteBrowser } } as unknown as BrowserSourceService, vi.fn(), vi.fn());
  const signal = new AbortController().signal;
  await expect(bridge.execute({ method: 'source.remoteBrowser', installationID: '/usr/bin/chromium' } as BrowserSourceOperation, signal)).rejects.toThrow('unavailable');
  await bridge.execute({ method: 'source.remoteBrowser', installationID: 'browser-aaaaaaaaaaaaaaaaaaaaaaaa' } as BrowserSourceOperation, signal);
  expect(prepareRemoteBrowser).toHaveBeenCalledExactlyOnceWith('browser-aaaaaaaaaaaaaaaaaaaaaaaa', signal);
});
