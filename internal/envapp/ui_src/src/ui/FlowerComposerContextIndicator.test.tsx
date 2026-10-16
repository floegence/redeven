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
 it('keeps the popup focused on usage and source bars without explanatory blocks', () => {
  const value=fixture();
  const {host}=mount(()=>({...value,confirmed:{...value.confirmed!,threshold_tokens:397000,request_output_tokens:1000,output_control:'client'}}));
  for(const text of ['Remaining window is shared by input and output.','Auto-compaction threshold','Latest request output limit','Input composition estimate','Estimated by share']) {
   expect(host.textContent).not.toContain(text);
  }
  expect(host.querySelectorAll('.flower-context-heading')).toHaveLength(1);
  expect(host.querySelectorAll('.flower-context-composition-row').length).toBeGreaterThan(0);
  expect(host.querySelector('.flower-model-context-amount')?.textContent).toMatch(/^≈\d/);
 });
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
  expect(summary.querySelector('.flower-model-context-amount')?.textContent).toBe('≈25');
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
 it.each(['relative', 'historical', 'media'] as const)('shows proportional estimated amounts for %s distributions', mode => {
  const value = fixture(); const breakdown = value.confirmed!.breakdown!;
  const { quality: _quality, tokenizer: _tokenizer, ...historical } = breakdown;
  const metadata = mode === 'historical' ? historical : { ...breakdown, quality: 'relative_weight' as const, ...(mode === 'media' ? { attachment_tokens: 100 } : {}) };
  const { host } = mount(() => ({ ...value, confirmed: { ...value.confirmed!, breakdown: metadata } }));
  const distribution = host.querySelector('.flower-context-composition')!;
  expect(distribution.textContent).toContain('≈');
  expect(distribution.getAttribute('title')).toBe(mode === 'historical' ? DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator.historicalHint : DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator.compositionHint);
  for (const row of distribution.querySelectorAll('.flower-context-composition-row')) {
   expect(row.querySelector('.flower-model-context-amount')?.textContent).toMatch(/^≈\d/);
   expect(row.getAttribute('aria-label')).toContain('≈');
   expect(row.querySelector('.flower-model-context-amount')?.getAttribute('title')).toContain('Estimated: ≈');
  }
  const amount = distribution.querySelector('[data-category="mcp_tools"] .flower-model-context-amount')!;
  expect(amount.textContent).toBe(mode === 'media' ? '≈160' : '≈185');
 });
 it('shows shares without amounts only when the displayed input total is missing', () => {
  const value = fixture();
  const { host } = mount(() => ({ confirmed: { ...value.confirmed!, input_tokens: undefined }, estimate: { ...value.confirmed!, input_tokens: 1000 } }));
  const distribution = host.querySelector('.flower-context-composition')!;
  expect(distribution.querySelector('.flower-model-context-amount')).toBeNull();
  expect(distribution.getAttribute('title')).toBe(DEFAULT_FLOWER_SURFACE_COPY.chat.contextIndicator.relativeHint);
  expect(distribution.textContent).not.toContain('≈');
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

describe('Flower compact context popup', () => {
 it('keeps measured input and proportional amounts without showing request budgets', () => {
  const usage=fixture();
  const {host}=mount(()=>({...usage, confirmed:{...usage.confirmed!, input_tokens:68400,context_window_tokens:950000,threshold_tokens:855000,request_output_tokens:393216,output_control:'client',safety_margin_tokens:4096}}));
  expect(host.querySelector('[data-category="outputReserve"]')).toBeNull();
  expect(host.textContent).not.toContain('855k');
  expect(host.textContent).not.toContain('393.2k');
  expect(host.querySelector('.flower-context-total')?.textContent).toContain('68.4k');
  expect(host.querySelector('[data-category="mcp_tools"] .flower-model-context-amount')?.textContent).toBe('≈21k');
 });
 it('keeps server-managed and missing output facts out of the popup', () => {
  const [usage,update]=createSignal<FlowerContextUsage>({confirmed:{...sample,output_control:'server',safety_margin_tokens:10}});
  const {host}=mount(usage);
  const original=host.textContent;
  expect(original).not.toContain('Managed by server');
  update({confirmed:sample});
  expect(host.textContent).toBe(original);
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
