import { describe, expect, it } from 'vitest';

import type { GatewayRuntimeOperation, GatewayRuntimeOperationState } from './gatewayClient';
import { projectAttachedRuntimeOperation } from './runtimeLifecycleAttachment';

function operation(
  state: GatewayRuntimeOperationState,
  observerRedacted = false,
): GatewayRuntimeOperation {
  return {
    protocol_version: 'redeven-gateway-v2',
    operation_id: 'rop_attach',
    idempotency_key: observerRedacted ? '' : 'runtime-operation:rop_attach',
    lifecycle_target_id: 'target-a',
    target_generation: 3,
    gateway_env_id: 'env_local',
    kind: 'update_runtime',
    authorized_client_key_id: observerRedacted ? '' : 'gck_desktop',
    desired_runtime: {
      version: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
      artifact_policy: 'published_release',
    },
    state,
    expected_snapshot: {
      snapshot_revision: 7,
      process_inventory_digest: observerRedacted ? '' : 'sha256:process',
      workload_identity_digest: observerRedacted ? '' : 'sha256:workload',
      workload: {
        knowledge: 'known',
        affected_process_count: 2,
        active_session_count: 1,
        protected_workload_present: true,
      },
      observed_at_unix_ms: 100,
    },
    created_at_unix_ms: 100,
    updated_at_unix_ms: 200,
    ...(observerRedacted ? { observer_redacted: true } : {}),
  };
}

describe('projectAttachedRuntimeOperation', () => {
  it('restores explicit confirmation only for the authorized operation client', () => {
    expect(projectAttachedRuntimeOperation(operation('awaiting_confirmation'))).toMatchObject({
      owned: true,
      needs_confirmation: true,
      should_resume: false,
      confirmation: {
        operation: 'update_runtime',
        snapshot_revision: 7,
        affected_process_count: 2,
        active_session_count: 1,
        protected_workload_present: true,
      },
    });
    expect(projectAttachedRuntimeOperation(operation('confirmation_required', true))).toMatchObject({
      owned: false,
      needs_confirmation: false,
      should_resume: false,
    });
  });

  it.each(['awaiting_artifact', 'commit_ready'] as const)(
    'resumes %s only for the authorized operation client',
    (state) => {
      expect(projectAttachedRuntimeOperation(operation(state)).should_resume).toBe(true);
      expect(projectAttachedRuntimeOperation(operation(state, true)).should_resume).toBe(false);
    },
  );

  it.each(['preflighting', 'staging', 'fencing', 'committing', 'recovering'] as const)(
    'projects authoritative %s progress without attempting another mutation',
    (state) => {
      expect(projectAttachedRuntimeOperation(operation(state))).toMatchObject({
        state,
        needs_confirmation: false,
        should_resume: false,
        manual_recovery_required: false,
      });
    },
  );

  it('surfaces quarantine as administrator recovery instead of a lifecycle retry', () => {
    expect(projectAttachedRuntimeOperation(operation('manual_recovery_required'))).toMatchObject({
      phase: 'gateway_runtime_operation_manual_recovery_required',
      title_key: 'progress.runtimeRecoveryRequiredTitle',
      detail_key: 'progress.runtimeRecoveryRequiredDetail',
      needs_confirmation: false,
      should_resume: false,
      manual_recovery_required: true,
    });
  });

  it('uses localized progress keys while keeping transport fallbacks', () => {
    expect(projectAttachedRuntimeOperation(operation('fencing'))).toMatchObject({
      title_key: 'progress.updatingRuntime',
      detail_key: 'progress.runtimeFencingDetail',
      title: 'Updating Runtime',
    });
  });
});
