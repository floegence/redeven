// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerComposerContextIndicator } from '../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { buildFlowerContextWindow } from '../../../../flower_ui/src/chat/flowerContextPresentation';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { mapContextUsage } from '../../../../flower_ui/src/flowerLiveMapper';
import type { FlowerContextUsage, FlowerModelContext } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
const facts: FlowerModelContext = { snapshot: { sections: [{ key: 'skills', title: 'Available skills', text: 'Complete selectable catalog' }] },
 entry_id: 'facts', path_depth: 1, turn_id: 'turn', run_id: 'run', updated_at: '2026-10-15T12:00:00Z', changed_keys: ['skills'], removed_keys: [] };
const sample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 600, context_window_tokens: 1000, output_headroom_tokens: 200 } as const;
function fixture(mcpTokens = 200): FlowerContextUsage {
 return { confirmed: { ...sample, breakdown: { source: 'semantic_input_bpe_v2', system_tokens: 50, tool_definition_tokens: mcpTokens + 100,
  user_tokens: 40, assistant_tokens: 30, tool_call_tokens: 10, tool_result_tokens: 100, model_context_tokens: 120,
  details: { items: [
   { category: 'tool_definition', key: 'docs.search', source: 'mcp', namespace: 'docs', tokens: mcpTokens },
   { category: 'tool_definition', key: 'terminal.exec', source: 'builtin', tokens: 100 },
   { category: 'model_context', key: 'skills', tokens: 60 },
   { category: 'model_context', key: 'repository_rules', tokens: 40 },
   { category: 'model_context', key: 'execution_environment', tokens: 10 },
   { category: 'model_context', key: '', tokens: 10 },
  ] },
 } } };
}
function mount(usage?: () => FlowerContextUsage) {
 const host = document.createElement('div'); document.body.append(host);
 disposers.push(render(() => <FlowerComposerContextIndicator usage={usage?.()} modelContext={facts} copy={DEFAULT_FLOWER_SURFACE_COPY} />, host));
 const trigger = host.querySelector<HTMLElement>('[role="progressbar"]')!;
 const panel = host.querySelector<HTMLElement>('[role="region"]')!;
 trigger.focus(); return { host, trigger, panel };
}

describe('Flower context source breakdown', () => {
 it('displays real source names and horizontal bars with flat detail rows', async () => {
  const { host } = mount(() => fixture());
  for (const text of ['System prompt', 'System tools', 'MCP tools', 'Skill catalog', 'Rule file index', 'Messages', 'Tool outputs']) expect(host.textContent).toContain(text);
  expect(host.textContent).not.toContain('Auto-loaded context');
  expect(host.textContent).not.toContain('chars');
  expect(host.textContent).not.toContain('Complete selectable catalog');
  const rows = host.querySelectorAll('.flower-context-composition-row');
  expect(host.querySelectorAll('.flower-context-composition-row .flower-model-context-track')).toHaveLength(rows.length);
  const category = host.querySelector<HTMLDetailsElement>('[data-category="mcp_tools"]')!;
  expect(category.open).toBe(false);
  category.querySelector('summary')!.click();
  await expect.poll(() => category.open).toBe(true);
  expect(category.textContent).toContain('docs · docs.search');
  expect(category.querySelectorAll('.flower-model-context-row')).toHaveLength(1);
  expect(category.querySelector('.flower-model-context-row details, .flower-model-context-row summary, pre')).toBeNull();
 });
 it('keeps expanded groups and keyboard focus when live source weights reorder', async () => {
  const [usage, update] = createSignal(fixture());
  const { host } = mount(usage);
  const category = host.querySelector<HTMLDetailsElement>('[data-category="mcp_tools"]')!;
  const summary = category.querySelector('summary')!;
  summary.click(); summary.focus();
  await expect.poll(() => category.open).toBe(true);
  update(fixture(20));
  expect(host.querySelector('[data-category="mcp_tools"] summary')).toBe(summary);
  await expect.poll(() => document.activeElement).toBe(summary);
  expect(category.open).toBe(true);
  expect(summary.textContent).toContain('≈20');
 });
 it('dismisses through Escape, outside click and focus navigation', async () => {
  const { trigger, panel } = mount(() => fixture());
  expect(panel.dataset.open).toBe('true');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(panel.dataset.open).toBe('true');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  await expect.poll(() => panel.getAttribute('aria-hidden')).toBe('true');
 });
 it('never substitutes current snapshot characters for unavailable request attribution', () => {
  const { host } = mount(() => ({ confirmed: { ...sample, breakdown: { source: 'historical', tool_definition_tokens: 100, model_context_tokens: 50 } } }));
  expect(host.textContent).toContain('Tools without source data');
  expect(host.textContent).toContain('Context without source data');
  expect(host.querySelector('[data-category="unattributed_tools"] summary')).toBeNull();
  expect(host.textContent).not.toContain('Skill catalog');
  expect(mount().host.querySelector('.flower-context-composition')).toBeNull();
 });
 it('rejects malformed, duplicate and mismatched source allocations at the wire boundary', () => {
  expect(mapContextUsage(JSON.parse(JSON.stringify(fixture())))).toEqual(fixture());
  const invalid = (mutate: (value: ReturnType<typeof fixture>) => void) => {
   const raw = JSON.parse(JSON.stringify(fixture())); mutate(raw);
   expect(() => mapContextUsage(raw)).toThrow();
  };
  invalid(value => { (value.confirmed!.breakdown!.details!.items as unknown[])[0] = { category: 'tool_definition', key: 'x', tokens: -1 }; });
  invalid(value => { (value.confirmed!.breakdown!.details!.items as unknown[]).push(value.confirmed!.breakdown!.details!.items[0]); });
  invalid(value => { (value.confirmed!.breakdown as { tool_definition_tokens: number }).tool_definition_tokens = 1; });
 });
});

describe('Flower context capacity partitions', () => {
 it('partitions measured capacity independently from source estimates', () => {
  expect(buildFlowerContextWindow({ confirmed: sample })).toEqual({ input: 600, capacity: 1000, estimated: false, segments: [
   { key: 'input', tokens: 600, share: 60 }, { key: 'outputReserve', tokens: 200, share: 20 }, { key: 'freeSpace', tokens: 200, share: 20 },
  ] });
  expect(buildFlowerContextWindow({ confirmed: sample, estimate: { ...sample, phase: 'projected_request', input_tokens: 900 } })?.input).toBe(600);
  expect(buildFlowerContextWindow({ estimate: { ...sample, phase: 'projected_request' } })?.estimated).toBe(true);
 });
 it('handles unknown and exhausted windows without negative allocations', () => {
  expect(buildFlowerContextWindow({})).toBeNull();
  expect(buildFlowerContextWindow({ confirmed: { ...sample, context_window_tokens: 0 } })).toBeNull();
  expect(buildFlowerContextWindow({ confirmed: { ...sample, input_tokens: 1200 } })?.segments).toEqual([{ key: 'input', tokens: 1200, share: 100 }, { key: 'freeSpace', tokens: 0, share: 0 }]);
 });
});
