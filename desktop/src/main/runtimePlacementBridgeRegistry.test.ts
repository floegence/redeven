import { describe, expect, it, vi } from 'vitest';

import {
  RuntimePlacementBridgeRegistry,
  type RuntimePlacementBridgeOwner,
  type RuntimePlacementBridgeRecord,
} from './runtimePlacementBridgeRegistry';
import type {
  RuntimePlacementBridgeSession,
  RuntimePlacementBridgeTermination,
} from './runtimePlacementBridgeSession';
import type { DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopProviderRuntimeLinkTargetID } from '../shared/providerRuntimeLinkTarget';
import type { DesktopSessionKey } from './desktopTarget';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function bridgeFixture(targetIDValue: string) {
  const targetID = targetIDValue as DesktopRuntimeTargetID;
  const closed = deferred<RuntimePlacementBridgeTermination>();
  let settled = false;
  const disconnect = vi.fn(async () => {
    if (!settled) {
      settled = true;
      closed.resolve({ kind: 'closed' });
    }
  });
  const session = {
    placement_target_id: targetID,
    closed: closed.promise,
    disconnect,
  } as unknown as RuntimePlacementBridgeSession;
  const record = {
    runtime_key: targetID,
    environment_id: targetID,
    label: targetID,
    target_id: `ssh_environment:${targetID}` as DesktopProviderRuntimeLinkTargetID,
    runtime_binary_path: 'redeven',
    session,
    startup: { local_ui_url: 'http://127.0.0.1:3000/', local_ui_urls: ['http://127.0.0.1:3000/'] },
    runtime_handle: {
      runtime_kind: 'ssh',
      lifecycle_owner: 'desktop',
      launch_mode: 'spawned',
      stop: disconnect,
    },
  } as RuntimePlacementBridgeRecord;
  return {
    targetID,
    session,
    record,
    disconnect,
    close: (termination: RuntimePlacementBridgeTermination) => {
      if (!settled) {
        settled = true;
        closed.resolve(termination);
      }
    },
  };
}

describe('RuntimePlacementBridgeRegistry', () => {
  it('tracks an opening owner and attaches the exact session owner', () => {
    const settled = vi.fn();
    const registry = new RuntimePlacementBridgeRegistry(settled);
    const fixture = bridgeFixture('target-one');

    registry.trackOpening(fixture.record, 'target-one:open');

    expect(registry.get(fixture.targetID)).toBe(fixture.record);
    expect(registry.owner(fixture.targetID)).toEqual({ kind: 'opening', operation_key: 'target-one:open' });
    expect(registry.attachSession(fixture.targetID, fixture.session, 'ssh:session-one' as DesktopSessionKey)).toBe(fixture.record);
    expect(registry.owner(fixture.targetID)).toEqual({ kind: 'session', session_key: 'ssh:session-one' });
    expect(registry.attachSession(fixture.targetID, fixture.session, 'ssh:session-two' as DesktopSessionKey)).toBeNull();
    expect(registry.owner(fixture.targetID)).toEqual({ kind: 'session', session_key: 'ssh:session-one' });
    expect(registry.attachSession(fixture.targetID, bridgeFixture('other').session, 'ssh:wrong' as DesktopSessionKey)).toBeNull();
  });

  it('rejects a second tracked bridge until the current owner settles', () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const first = bridgeFixture('target-one');
    const second = bridgeFixture('target-one');
    registry.trackOpening(first.record, 'first:open');

    expect(() => registry.trackOpening(second.record, 'second:open')).toThrow(
      'Runtime Placement Bridge target-one already has a lifecycle owner.',
    );
    expect(registry.get(first.targetID)).toBe(first.record);
  });

  it('updates only the current session identity', () => {
    const registry = new RuntimePlacementBridgeRegistry(vi.fn());
    const fixture = bridgeFixture('target-one');
    registry.trackOpening(fixture.record, 'target-one:open');

    const updated = registry.updateIfCurrent(fixture.targetID, fixture.session, (record) => ({
      ...record,
      label: 'Updated',
    }));

    expect(updated?.label).toBe('Updated');
    expect(registry.get(fixture.targetID)?.label).toBe('Updated');
    expect(registry.updateIfCurrent(fixture.targetID, bridgeFixture('other').session, (record) => record)).toBeNull();
  });

  it('keeps the record until disconnect settles and invokes one settlement owner', async () => {
    const settlements: Array<Readonly<{ owner: RuntimePlacementBridgeOwner; termination: RuntimePlacementBridgeTermination }>> = [];
    const settlementGate = deferred<void>();
    const registry = new RuntimePlacementBridgeRegistry(async (_record, owner, termination) => {
      settlements.push({ owner, termination });
      await settlementGate.promise;
    });
    const fixture = bridgeFixture('target-one');
    registry.trackOpening(fixture.record, 'target-one:open');
    registry.attachSession(fixture.targetID, fixture.session, 'ssh:session-one' as DesktopSessionKey);

    const retirement = registry.retire(fixture.targetID);
    await Promise.resolve();

    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
    expect(registry.get(fixture.targetID)).toBeNull();
    expect(settlements).toEqual([{
      owner: { kind: 'session', session_key: 'ssh:session-one' },
      termination: { kind: 'closed' },
    }]);

    let retired = false;
    void retirement.then(() => {
      retired = true;
    });
    await Promise.resolve();
    expect(retired).toBe(false);
    settlementGate.resolve();
    await retirement;
    expect(retired).toBe(true);
  });

  it('publishes a spontaneous terminal failure once', async () => {
    const settled = vi.fn();
    const registry = new RuntimePlacementBridgeRegistry(settled);
    const fixture = bridgeFixture('target-one');
    registry.trackOpening(fixture.record, 'target-one:open');
    registry.attachSession(fixture.targetID, fixture.session, 'ssh:session-one' as DesktopSessionKey);

    fixture.close({
      kind: 'failed',
      failure: {
        code: 'process_identity_changed',
        error_name: 'RuntimePlacementBridgeIdentityChangedError',
        technical_detail: 'identity changed',
      },
    });
    await fixture.session.closed;
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));

    expect(registry.get(fixture.targetID)).toBeNull();
    expect(fixture.disconnect).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(
      fixture.record,
      { kind: 'session', session_key: 'ssh:session-one' },
      expect.objectContaining({ kind: 'failed' }),
    );
  });

  it('does not let an old session termination delete a replacement', async () => {
    const settled = vi.fn();
    const registry = new RuntimePlacementBridgeRegistry(settled);
    const first = bridgeFixture('target-one');
    registry.trackOpening(first.record, 'first:open');
    await registry.retire(first.targetID);

    const second = bridgeFixture('target-one');
    registry.trackOpening(second.record, 'second:open');
    first.close({ kind: 'closed' });
    await first.session.closed;

    expect(registry.get(second.targetID)).toBe(second.record);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('retires every tracked session through its settlement', async () => {
    const settled = vi.fn();
    const registry = new RuntimePlacementBridgeRegistry(settled);
    const first = bridgeFixture('target-one');
    const second = bridgeFixture('target-two');
    registry.trackOpening(first.record, 'first:open');
    registry.trackOpening(second.record, 'second:open');

    await registry.retireAll();

    expect(registry.size).toBe(0);
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(second.disconnect).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(2);
  });
});
