import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { LinuxPackageUpdateAdapter } from './linuxPackageUpdateAdapter';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  allowDowngrade = true;
  logger: unknown = null;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => [] as string[]);
  quitAndInstall = vi.fn();
}

describe('LinuxPackageUpdateAdapter', () => {
  it('disables silent and prerelease updates, then exposes explicit actions', () => {
    const updater = new FakeUpdater();
    const adapter = new LinuxPackageUpdateAdapter({
      currentVersion: '1.0.0',
      automaticallyChecksForUpdates: () => true,
      setAutomaticallyChecksForUpdates: vi.fn(),
      updater: updater as never,
    });

    adapter.start();

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(adapter.snapshot().capabilities).not.toContain('download');
    updater.emit('update-available', { version: '1.1.0' });
    expect(adapter.snapshot().capabilities).toContain('download');
  });

  it('maps update and download events to stable renderer state', () => {
    const updater = new FakeUpdater();
    const adapter = new LinuxPackageUpdateAdapter({
      currentVersion: '1.0.0',
      automaticallyChecksForUpdates: () => true,
      setAutomaticallyChecksForUpdates: vi.fn(),
      updater: updater as never,
    });
    adapter.start();

    updater.emit('update-available', { version: '1.1.0' });
    expect(adapter.snapshot()).toMatchObject({ state: 'available', available_version: '1.1.0' });
    updater.emit('download-progress', { percent: 45.5 });
    expect(adapter.snapshot()).toMatchObject({ state: 'downloading', download_percent: 45.5 });
    updater.emit('update-downloaded', { version: '1.1.0' });
    expect(adapter.snapshot()).toMatchObject({ state: 'ready', download_percent: 100 });
  });

  it('persists the automatic check preference and installs only on request', async () => {
    const updater = new FakeUpdater();
    const persist = vi.fn();
    const adapter = new LinuxPackageUpdateAdapter({
      currentVersion: '1.0.0',
      automaticallyChecksForUpdates: () => true,
      setAutomaticallyChecksForUpdates: persist,
      updater: updater as never,
    });
    adapter.start();

    adapter.setAutomaticallyChecksForUpdates(false);
    adapter.installUpdate();

    expect(persist).toHaveBeenCalledWith(false);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});
