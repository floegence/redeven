import { describe, expect, it } from 'vitest';

import {
  envAppShellUnavailableOpenReadiness,
  normalizeRuntimeServiceSnapshot,
  runtimeServiceIsOpenable,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceOpenReadinessLabel,
} from './runtimeService';

describe('runtimeService', () => {
  it('blocks runtimes that do not expose explicit Desktop open-readiness', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      compatibility: 'compatible',
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(false);
    expect(snapshot.open_readiness).toEqual({
      state: 'blocked',
      reason_code: 'runtime_open_readiness_unavailable',
      message: 'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
    });
    expect(runtimeServiceOpenReadinessLabel(snapshot)).toBe(
      'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
    );
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(true);
  });

  it('keeps explicit openable readiness openable', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.11',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(true);
    expect(snapshot.open_readiness).toEqual({ state: 'openable' });
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(false);
  });

  it('treats a missing Env App shell as an update-required runtime block', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.0.0-dev',
      compatibility: 'compatible',
      open_readiness: envAppShellUnavailableOpenReadiness(),
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(false);
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(true);
    expect(runtimeServiceOpenReadinessLabel(snapshot)).toBe(
      'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.',
    );
  });

  it('requires every expected bundled identity field to match when present', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      runtime_commit: 'abc123',
      runtime_build_time: '2026-01-02T03:04:05Z',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    });

    expect(runtimeServiceMatchesIdentity(snapshot, {
      runtime_version: 'v1.2.3',
      runtime_commit: 'abc123',
      runtime_build_time: '2026-01-02T03:04:05Z',
    })).toBe(true);
    expect(runtimeServiceMatchesIdentity(snapshot, {
      runtime_version: 'v1.2.3',
      runtime_commit: 'new-commit',
      runtime_build_time: '2026-01-02T03:04:05Z',
    })).toBe(false);
    expect(runtimeServiceMatchesIdentity(normalizeRuntimeServiceSnapshot({
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    }), {
      runtime_version: 'v1.2.3',
    })).toBe(false);
  });
});
