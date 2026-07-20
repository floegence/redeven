import { describe, expect, it } from 'vitest';

import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { createDesktopI18n } from '../shared/i18n';
import { buildWelcomeOperationFailureDisplay } from './operationFailureDisplay';

describe('operationFailureDisplay', () => {
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
      code: 'runtime_lifecycle_conflict',
      severity: 'error',
      title: 'Runtime Changed During Operation',
      summary: 'Another lifecycle authority changed this Runtime while Desktop was managing it.',
      detail: 'inventory digest changed',
      recovery_hint: 'Wait for the other lifecycle operation to finish, then refresh Runtime status.',
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

    expect(display.explanation).toBe('The verified Runtime process inventory changed before Desktop completed the lifecycle transaction.');
    expect(display.recovery_hint).toBe('Wait for the other lifecycle operation to finish, then refresh Runtime status.');
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
