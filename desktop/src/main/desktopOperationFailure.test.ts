import { describe, expect, it } from 'vitest';
import { DesktopSSHTransportAuthenticationError } from './sshTransportManager';

import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
  diagnosticsFromRecentLogs,
  operationFailureFromUnknown,
  runtimeStateIncompatibleFailure,
  runtimeAccessVerificationFailure,
} from './desktopOperationFailure';
import { normalizeRuntimeServiceSnapshot, RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import { createDesktopI18n } from '../shared/i18n';
import { buildWelcomeOperationFailureDisplay } from '../welcome/operationFailureDisplay';

describe('desktopOperationFailure main helpers', () => {
  it('reports the observed readiness reason without exposing private bridge credentials', () => {
    const failure = runtimeAccessVerificationFailure('udesk26', { ok: true, value: {
      local_ui_url: '', local_ui_urls: [], local_ui_bridge_token: 'private-token',
      runtime_service: normalizeRuntimeServiceSnapshot({
        compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH, compatibility: 'compatible',
        open_readiness: { state: 'starting', reason_code: 'env_app_shell_unreachable', message: 'Environment App shell is not reachable yet.' },
      }),
    } });
    expect(failure).toMatchObject({ code: 'runtime_access_verification_failed',
      title_key: 'progress.runtimeAccessVerificationFailedTitle',
      summary_key: 'progress.runtimeAccessVerificationFailedSummary', target_label: 'udesk26' });
    expect(failure.detail).toBeUndefined();
    expect(JSON.parse(failure.diagnostics![0].text)).toMatchObject({ stage: 'runtime_readiness',
      open_readiness: { state: 'starting', reason_code: 'env_app_shell_unreachable' } });
    expect(JSON.stringify(failure)).not.toContain('private-token');
    for (const locale of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'] as const) {
      const display = buildWelcomeOperationFailureDisplay({
        i18n: createDesktopI18n(locale), failure, fallback_title: 'Failure',
      });
      expect(display.title).not.toBe('Failure');
      expect(display.summary).toContain('udesk26');
      expect(display.summary).not.toContain('{target}');
      expect(display.diagnostics).toEqual(failure.diagnostics);
    }
  });

  it('preserves the exact access probe failure stage and status', () => {
    const failure = runtimeAccessVerificationFailure('udesk26', { ok: false, failure: {
      kind: 'invalid_response', stage: 'runtime_health', status_code: 401,
    } });
    expect(JSON.parse(failure.diagnostics![0].text)).toEqual({
      kind: 'invalid_response', stage: 'runtime_health', status_code: 401,
    });
  });
  it('distinguishes SSH authentication rejection from network and Runtime failures', () => {
    const fallback = desktopOperationFailurePresentation({
      code: 'ssh_connection_failed', title: 'Connection failed', summary: 'Connection failed.', targetLabel: 'orange',
    });
    expect(operationFailureFromUnknown(new DesktopSSHTransportAuthenticationError('Denied', 'Permission denied (password).'), fallback))
      .toMatchObject({ code: 'ssh_authentication_failed', target_label: 'orange' });
    expect(operationFailureFromUnknown(new Error('Network unreachable'), fallback).code).toBe('ssh_connection_failed');
  });
  it('preserves typed failure presentation across main-process boundaries', () => {
    const failure = desktopOperationFailurePresentation({
      code: 'ssh_connection_failed',
      title: 'SSH Connection Failed',
      summary: 'SSH connection to "dify" failed.',
      targetLabel: 'dify',
    });

    expect(operationFailureFromUnknown(new DesktopOperationFailureError(failure), desktopOperationFailurePresentation({
      title: 'Fallback',
      summary: 'Fallback summary.',
    }))).toEqual(failure);
  });

  it('preserves runtime and Desktop update failure codes after an Open attempt reaches runtime compatibility checks', () => {
    for (const code of ['runtime_update_required', 'desktop_update_required'] as const) {
      const failure = desktopOperationFailurePresentation({
        code,
        severity: 'warning',
        title: code === 'runtime_update_required' ? 'Runtime Update Required' : 'Desktop Update Required',
        summary: code === 'runtime_update_required'
          ? 'Update the runtime before opening this environment.'
          : 'Update Desktop before opening this environment.',
      });

      expect(operationFailureFromUnknown(new DesktopOperationFailureError(failure), desktopOperationFailurePresentation({
        title: 'Fallback',
        summary: 'Fallback summary.',
      }))).toEqual(expect.objectContaining({
        code,
        severity: 'warning',
      }));
    }
  });

  it('maps incompatible runtime state to one reinstall recovery contract', () => {
    expect(runtimeStateIncompatibleFailure({
      message: 'wrong database kind: expected "portforward_registry_v1", got "portforward_registry"',
      targetLabel: 'orange',
      diagnostics: [{
        channel: 'runtime_startup_report',
        label: 'Runtime startup report',
        text: 'failure code: runtime_state_incompatible',
      }],
    })).toEqual({
      code: 'reinstall_required',
      severity: 'error',
      title: 'Reinstall requires attention',
      title_key: 'confirm.reinstallFailedTitle',
      summary: 'This environment has incompatible state. Reinstall is the only safe recovery.',
      summary_key: 'confirm.reinstallRequiredDescription',
      detail: 'wrong database kind: expected "portforward_registry_v1", got "portforward_registry"',
      target_label: 'orange',
      diagnostics: [{
        channel: 'runtime_startup_report',
        label: 'Runtime startup report',
        text: 'failure code: runtime_state_incompatible',
      }],
    });
  });

  it('converts recent logs into diagnostics without creating visible copy', () => {
    expect(diagnosticsFromRecentLogs({
      control_stderr: ' ssh: Could not resolve hostname dify ',
      master_stderr: '   ',
    }, {
      control_stderr: 'SSH command stderr',
    })).toEqual([{
      channel: 'control_stderr',
      label: 'SSH command stderr',
      text: 'ssh: Could not resolve hostname dify',
    }]);
  });
});
