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

  it.each([
    {
      locale: 'en-US' as const,
      code: 'ssh_connection_interrupted' as const,
      title: 'SSH Connection Interrupted',
      summary: 'Desktop connected to "los", but the reusable SSH connection ended before the operation completed.',
      detail: 'The SSH control connection was no longer healthy after a remote command failed.',
      recovery: 'Check the network, VPN, and SSH service on the host, then retry the operation explicitly.',
    },
    {
      locale: 'zh-CN' as const,
      code: 'ssh_connection_interrupted' as const,
      title: 'SSH 连接已中断',
      summary: 'Desktop 已连接到“los”，但可复用的 SSH 连接在操作完成前已断开。',
      detail: '远程命令失败后，SSH 控制连接已不再正常。',
      recovery: '请检查网络、VPN 和主机上的 SSH 服务状态，然后手动重试该操作。',
    },
    {
      locale: 'en-US' as const,
      code: 'ssh_upload_directory_unavailable' as const,
      title: 'SSH Upload Directory Unavailable',
      summary: 'Desktop could not create a private SSH upload directory on "los".',
      detail: 'The SSH connection is still active, but the host could not create a private directory under $TMPDIR or /tmp.',
      recovery: 'Check free disk space, user quota, and write permissions for $TMPDIR or /tmp, then retry.',
    },
    {
      locale: 'zh-CN' as const,
      code: 'ssh_upload_directory_unavailable' as const,
      title: 'SSH 上传目录不可用',
      summary: 'Desktop 无法在“los”上创建私有 SSH 上传目录。',
      detail: 'SSH 连接仍然正常，但主机无法在 $TMPDIR 或 /tmp 下创建私有目录。',
      recovery: '请检查可用磁盘空间、用户配额，以及 $TMPDIR 或 /tmp 的写入权限，然后重试。',
    },
  ])('localizes every field of $code for $locale', ({ locale, code, title, summary, detail, recovery }) => {
    const failure: DesktopOperationFailurePresentation = {
      code,
      severity: 'error',
      title: 'raw title',
      summary: 'raw summary',
      detail: 'raw detail',
      recovery_hint: 'raw recovery',
      target_label: 'los',
    };
    const i18n = createDesktopI18n(locale);

    expect(localizedOperationFailureTitle(i18n, failure)).toBe(title);
    expect(localizedOperationFailureSummary(i18n, failure)).toBe(summary);
    expect(localizedOperationFailureDetail(i18n, failure)).toBe(detail);
    expect(localizedOperationFailureRecoveryHint(i18n, failure)).toBe(recovery);
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

  it('localizes protected local transport failures without asking users to disable network software', () => {
    const failure: DesktopOperationFailurePresentation = {
      code: 'environment_open_failed',
      severity: 'error',
      title: 'Environment Open Failed',
      title_key: 'progress.environmentOpenFailedTitle',
      summary: 'Desktop could not open "Local Environment".',
      summary_key: 'progress.environmentOpenFailedSummary',
      detail: 'raw transport detail',
      detail_key: 'progress.environmentOpenLocalTransportDetail',
      recovery_hint: 'raw recovery',
      recovery_hint_key: 'progress.environmentOpenLocalTransportRecoveryHint',
      target_label: '本地环境',
    };

    const localized = createDesktopI18n('zh-CN');
    expect(localizedOperationFailureDetail(localized, failure)).toContain('受保护本地连接');
    expect(localizedOperationFailureRecoveryHint(localized, failure)).toContain('无需关闭 VPN、Tailscale 或代理软件');
  });
});
