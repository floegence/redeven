import { describe, expect, it, vi } from 'vitest';

import type { DesktopUpdateSnapshot } from '../shared/desktopUpdateIPC';
import { DesktopUpdateCoordinator, type DesktopUpdateAdapter } from './desktopUpdateCoordinator';

function adapterFixture(platform: DesktopUpdateAdapter['platform'] = 'linux_package') {
  let snapshot: DesktopUpdateSnapshot = {
    platform,
    state: 'idle',
    current_version: '1.0.0',
    automatically_checks_for_updates: true,
    capabilities: ['check', 'open_update_ui', 'automatic_checks', 'download'],
  };
  let listener: ((next: DesktopUpdateSnapshot) => void) | null = null;
  let installListener: ((continueInstallation: () => void) => void) | null = null;
  const adapter: DesktopUpdateAdapter = {
    platform,
    start: vi.fn(),
    snapshot: () => snapshot,
    subscribe: (nextListener) => {
      listener = nextListener;
      return () => { listener = null; };
    },
    subscribeInstallRequest: (nextListener) => {
      installListener = nextListener;
      return () => { installListener = null; };
    },
    checkForUpdates: vi.fn(() => {
      snapshot = { ...snapshot, state: 'checking' };
      listener?.(snapshot);
    }),
    openUpdateUI: vi.fn(),
    setAutomaticallyChecksForUpdates: vi.fn((enabled: boolean) => {
      snapshot = { ...snapshot, automatically_checks_for_updates: enabled };
    }),
    downloadUpdate: vi.fn(),
    cancelDownload: vi.fn(),
    installUpdate: vi.fn(),
  };
  return {
    adapter,
    emitInstall: (continueInstallation: () => void) => installListener?.(continueInstallation),
  };
}

