import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import {
  runtimeServiceNeedsDesktopUpdate,
  runtimeServiceNeedsRuntimeUpdate,
} from '../shared/runtimeService';
import type { StartupReport } from './startup';
import type { RuntimeProbeFailure } from './runtimeState';
import { desktopOperationFailurePresentation } from './desktopOperationFailure';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function probeDiagnostics(failure: RuntimeProbeFailure): readonly {
  channel: string;
  label: string;
  text: string;
}[] {
  return [{
    channel: 'runtime_readiness_probe',
    label: 'Runtime readiness probe',
    text: [
      `stage=${compact(failure.stage) || 'runtime_health'}`,
      `kind=${failure.kind}`,
      ...(compact(failure.code) ? [`code=${compact(failure.code)}`] : []),
      ...(failure.status_code !== undefined ? [`status_code=${failure.status_code}`] : []),
    ].join('\n'),
  }];
}

function runtimeCompatibilityDetail(startup: StartupReport): string | undefined {
  const runtimeService = startup.runtime_service;
  const compatibilityMessage = compact(runtimeService?.compatibility_message);
  if (compatibilityMessage !== '') {
    return compatibilityMessage;
  }
  const runtimeVersion = compact(runtimeService?.runtime_version);
  const requiredRuntimeVersion = compact(runtimeService?.minimum_runtime_version);
  if (runtimeVersion !== '' || requiredRuntimeVersion !== '') {
    return [
      `Installed runtime: ${runtimeVersion || 'unknown'}`,
      `Required runtime: ${requiredRuntimeVersion || 'current Desktop runtime'}`,
    ].join('\n');
  }
  return undefined;
}

export function desktopFailureForRuntimePlacementBridgeReadiness(
  failure: RuntimeProbeFailure,
  startup: StartupReport,
  targetLabel?: string,
): DesktopOperationFailurePresentation {
  const runtimeService = startup.runtime_service;
  const diagnostics = probeDiagnostics(failure);
  if (runtimeServiceNeedsDesktopUpdate(runtimeService)) {
    return desktopOperationFailurePresentation({
      code: 'desktop_update_required',
      title: 'Desktop Update Required',
      titleKey: 'runtimeMessage.desktopUpdateRequired',
      summary: 'Update Desktop before opening this environment.',
      summaryKey: 'runtimeMessage.updateDesktopBeforeOpeningEnvironment',
      detail: runtimeCompatibilityDetail(startup),
      recoveryHint: 'Update Desktop before opening this environment.',
      recoveryHintKey: 'runtimeMessage.updateDesktopBeforeOpeningEnvironment',
      targetLabel,
      diagnostics,
    });
  }
  if (runtimeServiceNeedsRuntimeUpdate(runtimeService)) {
    return desktopOperationFailurePresentation({
      code: 'runtime_update_required',
      title: 'Runtime Update Required',
      titleKey: 'runtimeMessage.runtimeUpdateRequired',
      summary: 'Update the Runtime before opening this environment.',
      summaryKey: 'runtimeMessage.updateRuntimeBeforeOpeningEnvironment',
      detail: runtimeCompatibilityDetail(startup),
      recoveryHint: 'Update the Runtime first.',
      recoveryHintKey: 'runtimeMessage.updateRuntimeFirst',
      targetLabel,
      diagnostics,
    });
  }

  return desktopOperationFailurePresentation({
    code: 'environment_open_failed',
    severity: 'warning',
    title: 'Runtime readiness check required',
    titleKey: 'runtimeMessage.refreshStatusTitle',
    summary: 'Desktop could not confirm Runtime readiness yet.',
    summaryKey: 'runtimeMessage.runtimeReadinessUnavailable',
    recoveryHint: 'Refresh status before opening this environment.',
    recoveryHintKey: 'runtimeMessage.refreshStatusTitle',
    targetLabel,
    diagnostics,
  });
}
