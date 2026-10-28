import '../index.css';
import '../../../../flower_ui/src/styles/flower.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { InfiniteCanvas } from '@floegence/floe-webapp-core/ui';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { FlowerContextCompaction } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerContextCompactionDivider } from '../../../../flower_ui/src/chat/FlowerContextCompactionDivider';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); document.documentElement.classList.remove('dark', 'light'); });

it.each(['en-US', 'zh-CN', 'de-DE'] as const)('keeps the estimate concise and dismissible on a narrow screen in %s', async locale => {
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
  expect(tooltip.textContent).toBe(copy.chat.compactionDivider.tokenChange('159.1k', '17.5k'));
  expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
  const bounds = tooltip.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(360);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(640);
  expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight);
  expect(bounds.height).toBeLessThan(52);
  expect(getComputedStyle(tooltip).whiteSpace).toBe('pre-wrap');
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
    await page.screenshot({ element: host, path: '__screenshots__/flower-compaction-concise-estimate.png' });
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
  expect(tooltip.textContent).toBe('Message text estimate: ≈ 159.1k → 17.5k tokens');
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

it('keeps multiline failures above the status without moving the timeline', async () => {
  await page.viewport(360, 640);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;padding:280px 16px 16px;--flower-chat-surface-border:var(--border);--flower-chat-surface-elevated:var(--card)';
  document.body.append(host);
  const error = 'tool history message 2 has unmatched result "call_00_Qt94NlrrbYFkmB4OBGuS4234"';
  dispose = render(() => <>
    <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
      decoration_id: 'context-compaction:error', kind: 'context_compaction', ordinal: 0,
      anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
      compaction: { operation_id: 'error', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'failed', status: 'failed', error, updated_at_ms: 1 },
    }} />
    <button type="button" data-testid="following-content">Continue conversation</button>
  </>, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  const following = host.querySelector<HTMLElement>('[data-testid="following-content"]')!;
  const before = following.getBoundingClientRect().top;
  await userEvent.hover(trigger);
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  await expect.poll(() => tooltip.getBoundingClientRect().bottom).toBeLessThanOrEqual(trigger.getBoundingClientRect().top - 4);
  expect(tooltip.textContent).toBe(error);
  const label = trigger.querySelector<HTMLElement>('.flower-compaction-divider-label')!;
  expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
  expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
  expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight);
  expect(tooltip.getBoundingClientRect().width).toBeLessThanOrEqual(320);
  expect(following.getBoundingClientRect().top).toBe(before);
  const divider = host.querySelector<HTMLElement>('.flower-compaction-divider')!;
  for (const side of ['::before', '::after']) {
    const style = getComputedStyle(divider, side);
    expect(style.content).toBe('""');
    expect(parseFloat(style.width)).toBeGreaterThan(0);
    expect(parseFloat(style.width)).toBeLessThanOrEqual(64);
    expect(parseFloat(style.height)).toBe(1);
  }
});

it.each(['light', 'dark'])('keeps a long error readable below a top-edge trigger in %s mode', async theme => {
  await page.viewport(360, 640);
  document.documentElement.classList.add(theme);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;padding:8px 16px;background:var(--background)';
  document.body.append(host);
  const error = 'Provider error: ' + 'unbroken'.repeat(24) + '\nPlease try again.';
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:top-error', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'top-error', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'failed', status: 'failed', error, updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  await userEvent.hover(trigger);
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  await expect.poll(() => tooltip.getBoundingClientRect().top).toBeGreaterThanOrEqual(trigger.getBoundingClientRect().bottom + 4);
  expect(tooltip.textContent).toBe(error);
  expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
  expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight);
  expect(tooltip.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(tooltip.getBoundingClientRect().right).toBeLessThanOrEqual(360);
  const style = getComputedStyle(tooltip);
  expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.backgroundColor).not.toBe(style.color);
  expect(style.userSelect).toBe('text');
  await userEvent.hover(tooltip);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(document.querySelector('[role="tooltip"]')).toBe(tooltip);
  await userEvent.click(trigger);
  await userEvent.click(tooltip);
  expect(document.querySelector('[role="tooltip"]')).toBe(tooltip);
  const range = document.createRange();
  range.selectNodeContents(tooltip);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  expect(window.getSelection()?.toString()).toBe(error);
  window.getSelection()?.removeAllRanges();
  await page.screenshot({ element: host, path: '__screenshots__/flower-compaction-error-' + theme + '.png' });
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await userEvent.hover(trigger);
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await userEvent.unhover(trigger);
  await expect.poll(() => document.querySelector('[role="tooltip"]')).toBeNull();
});

it('updates a concise open detail through running, cancelled, failed and successful states', async () => {
  await page.viewport(360, 640);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;padding:220px 16px';
  document.body.append(host);
  const [compaction, setCompaction] = createSignal<FlowerContextCompaction>({
    operation_id: 'states', turn_id: 'turn-1', canonical_ordinal: 1,
    phase: 'start', status: 'compacting', tokens_before: 128400, updated_at_ms: 1,
  });
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:states', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' }, compaction: compaction(),
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  trigger.focus();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Preparing summary · Message text estimate: ≈ 128.4k tokens');
  for (const [status, detail] of [
    ['cancelled', 'Compression stopped.'],
    ['failed', 'No summary was generated.'],
    ['compacted', 'Message text estimate: ≈ 128.4k → 24.6k tokens'],
  ] as const) {
    setCompaction(value => ({ ...value, status, phase: 'complete', tokens_after_estimate: 24600 }));
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe(detail);
    await expect.poll(() => tooltip.getBoundingClientRect().bottom).toBeLessThanOrEqual(trigger.getBoundingClientRect().top - 4);
    expect(tooltip.getBoundingClientRect().height).toBeLessThan(52);
  }
});

it.each(['en-US', 'zh-CN', 'de-DE'] as const)('explains byte capacity without clipping on a narrow screen in %s', async locale => {
  await page.viewport(360, 640);
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;padding:260px 16px 16px';
  document.body.append(host);
  dispose = render(() => <FlowerContextCompactionDivider copy={copy} decoration={{
    decoration_id: 'context-compaction:bytes', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'bytes', turn_id: 'turn', canonical_ordinal: 1, phase: 'start', status: 'compacting', tokens_before: 169238, updated_at_ms: 1,
      decision: { pressure: { pressure_signal: 'request_bytes' }, capacity: { kind: 'request_bytes', stage: 'prepare', source: 'host_policy', actual_bytes: 34716156, limit_bytes: 33554432 } },
    },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  trigger.focus();
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  await expect.poll(() => tooltip.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(tooltip.textContent).toContain(copy.chat.compactionDivider.requestBytes('33.11', '32.00'));
  expect(tooltip.scrollHeight).toBeLessThanOrEqual(tooltip.clientHeight);
  expect(tooltip.scrollWidth).toBeLessThanOrEqual(tooltip.clientWidth);
  expect(tooltip.getBoundingClientRect().right).toBeLessThanOrEqual(360);
  expect(tooltip.getBoundingClientRect().bottom).toBeLessThanOrEqual(640);
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
