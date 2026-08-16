import { describe, expect, it } from 'vitest';

import type { DesktopEnvironmentEntry } from './desktopLauncherIPC';
import { providerRuntimeGatewayCandidates } from './providerRuntimeGatewaySelection';

function entry(overrides: Partial<DesktopEnvironmentEntry>): DesktopEnvironmentEntry {
  return {
    id: 'entry',
    kind: 'provider_environment',
    label: 'Demo',
    local_ui_url: '',
    secondary_text: '',
    pinned: false,
    tag: 'Provider',
    category: 'provider',
    window_state: 'closed',
    is_open: false,
    is_opening: false,
    runtime_health: {
      status: 'online',
      checked_at_unix_ms: 1,
      source: 'provider_batch_probe',
      freshness: 'fresh',
    },
    runtime_operations: {} as DesktopEnvironmentEntry['runtime_operations'],
    open_session_key: '',
    open_action: 'open',
    can_edit: false,
    can_delete: false,
    created_at_ms: 1,
    last_used_at_ms: 1,
    ...overrides,
  };
}

function management(targetID: string, generation: number, operations: readonly ('restart' | 'stop')[]) {
  return {
    support: 'supported' as const,
    authorization: { state: 'allowed' as const, grants: ['manage_runtime' as const] },
    readiness: 'ready' as const,
    presentation_state: 'allowed' as const,
    target: { lifecycle_target_id: targetID, target_generation: generation },
    operations,
    artifact_policies: ['published_release' as const],
    binding_actions: [],
    supervision_mode: 'provider_gateway',
    reason_code: '',
    checked_at_unix_ms: 1,
  };
}

describe('providerRuntimeGatewayCandidates', () => {
  it('requires an exact target, generation, operation, and explicit Gateway card', () => {
    const provider = entry({ runtime_management: management('rlt_demo', 7, ['restart']) });
    const exact = entry({
      id: 'gateway-exact',
      kind: 'gateway_environment',
      category: 'gateway',
      tag: 'Gateway',
      gateway_id: 'gateway-demo',
      gateway_env_id: 'env_demo',
      runtime_management: management('rlt_demo', 7, ['restart']),
    });
    const stale = entry({
      id: 'gateway-stale',
      kind: 'gateway_environment',
      category: 'gateway',
      tag: 'Gateway',
      runtime_management: management('rlt_demo', 6, ['restart']),
    });
    const wrongOperation = entry({
      id: 'gateway-stop-only',
      kind: 'gateway_environment',
      category: 'gateway',
      tag: 'Gateway',
      runtime_management: management('rlt_demo', 7, ['stop']),
    });

    expect(providerRuntimeGatewayCandidates(provider, [provider, stale, exact, wrongOperation], 'restart'))
      .toEqual([exact]);
  });

  it('returns no hidden fallback when Provider management is not ready', () => {
    const provider = entry({
      runtime_management: {
        ...management('rlt_demo', 7, ['restart']),
        readiness: 'setup_required',
        presentation_state: 'setup_required',
      },
    });
    const gateway = entry({
      kind: 'gateway_environment',
      category: 'gateway',
      tag: 'Gateway',
      runtime_management: management('rlt_demo', 7, ['restart']),
    });

    expect(providerRuntimeGatewayCandidates(provider, [gateway], 'restart')).toEqual([]);
  });
});
