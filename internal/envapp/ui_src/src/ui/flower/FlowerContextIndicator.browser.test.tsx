import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import '../../index.css';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerComposerContextIndicator } from '../../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { mapContextUsage } from '../../../../../flower_ui/src/flowerLiveMapper';
import type { FlowerContextUsage, FlowerModelContext } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { RedevenLocale } from '../i18n/localeMeta';
import type { EnvAppTranslationKey } from '../i18n/locales';
import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import '../../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});

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
      host.style.cssText = 'position:fixed;inset:0;padding:24px;box-sizing:border-box;display:flex;align-items:flex-end;justify-content:flex-end;font-family:system-ui;background:var(--background);--flower-chat-surface:var(--background);--flower-chat-surface-border:var(--border);--flower-chat-surface-elevated:var(--card);--redeven-status-warning-foreground:var(--warning)';
      const preset = builtInShellThemePresets.find(preset => preset.name === `classic-${dark ? 'dark' : 'light'}`)!;
      document.documentElement.classList.toggle('dark', dark);
      for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
        if (value) document.documentElement.style.setProperty(name, value);
      }
      document.body.append(host);
      const confirmed = { run_id: 'previous', phase: 'provider_usage', pressure_status: 'stable', input_tokens: 71872, context_window_tokens: 950000, output_headroom_tokens: 64000, updated_at_ms: 1 };
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
      expect(tooltip.querySelectorAll('.flower-context-window-stat')).toHaveLength(3);
      expect(tooltip.textContent).not.toContain('291,336');
      await userEvent.keyboard('{Escape}');
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
      await userEvent.keyboard('{Enter}');
      expect(tooltip.dataset.open).toBe('true');

      setUsage(mapContextUsage({ confirmed, estimate, thread_usage })!);
      expect(progress.getAttribute('aria-valuenow')).toBe('8');
      expect(tooltip.querySelector('.flower-context-heading')?.textContent).toBe(`${copy.chat.contextIndicator.label}71.9k / 950k (8%)`);
      expect(tooltip.querySelector('.flower-context-cache-stats')?.textContent).toBe(`${copy.chat.contextIndicator.recentCacheHitShortLabel}—${copy.chat.contextIndicator.cacheHitShortLabel}45%`);
      expect(host.querySelector('.flower-composer-context-sample-label')).toBeNull();
      const rect = tooltip.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
      expect(rect.height).toBeLessThan(180);
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
      setUsage(mapContextUsage({ confirmed, thread_usage, recent_request_usage: { input_tokens: 25, output_tokens: 10, cache_read_tokens: 75, cache_write_tokens: 0 } })!);
      setFacts(context);
      progress.focus();
      const disclosure = tooltip.querySelector<HTMLElement>('.flower-model-context-disclosure')!;
      expect(tooltip.querySelector('.flower-model-context-row')).toBeNull();
      disclosure.focus();
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => tooltip.querySelectorAll('.flower-model-context-row').length).toBe(6);
      expect(tooltip.querySelectorAll('summary')).toHaveLength(1);
      expect(tooltip.querySelector('pre')).toBeNull();
      expect(tooltip.textContent).not.toContain('Complete selectable catalog');
      const loadedRows = [...tooltip.querySelectorAll<HTMLElement>('.flower-model-context-row')];
      expect(loadedRows[0]!.dataset.category).toBe('skills');
      expect(loadedRows[0]!.textContent).toContain('80.5%');
      for (const row of loadedRows) {
        const track = row.querySelector<HTMLElement>('.flower-model-context-track')!;
        const fill = row.querySelector<HTMLElement>('.flower-model-context-fill')!;
        expect(track.getBoundingClientRect().width).toBeGreaterThan(100);
        expect(getComputedStyle(fill).backgroundColor).toBe(getComputedStyle(row.querySelector('.flower-context-swatch')!).backgroundColor);
        expect(fill.getBoundingClientRect().width).toBeGreaterThan(0);
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
      }
      await expect.poll(() => getComputedStyle(tooltip).opacity).toBe('1');
      expect(tooltip.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
      if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') {
        await page.screenshot({ path: `__screenshots__/context-loaded-${locale}-${dark ? 'dark' : 'light'}.png` });
      }
      setFacts({ ...context, snapshot: { sections: context.snapshot.sections.map(section => ({ ...section, text: section.text + '\nUpdated' })) } });
      expect(document.activeElement).toBe(disclosure);
      expect(tooltip.querySelector('details')?.open).toBe(true);
      expect(tooltip.querySelector('.flower-model-context-row .flower-model-context-amount')?.textContent).toBe('836');
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => tooltip.querySelector('.flower-model-context-row')).toBeNull();
      setUsage(mapContextUsage({ confirmed: { ...confirmed, breakdown: {
        source: 'semantic_input_bpe_v1', system_tokens: 3400, tool_definition_tokens: 23500,
        user_tokens: 4200, assistant_tokens: 3000, tool_call_tokens: 1700,
        tool_result_tokens: 29000, model_context_tokens: 5100, compaction_tokens: 800,
      } }, thread_usage, recent_request_usage: { input_tokens: 25, output_tokens: 10, cache_read_tokens: 75, cache_write_tokens: 0 } })!);
      progress.focus();
      await expect.poll(() => tooltip.getBoundingClientRect().height).toBeGreaterThan(200);
      const chartBounds = tooltip.getBoundingClientRect();
      expect(chartBounds.height).toBeLessThan(408);
      expect(chartBounds.top).toBeGreaterThanOrEqual(0);
      expect(chartBounds.left).toBeGreaterThanOrEqual(0);
      expect(chartBounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(tooltip.scrollHeight).toBe(tooltip.clientHeight);
      expect(tooltip.querySelectorAll('.flower-context-composition-bar')).toHaveLength(1);
      expect(tooltip.querySelectorAll('.flower-context-composition-bar > span')).toHaveLength(8);
      expect(tooltip.querySelector('pre')).toBeNull();
      expect(tooltip.querySelector('.flower-model-context-time')).toBeNull();
      const rows = [...tooltip.querySelectorAll<HTMLElement>('.flower-context-composition-row')];
      expect(tooltip.querySelectorAll('.flower-model-context-details')).toHaveLength(1);
      expect(disclosure.closest('.flower-context-composition')).not.toBeNull();
      expect(disclosure.textContent).toContain(copy.chat.contextIndicator.categoryLabels.model_context_tokens);
      expect(disclosure.textContent).toContain('≈5.1k');
      expect(disclosure.textContent).toContain('7.2%');
      for (const row of rows) {
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
      }
      const segmentColors = [...tooltip.querySelectorAll<HTMLElement>('.flower-context-composition-bar > span')].map(segment => getComputedStyle(segment).backgroundColor);
      const swatchColors = rows.map(row => getComputedStyle(row.querySelector('.flower-context-swatch')!).backgroundColor);
      expect(segmentColors).toEqual(swatchColors);
      expect(new Set(segmentColors).size).toBe(8);
      const amountColumns = rows.map(row => row.querySelector('.flower-model-context-amount')!.getBoundingClientRect().right);
      expect(new Set(amountColumns).size).toBe(1);
      expect(rows[0]!.textContent).toContain(copy.chat.contextIndicator.categoryLabels.tool_result_tokens);
      if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') {
        await page.screenshot({ path: `__screenshots__/context-breakdown-${locale}-${dark ? 'dark' : 'light'}.png` });
      }
      disclosure.focus();
      await userEvent.keyboard('{Enter}');
      await expect.poll(() => tooltip.querySelectorAll('.flower-model-context-row').length).toBe(6);
      expect(tooltip.querySelector('.flower-model-context-current-heading')?.textContent).toContain(copy.chat.contextIndicator.currentContents);
      expect(tooltip.querySelector('.flower-model-context-hint')?.textContent).toBe(copy.chat.contextIndicator.currentContentsHint);
      setUsage(mapContextUsage({ confirmed: { ...confirmed, breakdown: {
        source: 'semantic_input_bpe_v1', system_tokens: 3400, tool_definition_tokens: 23500,
        user_tokens: 4200, assistant_tokens: 3000, tool_call_tokens: 1700,
        tool_result_tokens: 29000, model_context_tokens: 26000, compaction_tokens: 800,
      } } })!);
      expect(tooltip.querySelector('.flower-model-context-disclosure')).toBe(disclosure);
      expect(document.activeElement).toBe(disclosure);
      expect(tooltip.querySelector('details')?.open).toBe(true);
      expect(disclosure.textContent).toContain('≈26k');
      expect(tooltip.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
      expect(tooltip.getBoundingClientRect().height).toBeLessThanOrEqual(408);
      expect(tooltip.scrollWidth).toBe(tooltip.clientWidth);
      expect(tooltip.querySelectorAll('details, summary')).toHaveLength(2);
      const lastBar = tooltip.querySelector<HTMLElement>('.flower-model-context-row:last-child .flower-model-context-track')!;
      tooltip.scrollTop = tooltip.scrollHeight;
      expect(lastBar.getBoundingClientRect().bottom).toBeLessThanOrEqual(tooltip.getBoundingClientRect().bottom);
      if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') {
        await page.viewport(440, 720);
        tooltip.scrollTop = 0;
        progress.focus();
        expect(tooltip.scrollHeight).toBe(tooltip.clientHeight);
        await page.screenshot({ path: `__screenshots__/context-expanded-${locale}-${dark ? 'dark' : 'light'}.png` });
      }
      await userEvent.keyboard('{Escape}');
      expect(tooltip.getAttribute('aria-hidden')).toBe('true');
      expect(document.activeElement).toBe(progress);
    });
  }
}

