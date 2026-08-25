import { describe, expect, it, vi } from 'vitest';

import { MacSparkleUpdateAdapter, type SparkleNativeBridge } from './macSparkleUpdateAdapter';

function fakeBridge() {
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  let snapshot = {
    kind: 'snapshot',
    state: 'idle',
    can_check: true,
    automatically_checks_for_updates: true,
  };
  const bridge: SparkleNativeBridge = {
    start: (nextListener) => {
      listener = nextListener as (event: Record<string, unknown>) => void;
      return snapshot;
    },
    snapshot: () => snapshot,
    checkForUpdates: vi.fn(),
    openUpdateUI: vi.fn(),
    setAutomaticallyChecksForUpdates: vi.fn((enabled: boolean) => {
      snapshot = { ...snapshot, automatically_checks_for_updates: enabled };
    }),
    continueInstallation: vi.fn(() => true),
  };
  return {
    bridge,
    emit: (event: Record<string, unknown>) => {
      if (event.kind === 'snapshot') snapshot = event as typeof snapshot;
      listener?.(event);
    },
  };
}

describe('MacSparkleUpdateAdapter', () => {
  it('maps native snapshots and delegates update UI to Sparkle', () => {
    const native = fakeBridge();
    const adapter = new MacSparkleUpdateAdapter({
      currentVersion: '1.2.3',
      loadNativeBridge: () => native.bridge,
    });
    adapter.start();
    native.emit({
      kind: 'snapshot',
      state: 'available',
      available_version: '1.3.0',
      can_check: true,
      automatically_checks_for_updates: true,
    });
    expect(adapter.snapshot()).toMatchObject({
      platform: 'macos_sparkle',
      state: 'available',
      current_version: '1.2.3',
      available_version: '1.3.0',
    });
    adapter.openUpdateUI();
    expect(native.bridge.openUpdateUI).toHaveBeenCalledOnce();
  });

  it('continues a postponed installation only once', () => {
    const native = fakeBridge();
    const adapter = new MacSparkleUpdateAdapter({
      currentVersion: '1.2.3',
      loadNativeBridge: () => native.bridge,
    });
    adapter.start();
    let continuation: (() => void) | null = null;
    adapter.subscribeInstallRequest((next) => {
      continuation = next;
    });
    native.emit({ kind: 'install_requested' });
    expect(continuation).not.toBeNull();
    const invokeContinuation = continuation as (() => void) | null;
    invokeContinuation?.();
    invokeContinuation?.();
    expect(native.bridge.continueInstallation).toHaveBeenCalledOnce();
  });

  it('does not poison the adapter when the native bridge fails during startup', () => {
    const native = fakeBridge();
    const start = vi.spyOn(native.bridge, 'start')
      .mockImplementationOnce(() => { throw new Error('bridge unavailable'); })
      .mockImplementation((listener) => {
        return fakeBridge().bridge.start(listener);
      });
    const adapter = new MacSparkleUpdateAdapter({
      currentVersion: '1.2.3',
      loadNativeBridge: () => native.bridge,
    });

    expect(() => adapter.start()).toThrow('bridge unavailable');
    expect(() => adapter.start()).not.toThrow();
    expect(start).toHaveBeenCalledTimes(2);
  });
});
