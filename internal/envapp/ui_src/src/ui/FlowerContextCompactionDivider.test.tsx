// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerContextCompactionDivider } from '../../../../flower_ui/src/chat/FlowerContextCompactionDivider';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });

it('shows only a concise message estimate and dismisses by keyboard, outside pointer and focus', () => {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:one', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'one', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', tokens_before: 159143, tokens_after_estimate: 17462, updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('[role="button"]')!;
  trigger.focus();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Message estimate: 159k → 17k tokens');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  trigger.click();
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(document.activeElement).toBe(outside);
});

it('closes the floating detail when hidden and can reopen after disclosure', () => {
  const host = document.createElement('div'); document.body.append(host);
  const [visible, setVisible] = createSignal(true);
  dispose = render(() => <FlowerContextCompactionDivider visible={visible()} copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:visible', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'visible', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', tokens_before: 159143, tokens_after_estimate: 17462, updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('[role="button"]')!;
  trigger.focus();
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  setVisible(false);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  trigger.click();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  setVisible(true);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  trigger.click();
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
});

it('does not create an empty detail control when canonical estimates are unavailable', () => {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:historical', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'historical', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('.flower-compaction-divider-pill')!;
  expect(trigger.textContent).toBe('Context compacted');
  expect(trigger.hasAttribute('role')).toBe(false);
  expect(trigger.hasAttribute('tabindex')).toBe(false);
  trigger.click();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it('keeps the failure detail and retry action available', () => {
  const host = document.createElement('div'); document.body.append(host);
  const retry = vi.fn();
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} onRetry={retry} decoration={{
    decoration_id: 'context-compaction:failed', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'failed', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'failed', status: 'failed', error: 'Summary unavailable', updated_at_ms: 1 },
  }} />, host);
  host.querySelector<HTMLElement>('[role="button"]')!.focus();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Summary unavailable');
  const action = host.querySelector<HTMLButtonElement>('button')!;
  expect(action.textContent).toBe(DEFAULT_FLOWER_SURFACE_COPY.chat.compactContext);
  action.focus();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  action.click();
  expect(retry).toHaveBeenCalledOnce();
});

it('closes unavailable details without reopening them when a later update restores the estimate', () => {
  const host = document.createElement('div'); document.body.append(host);
  const [tokens, setTokens] = createSignal<number | undefined>(20000);
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:updated', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'updated', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', tokens_before: 150000, tokens_after_estimate: tokens(), updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('[role="button"]')!;
  trigger.focus();
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  setTokens(undefined);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  expect(trigger.hasAttribute('tabindex')).toBe(false);
  setTokens(21000);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  trigger.click();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Message estimate: 150k → 21k tokens');
});
