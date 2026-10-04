import type { DesktopStepProgress, DesktopStepProgressStepStatus } from '../shared/desktopLauncherIPC';
import type { DesktopTranslationKey } from '../shared/i18n';
import type { GatewayServiceLifecycleProgress } from './gatewayLifecycleManager';

type Phase = GatewayServiceLifecycleProgress['phase'] | 'checking_gateway_service';
const labels: Record<Phase, readonly [string, DesktopTranslationKey]> = {
  checking_gateway_service: ['Checking Gateway service', 'progress.checkingGatewayService'],
  checking_host: ['Checking host', 'progress.checkingHost'],
  checking_container: ['Checking container', 'progress.checkingContainer'],
  preparing_gateway_package: ['Preparing Gateway package', 'progress.preparingGatewayPackage'],
  installing_gateway: ['Installing Gateway package', 'progress.installingGatewayPackage'],
  starting_gateway: ['Starting Gateway service', 'progress.startingGatewayService'],
  opening_bridge: ['Opening Gateway bridge', 'progress.openingGatewayBridge'],
  stopping_gateway: ['Stopping Gateway service', 'progress.stoppingGatewayService'],
  verifying_gateway_stopped: ['Verifying Gateway stopped', 'progress.verifyingGatewayStopped'],
  enrolling_gateway: ['Checking Gateway trust', 'progress.checkingGatewayTrust'],
  gateway_ready: ['Gateway service ready', 'progress.gatewayServiceReady'],
};

// Project observed service events into the existing operation snapshot. Do not
// invent installation steps or percentages for work the host may skip.
export function gatewayServiceStepProgress(
  previous: DesktopStepProgress | undefined,
  phase: Phase,
  status: DesktopStepProgressStepStatus = 'running',
  now = Date.now(),
): DesktopStepProgress {
  const steps = [...(previous?.steps ?? [])];
  const last = steps.at(-1);
  if (last?.id === phase || last?.id.startsWith(`${phase}:`)) {
    steps[steps.length - 1] = { ...last, status };
  } else {
    if (last?.status === 'running') steps[steps.length - 1] = { ...last, status: 'succeeded' };
    const [label, label_key] = labels[phase];
    const id = steps.some(step => step.id === phase) ? `${phase}:${steps.length}` : phase;
    steps.push({ id, label, label_key, status, started_at_unix_ms: now });
  }
  return { active_step_id: steps[steps.length - 1].id, steps };
}

export function finishGatewayServiceStepProgress(previous: DesktopStepProgress | undefined, status: 'succeeded' | 'failed' | 'canceled'): DesktopStepProgress | undefined {
  if (!previous) return undefined;
  return { ...previous, steps: previous.steps.map((step, index) => index === previous.steps.length - 1 ? { ...step, status } : step) };
}
