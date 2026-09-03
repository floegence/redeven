import type { DesktopFailureDiagnostic } from '../shared/desktopOperationFailure';
import {
  classifyDesktopRuntimeBlockedLaunchReport,
  type DesktopRuntimeBlockedClassification,
} from '../shared/desktopRuntimeHealth';
import {
  DesktopOperationFailureError,
  runtimeStateIncompatibleFailure,
} from './desktopOperationFailure';
import {
  formatBlockedLaunchDiagnostics,
  type LaunchBlockedReport,
} from './launchReport';

export function desktopOperationFailureFromBlockedLaunchReport(input: Readonly<{
  report: LaunchBlockedReport;
  classification?: DesktopRuntimeBlockedClassification;
  targetLabel?: string;
  targetRuntimeVersion?: string;
  diagnostics?: readonly DesktopFailureDiagnostic[];
}>): DesktopOperationFailureError | null {
  const classification = input.classification ?? classifyDesktopRuntimeBlockedLaunchReport(
    input.report,
    { target_runtime_version: input.targetRuntimeVersion },
  );
  if (classification.kind !== 'reinstall_required') {
    return null;
  }
  return new DesktopOperationFailureError(runtimeStateIncompatibleFailure({
    message: input.report.message,
    targetLabel: input.targetLabel,
    diagnostics: [{
      channel: 'runtime_startup_report',
      label: 'Runtime startup report',
      text: formatBlockedLaunchDiagnostics(input.report),
    }, ...(input.diagnostics ?? []).filter((diagnostic) => diagnostic.channel !== 'runtime_startup_report')],
  }));
}
