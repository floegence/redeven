import { describe, expect, it } from 'vitest';

import { createDesktopI18n } from '../../shared/i18n';
import { createDesktopFlowerSurfaceCopy } from './desktopFlowerSurfaceCopy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../internal/flower_ui/src/copy';

describe('createDesktopFlowerSurfaceCopy', () => {
  it('keeps the localized English starter tasks aligned with the shared surface defaults', () => {
    expect(createDesktopFlowerSurfaceCopy(createDesktopI18n('en-US')).emptyState)
      .toEqual(DEFAULT_FLOWER_SURFACE_COPY.emptyState);
  });

  it('formats Subagent operation titles from the active locale', () => {
    const en = createDesktopFlowerSurfaceCopy(createDesktopI18n('en-US')).subagents!.activity.titles;
    const zhCN = createDesktopFlowerSurfaceCopy(createDesktopI18n('zh-CN')).subagents!.activity.titles;

    expect(en.starting).toBe('Creating subagent');
    expect(en.started).toBe('Created subagent');
    expect(en.createFailed).toBe('Failed to create subagent');
    expect(en.waiting('3')).toBe('Waiting for 3 subagents');
    expect(en.completed('3')).toBe('3 subagents completed');
    expect(en.waitTimedOut('1', '3')).toBe('Wait timed out · 1/3 completed');
    expect(zhCN.starting).toBe('正在创建 Subagent');
    expect(zhCN.started).toBe('已创建 Subagent');
    expect(zhCN.createFailed).toBe('创建 Subagent 失败');
    expect(zhCN.waiting('3')).toBe('正在等待 3 个 Subagent');
    expect(zhCN.completed('3')).toBe('3 个 Subagent 已完成');
    expect(zhCN.waitTimedOut('1', '3')).toBe('等待超时 · 已完成 1/3');
  });
});
