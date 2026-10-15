// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerComposerContextIndicator } from '../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
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
 it('scales category bars by Unicode text share and refreshes the existing panel', () => {
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
  expect(host.querySelector('.flower-model-context-fill')?.getAttribute('style')).toContain('75%');
  update({ ...facts, snapshot: { sections: [{ key: 'repository', title: 'Repository state', text: '' }] } });
  expect(shares()).toEqual(['0%']);
  expect(host.querySelector('.flower-model-context-fill')?.getAttribute('style')).toContain('0%');
  expect(document.activeElement).toBe(trigger);
  expect(host.querySelector('[role="region"]')?.getAttribute('data-open')).toBe('true');
  update({ ...facts, snapshot: { sections: [] } });
  expect(host.querySelector('.flower-model-context-details')).toBeNull();
 });
});
