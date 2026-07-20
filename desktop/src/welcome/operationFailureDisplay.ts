import type {
  DesktopFailureDiagnostic,
  DesktopFailureSeverity,
  DesktopOperationFailurePresentation,
} from '../shared/desktopOperationFailure';
import type { DesktopI18n } from '../shared/i18n';
import {
  localizedOperationFailureDetail,
  localizedOperationFailureCompactSummary,
  localizedOperationFailureRecoveryHint,
  localizedOperationFailureTitle,
} from './operationFailureI18n';

export type WelcomeOperationFailureDisplay = Readonly<{
  severity: DesktopFailureSeverity;
  title: string;
  summary: string;
  explanation?: string;
  recovery_hint?: string;
  technical_details: readonly string[];
  diagnostics: readonly DesktopFailureDiagnostic[];
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function distinctText(values: readonly unknown[], excluded: readonly unknown[]): readonly string[] {
  const excludedValues = new Set(excluded.map(compact).filter(Boolean));
  const accepted = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = compact(value);
    if (text === '' || excludedValues.has(text) || accepted.has(text)) {
      continue;
    }
    accepted.add(text);
    result.push(text);
  }
  return result;
}

export function buildWelcomeOperationFailureDisplay(input: Readonly<{
  i18n: DesktopI18n;
  failure?: DesktopOperationFailurePresentation;
  progress_detail?: string;
  fallback_title: string;
}>): WelcomeOperationFailureDisplay {
  const failure = input.failure;
  if (!failure) {
    const title = compact(input.fallback_title) || input.i18n.t('progress.operationFailedTitle');
    const summary = input.i18n.t('progress.operationFailedSummary');
    return {
      severity: 'error',
      title,
      summary,
      technical_details: distinctText([input.progress_detail], [title, summary]),
      diagnostics: [],
    };
  }

  const title = localizedOperationFailureTitle(input.i18n, failure);
  const summary = localizedOperationFailureCompactSummary(input.i18n, failure);
  const explanation = localizedOperationFailureDetail(input.i18n, failure);
  const recoveryHint = localizedOperationFailureRecoveryHint(input.i18n, failure);
  const technicalDetails = distinctText([
    failure.summary,
    failure.detail,
    input.progress_detail,
  ], [
    title,
    summary,
    explanation,
    recoveryHint,
  ]);

  return {
    severity: failure.severity,
    title,
    summary,
    ...(compact(explanation) ? { explanation: compact(explanation) } : {}),
    ...(compact(recoveryHint) ? { recovery_hint: compact(recoveryHint) } : {}),
    technical_details: technicalDetails,
    diagnostics: failure.diagnostics ?? [],
  };
}
