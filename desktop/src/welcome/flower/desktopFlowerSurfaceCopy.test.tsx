import { describe, expect, it } from 'vitest';

import { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } from '../../shared/i18n';
import { createDesktopFlowerSurfaceCopy } from './desktopFlowerSurfaceCopy';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../internal/flower_ui/src/copy';
import { presentFlowerActivityItem } from '../../../../internal/flower_ui/src/flowerActivityPresentation';

describe('createDesktopFlowerSurfaceCopy', () => {
  it.each(REDEVEN_SUPPORTED_LOCALES)('resolves every immediate surface message in %s', locale => {
    const i18n = createDesktopI18n(locale);
    const copy = createDesktopFlowerSurfaceCopy({ ...i18n, t: (key, params) => {
      const message = i18n.t(key, params);
      expect(message, `${locale}: ${key}`).not.toBe(key);
      return message;
    } });
    for (const message of [copy.chat.fileReadEmpty, copy.chat.fileReadEmptyTotal(10), copy.chat.fileReadRange(2, 5), copy.chat.fileReadRangeTotal(2, 5, 10)]) {
      expect(message).not.toMatch(/\{(?:start|end|total)\}/u);
      expect(message).not.toContain('flowerSurface.');
    }
    expect(copy.filesystemPicker.selectedCount(3)).not.toContain('{count}');
    const presentation = presentFlowerActivityItem({ item_id: 'search', tool_name: 'web_search', renderer: 'web_search', kind: 'hosted_tool',
      status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      payload: { operation: 'search', query: 'Runtime' },
    }, { webSearch: copy.chat.webSearch });
    expect(presentation.label).toBe(copy.chat.webSearch.search + ' Runtime');
  });
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
