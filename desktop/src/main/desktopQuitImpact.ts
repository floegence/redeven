import type { DesktopConfirmationDialogModel } from '../shared/desktopConfirmationContract';
import { createDesktopI18n, type DesktopI18n } from '../shared/i18n/desktopI18n';
import type { RedevenLocale } from '../shared/i18n/localeMeta';

export type DesktopQuitSource = 'explicit' | 'system' | 'last_window_close';

export type DesktopQuitImpactInput = Readonly<{
  environment_window_count: number;
  pending_operation_count?: number;
  running_runtime_count?: number;
}>;

export type DesktopQuitImpact = Readonly<{
  environment_window_count: number;
  pending_operation_count: number;
  running_runtime_count: number;
}>;

function joinWithAnd(parts: readonly string[], locale: RedevenLocale): string {
  if (parts.length <= 0) {
    return '';
  }
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format([...parts]);
  } catch {
    return new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format([...parts]);
  }
}

export function buildDesktopQuitImpact(input: DesktopQuitImpactInput): DesktopQuitImpact {
  return {
    environment_window_count: Math.max(0, Math.trunc(input.environment_window_count)),
    pending_operation_count: Math.max(0, Math.trunc(input.pending_operation_count ?? 0)),
    running_runtime_count: Math.max(0, Math.trunc(input.running_runtime_count ?? 0)),
  };
}

export function shouldConfirmDesktopQuit(
  impact: DesktopQuitImpact,
  source: DesktopQuitSource,
): boolean {
  if (impact.pending_operation_count > 0) {
    return true;
  }
  if (source === 'last_window_close') {
    return false;
  }
  return impact.environment_window_count > 0;
}

export function shouldConfirmDesktopLastWindowClose(
  impact: DesktopQuitImpact,
): boolean {
  return impact.pending_operation_count > 0 || impact.environment_window_count > 0;
}

function i18nFromLocale(locale: RedevenLocale = 'en-US'): DesktopI18n {
  return createDesktopI18n(locale);
}

export function buildDesktopQuitConfirmationModel(
  impact: DesktopQuitImpact,
  locale: RedevenLocale = 'en-US',
): DesktopConfirmationDialogModel {
  const i18n = i18nFromLocale(locale);
  const sessionCount = impact.environment_window_count;
  const operationCount = impact.pending_operation_count;
  const runtimeCount = impact.running_runtime_count;
  const summary: string[] = [];

  if (sessionCount > 0) {
    summary.push(
      i18n.tn('quitImpact.closeEnvironmentWindows', sessionCount),
    );
  }
  if (operationCount > 0) {
    summary.push(
      i18n.tn('quitImpact.cancelBackgroundTasks', operationCount),
    );
  }

  const message = summary.length > 0
    ? i18n.t('quitImpact.quitWill', { summary: joinWithAnd(summary, locale) })
    : i18n.t('quitImpact.quitWithoutImpact');
  const detail = runtimeCount > 0
    ? i18n.tn('quitImpact.runtimeProcessesKeepRunning', runtimeCount)
    : '';

  return {
    title: i18n.t('quitImpact.quitTitle'),
    message,
    detail,
    confirm_label: i18n.t('quitImpact.quitConfirm'),
    cancel_label: i18n.t('common.cancel'),
    confirm_tone: 'danger',
    platform_action: 'quit_app',
    platform_title: i18n.t('quitImpact.exitTitle'),
    platform_confirm_label: i18n.t('quitImpact.exitConfirm'),
  };
}

export function buildDesktopLastWindowCloseConfirmationModel(
  impact: DesktopQuitImpact,
  locale: RedevenLocale = 'en-US',
): DesktopConfirmationDialogModel {
  const i18n = i18nFromLocale(locale);
  const operationCount = impact.pending_operation_count;
  const runtimeCount = impact.running_runtime_count;
  const message = operationCount > 0
    ? i18n.tn('quitImpact.lastWindowBackgroundTasksKeepRunning', operationCount)
    : impact.environment_window_count > 0
      ? i18n.t('quitImpact.lastWindowDesktopKeepsRunning')
      : i18n.t('quitImpact.desktopKeepsRunning');
  const runtimeDetail = runtimeCount > 0
    ? i18n.tn('quitImpact.runtimeProcessesKeepRunning', runtimeCount)
    : '';

  return {
    title: i18n.t('quitImpact.closeLastWindowTitle'),
    message,
    detail: [runtimeDetail, i18n.t('quitImpact.reopenLauncherHint')].filter(Boolean).join(' '),
    confirm_label: i18n.t('quitImpact.closeWindowConfirm'),
    cancel_label: i18n.t('common.cancel'),
    confirm_tone: 'warning',
  };
}
