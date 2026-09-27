import type { FlowerComputerCopy } from './computerUseCopy';
import type { FlowerChromeDiagnostic } from './contracts/flowerSurfaceContracts';

const reasons = new Set(['browser_resources_missing', 'browser_extension_missing', 'browser_not_installed',
  'desktop_session_unavailable', 'browser_start_failed', 'folder_opener_missing', 'folder_open_failed', 'extension_platform_unsupported',
  'extension_runtime_unavailable', 'extension_prepare_failed', 'extension_setup_failed', 'extension_open_failed', 'extension_check_failed', 'extension_continue_failed']);

export function chromeConnectionDiagnostic(value: unknown, stage: FlowerChromeDiagnostic['stage']): FlowerChromeDiagnostic {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const safeStage = ['prepare', 'open', 'check', 'continue'].includes(stage) ? stage : 'check';
  const reason = typeof record.reason === 'string' && reasons.has(record.reason) ? record.reason : `extension_${safeStage}_failed`;
  const id = typeof record.diagnostic_id === 'string' && /^[A-Za-z0-9_-]{8,80}$/u.test(record.diagnostic_id) ? record.diagnostic_id : undefined;
  return { stage: safeStage, reason, ...(id ? { diagnostic_id: id } : {}) };
}

export function chromeConnectionError(error: unknown, stage: FlowerChromeDiagnostic['stage']): FlowerChromeDiagnostic {
  const record = error && typeof error === 'object' ? error as { code?: unknown; data?: unknown } : {};
  return chromeConnectionDiagnostic(record.data ?? { reason: record.code }, stage);
}

export function chromeDiagnosticPresentation(diagnostic: FlowerChromeDiagnostic, copy: FlowerComputerCopy) {
  switch (diagnostic.reason) {
    case 'browser_resources_missing': case 'browser_extension_missing':
      return { title: copy.chromeResourcesTitle, hint: copy.chromeResourcesHint, help: copy.chromeRepairAction, steps: copy.chromeRepairSteps };
    case 'browser_not_installed': return { title: copy.chromeMissingTitle, hint: copy.chromeMissingHint };
    case 'desktop_session_unavailable': return { title: copy.chromeDesktopTitle, hint: copy.chromeDesktopHint, help: copy.chromeDesktopAction, steps: copy.chromeDesktopSteps };
    case 'browser_start_failed': return { title: copy.chromeLaunchTitle, hint: copy.chromeLaunchHint };
    case 'folder_opener_missing': case 'folder_open_failed': return { hint: copy.chromeFolderFailed };
    case 'extension_platform_unsupported': return { hint: copy.chromeUnsupported };
    default: return { hint: diagnostic.stage === 'continue' ? copy.chromeContinueFailed : diagnostic.stage === 'prepare' ? copy.chromePrepareFailed : diagnostic.stage === 'open' ? copy.chromeLaunchHint : copy.chromeCheckFailed };
  }
}
