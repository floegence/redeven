import '../index.css';
import './flower-feature.css';

import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { FlowerActivityItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { EnvAppTranslationKey } from './i18n';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => document.documentElement.classList.remove('dark'));

it.each([['en-US', 1200, 'light'], ['zh-CN', 390, 'dark']] as const)(
  'keeps %s tool failures after useful content at %s px in %s mode', async (locale, width, theme) => {
    await page.viewport(width, 1000);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const cases: readonly Partial<FlowerActivityItem>[] = [
      { item_id: 'file-failed', tool_name: 'file.read', renderer: 'file', label: 'report.txt',
        payload: { operation: 'read', display_name: 'report.txt', content: 'Partial file content', line_count: 1, total_lines: 2, error: { message: 'Read access was revoked.' } } },
      { item_id: 'patch-failed', tool_name: 'apply_patch', renderer: 'patch', label: 'report.txt',
        payload: { mutations: [{ display_name: 'report.txt', change_type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new' }], error: { message: 'The next edit could not be applied.' } } },
      { item_id: 'search-failed', tool_name: 'web.search', renderer: 'web_search', label: 'Search release notes',
        payload: { operation: 'search', query: 'release notes', error: { message: 'The search service is unavailable.' } } },
      { item_id: 'computer-failed', tool_name: 'computer.exec', renderer: 'computer', label: 'Inspect the current page',
        payload: { inputs: [{ content: 'await ui.observe();', format: 'code', language: 'javascript' }], rows: [{ content: 'Page loaded', format: 'text' }],
          error: { message: 'The selected page was closed.', meta: { repair_action: 'Select an available page', suggested_targets: ['Browser'] } } } },
      { item_id: 'skill-failed', tool_name: 'use_skill', renderer: 'structured', label: 'design',
        payload: { error: { message: 'Skill package could not be loaded.' } } },
    ];
    const items = cases.map(value => activityItem({ ...value, tool_id: value.item_id, status: 'error',
      description: (value.payload!.error as { message: string }).message }));
    const seed = thread({ thread_id: 'tool-failures', title: 'Tool failure details', messages: [{
      id: 'failures', turn_id: 'turn-failures', run_id: 'run-failures', role: 'assistant', status: 'complete', content: '', created_at_ms: 1,
      blocks: [activityTimeline({ thread_id: 'tool-failures', turn_id: 'turn-failures', run_id: 'run-failures', status: 'success', items })],
    }] });
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed) }, { copy,
      focusThreadRequest: { request_id: 'tool-failures', thread_id: seed.thread_id } });
    surface.style.cssText = `width:${width}px;height:950px;position:relative;`;
    await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="skill-failed"]')));
    for (const item of items) {
      const row = surface.querySelector<HTMLElement>(`[data-flower-activity-item-id="${item.item_id}"]`)!;
      const trigger = row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!;
      const message = (item.payload!.error as { message: string }).message;
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.textContent).not.toContain(message);
      expect(row.getAttribute('data-flower-activity-status')).toBe('error');
      trigger.click();
      await waitFor(() => row.querySelector('.flower-activity-error-message')?.textContent === message);
      await waitFor(() => row.querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
      expect(row.textContent!.split(message)).toHaveLength(2);
      expect(row.querySelector('.flower-activity-inline-details-content')!.lastElementChild?.contains(row.querySelector('.flower-activity-error-panel'))).toBe(true);
      expect(row.querySelector('.flower-activity-error-panel')?.getAttribute('aria-label')).toBe(copy.chat.toolStatuses.error);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    expect(surface.querySelectorAll('.flower-activity-error-panel')).toHaveLength(cases.length);
    const skill = surface.querySelector('[data-flower-activity-item-id="skill-failed"]')!;
    expect(skill.querySelector('.flower-activity-detail-notice')).toBeNull();
    expect(surface.querySelector('.flower-activity-error-repair')?.textContent).toContain('Select an available page');
    expect(surface.querySelector('.flower-activity-error-targets')?.textContent).toContain('Browser');
    await page.screenshot({ element: surface, path: `__screenshots__/flower-tool-failures-${locale}.png` });
  },
);
