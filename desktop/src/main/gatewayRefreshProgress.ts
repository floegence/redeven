import type { DesktopStepProgress, DesktopStepProgressStepStatus } from '../shared/desktopLauncherIPC';
import type { DesktopTranslationKey } from '../shared/i18n';

export type GatewayWorkflowStepID =
  | 'checking_gateway_service'
  | 'checking_gateway_package'
  | 'fetching_pairing_challenge'
  | 'saving_trust_profile'
  | 'refreshing_gateway_catalog'
  | 'gateway_refreshed';

export type GatewayWorkflowStepDefinition = Readonly<{
  id: GatewayWorkflowStepID;
  label: string;
  labelKey: DesktopTranslationKey;
  backendEvent: string;
}>;

export const GATEWAY_REFRESH_WORKFLOW_STEPS: readonly GatewayWorkflowStepDefinition[] = [
  { id: 'checking_gateway_service', label: 'Checking Gateway service', labelKey: 'progress.checkingGatewayService', backendEvent: 'gateway.service.check' },
  { id: 'checking_gateway_package', label: 'Checking Gateway package', labelKey: 'progress.checkingGatewayPackage', backendEvent: 'gateway.package.check' },
  { id: 'fetching_pairing_challenge', label: 'Fetching pairing challenge', labelKey: 'progress.fetchingGatewayPairingChallenge', backendEvent: 'gateway.pair.challenge' },
  { id: 'saving_trust_profile', label: 'Saving trust profile', labelKey: 'progress.savingGatewayTrustProfile', backendEvent: 'gateway.pair.trust' },
  { id: 'refreshing_gateway_catalog', label: 'Refreshing Gateway catalog', labelKey: 'progress.refreshingGatewayCatalog', backendEvent: 'gateway.catalog.refresh' },
  { id: 'gateway_refreshed', label: 'Gateway refreshed', labelKey: 'progress.gatewayChecked', backendEvent: 'gateway.refresh.done' },
];

export function gatewayStepProgress(
  steps: readonly GatewayWorkflowStepDefinition[],
  activeStepID: GatewayWorkflowStepID,
  status: DesktopStepProgressStepStatus = 'running',
): DesktopStepProgress {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepID));
  return {
    active_step_id: activeStepID,
    steps: steps.map((step, index) => ({
      id: step.id,
      backend_event: step.backendEvent,
      label: step.label,
      label_key: step.labelKey,
      status: index < activeIndex
        ? 'succeeded'
        : index === activeIndex
          ? status
          : 'pending',
    })),
  };
}

export function completeGatewayStepProgress(
  steps: readonly GatewayWorkflowStepDefinition[],
  activeStepID: GatewayWorkflowStepID,
): DesktopStepProgress {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepID));
  return {
    active_step_id: activeStepID,
    steps: steps.map((step, index) => ({
      id: step.id,
      backend_event: step.backendEvent,
      label: step.label,
      label_key: step.labelKey,
      status: index <= activeIndex ? 'succeeded' : 'pending',
    })),
  };
}

export function failGatewayStepProgress(
  steps: readonly GatewayWorkflowStepDefinition[],
  activeStepID: GatewayWorkflowStepID,
  detail: string,
): DesktopStepProgress {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepID));
  return {
    active_step_id: activeStepID,
    steps: steps.map((step, index) => ({
      id: step.id,
      backend_event: step.backendEvent,
      label: step.label,
      label_key: step.labelKey,
      status: index < activeIndex ? 'succeeded' : index === activeIndex ? 'failed' : 'pending',
      ...(index === activeIndex ? { detail } : {}),
    })),
  };
}
