import type {
  DesktopFailureCode,
  DesktopFailureDiagnostic,
  DesktopFailureSeverity,
  DesktopOperationFailurePresentation,
} from '../shared/desktopOperationFailure';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export class DesktopOperationFailureError extends Error {
  readonly presentation: DesktopOperationFailurePresentation;

  constructor(presentation: DesktopOperationFailurePresentation, options: Readonly<{ cause?: unknown }> = {}) {
    super(presentation.summary);
    this.name = 'DesktopOperationFailureError';
    this.presentation = presentation;
    this.cause = options.cause;
  }
}

export function isDesktopOperationFailureError(error: unknown): error is DesktopOperationFailureError {
  return error instanceof DesktopOperationFailureError;
}

export function desktopOperationFailurePresentation(
  input: Readonly<{
    code?: DesktopFailureCode;
    severity?: DesktopFailureSeverity;
    title: string;
    summary: string;
    detail?: string;
    recoveryHint?: string;
    targetLabel?: string;
    diagnostics?: readonly DesktopFailureDiagnostic[];
  }>,
): DesktopOperationFailurePresentation {
  const title = compact(input.title) || 'Operation failed';
  const summary = compact(input.summary) || 'Desktop could not complete this operation.';
  const diagnostics = (input.diagnostics ?? []).filter((item) => compact(item.text) !== '');
  return {
    code: input.code ?? 'operation_failed',
    severity: input.severity ?? 'error',
    title,
    summary,
    ...(compact(input.detail) ? { detail: compact(input.detail) } : {}),
    ...(compact(input.recoveryHint) ? { recovery_hint: compact(input.recoveryHint) } : {}),
    ...(compact(input.targetLabel) ? { target_label: compact(input.targetLabel) } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function diagnosticsFromRecentLogs(
  logs: Record<string, unknown>,
  labels: Record<string, string> = {},
): readonly DesktopFailureDiagnostic[] {
  return Object.entries(logs)
    .map(([channel, value]) => ({
      channel,
      label: compact(labels[channel]) || channel,
      text: compact(value),
    }))
    .filter((item) => item.text !== '');
}

export function operationFailureFromUnknown(
  error: unknown,
  fallback: DesktopOperationFailurePresentation,
): DesktopOperationFailurePresentation {
  if (isDesktopOperationFailureError(error)) {
    return error.presentation;
  }
  const message = error instanceof Error ? compact(error.message) : compact(error);
  if (message === '') {
    return fallback;
  }
  return {
    ...fallback,
    summary: message,
  };
}

// IMPORTANT: Recent runtime logs are diagnostics. Do not concatenate them into
// Error.message for launcher/UI paths; pass them through diagnostics.
