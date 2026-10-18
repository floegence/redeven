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
const sample = { available: true, measured: true, phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 800, context_window_tokens: 1000, output_headroom_tokens: 200 } as const;
function fixture(mcpTokens = 200): FlowerContextUsage {
 return { confirmed: { ...sample, characters_available: true, characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: (50)+(mcpTokens + 100)+(40)+(30)+(10)+(100)+(120), categories: [{ category: 'system', characters: 50 },{ category: 'tool_definition', characters: mcpTokens + 100, details: [{ key: 'docs.search', source: 'mcp', namespace: 'docs', characters: mcpTokens },{ key: 'terminal.exec', source: 'builtin', characters: 100 }] },{ category: 'user', characters: 40 },{ category: 'assistant', characters: 30 },{ category: 'tool_call', characters: 10 },{ category: 'tool_result', characters: 100 },{ category: 'model_context', characters: 120, details: [{ key: 'skills', characters: 60 },{ key: 'repository_rules', characters: 40 },{ key: 'execution_environment', characters: 10 },{ key: '', characters: 10 }] }] } } };
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
  expect(host.querySelector('.flower-model-context-amount')?.textContent).toMatch(/^\d.*chars$/);
 });
 it('displays real source names and horizontal bars with flat detail rows', async () => {
  const { host } = mount(() => fixture());
  for (const text of ['System prompt', 'System tool definitions', 'MCP tool definitions', 'Skill catalog', 'Rule file index', 'Messages', 'Tool execution outputs']) expect(host.textContent).toContain(text);
  expect(host.textContent).not.toContain('Auto-loaded context');
  expect(host.textContent).toContain('Visible input');
  expect(host.textContent).toContain('chars');
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
  expect(summary.querySelector('.flower-model-context-amount')?.textContent).toBe('20 chars');
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
 it('suppresses historical and unreliable categories while retaining the measured total', () => {
  const value = fixture();
  const { host } = mount(() => ({ confirmed: { ...value.confirmed!, characters_available: false, characters: undefined, character_limitation: 'unavailable_attribution' } }));
  expect(host.textContent).toContain('Categories available after the next request');
  expect(host.querySelector('.flower-context-composition')).toBeNull();
  expect(host.querySelector('.flower-context-total')?.textContent).toContain('= 800');
  expect(mount().host.querySelector('.flower-context-composition')).toBeNull();
 });
 it('never presents partial input as a total', () => {
  const { host, trigger } = mount(() => ({ estimate: { ...sample, available: false, measured: false, phase: 'projected_request' } }));
  expect(host.querySelector('.flower-context-total')?.textContent).toBe('—');
  expect(trigger.getAttribute('aria-valuenow')).toBeNull();
 });
 it('keeps the displayed request authoritative when its distribution is missing', () => {
  const value = { confirmed: { ...sample }, estimate: fixture().confirmed };
  const { host } = mount(() => value);
  expect(host.textContent).toContain('Categories available after the next request');
  expect(host.querySelector('.flower-context-composition')).toBeNull();
 });
 it('isolates malformed optional character transport without dropping measured usage', () => {
  const raw = JSON.parse(JSON.stringify(fixture()));
  raw.confirmed.characters.categories[0].characters = -1;
  expect(mapContextUsage(raw)?.confirmed).toMatchObject({ available: true, input_tokens: 800, characters_available: false, character_limitation: 'invalid_characters' });
 });
});

describe('Flower request input comparison', () => {
 it('compares confirmed input to capacity without claiming exact remaining space', () => {
  expect(buildFlowerContextWindow({ confirmed: sample })).toEqual({ input: 800, capacity: 1000, share: 80 });
  expect(buildFlowerContextWindow({ confirmed: sample, estimate: { ...sample, input_tokens: 900 } })?.input).toBe(800);
  expect(buildFlowerContextWindow({ estimate: sample })).toBeNull();
  expect(buildFlowerContextWindow({ confirmed: { ...sample, context_window_tokens: 0 } })).toEqual({ input: 800, capacity: null, share: 0 });
  expect(buildFlowerContextWindow({ confirmed: { ...sample, input_tokens: 1200 } })?.share).toBe(100);
 });
});

describe('Flower compact context popup', () => {
 it('keeps measured input and unscaled amounts without showing request budgets', () => {
  const usage=fixture();
  const {host}=mount(()=>({...usage, confirmed:{...usage.confirmed!, input_tokens:68400,context_window_tokens:950000,threshold_tokens:855000,request_output_tokens:393216,output_control:'client',safety_margin_tokens:4096}}));
  expect(host.querySelector('[data-category="outputReserve"]')).toBeNull();
  expect(host.textContent).not.toContain('855k');
  expect(host.textContent).not.toContain('393.2k');
  expect(host.querySelector('.flower-context-total')?.textContent).toContain('68.4k');
  expect(host.querySelector('[data-category="mcp_tools"] .flower-model-context-amount')?.textContent).toBe('200 chars');
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
