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
