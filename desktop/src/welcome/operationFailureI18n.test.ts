import { describe, expect, it } from 'vitest';

import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { createDesktopI18n } from '../shared/i18n';
import {
  localizedOperationFailureDetail,
  localizedOperationFailureRecoveryHint,
  localizedOperationFailureSummary,
  localizedOperationFailureTitle,
} from './operationFailureI18n';

describe('operationFailureI18n', () => {
  it('localizes Gateway package preparation failures', () => {
    const failure: DesktopOperationFailurePresentation = {
      code: 'gateway_package_prepare_failed',
      severity: 'error',
      title: 'Gateway package failed',
      summary: 'raw summary',
      target_label: 'linux/amd64 Redeven Gateway package',
    };

    expect(localizedOperationFailureTitle(createDesktopI18n('en-US'), failure)).toBe('Gateway Package Preparation Failed');
    expect(localizedOperationFailureSummary(createDesktopI18n('en-US'), failure)).toBe('Prepare Gateway package did not complete.');
    expect(localizedOperationFailureTitle(createDesktopI18n('zh-CN'), failure)).toBe('网关包准备失败');
    expect(localizedOperationFailureSummary(createDesktopI18n('zh-CN'), failure)).toBe('准备网关包未完成。');
  });

  it('localizes every field of SSH forward verification timeout failures', () => {
    const failure: DesktopOperationFailurePresentation = {
      code: 'ssh_forward_verification_timed_out',
      severity: 'error',
      title: 'SSH Tunnel Verification Timed Out',
      summary: 'raw summary',
      detail: 'raw detail',
      detail_key: 'progress.sshForwardVerificationTimedOutDetail',
      recovery_hint: 'raw recovery',
      recovery_hint_key: 'progress.sshForwardVerificationTimedOutRecoveryHint',
      target_label: 'los',
    };
    const i18n = createDesktopI18n('zh-CN');

    expect(localizedOperationFailureTitle(i18n, failure)).toBe('SSH 隧道验证超时');
    expect(localizedOperationFailureSummary(i18n, failure)).toContain('转发后的运行时未能在就绪检查截止时间前响应');
    expect(localizedOperationFailureDetail(i18n, failure)).toContain('未能在就绪检查截止时间内完成健康检查');
    expect(localizedOperationFailureRecoveryHint(i18n, failure)).toBe('确认远程运行时可以正常响应，然后重新打开该环境。');
  });

  it('localizes lifecycle conflicts without exposing raw process inventory errors', () => {
    const failure: DesktopOperationFailurePresentation = {
      code: 'runtime_lifecycle_conflict',
      severity: 'error',
      title: 'Runtime Changed During Operation',
      summary: 'raw summary',
      summary_key: 'progress.runtimeLifecycleConflictSummary',
      detail: 'runtime_inventory_changed: pid changed',
      detail_key: 'progress.runtimeLifecycleConflictDetail',
      recovery_hint: 'raw recovery',
      recovery_hint_key: 'progress.runtimeLifecycleConflictRecoveryHint',
    };
    const i18n = createDesktopI18n('zh-CN');

    expect(localizedOperationFailureTitle(i18n, failure)).toBe('操作期间运行时发生变化');
    expect(localizedOperationFailureSummary(i18n, failure)).toContain('另一个生命周期控制方');
    expect(localizedOperationFailureDetail(i18n, failure)).not.toContain('pid changed');
    expect(localizedOperationFailureRecoveryHint(i18n, failure)).toContain('刷新运行时状态');
  });
});
