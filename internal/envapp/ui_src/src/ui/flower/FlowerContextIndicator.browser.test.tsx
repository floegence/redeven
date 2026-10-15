import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerComposerContextIndicator } from '../../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { mapContextUsage } from '../../../../../flower_ui/src/flowerLiveMapper';
import type { FlowerContextUsage, FlowerModelContext } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { EnvAppTranslationKey } from '../i18n/locales';
import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import '../../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

for (const locale of ['en-US', 'zh-CN'] as const) {
  for (const dark of [false, true]) {
    it(`shows a single stable usage with keyboard access in ${locale}, dark=${dark}`, async () => {
      await page.viewport(360, 480);
      const i18n = createTestI18nHelpers(locale);
      const copy = createLocalizedFlowerSurfaceCopy({ locale,
        t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
        tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
      });
      const host = document.createElement('div');
      host.style.cssText = `position:fixed;inset:0;padding:24px;box-sizing:border-box;display:flex;align-items:flex-end;justify-content:flex-end;font-family:system-ui;background:${dark ? '#191b1a' : '#fafaf7'};--foreground:${dark ? '#ededeb' : '#242721'};--muted-foreground:${dark ? '#a8ada5' : '#6c7466'};--primary:#76826a;--flower-chat-surface:${dark ? '#232621' : '#fafaf7'};--flower-chat-surface-border:${dark ? '#41483c' : '#dedfd7'};--background:var(--flower-chat-surface);--popover:var(--flower-chat-surface);--redeven-surface-shadow-source:#000;--redeven-status-warning-foreground:#b78330;--destructive:#dc4545`;
      document.body.append(host);
      const confirmed = { run_id: 'previous', phase: 'provider_usage', pressure_status: 'stable', input_tokens: 71872, context_window_tokens: 950000, updated_at_ms: 1 };
      const estimate = { ...confirmed, run_id: 'current', phase: 'projected_request', input_tokens: 291336, updated_at_ms: 2 };
      const thread_usage = { input_tokens: 55, output_tokens: 10, cache_read_tokens: 45, cache_write_tokens: 0 };
      const [usage, setUsage] = createSignal<FlowerContextUsage>(mapContextUsage({ estimate })!);
      const [facts, setFacts] = createSignal<FlowerModelContext>();
      dispose = render(() => <FlowerComposerContextIndicator usage={usage()} modelContext={facts()} copy={copy} />, host);
      const outside = document.createElement('button');
      outside.setAttribute('aria-label', 'Next composer action');
      outside.style.cssText = 'position:absolute;left:0;top:0';
      host.append(outside);
      const progress = host.querySelector<HTMLElement>('[role="progressbar"]')!;
      expect(host.querySelector('.flower-composer-context-percent')).toBeNull();
      expect(progress.getAttribute('aria-valuenow')).toBe('31');
      progress.focus();
      const tooltip = host.querySelector<HTMLElement>('[role="region"]')!;
      expect(tooltip.dataset.open).toBe('true');
      expect(tooltip.querySelectorAll('.flower-composer-context-tooltip-row')).toHaveLength(3);
      expect(tooltip.textContent).not.toContain('291,336');
      await userEvent.keyboard('{Escape}');
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
      await userEvent.keyboard('{Enter}');
      expect(tooltip.dataset.open).toBe('true');

      setUsage(mapContextUsage({ confirmed, estimate, thread_usage })!);
      expect(progress.getAttribute('aria-valuenow')).toBe('8');
      expect(tooltip.textContent).toBe(`${copy.chat.contextIndicator.label}8%${copy.chat.contextIndicator.recentCacheHitLabel}—${copy.chat.contextIndicator.cacheHitLabel}45%`);
      expect(host.querySelector('.flower-composer-context-sample-label')).toBeNull();
      const rect = tooltip.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
      expect(rect.height).toBeLessThan(80);
      expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
      await expect.poll(() => getComputedStyle(tooltip).opacity).toBe('1');
      if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') {
        await page.screenshot({ path: `__screenshots__/context-${locale}-${dark ? 'dark' : 'light'}.png` });
      }

      setUsage(mapContextUsage({ confirmed, estimate: { ...estimate, input_tokens: 960000, pressure_status: 'hard_limit' } })!);
      expect(host.querySelector('[data-context-pressure]')?.getAttribute('data-context-pressure')).toBe('danger');
      expect(progress.getAttribute('aria-valuenow')).toBe('8');
      expect(tooltip.textContent).toContain(copy.chat.contextIndicator.hardLimit);
      setUsage(mapContextUsage({ confirmed: { ...confirmed, input_tokens: 74312 }, thread_usage })!);
      expect(progress.getAttribute('aria-valuenow')).toBe('8');
      expect(host.querySelector('.flower-composer-context-warning')).toBeNull();
      const completedText = tooltip.textContent;
      setUsage(mapContextUsage(JSON.parse(JSON.stringify(usage())))!);
      expect(tooltip.textContent).toBe(completedText);
      // Compaction and model changes replace the old sample with the current estimate.
      setUsage(mapContextUsage({ estimate: { ...estimate, input_tokens: 1000, context_window_tokens: 100000 } })!);
      expect(progress.getAttribute('aria-valuenow')).toBe('1');
      setUsage(mapContextUsage({ confirmed: { ...confirmed, input_tokens: 1000, context_window_tokens: 100000 } })!);
      expect(progress.getAttribute('aria-valuenow')).toBe('1');
      expect(document.activeElement).toBe(progress);
      await userEvent.keyboard('{Tab}');
      expect(document.activeElement).toBe(outside);
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');

      const context: FlowerModelContext = {
        entry_id: 'facts', path_depth: 1, turn_id: 'turn', run_id: 'run',
        updated_at: '2026-10-15T12:00:00Z', used_at: '2026-10-15T12:00:01Z',
        changed_keys: ['skills'], removed_keys: [],
        snapshot: { sections: [
          { key: 'delegation', title: 'Delegation state', text: 'A'.repeat(20) },
          { key: 'execution_environment', title: 'Execution environment', text: 'B'.repeat(100) },
          { key: 'local_time', title: 'Date and timezone', text: 'C'.repeat(20) },
          { key: 'repository', title: 'Repository state', text: 'D'.repeat(40) },
          { key: 'repository_rules', title: 'Repository rule sources', text: 'E'.repeat(20) },
          { key: 'skills', title: 'Available skills', text: 'Complete selectable catalog\n' + 'F'.repeat(800) },
        ] },
      };
      setFacts(context);
      progress.focus();
      await expect.poll(() => tooltip.getBoundingClientRect().height).toBeGreaterThan(200);
      const chartBounds = tooltip.getBoundingClientRect();
      expect(chartBounds.height).toBeLessThan(280);
      expect(chartBounds.top).toBeGreaterThanOrEqual(0);
      expect(chartBounds.left).toBeGreaterThanOrEqual(0);
      expect(chartBounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(tooltip.scrollHeight).toBe(tooltip.clientHeight);
      expect(tooltip.querySelectorAll('.flower-model-context-bar')).toHaveLength(6);
      expect(tooltip.querySelector('pre')).toBeNull();
      expect(tooltip.querySelector('.flower-model-context-time')).toBeNull();
      const rows = [...tooltip.querySelectorAll<HTMLElement>('.flower-model-context-row')];
      for (const row of rows) {
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
        expect(getComputedStyle(row).cursor).toBe('pointer');
      }
      expect(rows.at(-1)!.textContent).toContain(copy.chat.contextIndicator.sectionLabels.skills);
      if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') {
        await page.screenshot({ path: `__screenshots__/context-bars-${locale}-${dark ? 'dark' : 'light'}.png` });
      }
      rows.at(-1)!.focus();
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => tooltip.querySelector('pre')?.textContent).toContain('Complete selectable catalog');
      setFacts({ ...context, snapshot: { sections: context.snapshot.sections.map(section => ({ ...section, text: section.text + '\nUpdated' })) } });
      expect(document.activeElement).toBe(rows.at(-1));
      expect(tooltip.querySelector('details[open]')).not.toBeNull();
      expect(tooltip.querySelector('pre')?.textContent).toContain('Updated');
      await userEvent.keyboard('{Escape}');
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    });
  }
}
