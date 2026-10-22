import { describe, expect, it } from 'vitest';
import { createDesktopI18n } from '../shared/i18n';
import { REDEVEN_SUPPORTED_LOCALES } from '../shared/i18n/localeMeta';
import {
  completeGatewayStepProgress,
  failGatewayStepProgress,
  GATEWAY_REFRESH_WORKFLOW_STEPS,
} from './gatewayRefreshProgress';

const expectedLabelKeys = [
  'progress.checkingGatewayService',
  'progress.checkingGatewayPackage',
  'progress.fetchingGatewayPairingChallenge',
  'progress.savingGatewayTrustProfile',
  'progress.refreshingGatewayCatalog',
  'progress.gatewayChecked',
] as const;

describe('Gateway refresh progress localization', () => {
  it.each([
    ['completed', () => completeGatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'gateway_refreshed')],
    ['failed', () => failGatewayStepProgress(GATEWAY_REFRESH_WORKFLOW_STEPS, 'refreshing_gateway_catalog', 'Catalog refresh failed.')],
  ])('retains a translation key on every %s step', (_status, createProgress) => {
    const progress = createProgress();
    expect(progress.steps.map((step) => step.label_key)).toEqual(expectedLabelKeys);
  });

  it('provides localized labels for each distinct Gateway refresh action in every locale', () => {
    for (const locale of REDEVEN_SUPPORTED_LOCALES) {
      const i18n = createDesktopI18n(locale);
      for (const step of GATEWAY_REFRESH_WORKFLOW_STEPS) {
        expect(i18n.t(step.labelKey), `${locale}:${step.id}`).not.toBe('');
        if (locale !== 'en-US') {
          expect(i18n.t(step.labelKey), `${locale}:${step.id}`).not.toBe(step.label);
        }
      }
    }

    const i18n = createDesktopI18n('zh-CN');
    expect(GATEWAY_REFRESH_WORKFLOW_STEPS.map((step) => i18n.t(step.labelKey))).toEqual([
      '检查网关服务',
      '检查网关包',
      '获取配对挑战',
      '保存信任配置文件',
      '刷新网关环境目录',
      '网关已刷新',
    ]);
  });
});
