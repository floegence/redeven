import { describe, expect, it } from 'vitest';
import {
  buildFlowerRouterDecision,
  createFlowerAction,
  createFlowerSurfaceInstance,
  deriveTransferApplyState,
  normalizeFlowerUIChips,
  type FlowerTransferPlanItem,
} from './contracts';

describe('Flower contracts', () => {
  it('keeps composer chips in Host / Source / Targets / Mode order', () => {
    const chips = normalizeFlowerUIChips([
      { kind: 'targets', label: 'Connected: staging-api', tone: 'normal' },
      { kind: 'mode', label: 'Approval required', tone: 'warning' },
      { kind: 'source', label: 'From: Env A /srv/app', tone: 'normal' },
      { kind: 'host', label: 'Using Flower Host', tone: 'normal' },
    ]);

    expect(chips.map((chip) => chip.kind)).toEqual(['host', 'source', 'targets', 'mode']);
  });

  it('builds router decisions without treating Ask Flower as the component launcher', () => {
    const decision = buildFlowerRouterDecision({
      decisionId: 'frd_1',
      route: 'flower_host',
      reasonCode: 'host_available',
      hostPresence: {
        host_id: 'flower-host:1',
        host_kind: 'global',
        carrier_kind: 'desktop',
        state: 'online',
      },
      currentTargetId: 'current',
      allowedActions: ['start_thread'],
      uiChips: [
        { kind: 'source', label: 'From: Env A /srv/app', tone: 'normal' },
        { kind: 'host', label: 'Using Flower Host', tone: 'normal' },
        { kind: 'targets', label: 'Tools: Env A', tone: 'normal' },
      ],
    });

    expect(decision.route).toBe('flower_host');
    expect(decision.ui_chips.map((chip) => chip.kind)).toEqual(['host', 'source', 'targets']);
    expect(decision.allowed_actions).toEqual(['start_thread']);
  });

  it('carries host offline, cross-env, env-local, and read-only UI states as chips and blockers', () => {
    const offline = buildFlowerRouterDecision({
      decisionId: 'offline',
      route: 'blocked',
      reasonCode: 'host_unavailable',
      hostPresence: { host_id: 'env_a', host_kind: 'env_local', state: 'offline' },
      uiChips: [
        { kind: 'host', label: 'Host offline', tone: 'danger' },
        { kind: 'source', label: 'Source: New chat', tone: 'muted' },
        { kind: 'targets', label: 'No target context', tone: 'muted' },
        { kind: 'mode', label: 'Flower host is offline.', tone: 'danger' },
      ],
      blocker: { code: 'host_unavailable', message: 'Flower host is offline.' },
    });
    const envLocal = buildFlowerRouterDecision({
      decisionId: 'env-local',
      route: 'env_local',
      reasonCode: 'current_env_only',
      hostPresence: { host_id: 'env_a', host_kind: 'env_local', state: 'online' },
      uiChips: [
        { kind: 'host', label: 'Host online', tone: 'normal' },
        { kind: 'source', label: 'Source: /workspace/app', tone: 'normal' },
        { kind: 'targets', label: 'Target: current env', tone: 'normal' },
        { kind: 'mode', label: 'Act mode', tone: 'normal' },
      ],
    });
    const crossEnv = buildFlowerRouterDecision({
      decisionId: 'cross-env',
      route: 'blocked',
      reasonCode: 'cross_env_requires_flower_host',
      hostPresence: { host_id: 'env_a', host_kind: 'env_local', state: 'online' },
      uiChips: [
        { kind: 'host', label: 'Host online', tone: 'normal' },
        { kind: 'source', label: 'Source: env_b', tone: 'normal' },
        { kind: 'targets', label: 'Cross-env target: env_b', tone: 'danger' },
        { kind: 'mode', label: 'Cross-env actions require Flower Host.', tone: 'danger' },
      ],
      blocker: { code: 'cross_env_requires_flower_host', message: 'Cross-env actions require Flower Host.' },
    });
    const readOnly = buildFlowerRouterDecision({
      decisionId: 'read-only',
      route: 'blocked',
      reasonCode: 'thread_read_only',
      hostPresence: { host_id: 'env_a', host_kind: 'env_local', state: 'online' },
      uiChips: [
        { kind: 'host', label: 'Host online', tone: 'normal' },
        { kind: 'source', label: 'Source: Current environment', tone: 'normal' },
        { kind: 'targets', label: 'Target: current env', tone: 'normal' },
        { kind: 'mode', label: 'This environment is read-only.', tone: 'warning' },
      ],
      blocker: { code: 'thread_read_only', message: 'This environment is read-only.' },
    });

    expect(offline.host_presence?.state).toBe('offline');
    expect(offline.blocker?.code).toBe('host_unavailable');
    expect(envLocal.route).toBe('env_local');
    expect(envLocal.blocker).toBeNull();
    expect(crossEnv.blocker?.code).toBe('cross_env_requires_flower_host');
    expect(readOnly.ui_chips.find((chip) => chip.kind === 'mode')?.tone).toBe('warning');
  });

  it('standardizes UI action disabled and confirmation semantics', () => {
    expect(createFlowerAction({
      kind: 'apply_transfer',
      label: 'Apply transfer',
      enabled: false,
      disabledReason: 'blocked_items_present',
      requiresConfirmation: true,
      dangerLevel: 'write',
      presentationHint: 'primary_footer',
    })).toEqual({
      kind: 'apply_transfer',
      label: 'Apply transfer',
      enabled: false,
      disabled_reason: 'blocked_items_present',
      requires_confirmation: true,
      danger_level: 'write',
      presentation_hint: 'primary_footer',
    });
  });

  it('derives transfer apply state from per-item contract state', () => {
    const blocked: Pick<FlowerTransferPlanItem, 'decision' | 'preview_status'>[] = [
      { decision: 'replace', preview_status: 'replace' },
      { decision: 'block', preview_status: 'blocked' },
    ];

    expect(deriveTransferApplyState({ items: blocked })).toEqual({
      enabled: false,
      disabled_reason: 'blocked_items_present',
    });

    expect(deriveTransferApplyState({
      items: [{ decision: 'replace', preview_status: 'replace' }],
    })).toEqual({
      enabled: true,
      disabled_reason: 'none',
    });

    expect(deriveTransferApplyState({
      planHashExpired: true,
      items: [{ decision: 'replace', preview_status: 'replace' }],
    })).toEqual({
      enabled: false,
      disabled_reason: 'plan_hash_expired',
    });
  });

  it('stores only presentation data in surface instances', () => {
    const surface = createFlowerSurfaceInstance({
      surfaceId: 'surface_1',
      presentationKind: 'workbench_embedded',
      sourceContainerKind: 'workbench',
      threadId: 'th_1',
      hostId: 'flower-host:1',
      workbenchId: 'wb_1',
      dock: 'right',
      widthPx: 420,
      isPinned: true,
    });

    expect(surface).toMatchObject({
      surface_id: 'surface_1',
      thread_id: 'th_1',
      presentation_kind: 'workbench_embedded',
      source_container: {
        kind: 'workbench',
        workbench_id: 'wb_1',
      },
      layout: {
        dock: 'right',
        width_px: 420,
        is_pinned: true,
      },
      state: 'active',
    });

    expect(surface).not.toHaveProperty('target_session');
    expect(surface).not.toHaveProperty('run_state');
  });
});
