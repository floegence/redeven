// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowerComposerContextIndicator } from '../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { buildFlowerContextWindow, flowerRequestOutputSample } from '../../../../flower_ui/src/chat/flowerContextPresentation';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { mapContextUsage } from '../../../../flower_ui/src/flowerLiveMapper';
import type { FlowerContextUsage, FlowerModelContext } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });
const facts: FlowerModelContext = { snapshot: { sections: [{ key: 'skills', title: 'Available skills', text: 'Complete selectable catalog' }] },
 entry_id: 'facts', path_depth: 1, turn_id: 'turn', run_id: 'run', updated_at: '2026-10-15T12:00:00Z', changed_keys: ['skills'], removed_keys: [] };
const sample = { phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 600, context_window_tokens: 1000, output_headroom_tokens: 200 } as const;
function fixture(mcpTokens = 200): FlowerContextUsage {
 return { confirmed: { ...sample, breakdown: { source: 'rendered_deepseek_v4_content_v3', quality: 'token_estimate', tokenizer: 'deepseek_v4', system_tokens: 50, tool_definition_tokens: mcpTokens + 100,
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
 const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
 trigger.focus(); return { host: panel, trigger, panel };
}

describe('Flower context source breakdown', () => {
 it('displays real source names and horizontal bars with flat detail rows', async () => {
  const { host } = mount(() => fixture());
  for (const text of ['System prompt', 'System tool definitions', 'MCP tool definitions', 'Skill catalog', 'Rule file index', 'Messages', 'Tool execution outputs']) expect(host.textContent).toContain(text);
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
 it.each(['relative', 'historical', 'media'] as const)('hides every estimated amount for %s distributions', mode => {
  const value = fixture(); const breakdown = value.confirmed!.breakdown!;
  const { quality: _quality, tokenizer: _tokenizer, ...historical } = breakdown;
  const metadata = mode === 'historical' ? historical : { ...breakdown, quality: 'relative_weight' as const, ...(mode === 'media' ? { attachment_tokens: 100 } : {}) };
  const { host } = mount(() => ({ ...value, confirmed: { ...value.confirmed!, breakdown: metadata } }));
  const distribution = host.querySelector('.flower-context-composition')!;
  expect(distribution.querySelector('.flower-model-context-amount')).toBeNull();
  expect(distribution.textContent).not.toContain('≈');
  expect(distribution.textContent).toContain(mode === 'historical' ? 'Historical shares' : 'Relative shares');
  for (const row of distribution.querySelectorAll('[title], [aria-label]')) {
   expect(row.getAttribute('title') ?? '').not.toContain('tokens');
   expect(row.getAttribute('aria-label') ?? '').not.toContain('tokens');
  }
 });
 it('keeps the displayed request authoritative when its distribution is missing', () => {
  const value = { confirmed: { ...sample }, estimate: fixture().confirmed };
  const { host } = mount(() => value);
  expect(host.textContent).toContain('No distribution available');
  expect(host.querySelector('.flower-context-composition')).toBeNull();
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
   { key: 'input', tokens: 600, share: 60 }, { key: 'freeSpace', tokens: 400, share: 40 },
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

describe('Flower request budget facts', () => {
 it('keeps output facts on the latest request and respects canonical invalidation', () => {
  const confirmed = { ...sample, output_control: 'client' as const, request_output_tokens: 100 };
  const estimate = { ...sample, phase: 'projected_request' as const, updated_at_ms: 2, output_control: 'client' as const, request_output_tokens: 50 };
  expect(flowerRequestOutputSample({ confirmed, estimate })).toBe(estimate);
  expect(flowerRequestOutputSample({ confirmed: { ...confirmed, run_id: 'run', step_index: 1 },
   estimate: { ...estimate, updated_at_ms: 1, run_id: 'run', step_index: 2 } })?.request_output_tokens).toBe(50);
  expect(flowerRequestOutputSample({})).toBeUndefined();
  expect(flowerRequestOutputSample({ estimate: { ...sample, phase: 'projected_request' } })?.output_control).toBeUndefined();
  expect(flowerRequestOutputSample({ confirmed, estimate: { ...sample, phase: 'projected_request', updated_at_ms: 3 } })?.output_control).toBeUndefined();
 });
 it('shows measured input and independently totaled estimates without reserving model output', () => {
  const usage=fixture();
  const {host}=mount(()=>({...usage, confirmed:{...usage.confirmed!, input_tokens:68400,context_window_tokens:950000,threshold_tokens:855000,request_output_tokens:393216,output_control:'client',safety_margin_tokens:4096}}));
  expect(host.querySelector('[data-category="outputReserve"]')).toBeNull();
  expect(host.textContent).toContain('Auto-compaction threshold');
  expect(host.textContent).toContain('855k');
  expect(host.textContent).toContain('393.2k');
  expect(host.textContent).toContain('Input composition estimate');
  expect(host.textContent).toContain('Estimated total: ≈650');
 });
 it('shows server management and never infers historical output limits', () => {
  const [usage,update]=createSignal<FlowerContextUsage>({confirmed:{...sample,output_control:'server',safety_margin_tokens:10}});
  const {host}=mount(usage);
  expect(host.textContent).toContain('Managed by server');
  update({confirmed:sample});
  expect(host.querySelector('.flower-context-budget-facts')?.textContent).toContain('Not available');
  expect(host.querySelector('.flower-context-budget-facts')?.textContent).not.toContain('200');
 });
 it('closes through its visible button and restores trigger focus',()=>{
  const {panel,trigger}=mount(()=>fixture());
  panel.querySelector<HTMLButtonElement>('.flower-context-close')!.click();
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  expect(document.activeElement).toBe(trigger);
 });
 it('rejects invalid output budget contracts',()=>{
  for(const fields of [{output_control:'server',request_output_tokens:100},{request_output_tokens:100},{output_control:'client',request_output_tokens:-1},{output_control:'client',safety_margin_tokens:4097}]){
   expect(()=>mapContextUsage({confirmed:{...sample,...fields}})).toThrow();
  }
 });
});
