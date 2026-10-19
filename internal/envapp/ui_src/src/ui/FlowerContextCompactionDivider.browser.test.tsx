import '../index.css';
import '../../../../flower_ui/src/styles/flower.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { InfiniteCanvas } from '@floegence/floe-webapp-core/ui';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
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
    compaction: { operation_id: 'one', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', tokens_before: 159143, tokens_after_estimate: 17462, updated_at_ms: 1,
      decision: { pressure: { projected_input_tokens: 480000, threshold_tokens: 472500, request_safe_limit_tokens: 500000, pressure_signal: 'projected_request', pressure_source: 'usage_anchored_delta' },
        before: { payload_fingerprint: 'trigger', provider: 'test', model: 'model', estimated_input_tokens: 470382, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: 'conservative', pressure: {}, calibration_request_id: 'qualified-request' },
        after: { payload_fingerprint: 'replacement', provider: 'test', model: 'model', estimated_input_tokens: 37594, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: 'conservative', pressure: {} } },
    },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  await userEvent.hover(trigger);
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  await expect.poll(() => getComputedStyle(tooltip).opacity).toBe('1');
  expect(tooltip.textContent).toContain(copy.chat.compactionDivider.tokenChange('159k', '17k'));
  expect(tooltip.textContent).toContain(copy.chat.compactionDivider.requestAfter('37594'));
  expect(tooltip.textContent).toContain(copy.chat.compactionDivider.requestScope);
  expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
  const bounds = tooltip.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(360);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(640);
  expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight);
  expect(getComputedStyle(tooltip).whiteSpace).toBe('normal');
  trigger.focus();
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  if (locale === 'zh-CN') {
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await page.screenshot({ element: host, path: '__screenshots__/flower-compaction-estimate-scope.png' });
  }
});

it('uses the local floating layer inside a transformed Workbench and stays dismissible', async () => {
  await page.viewport(800, 640);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <InfiniteCanvas viewport={{ x: 36, y: 24, scale: 1.15 }} onViewportChange={() => undefined} ariaLabel="Compaction canvas">
      <div data-testid="surface-host" data-floe-dialog-surface-host="true" style={{ position: 'relative', width: '440px', height: '300px', padding: '220px 8px 8px' }}>
        <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
          decoration_id: 'context-compaction:projected', kind: 'context_compaction', ordinal: 0,
          anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
          compaction: { operation_id: 'projected', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', tokens_before: 159143, tokens_after_estimate: 17462, updated_at_ms: 1,
            decision: { pressure: { projected_input_tokens: 480000, threshold_tokens: 472500, request_safe_limit_tokens: 500000, pressure_signal: 'projected_request', pressure_source: 'usage_anchored_delta' },
              before: { payload_fingerprint: 'trigger', provider: 'test', model: 'model', estimated_input_tokens: 470382, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: 'conservative', pressure: {}, calibration_request_id: 'qualified-request' },
              after: { payload_fingerprint: 'replacement', provider: 'test', model: 'model', estimated_input_tokens: 37594, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: 'conservative', pressure: {} } },
          },
        }} />
        <button type="button">After compaction</button>
      </div>
    </InfiniteCanvas>
  </LayoutProvider></FloeConfigProvider>, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  trigger.focus();
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  await expect.poll(() => tooltip.getBoundingClientRect().top).toBeGreaterThan(0);
  expect(tooltip.closest('[data-floe-surface-floating-layer]')).not.toBeNull();
  const surface = host.querySelector<HTMLElement>('[data-testid="surface-host"]')!;
  expect(tooltip.closest('[data-floe-surface-portal-layer="true"]')).toBe(trigger.closest('[data-floe-surface-portal-layer="true"]'));
  expect(getComputedStyle(tooltip.closest('[data-floe-surface-floating-layer]')!).position).toBe('absolute');
  expect(tooltip.textContent).toContain('470382');
  expect(tooltip.textContent).toContain('37594');
  expect(tooltip.textContent).toContain('calibrated');
  expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight);
  expect(tooltip.style.position).toBe('');
  expect(tooltip.style.left).toBe('');
  expect(tooltip.style.top).toBe('');
  const bounds = surface.getBoundingClientRect();
  await expect.poll(() => tooltip.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right + 1);
  expect(tooltip.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left - 1);
  expect(tooltip.getBoundingClientRect().bottom).toBeLessThanOrEqual(trigger.getBoundingClientRect().top);
  const before = tooltip.getBoundingClientRect().left;
  trigger.style.transform = 'translateX(-30px)';
  window.dispatchEvent(new Event('resize'));
  await expect.poll(() => tooltip.getBoundingClientRect().left).toBeLessThan(before);
  await userEvent.keyboard('{Tab}');
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(document.activeElement?.textContent).toBe('After compaction');
  trigger.focus();
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