function coordinatorFixture(adapter: DesktopUpdateAdapter | null) {
  const prepareForInstallation = vi.fn(async () => undefined);
  const requestRendererUI = vi.fn();
  const coordinator = new DesktopUpdateCoordinator({
    adapter,
    currentVersion: '1.0.0',
    startupDelayMS: 30_000,
    schedule: (action) => {
      action();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    automaticCheckDue: () => true,
    recordAutomaticCheck: vi.fn(),
    prepareForInstallation,
    openReleasePage: vi.fn(),
    revealApplication: vi.fn(),
    openApplicationsFolder: vi.fn(),
    requestRendererUI,
  });
  return { coordinator, prepareForInstallation, requestRendererUI };
}

describe('DesktopUpdateCoordinator', () => {
  it('starts once and performs one due Linux automatic check', async () => {
    const { adapter } = adapterFixture();
    const { coordinator } = coordinatorFixture(adapter);

    coordinator.scheduleStartup();
    coordinator.scheduleStartup();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.start).toHaveBeenCalledTimes(1);
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('shares the startup check with a concurrent manual request', async () => {
    const { adapter } = adapterFixture();
    let finishCheck = (): void => undefined;
    const pendingCheck = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    vi.mocked(adapter.checkForUpdates).mockImplementation(() => pendingCheck);
    const { coordinator } = coordinatorFixture(adapter);

    coordinator.scheduleStartup();
    const manual = coordinator.perform({ kind: 'check_for_updates' });
    await Promise.resolve();
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);

    finishCheck();
    await manual;
  });

  it('coalesces repeated checks while an update operation is active', async () => {
    const { adapter } = adapterFixture();
    const { coordinator, requestRendererUI } = coordinatorFixture(adapter);

    await coordinator.perform({ kind: 'check_for_updates' });
    await coordinator.perform({ kind: 'check_for_updates' });

    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(requestRendererUI).toHaveBeenCalledTimes(2);
    expect(adapter.openUpdateUI).not.toHaveBeenCalled();
  });

  it('coalesces checks before the adapter publishes its checking state', async () => {
    const { adapter } = adapterFixture();
    let finishCheck = (): void => undefined;
    const pendingCheck = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    vi.mocked(adapter.checkForUpdates).mockImplementation(() => pendingCheck);
    const { coordinator } = coordinatorFixture(adapter);

    const first = coordinator.perform({ kind: 'check_for_updates' });
    const second = coordinator.perform({ kind: 'check_for_updates' });
    await Promise.resolve();

    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
    finishCheck();
    await Promise.all([first, second]);
  });

  it('schedules startup once before the delayed action runs', () => {
    const { adapter } = adapterFixture();
    const schedule = vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>);
    const coordinator = new DesktopUpdateCoordinator({
      adapter,
      currentVersion: '1.0.0',
      schedule,
      prepareForInstallation: vi.fn(),
      openReleasePage: vi.fn(),
      revealApplication: vi.fn(),
      openApplicationsFolder: vi.fn(),
      requestRendererUI: vi.fn(),
    });

    coordinator.scheduleStartup();
    coordinator.scheduleStartup();

    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('allows a manual retry when adapter startup fails', async () => {
    const { adapter } = adapterFixture();
    vi.mocked(adapter.start)
      .mockRejectedValueOnce(new Error('native bridge unavailable'))
      .mockResolvedValueOnce(undefined);
    const { coordinator } = coordinatorFixture(adapter);

    expect((await coordinator.perform({ kind: 'check_for_updates' })).ok).toBe(false);
    expect((await coordinator.perform({ kind: 'check_for_updates' })).ok).toBe(true);

    expect(adapter.start).toHaveBeenCalledTimes(2);
  });

  it('prepares a native Sparkle install and invokes its continuation once', async () => {
    const fixture = adapterFixture('macos_sparkle');
    const { prepareForInstallation } = coordinatorFixture(fixture.adapter);
    const continueInstallation = vi.fn();

    fixture.emitInstall(continueInstallation);
    fixture.emitInstall(continueInstallation);
    await Promise.resolve();
    await Promise.resolve();

    expect(prepareForInstallation).toHaveBeenCalledTimes(1);
    expect(continueInstallation).toHaveBeenCalledTimes(1);
  });

  it('does not continue installation when shutdown preparation fails', async () => {
    const fixture = adapterFixture('macos_sparkle');
    const continueInstallation = vi.fn();
    const coordinator = new DesktopUpdateCoordinator({
      adapter: fixture.adapter,
      currentVersion: '1.0.0',
      prepareForInstallation: async () => { throw new Error('Runtime did not stop'); },
      openReleasePage: vi.fn(),
      revealApplication: vi.fn(),
      openApplicationsFolder: vi.fn(),
      requestRendererUI: vi.fn(),
    });

    fixture.emitInstall(continueInstallation);
    await vi.waitFor(() => {
      expect(coordinator.snapshot()).toMatchObject({ state: 'error', error_detail: 'Runtime did not stop' });
    });

    expect(continueInstallation).not.toHaveBeenCalled();
  });

  it('runs installation failure recovery after preparation succeeds', async () => {
    const fixture = adapterFixture();
    const recover = vi.fn();
    vi.mocked(fixture.adapter.installUpdate!).mockImplementation(() => {
      throw new Error('installer unavailable');
    });
    const coordinator = new DesktopUpdateCoordinator({
      adapter: fixture.adapter,
      currentVersion: '1.0.0',
      prepareForInstallation: vi.fn(),
      onInstallationFailure: recover,
      openReleasePage: vi.fn(),
      revealApplication: vi.fn(),
      openApplicationsFolder: vi.fn(),
      requestRendererUI: vi.fn(),
    });

    const response = await coordinator.perform({ kind: 'install_update' });

    expect(response.ok).toBe(false);
    expect(recover).toHaveBeenCalledOnce();
  });

  it('fails closed for unpackaged or unsupported builds', async () => {
    const { coordinator, requestRendererUI } = coordinatorFixture(null);

    const response = await coordinator.perform({ kind: 'check_for_updates' });

    expect(response.ok).toBe(true);
    expect(response.snapshot).toMatchObject({ platform: 'unsupported', state: 'blocked' });
    expect(requestRendererUI).toHaveBeenCalledTimes(1);
  });
});
