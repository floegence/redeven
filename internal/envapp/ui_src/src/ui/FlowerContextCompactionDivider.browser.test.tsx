import '../index.css';
import '../../../../flower_ui/src/styles/flower.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerContextCompactionDivider } from '../../../../flower_ui/src/chat/FlowerContextCompactionDivider';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });

it.each(['en-US', 'zh-CN', 'de-DE'] as const)('keeps the complete estimate explanation readable and dismissible in %s', async locale => {
  await page.viewport(360, 640);
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;padding:220px 16px 16px;--flower-chat-surface-border:var(--border);--flower-chat-surface-elevated:var(--card)';
  document.body.append(host);
  dispose = render(() => <FlowerContextCompactionDivider copy={copy} decoration={{
    decoration_id: 'context-compaction:one', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'one', phase: 'complete', status: 'compacted', tokens_before: 159143, tokens_after_estimate: 17462, updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('[role="button"]')!;
  await userEvent.hover(trigger);
  const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  await expect.poll(() => getComputedStyle(tooltip).opacity).toBe('1');
  expect(tooltip.textContent).toBe(copy.chat.compactionDivider.tokenChange('159k', '17k'));
  expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
  const bounds = tooltip.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(360);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(getComputedStyle(tooltip).whiteSpace).toBe('normal');
  trigger.focus();
  await userEvent.keyboard('{Escape}');
  expect(host.querySelector('[role="tooltip"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
  host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  expect(host.querySelector('[role="tooltip"]')).toBeNull();
  if (locale === 'zh-CN') {
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await page.screenshot({ element: host, path: '__screenshots__/flower-compaction-estimate-scope.png' });
  }
});
