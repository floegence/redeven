// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18nHelpers } from '../i18n';
import { enUS } from '../i18n/locales';
import { PluginBackgroundStatus, backgroundScheduleLabel } from './PluginBackgroundStatus';
import type { PluginInventoryItem } from './pluginTypes';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ''; });
const item = { inventoryKey: 'installed:counter', pluginID: 'dev.counter', displayName: 'Counter', description: '', iconFallback: 'generic', category: 'utilities', searchKeywords: [], publisher: 'Example', lifecycleState: 'enabled', trustBadge: 'unsigned', pinned: false } satisfies PluginInventoryItem;
describe('background interval presentation', () => {
  it('formats exact short intervals without inventing a schedule for existing entries', () => {
    const i18n = createI18nHelpers('en-US', enUS);
    expect(backgroundScheduleLabel({}, i18n)).toBe('Can run in the background');
    expect(backgroundScheduleLabel({ interval_ms: 1500 }, i18n)).toBe('Every 1.5 sec');
    expect(backgroundScheduleLabel({ interval_ms: 60000 }, i18n)).toBe('Every 1 min');
    expect(backgroundScheduleLabel({ interval_ms: 3600000 }, i18n)).toBe('Every 1 hr');
  });
  it('keeps an unknown prior result visible without a replay action', () => {
    const mount = document.createElement('div'); document.body.append(mount);
    dispose = render(() => <PluginBackgroundStatus item={{ ...item, backgroundInterval: { state: 'scheduled', interval_ms: 60000, max_runtime_ms: 5000, last_outcome: 'unknown', next_run_at: '2026-10-31T10:00:00Z' } }} />, mount);
    expect(mount.textContent).toContain('Previous result unknown');
    expect(mount.textContent).toContain('Next run:');
    expect(mount.querySelector('button')).toBeNull();
    expect(mount.textContent).not.toContain('max_runtime_ms');
  });
  it('does not imply a future run while disabled, blocked or currently running', () => {
    const mount = document.createElement('div'); document.body.append(mount);
    for (const state of ['stopped', 'blocked', 'running'] as const) {
      dispose = render(() => <PluginBackgroundStatus item={{ ...item, backgroundInterval: { state, interval_ms: 60000, max_runtime_ms: 5000, next_run_at: '2026-10-31T10:00:00Z' } }} />, mount);
      expect(mount.textContent).not.toContain('Next run:'); dispose();
    }
  });
});
