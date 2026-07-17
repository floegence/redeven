// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  desktopRendererStorageScopeID,
  notifyDesktopSessionAppReady,
  readDesktopSessionContextSnapshot,
  readDesktopTransportRecoverySnapshot,
  requestDesktopTransportRecoveryNow,
  resolveRendererStorageScopeID,
  subscribeDesktopTransportRecovery,
} from './desktopSessionContext';

const originalParent = window.parent;
const originalTop = window.top;

function setWindowHierarchy(parent: Window, top: Window = parent): void {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: parent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: top,
  });
}

afterEach(() => {
  delete window.redevenDesktopSessionContext;
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: originalTop,
  });
});

describe('desktopSessionContext', () => {
  it('reads desktop session context from a same-origin parent window', () => {
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'provider:https%3A%2F%2Fredeven.test:env:env_demo',
          renderer_storage_scope_id: 'provider:https%3A%2F%2Fredeven.test:env:env_demo',
          target_kind: 'local_environment',
          target_route: 'remote_desktop',
          session_source: 'provider_environment',
          provider_origin: ' https://redeven.test ',
          provider_id: ' provider-1 ',
          env_public_id: ' env_demo ',
          label: ' Demo Environment ',
        }),
      },
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(readDesktopSessionContextSnapshot()).toEqual({
      local_environment_id: 'provider:https%3A%2F%2Fredeven.test:env:env_demo',
      renderer_storage_scope_id: 'provider:https%3A%2F%2Fredeven.test:env:env_demo',
      target_kind: 'local_environment',
      target_route: 'remote_desktop',
      session_source: 'provider_environment',
      provider_origin: 'https://redeven.test',
      provider_id: 'provider-1',
      env_public_id: 'env_demo',
      label: 'Demo Environment',
    });
    expect(desktopRendererStorageScopeID()).toBe('provider:https%3A%2F%2Fredeven.test:env:env_demo');
  });

  it('preserves runtime gateway session identity from Desktop', () => {
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'gateway:bastion:env:env_demo',
          renderer_storage_scope_id: 'gateway:bastion:env:env_demo',
          target_kind: 'gateway_environment',
          target_route: 'remote_desktop',
          session_source: 'runtime_gateway',
          label: 'Gateway Demo',
        }),
      },
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(readDesktopSessionContextSnapshot()).toEqual({
      local_environment_id: 'gateway:bastion:env:env_demo',
      renderer_storage_scope_id: 'gateway:bastion:env:env_demo',
      target_kind: 'gateway_environment',
      target_route: 'remote_desktop',
      session_source: 'runtime_gateway',
      label: 'Gateway Demo',
    });
  });

  it.each([
    ['missing route', undefined],
    ['invalid route', 'browser'],
  ])('rejects a Desktop session contract with %s', (_label, targetRoute) => {
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'ssh:devbox',
          renderer_storage_scope_id: 'ssh:devbox',
          target_kind: 'ssh_environment',
          ...(targetRoute ? { target_route: targetRoute } : {}),
        }),
      },
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(readDesktopSessionContextSnapshot()).toBeNull();
  });

  it('falls back to the provided scope id when no desktop session context exists', () => {
    expect(readDesktopSessionContextSnapshot()).toBeNull();
    expect(desktopRendererStorageScopeID()).toBe('');
    expect(resolveRendererStorageScopeID('env_demo')).toBe('env_demo');
  });

  it('notifies Desktop when the environment app becomes interactive', () => {
    const readyPayloads: Array<{ state: string; timings?: { shell_painted_ms?: number } }> = [];
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'local',
          renderer_storage_scope_id: 'local',
        }),
        notifyAppReady: (payload: { state: string; timings?: { shell_painted_ms?: number } }) => {
          readyPayloads.push(payload);
        },
      },
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(notifyDesktopSessionAppReady('access_gate_interactive')).toBe(true);
    expect(notifyDesktopSessionAppReady('runtime_connected', { shell_painted_ms: 42 })).toBe(true);
    expect(readyPayloads).toEqual([
      { state: 'access_gate_interactive' },
      { state: 'runtime_connected', timings: { shell_painted_ms: 42 } },
    ]);
  });

  it('reads, orders, and controls Desktop transport recovery through the current session bridge', async () => {
    let recoveryListener: (snapshot: unknown) => void = () => undefined;
    let subscribed = false;
    const requestRetry = vi.fn(async () => true);
    const initialSnapshot = {
      generation: 4,
      revision: 8,
      phase: 'waiting' as const,
      attempt_count: 2,
      started_at_unix_ms: 100,
      next_attempt_at_unix_ms: 200,
      failure: {
        code: 'transport_interrupted' as const,
        error_name: 'DesktopSSHTransportInterruptedError',
        technical_detail: 'SSH transport was interrupted.',
      },
      actions: ['retry_now' as const],
    };
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopSessionContext: {
        getSnapshot: () => ({
          local_environment_id: 'ssh:demo',
          renderer_storage_scope_id: 'ssh:demo',
        }),
        getTransportRecoverySnapshot: () => initialSnapshot,
        subscribeTransportRecovery: (listener: (snapshot: unknown) => void) => {
          recoveryListener = listener;
          subscribed = true;
          listener(initialSnapshot);
          return () => {
            subscribed = false;
          };
        },
        requestTransportRecoveryNow: requestRetry,
      },
    } as unknown as Window;
    setWindowHierarchy(parentWindow);

    expect(readDesktopTransportRecoverySnapshot()).toEqual(initialSnapshot);
    const snapshots: unknown[] = [];
    const unsubscribe = subscribeDesktopTransportRecovery((snapshot) => snapshots.push(snapshot));
    recoveryListener({ ...initialSnapshot, revision: 7, phase: 'connecting', actions: [] });
    recoveryListener({
      ...initialSnapshot,
      revision: 9,
      phase: 'ready',
      attempt_count: 3,
      recovered_at_unix_ms: 240,
      actions: [],
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ revision: 9, phase: 'ready', attempt_count: 3 });
    await expect(requestDesktopTransportRecoveryNow()).resolves.toBe(true);
    expect(requestRetry).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(subscribed).toBe(false);
  });
});