it('keeps localized legends inside a narrow card and follows every shipped theme', async () => {
  await page.viewport(320, 480);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;padding:16px;display:flex;align-items:flex-end;justify-content:flex-end;--flower-chat-surface-border:var(--border);--flower-chat-surface:var(--background);--redeven-surface-shadow-source:#000';
  document.body.append(host);
  const facts: FlowerModelContext = {
    entry_id: 'facts', path_depth: 1, turn_id: 'turn', run_id: 'run', updated_at: '2026-10-15T12:00:00Z', changed_keys: [], removed_keys: [],
    snapshot: { sections: ['delegation', 'execution_environment', 'local_time', 'repository', 'repository_rules', 'skills']
      .map((key, index) => ({ key, title: key, text: 'A'.repeat((index + 1) * 100) })) },
  };
  const [locale, setLocale] = createSignal<RedevenLocale>('en-US');
  const copy = () => {
    const i18n = createTestI18nHelpers(locale());
    return createLocalizedFlowerSurfaceCopy({ locale: locale(),
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
    });
  };
  const applyTheme = (preset: typeof builtInShellThemePresets[number]) => {
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
      if (value) document.documentElement.style.setProperty(name, value);
    }
  };
  applyTheme(builtInShellThemePresets.find(preset => preset.name === 'classic-dark')!);
  dispose = render(() => <FlowerComposerContextIndicator modelContext={facts} copy={copy()}
    usage={{ confirmed: { phase: 'provider_usage', pressure_status: 'stable', input_tokens: 85400, context_window_tokens: 1000000, output_headroom_tokens: 64000, updated_at_ms: 1, breakdown: { source:'semantic_input_bpe_v1', system_tokens:3400,tool_definition_tokens:23000,user_tokens:4000,assistant_tokens:3000,tool_call_tokens:1700,tool_result_tokens:29000,model_context_tokens:5100,compaction_tokens:800 } } }} />, host);
  const trigger = host.querySelector<HTMLElement>('[role="progressbar"]')!;
  trigger.focus();
  const panel = host.querySelector<HTMLElement>('[role="region"]')!;
  await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
  const disclosure = panel.querySelector<HTMLElement>('.flower-model-context-disclosure')!;
  disclosure.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => panel.querySelectorAll('.flower-model-context-row').length).toBe(6);
  for (const value of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'] as const) {
    setLocale(value);
    expect(panel.scrollWidth, value).toBe(panel.clientWidth);
    expect(panel.getBoundingClientRect().height, value).toBeLessThanOrEqual(408);
    for (const row of panel.querySelectorAll<HTMLElement>('.flower-context-composition-row, .flower-model-context-row, .flower-context-window-stat')) {
      expect(row.scrollWidth, `${value}: ${row.textContent}`).toBeLessThanOrEqual(row.clientWidth);
    }
    expect(panel.getBoundingClientRect().top, value).toBeGreaterThanOrEqual(0);
    if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1' && value === 'de-DE') {
      await page.screenshot({ path: '__screenshots__/context-breakdown-de-DE-dark.png' });
    }
  }
  setLocale('en-US');
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset);
    const swatches = [...panel.querySelectorAll<HTMLElement>('.flower-context-composition-row .flower-context-swatch')];
    const segments = [...panel.querySelectorAll<HTMLElement>('.flower-context-composition-bar > span')];
    expect(swatches.map(node => getComputedStyle(node).backgroundColor), preset.name)
      .toEqual(segments.map(node => getComputedStyle(node).backgroundColor));
    expect(panel.scrollWidth, preset.name).toBe(panel.clientWidth);
    for (const row of panel.querySelectorAll('.flower-model-context-row')) {
      expect(getComputedStyle(row.querySelector('.flower-model-context-fill')!).backgroundColor, preset.name)
        .toBe(getComputedStyle(row.querySelector('.flower-context-swatch')!).backgroundColor);
    }
  }
});
