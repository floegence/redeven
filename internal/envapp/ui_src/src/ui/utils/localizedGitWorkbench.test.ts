import { describe, expect, it } from 'vitest';

import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import {
  localizedGitBranchSubviewLabel,
  localizedGitChangeLabel,
} from './localizedGitWorkbench';

describe('localized Git workbench labels', () => {
  it('localizes file change states without leaking implementation literals', () => {
    const enUS = createTestI18nHelpers('en-US');
    const zhCN = createTestI18nHelpers('zh-CN');
    const zhTW = createTestI18nHelpers('zh-TW');

    expect(localizedGitChangeLabel('modified', enUS)).toBe('Modified');
    expect(localizedGitChangeLabel('modified', zhCN)).toBe('已修改');
    expect(localizedGitChangeLabel('conflicted', zhTW)).toBe('有衝突');
    expect(localizedGitChangeLabel(undefined, zhCN)).toBe('已修改');
    expect(localizedGitChangeLabel('submodule', zhCN)).toBe('submodule');
  });

  it('uses the established workspace and graph names for branch detail tabs', () => {
    const zhCN = createTestI18nHelpers('zh-CN');
    const zhTW = createTestI18nHelpers('zh-TW');

    expect(localizedGitBranchSubviewLabel('status', zhCN)).toBe('工作区');
    expect(localizedGitBranchSubviewLabel('history', zhCN)).toBe('提交图');
    expect(localizedGitBranchSubviewLabel('status', zhTW)).toBe('工作空間');
    expect(localizedGitBranchSubviewLabel('history', zhTW)).toBe('提交圖');
  });
});
