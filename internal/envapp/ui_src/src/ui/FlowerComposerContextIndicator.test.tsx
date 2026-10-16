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
 it('opens the loaded context distribution with one disclosure and dismisses without trapping navigation', async () => {
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator modelContext={facts} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  const trigger = host.querySelector('[role="progressbar"]') as HTMLElement;
  const panel = host.querySelector('[role="region"]') as HTMLElement;
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  trigger.focus(); trigger.click();
  expect(panel.getAttribute('data-open')).toBe('true');
  const disclosure = host.querySelector('.flower-model-context-disclosure') as HTMLElement;
  expect(host.querySelector('.flower-model-context-row')).toBeNull();
  expect(disclosure.textContent).toContain('Auto-loaded context');
  expect(disclosure.querySelector('.flower-model-context-amount')?.textContent).toBe('—');
  expect(disclosure.querySelector('.flower-model-context-share')?.textContent).toBe('—');
  disclosure.click();
  await expect.poll(() => host.querySelector('.flower-model-context-row')).not.toBeNull();
  disclosure.focus();
  expect(panel.getAttribute('data-open')).toBe('true');
  expect(host.querySelector('.flower-context-composition')).toBeNull();
  expect(host.textContent).not.toContain('Complete selectable catalog');
  expect(host.querySelector('.flower-model-context-row details, .flower-model-context-row summary, pre')).toBeNull();
  expect(host.querySelector('.flower-model-context-row .flower-model-context-fill')?.getAttribute('style')).toContain('100%');
  expect(host.querySelector('.flower-model-context-row')?.textContent).toContain('100%');
  expect(host.textContent).toContain('27 chars');
  disclosure.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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
 it('shows every loaded category as a bar and keeps disclosure focus during live updates', async () => {
  const [context, update] = createSignal({ ...facts, snapshot: { sections: [
   { key: 'skills', title: 'Skills', text: '🌸abc' },
   { key: 'repository', title: 'Repository', text: 'xy' },
   { key: 'local_time', title: 'Time', text: '' },
  ] } });
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator modelContext={context()} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  (host.querySelector('[role="progressbar"]') as HTMLElement).focus();
  const disclosure = host.querySelector('.flower-model-context-disclosure') as HTMLElement;
  disclosure.click(); disclosure.focus();
  await expect.poll(() => host.querySelectorAll('.flower-model-context-row').length).toBe(3);
  const shares = () => [...host.querySelectorAll('.flower-model-context-row .flower-model-context-share')].map(row => row.textContent);
  expect(shares()).toEqual(['66.7%', '33.3%', '0%']);
  expect(host.querySelectorAll('.flower-model-context-track')).toHaveLength(3);
  expect(host.querySelectorAll('details')).toHaveLength(1);
  expect(host.querySelectorAll('summary')).toHaveLength(1);
  update({ ...context(), snapshot: { sections: context().snapshot.sections.map(section => ({ ...section, text: section.key === 'repository' ? 'x'.repeat(12) : section.text })) } });
  expect(shares()).toEqual(['75%', '25%', '0%']);
  expect(document.activeElement).toBe(disclosure);
  expect(host.querySelector('details')?.open).toBe(true);
  disclosure.click();
  await expect.poll(() => host.querySelector('.flower-model-context-row')).toBeNull();
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
 it('keeps current contents inside their single used-context category across request updates', async () => {
  const base = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 900, context_window_tokens: 1000 } as const;
  const [usage, update] = createSignal({ confirmed: { ...base, breakdown: { source: 'semantic_input_bpe_v1', model_context_tokens: 100, tool_result_tokens: 300 } } });
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator usage={usage()} modelContext={facts} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  (host.querySelector('[role="progressbar"]') as HTMLElement).focus();
  const category = host.querySelector('[data-category="model_context_tokens"].flower-model-context-details');
  expect(category).not.toBeNull();
  expect(host.querySelectorAll('.flower-model-context-details')).toHaveLength(1);
  expect(category?.closest('.flower-context-composition')).not.toBeNull();
  const disclosure = category!.querySelector('summary')!;
  expect(disclosure.textContent).toContain('Auto-loaded context');
  expect(disclosure.textContent).toContain('≈100');
  expect(disclosure.textContent).toContain('25%');
  expect(host.querySelector('.flower-model-context-row')).toBeNull();
  disclosure.click(); disclosure.focus();
  await expect.poll(() => host.querySelector('.flower-model-context-row')).not.toBeNull();
  expect(category?.textContent).toContain('Current contents');
  expect(category?.textContent).toContain('27 chars');
  expect(category?.textContent).toContain('token totals include retained updates');
  expect(category?.querySelectorAll('summary')).toHaveLength(1);
  update({ confirmed: { ...base, breakdown: { source: 'semantic_input_bpe_v1', model_context_tokens: 400, tool_result_tokens: 100 } } });
  expect(host.querySelector('.flower-model-context-disclosure')).toBe(disclosure);
  expect(document.activeElement).toBe(disclosure);
  expect(category?.getAttribute('open')).not.toBeNull();
  expect(disclosure.textContent).toContain('≈400');
  expect(disclosure.textContent).toContain('80%');
 });
 it('shows a request category without offering unavailable current contents', () => {
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator copy={DEFAULT_FLOWER_SURFACE_COPY}
   usage={{ confirmed: { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 100,
    breakdown: { source: 'semantic_input_bpe_v1', model_context_tokens: 100 } } }} />, host));
  expect(host.querySelectorAll('.flower-context-composition-row')).toHaveLength(1);
  expect(host.querySelector('.flower-context-composition-row')?.textContent).toContain('Auto-loaded context');
  expect(host.querySelector('details')).toBeNull();
  expect(host.querySelector('.flower-model-context-row')).toBeNull();
 });
 it('shows retained tool output in the primary estimated input distribution', () => {
  const base = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 900, context_window_tokens: 1000 } as const;
  const [usage, update] = createSignal({ confirmed: { ...base, breakdown: { source: 'semantic_input_bpe_v1', tool_result_tokens: 300, user_tokens: 100 } } });
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerComposerContextIndicator usage={usage()} modelContext={facts} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
  const trigger = host.querySelector('[role="progressbar"]') as HTMLElement;
  trigger.focus();
  expect(host.querySelector('.flower-context-composition')?.textContent).toContain('Tool outputs');
  expect([...host.querySelectorAll('.flower-context-composition-row .flower-model-context-share')].map(row => row.textContent)).toEqual(['75%', '25%', '0%']);
  expect([...host.querySelectorAll('.flower-context-composition-row .flower-model-context-amount')].map(row => row.textContent)).toEqual(['≈300', '≈100', '≈0']);
  expect(host.querySelector('.flower-context-heading')?.textContent).toContain('900 / 1k');
  expect(host.querySelector('pre')).toBeNull();
  expect(host.querySelector('.flower-model-context-row')).toBeNull();
  update({ confirmed: { ...base, breakdown: { source: 'semantic_input_bpe_v1', tool_result_tokens: 100, user_tokens: 100 } } });
  expect([...host.querySelectorAll('.flower-context-composition-row .flower-model-context-share')].map(row => row.textContent)).toEqual(['50%', '50%', '0%']);
  expect(document.activeElement).toBe(trigger);
  expect(host.querySelector('[role="region"]')?.getAttribute('data-open')).toBe('true');
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
