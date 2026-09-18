import { describe, expect, it } from 'vitest';
import { assertRuntimeFlowerCompatible, runtimeFlowerBlocker } from './runtimeFlowerAccess';
import { normalizeRuntimeServiceSnapshot, RUNTIME_SERVICE_COMPATIBILITY_EPOCH as epoch, RUNTIME_SERVICE_PROTOCOL_VERSION as protocol, runtimeServiceIsOpenable } from './runtimeService';

function snapshot(overrides: Record<string, unknown> = {}) {
  return normalizeRuntimeServiceSnapshot({ compatibility: 'compatible', compatibility_epoch: epoch, protocol_version: protocol, open_readiness: { state: 'openable' }, ...overrides });
}

describe('Desktop Flower protocol access', () => {
  it.each([epoch - 1, undefined, null, '24', 24.5, 0, -1, Number.NaN])('blocks incompatible Runtime epoch %s while allowing its own Env App', (compatibility_epoch) => {
    const runtime = snapshot({ compatibility_epoch });
    expect(runtimeServiceIsOpenable(runtime)).toBe(true);
    expect(runtimeFlowerBlocker(runtime)?.code).toBe('runtime_update_required');
    expect(() => assertRuntimeFlowerCompatible(runtime)).toThrow();
  });
  it('requires Desktop update for a newer epoch', () => {
    expect(runtimeFlowerBlocker(snapshot({ compatibility_epoch: epoch + 1 }))?.code).toBe('desktop_update_required');
  });
  it.each([undefined, '', 'redeven-runtime-v1', 'unexpected'])('rejects missing or unsupported protocol %s', (protocol_version) => {
    expect(runtimeFlowerBlocker(snapshot({ protocol_version }))?.code).toBe('runtime_update_required');
  });
  it.each(['compatible', 'update_available', 'restart_recommended'])('allows %s builds without requiring equal commits', (compatibility) => {
    expect(runtimeFlowerBlocker(snapshot({ compatibility, runtime_commit: 'other-commit', runtime_version: 'v0.0.0-dev' }))).toBeNull();
  });
  it('rechecks the observed state after a failed and then successful update', () => {
    const old = snapshot({ compatibility_epoch: epoch - 1 });
    expect(() => assertRuntimeFlowerCompatible(old)).toThrow();
    expect(() => assertRuntimeFlowerCompatible(old)).toThrow();
    expect(() => assertRuntimeFlowerCompatible(snapshot())).not.toThrow();
  });
  it('retains readiness and explicit version requirements', () => {
    expect(runtimeFlowerBlocker(undefined)?.code).toBe('runtime_not_ready');
    expect(runtimeFlowerBlocker(snapshot({ open_readiness: { state: 'starting' } }))?.code).toBe('runtime_not_ready');
    expect(runtimeFlowerBlocker(snapshot({ compatibility: 'update_required' }))?.code).toBe('runtime_update_required');
    expect(runtimeFlowerBlocker(snapshot({ compatibility: 'desktop_update_required' }))?.code).toBe('desktop_update_required');
  });
});
