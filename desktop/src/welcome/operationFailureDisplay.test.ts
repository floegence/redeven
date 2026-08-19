import { describe, expect, it } from 'vitest';

import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopLauncherActionProgress, DesktopLauncherActionResult } from '../shared/desktopLauncherIPC';
import {
  buildWelcomeOperationFailureDisplay,
  confirmationProgressForLauncherFailure,
} from './operationFailureDisplay';

describe('operationFailureDisplay', () => {
  it('treats confirmation_required as a progress transition instead of a displayed failure', () => {
    const failure: Extract<DesktopLauncherActionResult, Readonly<{ ok: false }>> = {
      ok: false,
      code: 'confirmation_required',
      scope: 'environment',
      message: 'Review the Runtime impact.',
      environment_id: 'ssh-orange',
      operation_key: 'ssh-orange:update_runtime',
    };
    const progress = {
      operation_key: 'ssh-orange:update_runtime',
      action: 'update_environment_runtime',
      subject_kind: 'gateway',
      subject_id: 'gw-orange',
      environment_id: 'ssh-orange',
      status: 'needs_confirmation',
      phase: 'runtime_operation_confirmation_required',
      title: 'Update Runtime',
      detail: 'Confirm and continue.',
      started_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      cancelable: true,
    } satisfies DesktopLauncherActionProgress;

    expect(confirmationProgressForLauncherFailure(failure, [progress])).toBe(progress);
    expect(confirmationProgressForLauncherFailure({ ...failure, code: 'runtime_start_failed' }, [progress])).toBeNull();
  });
  it('keeps a localized failure summary compact and moves the raw error into technical details', () => {
    const rawError = 'failed to init runtime: codeapp registry column mismatch';
    const failure: DesktopOperationFailurePresentation = {
      code: 'local_runtime_launch_failed',
      severity: 'error',
      title: 'Runtime Start Failed',
      summary: rawError,
      target_label: 'Local Environment',
    };

    expect(buildWelcomeOperationFailureDisplay({
      i18n: createDesktopI18n('zh-CN'),
      failure,
      progress_detail: rawError,
      fallback_title: '启动需要处理',
    })).toMatchObject({
      title: '运行时启动失败',
      summary: '启动运行未完成。',
      technical_details: [rawError],
      diagnostics: [],
    });
  });

  it('deduplicates localized explanations, raw errors, progress detail, and diagnostics', () => {
    const failure: DesktopOperationFailurePresentation = {
      code: 'confirmation_required',
      severity: 'warning',
      title: 'Runtime Confirmation Required',
      summary: 'The Runtime workload changed before this operation could continue.',
      detail: 'inventory digest changed',
      recovery_hint: 'Review the current Runtime workload, then confirm again to continue.',
      diagnostics: [{
        channel: 'runtime_control',
        label: 'Runtime control',
        text: 'inventory digest changed',
      }],
    };

    const display = buildWelcomeOperationFailureDisplay({
      i18n: createDesktopI18n('en-US'),
      failure,
      progress_detail: failure.summary,
      fallback_title: 'Startup needs attention',
    });

    expect(display.explanation).toBe("The verified Runtime process inventory no longer matches the operation's confirmation snapshot.");
    expect(display.recovery_hint).toBe('Review the current Runtime workload, then confirm again to continue.');
    expect(display.technical_details).toEqual(['inventory digest changed']);
    expect(display.diagnostics).toEqual(failure.diagnostics);
  });

  it('keeps an unstructured failure below progress as a generic summary with technical detail', () => {
    const display = buildWelcomeOperationFailureDisplay({
      i18n: createDesktopI18n('en-US'),
      progress_detail: 'unexpected multiline\nerror output',
      fallback_title: 'Startup needs attention',
    });

    expect(display).toMatchObject({
      severity: 'error',
      title: 'Startup needs attention',
      summary: 'Desktop could not complete this operation.',
      technical_details: ['unexpected multiline\nerror output'],
      diagnostics: [],
    });
  });

  it('keeps an inline structured failure message out of the compact summary', () => {
    const rawError = 'operation request failed with a very long response';
    const display = buildWelcomeOperationFailureDisplay({
      i18n: createDesktopI18n('en-US'),
      failure: {
        code: 'operation_failed',
        severity: 'error',
        title: 'Operation failed',
        summary: rawError,
      },
      progress_detail: rawError,
      fallback_title: 'Gateway issue',
    });

    expect(display.summary).toBe('Desktop could not complete this operation.');
    expect(display.technical_details).toEqual([rawError]);
  });
});
