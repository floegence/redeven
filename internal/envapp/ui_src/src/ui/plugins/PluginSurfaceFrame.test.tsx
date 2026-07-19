// @vitest-environment jsdom

import type { PluginBridgeError, PluginSurfaceHost } from '@floegence/redevplugin-ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginConfirmationQueue } from './PluginConfirmationQueue';
import { PluginSurfaceFrame } from './PluginSurfaceFrame';
import type { PluginSurfacePlacementCoordinator } from './pluginPlatform';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  X: () => <span />,
}));

const target: PluginSurfaceLaunchTarget = {
  pluginID: 'com.redeven.official.containers',
  pluginInstanceID: 'plugini_redeven_official_containers',
  surfaceID: 'containers.dashboard',
  expectedManagementRevision: 7,
  preferredPlacement: 'activity',
};

let dispose: (() => void) | undefined;

beforeEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function createHost(): PluginSurfaceHost {
  const element = document.createElement('iframe');
  return {
    element,
    surfaceInstanceId: 'surface_instance_1',
    sendLifecycle: vi.fn(),
    close: vi.fn(async () => ({
      quiesce: { outcome: 'acknowledged' as const, durationMs: 1 },
      revokeDurationMs: 1,
      totalDurationMs: 2,
    })),
    dispose: vi.fn(async () => undefined),
  };
}

function createConfirmationQueue(): PluginConfirmationQueue {
  return {
    active: () => undefined,
    createHandler: vi.fn(() => vi.fn()),
    approveActive: vi.fn(),
    rejectActive: vi.fn(),
    cancelOwner: vi.fn(),
    cancelAll: vi.fn(),
  };
}

function createCoordinator(host: PluginSurfaceHost): PluginSurfacePlacementCoordinator {
  return {
    open: vi.fn(async () => host),
    setVisible: vi.fn((_slot, visible) => {
      host.sendLifecycle({ type: visible ? 'visible' : 'hidden' });
    }),
    fail: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    closeActive: vi.fn(async () => undefined),
    disposeActive: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PluginSurfaceFrame', () => {
  it('opens through the shared placement coordinator and waits for the SDK first-commit boundary', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const host = createHost();
    let resolveOpen!: (value: PluginSurfaceHost) => void;
    const coordinator = createCoordinator(host);
    vi.mocked(coordinator.open).mockImplementation(() => new Promise((resolve) => {
      resolveOpen = resolve;
    }));
    const confirmationQueue = createConfirmationQueue();

    dispose = render(() => (
      <PluginSurfaceFrame
        coordinator={coordinator}
        confirmationQueue={confirmationQueue}
        target={target}
        visible
        onClose={vi.fn()}
        onRetirementError={vi.fn()}
      />
    ), mount);

    expect(mount.textContent).toContain('Opening plugin surface');
    expect(coordinator.open).toHaveBeenCalledWith(
      expect.anything(),
      {
        plugin_instance_id: target.pluginInstanceID,
        surface_id: target.surfaceID,
        expected_management_revision: target.expectedManagementRevision,
      },
      expect.objectContaining({
        confirm: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(confirmationQueue.createHandler).toHaveBeenCalledWith(expect.objectContaining({
      pluginID: target.pluginID,
      pluginInstanceID: target.pluginInstanceID,
      surfaceID: target.surfaceID,
      canConfirm: expect.any(Function),
    }));

    resolveOpen(host);
    await flushAsync();

    expect(mount.textContent).not.toContain('Opening plugin surface');
    expect(host.element.title).toBe(`${target.pluginID} ${target.surfaceID}`);
    expect(host.element.dataset.pluginSurfaceIframe).toBe('');
    expect(host.sendLifecycle).toHaveBeenCalledWith({ type: 'visible' });
    expect(mount.querySelector('[data-plugin-surface-host]')?.getAttribute('data-surface-instance-id')).toBe('surface_instance_1');
  });

  it('publishes an explicit initial hidden state and follows placement visibility', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const host = createHost();
    const coordinator = createCoordinator(host);
    const confirmationQueue = createConfirmationQueue();
    const [visible, setVisible] = createSignal(false);

    dispose = render(() => (
      <PluginSurfaceFrame
        coordinator={coordinator}
        confirmationQueue={confirmationQueue}
        target={target}
        visible={visible()}
        onClose={vi.fn()}
        onRetirementError={vi.fn()}
      />
    ), mount);
    await flushAsync();

    expect(coordinator.setVisible).toHaveBeenCalledWith(expect.anything(), false);
    setVisible(true);
    await flushAsync();
    expect(coordinator.setVisible).toHaveBeenLastCalledWith(expect.anything(), true);
  });

  it('closes and disposes the slot before removing the Activity placement', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const host = createHost();
    const coordinator = createCoordinator(host);
    const confirmationQueue = createConfirmationQueue();
    const onClose = vi.fn(async () => undefined);
    let resolveRelease!: () => void;
    vi.mocked(coordinator.release).mockImplementation(() => new Promise<void>((resolve) => {
      resolveRelease = resolve;
    }));

    dispose = render(() => (
      <PluginSurfaceFrame
        coordinator={coordinator}
        confirmationQueue={confirmationQueue}
        target={target}
        visible
        onClose={onClose}
        onRetirementError={vi.fn()}
      />
    ), mount);
    await flushAsync();

    (mount.querySelector('button') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(mount.textContent).not.toContain('Opening plugin surface');
    expect(mount.textContent).toContain('Loading');
    expect(confirmationQueue.cancelOwner).toHaveBeenCalledTimes(1);
    expect(coordinator.release).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    resolveRelease();
    await flushAsync();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancels pending confirmations and releases the owned slot on unmount', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const host = createHost();
    const coordinator = createCoordinator(host);
    const confirmationQueue = createConfirmationQueue();
    const retirementError = new Error('surface retirement failed');
    const onRetirementError = vi.fn();
    vi.mocked(coordinator.release).mockRejectedValue(retirementError);

    dispose = render(() => (
      <PluginSurfaceFrame
        coordinator={coordinator}
        confirmationQueue={confirmationQueue}
        target={target}
        visible
        onClose={vi.fn()}
        onRetirementError={onRetirementError}
      />
    ), mount);
    await flushAsync();

    dispose();
    dispose = undefined;
    await flushAsync();

    expect(coordinator.setVisible).not.toHaveBeenCalledWith(expect.anything(), false);
    expect(confirmationQueue.cancelOwner).toHaveBeenCalledTimes(1);
    expect(coordinator.release).toHaveBeenCalledTimes(1);
    expect(onRetirementError).toHaveBeenCalledWith(retirementError);
  });

  it('serializes terminal SDK errors through coordinator retirement', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const host = createHost();
    const coordinator = createCoordinator(host);
    const confirmationQueue = createConfirmationQueue();

    dispose = render(() => (
      <PluginSurfaceFrame
        coordinator={coordinator}
        confirmationQueue={confirmationQueue}
        target={target}
        visible
        onClose={vi.fn()}
        onRetirementError={vi.fn()}
      />
    ), mount);
    await flushAsync();

    const options = vi.mocked(coordinator.open).mock.calls[0]?.[2];
    const terminalError = Object.assign(new Error('surface terminated'), { errorCode: 'PLUGIN_BRIDGE_DISPOSED' });
    options?.onError?.(terminalError as PluginBridgeError);
    await flushAsync();

    expect(coordinator.fail).toHaveBeenCalledWith(expect.anything(), terminalError);
    expect(mount.querySelector('[data-plugin-surface-error]')?.textContent).toContain('surface terminated');
  });
});
