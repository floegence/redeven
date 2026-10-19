// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { FlowerContextCompactionDivider } from '../../../../flower_ui/src/chat/FlowerContextCompactionDivider';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });

it('explains the message estimate and dismisses by keyboard, outside pointer and focus', () => {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerContextCompactionDivider copy={DEFAULT_FLOWER_SURFACE_COPY} decoration={{
    decoration_id: 'context-compaction:one', kind: 'context_compaction', ordinal: 0,
    anchor: { target_kind: 'message', message_id: 'message-1', edge: 'after' },
    compaction: { operation_id: 'one', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', tokens_before: 159143, tokens_after_estimate: 17462, updated_at_ms: 1 },
  }} />, host);
  const trigger = host.querySelector<HTMLElement>('[role="button"]')!;
  trigger.focus();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Estimated message context: 159k to 17k tokens');
  expect(document.body.textContent).toContain('Excludes system instructions and tool definitions');
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
    compaction: { operation_id: 'visible', turn_id: 'turn-1', canonical_ordinal: 1, phase: 'complete', status: 'compacted', updated_at_ms: 1 },
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
