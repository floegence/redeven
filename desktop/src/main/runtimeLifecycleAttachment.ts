import type {
  GatewayRuntimeOperation,
  GatewayRuntimeOperationKind,
  GatewayRuntimeOperationState,
} from './gatewayClient';
import type { DesktopTranslationKey } from '../shared/i18n/desktopI18n';

export type RuntimeLifecycleAttachmentProjection = Readonly<{
  state: GatewayRuntimeOperationState;
  phase: string;
  title: string;
  title_key?: DesktopTranslationKey;
  detail: string;
  detail_key?: DesktopTranslationKey;
  owned: boolean;
  needs_confirmation: boolean;
  should_resume: boolean;
  manual_recovery_required: boolean;
  confirmation?: Readonly<{
    operation: Exclude<GatewayRuntimeOperationKind, 'reconcile'>;
    snapshot_revision: number;
    workload_knowledge: 'known' | 'unknown';
    affected_process_count?: number;
    active_session_count?: number;
    protected_workload_present: boolean;
  }>;
}>;

function operationTitle(kind: GatewayRuntimeOperationKind): Readonly<{
  title: string;
  title_key: DesktopTranslationKey;
}> {
  switch (kind) {
    case 'start':
      return { title: 'Starting Runtime', title_key: 'progress.startingRuntime' };
    case 'stop':
      return { title: 'Stopping Runtime', title_key: 'progress.stoppingRuntimeProcess' };
    case 'restart':
      return { title: 'Restarting Runtime', title_key: 'progress.restartingRuntime' };
    case 'update_runtime':
      return { title: 'Updating Runtime', title_key: 'progress.updatingRuntime' };
    case 'reconcile':
      return { title: 'Recovering Runtime', title_key: 'progress.runtimeRecoveringTitle' };
  }
}

