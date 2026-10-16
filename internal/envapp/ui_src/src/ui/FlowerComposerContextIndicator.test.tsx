// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerComposerContextIndicator } from '../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { buildFlowerContextWindow } from '../../../../flower_ui/src/chat/flowerContextPresentation';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerModelContext } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
const facts: FlowerModelContext = { snapshot: { sections: [{ key: 'skills', title: 'Available skills', text: 'Complete selectable catalog' }] },
 entry_id: 'facts-entry', path_depth: 1, turn_id: 'turn-a', run_id: 'run-a', updated_at: '2026-10-15T12:00:00Z', changed_keys: ['skills'], removed_keys: [] };

describe('Flower managed context panel', () => {
 it('opens by touch, retains section focus and dismisses without trapping navigation', async () => {
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator modelContext={facts} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  const trigger = host.querySelector('[role="progressbar"]') as HTMLElement;
  const panel = host.querySelector('[role="region"]') as HTMLElement;
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  trigger.focus(); trigger.click();
  expect(panel.getAttribute('data-open')).toBe('true');
  const summary = host.querySelector('summary') as HTMLElement;
  summary.tabIndex = 0; summary.focus();
  expect(panel.getAttribute('data-open')).toBe('true');
  expect(host.querySelectorAll('.flower-model-context-bar')).toHaveLength(1);
  expect(host.querySelector('.flower-model-context-share')?.textContent).toBe('100%');
  expect(host.textContent).not.toContain('Complete selectable catalog');
  summary.click();
  await expect.poll(() => host.textContent).toContain('Complete selectable catalog');
  summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(panel.getAttribute('data-open')).toBe('true');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  expect(panel.getAttribute('data-open')).toBe('true');
  const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  expect(panel.getAttribute('aria-hidden')).toBe('true');
 });
 it('distinguishes collected facts from their first request use and updates live', () => {
  const [context, update] = createSignal(facts);
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator modelContext={context()} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  const status = () => host.querySelector('.flower-model-context-status')!;
  expect(status().getAttribute('aria-label')).toContain(DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator.collected);
  expect(host.querySelector('.flower-model-context-time')).toBeNull();
  update({ ...facts, used_by_request_id: 'request-a', used_by_run_id: 'run-a', used_by_turn_id: 'turn-a', used_at: '2026-10-15T12:00:01Z' });
  expect(status().getAttribute('aria-label')).toContain(DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator.used);
  expect(host.textContent).not.toContain(DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator.used);
 });
 it('sizes stacked segments and aligned category amounts by Unicode text share and refreshes the existing panel', () => {
  const [context, update] = createSignal({ ...facts, snapshot: { sections: [
   { key: 'skills', title: 'Available skills', text: '😀😀😀' },
   { key: 'repository', title: 'Repository state', text: 'A' },
  ] } });
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator modelContext={context()} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  const trigger = host.querySelector('[role="progressbar"]') as HTMLElement;
  trigger.focus();
  const shares = () => [...host.querySelectorAll('.flower-model-context-share')].map(row => row.textContent);
  expect(shares()).toEqual(['75%', '25%']);
  expect([...host.querySelectorAll('.flower-model-context-amount')].map(row => row.textContent)).toEqual(['3', '1']);
  expect(host.querySelector('.flower-model-context-heading')?.textContent).toContain('4 chars');
  expect([...host.querySelectorAll('.flower-model-context-bar > span')].map(row => row.getAttribute('data-category'))).toEqual(['skills', 'repository']);
  expect(host.querySelector('.flower-model-context-bar > span')?.getAttribute('style')).toContain('75%');
  update({ ...facts, snapshot: { sections: [{ key: 'repository', title: 'Repository state', text: '' }] } });
  expect(shares()).toEqual(['0%']);
  expect(host.querySelector('.flower-model-context-bar > span')?.getAttribute('style')).toContain('0%');
  expect(document.activeElement).toBe(trigger);
  expect(host.querySelector('[role="region"]')?.getAttribute('data-open')).toBe('true');
  update({ ...facts, snapshot: { sections: [] } });
  expect(host.querySelector('.flower-model-context-details')).toBeNull();
 });
});


describe('Flower context capacity partitions', () => {
 const sample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1,
  input_tokens: 600, context_window_tokens: 1000, output_headroom_tokens: 200 } as const;
 it('partitions measured capacity without treating runtime character shares as tokens', () => {
  expect(buildFlowerContextWindow({ confirmed: sample })).toEqual({ input: 600, capacity: 1000, estimated: false, segments: [
   { key: 'input', tokens: 600, share: 60 }, { key: 'outputReserve', tokens: 200, share: 20 }, { key: 'freeSpace', tokens: 200, share: 20 },
  ] });
  expect(buildFlowerContextWindow({ confirmed: sample, estimate: { ...sample, phase: 'projected_request', input_tokens: 900 } })?.input).toBe(600);
  expect(buildFlowerContextWindow({ estimate: { ...sample, phase: 'projected_request' } })?.estimated).toBe(true);
 });
 it('handles unknown, empty and exhausted windows without negative or invented allocations', () => {
  expect(buildFlowerContextWindow({})).toBeNull();
  expect(buildFlowerContextWindow({ confirmed: { ...sample, input_tokens: undefined } })).toBeNull();
  expect(buildFlowerContextWindow({ confirmed: { ...sample, context_window_tokens: 0 } })).toBeNull();
  expect(buildFlowerContextWindow({ confirmed: { ...sample, input_tokens: 0 } })?.segments).toEqual([
   { key: 'input', tokens: 0, share: 0 }, { key: 'outputReserve', tokens: 200, share: 20 }, { key: 'freeSpace', tokens: 800, share: 80 },
  ]);
  const overflow = buildFlowerContextWindow({ confirmed: { ...sample, input_tokens: 1200 } })!;
  expect(overflow.input).toBe(1200);
  expect(overflow.segments).toEqual([{ key: 'input', tokens: 1200, share: 100 }, { key: 'freeSpace', tokens: 0, share: 0 }]);
  expect(buildFlowerContextWindow({ confirmed: { ...sample, output_headroom_tokens: undefined } })?.segments).toEqual([
   { key: 'input', tokens: 600, share: 60 }, { key: 'freeSpace', tokens: 400, share: 40 },
  ]);
 });
});
