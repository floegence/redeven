import { describe, expect, it } from 'vitest';

import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { createDesktopI18n } from '../shared/i18n';
import {
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
});