function statePresentation(
  operation: GatewayRuntimeOperation,
  owned: boolean,
): Pick<RuntimeLifecycleAttachmentProjection, 'phase' | 'title' | 'title_key' | 'detail' | 'detail_key'> {
  if (operation.kind === 'start') {
    switch (operation.state) {
      case 'preflighting':
      case 'awaiting_confirmation':
      case 'confirmation_required':
        return {
          phase: operation.state === 'preflighting'
            ? 'gateway_runtime_operation_preflighting'
            : 'runtime_operation_confirmation_required',
          title: 'Checking access',
          title_key: 'environmentOpenFlow.checkingAccessTitle',
          detail: 'Redeven is checking access before changing this environment.',
          detail_key: 'environmentOpenFlow.checkingAccessDetail',
        };
      case 'awaiting_artifact':
      case 'staging':
        return {
          phase: `gateway_runtime_operation_${operation.state}`,
          title: 'Preparing environment',
          title_key: 'environmentOpenFlow.preparingEnvironmentTitle',
          detail: 'Redeven is preparing the environment so it can start safely.',
          detail_key: 'environmentOpenFlow.preparingEnvironmentDetail',
        };
      case 'commit_ready':
      case 'fencing':
      case 'committing':
        return {
          phase: `gateway_runtime_operation_${operation.state}`,
          title: 'Starting environment',
          title_key: 'environmentOpenFlow.startingEnvironmentTitle',
          detail: 'Redeven is starting the environment.',
          detail_key: 'environmentOpenFlow.startingEnvironmentDetail',
        };
      case 'succeeded':
        return {
          phase: 'gateway_runtime_operation_succeeded',
          title: 'Starting environment',
          title_key: 'environmentOpenFlow.startingEnvironmentTitle',
          detail: 'Redeven is starting the environment.',
          detail_key: 'environmentOpenFlow.startingEnvironmentDetail',
        };
      case 'failed':
      case 'cancelled':
      case 'expired':
        return {
          phase: `gateway_runtime_operation_${operation.state}`,
          title: 'Start failed',
          title_key: 'environmentOpenFlow.startFailedTitle',
          detail: 'Redeven could not start this environment. Try again.',
          detail_key: 'environmentOpenFlow.startFailedDetail',
        };
      case 'recovering':
      case 'manual_recovery_required':
        break;
    }
  }
  const presentation = operationTitle(operation.kind);
  switch (operation.state) {
    case 'preflighting':
      return {
        phase: 'gateway_runtime_operation_preflighting',
        ...presentation,
        detail: 'The Runtime supervisor is validating the target and workload before making changes.',
        detail_key: 'progress.runtimeSupervisorPreflightDetail',
      };
    case 'awaiting_confirmation':
    case 'confirmation_required':
      return {
        phase: 'runtime_operation_confirmation_required',
        ...(owned
          ? { title: 'Review Runtime impact', title_key: 'progress.runtimeImpactTitle' as const }
          : presentation),
        detail: owned
          ? 'Review the current workload impact before allowing the Runtime supervisor to continue.'
          : 'This Runtime operation is waiting for confirmation from the client that started it.',
        detail_key: owned
          ? 'progress.runtimeConfirmationRequiredRecoveryHint'
          : 'progress.runtimeAwaitingConfirmationObserverDetail',
      };
    case 'awaiting_artifact':
      return {
        phase: 'gateway_runtime_operation_awaiting_artifact',
        ...presentation,
        detail: owned
          ? 'Desktop is resuming preparation of the verified Runtime release artifact.'
          : 'The authorized client is preparing the verified Runtime release artifact.',
        detail_key: 'progress.runtimeArtifactPreparationDetail',
      };
    case 'staging':
      return {
        phase: 'gateway_runtime_operation_staging',
        ...presentation,
        detail: 'The Runtime supervisor is staging and verifying the release artifact.',
        detail_key: 'progress.runtimeArtifactStagingDetail',
      };
    case 'commit_ready':
      return {
        phase: 'gateway_runtime_operation_commit_ready',
        ...presentation,
        detail: owned
          ? 'Desktop is resuming the confirmed Runtime lifecycle commit.'
          : 'The authorized client is continuing the confirmed Runtime lifecycle commit.',
        detail_key: 'progress.runtimeCommitReadyDetail',
      };
    case 'fencing':
      return {
        phase: 'gateway_runtime_operation_fencing',
        ...presentation,
        detail: 'The Runtime supervisor is blocking new workload and rechecking the confirmed impact.',
        detail_key: 'progress.runtimeFencingDetail',
      };
    case 'committing':
      return {
        phase: 'gateway_runtime_operation_committing',
        ...presentation,
        detail: 'The Runtime supervisor is applying and verifying the lifecycle change.',
        detail_key: 'progress.runtimeCommittingDetail',
      };
    case 'recovering':
      return {
        phase: 'gateway_runtime_operation_recovering',
        title: 'Recovering Runtime',
        title_key: 'progress.runtimeRecoveringTitle',
        detail: 'The Runtime supervisor is restoring a verified installation after the operation did not complete.',
        detail_key: 'progress.runtimeRecoveringDetail',
      };
    case 'manual_recovery_required':
      return {
        phase: 'gateway_runtime_operation_manual_recovery_required',
        title: 'Runtime recovery required',
        title_key: 'progress.runtimeRecoveryRequiredTitle',
        detail: 'The Runtime supervisor isolated this target. A Runtime management administrator must review and reconcile it.',
        detail_key: 'progress.runtimeRecoveryRequiredDetail',
      };
    case 'succeeded':
      return {
        phase: 'gateway_runtime_operation_succeeded',
        title: 'Runtime operation complete',
        title_key: 'progress.runtimeOperationCompleteTitle',
        detail: 'The Runtime supervisor completed this lifecycle operation.',
        detail_key: 'progress.runtimeOperationCompleteDetail',
      };
    case 'failed':
    case 'cancelled':
    case 'expired':
      return {
        phase: `gateway_runtime_operation_${operation.state}`,
        title: 'Runtime operation stopped',
        title_key: 'progress.runtimeOperationStoppedTitle',
        detail: operation.failure?.message || 'The Runtime supervisor stopped this lifecycle operation.',
        ...(operation.failure?.message ? {} : { detail_key: 'progress.runtimeOperationStoppedDetail' as const }),
      };
  }
}

export function projectAttachedRuntimeOperation(
  operation: GatewayRuntimeOperation,
): RuntimeLifecycleAttachmentProjection {
  const owned = operation.observer_redacted !== true;
  const needsConfirmation = owned
    && operation.kind !== 'reconcile'
    && (operation.state === 'awaiting_confirmation' || operation.state === 'confirmation_required');
  const snapshot = operation.expected_snapshot;
  return {
    state: operation.state,
    ...statePresentation(operation, owned),
    owned,
    needs_confirmation: needsConfirmation,
    should_resume: owned && (operation.state === 'awaiting_artifact' || operation.state === 'commit_ready'),
    manual_recovery_required: operation.state === 'manual_recovery_required',
    ...(needsConfirmation ? {
      confirmation: {
        operation: operation.kind as Exclude<GatewayRuntimeOperationKind, 'reconcile'>,
        snapshot_revision: snapshot.snapshot_revision,
        workload_knowledge: snapshot.workload.knowledge,
        ...(snapshot.workload.affected_process_count !== undefined
          ? { affected_process_count: snapshot.workload.affected_process_count }
          : {}),
        ...(snapshot.workload.active_session_count !== undefined
          ? { active_session_count: snapshot.workload.active_session_count }
          : {}),
        protected_workload_present: snapshot.workload.protected_workload_present,
      },
    } : {}),
  };
}
