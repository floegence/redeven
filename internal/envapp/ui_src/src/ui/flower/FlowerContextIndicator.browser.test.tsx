import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerComposerContextIndicator } from '../../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { mapContextUsage } from '../../../../../flower_ui/src/flowerLiveMapper';
import type { FlowerContextUsage } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { EnvAppTranslationKey } from '../i18n/locales';
import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import '../../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

for (const locale of ['en-US', 'zh-CN'] as const) {
  it(`separates measurement, estimate and risk with keyboard access in ${locale}`, async () => {
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale,
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
    });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;top:380px;width:320px;display:flex;justify-content:flex-end;font-family:system-ui;--foreground:#18181b;--muted-foreground:#71717a;--primary:#2563eb;--flower-chat-surface:white;--flower-chat-surface-border:#ddd;--background:white;--popover:white';
    document.body.append(host);
    const confirmed = { run_id: 'previous', phase: 'provider_usage', pressure_status: 'stable', input_tokens: 71872, context_window_tokens: 950000, updated_at_ms: 1 };
    const estimate = { ...confirmed, run_id: 'current', phase: 'projected_request', input_tokens: 82346, updated_at_ms: 2 };
    const [usage, setUsage] = createSignal<FlowerContextUsage>(mapContextUsage({ estimate })!);
    dispose = render(() => <FlowerComposerContextIndicator usage={usage()} copy={copy} />, host);
    const progress = host.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(host.querySelector('.flower-composer-context-sample-label')?.textContent).toBe(copy.chat.contextIndicator.estimated);
    progress.focus();
    const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.dataset.open).toBe('true');
    expect(tooltip.textContent).toContain('82,346');
    await userEvent.keyboard('{Escape}');
    expect(tooltip.getAttribute('aria-hidden')).toBe('true');
    await userEvent.keyboard('{Enter}');
    expect(tooltip.dataset.open).toBe('true');

    setUsage(mapContextUsage({ confirmed, estimate })!);
    expect(progress.getAttribute('aria-valuenow')).toBe('8');
    expect(tooltip.textContent).toContain('71,872');
    expect(tooltip.textContent).toContain('82,346');
    expect(host.querySelector('.flower-composer-context-sample-label')?.textContent).toBe(copy.chat.contextIndicator.lastKnownLabel);
    expect(progress.getAttribute('aria-valuetext')).toContain(copy.chat.contextIndicator.estimateLabel);
    const rect = tooltip.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);

    setUsage(mapContextUsage({ confirmed, estimate: { ...estimate, input_tokens: 960000, pressure_status: 'hard_limit' } })!);
    expect(host.querySelector('[data-context-pressure]')?.getAttribute('data-context-pressure')).toBe('danger');
    expect(progress.getAttribute('aria-valuenow')).toBe('8');
    setUsage(mapContextUsage({ confirmed: { ...confirmed, input_tokens: 74312 } })!);
    expect(tooltip.textContent).toContain('74,312');
    expect(tooltip.textContent).not.toContain('82,346');
    expect(host.querySelector('.flower-composer-context-sample-label')).toBeNull();
    const completedText = tooltip.textContent;
    setUsage(mapContextUsage(JSON.parse(JSON.stringify(usage())))!);
    expect(tooltip.textContent).toBe(completedText);
    // A new model or successful compaction has no old measurement.
    setUsage(mapContextUsage({ estimate: { ...estimate, input_tokens: 1000, context_window_tokens: 100000 } })!);
    expect(progress.getAttribute('aria-valuenow')).toBe('1');
    expect(tooltip.textContent).not.toContain('74,312');
    expect(document.activeElement).toBe(progress);
  });
}
