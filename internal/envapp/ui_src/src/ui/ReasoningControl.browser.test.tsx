import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import zhCN from './i18n/locales/catalogs/zh-CN.json';
import { createLocalizedReasoningControlCopy, type ReasoningControlCopy } from '../../../../flower_ui/src/i18n/reasoningControlMessages';
import { FlowerReasoningControl } from '../../../../flower_ui/src/ReasoningControl';
import type { FlowerReasoningCapability, FlowerReasoningSelection } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const effort: FlowerReasoningCapability = {
  kind: 'effort', supported_levels: ['low', 'high', 'max'], disable_supported: true,
};
let dispose: (() => void) | undefined;
let root: HTMLDivElement;
afterEach(() => { dispose?.(); root?.remove(); });

function mount(capability = effort, variant: 'segment' | 'badge' | 'full' = 'segment', initial?: FlowerReasoningSelection, copy?: ReasoningControlCopy, readOnly = false) {
  root = document.createElement('div');
  document.body.append(root);
  const [selection, setSelection] = createSignal(initial);
  const change = vi.fn((next: FlowerReasoningSelection | undefined) => setSelection(next));
  dispose = render(() => <FlowerReasoningControl copy={copy} readOnly={readOnly} capability={capability} selection={selection()} variant={variant} onChange={change} />, root);
  return change;
}

describe('Reasoning control semantics', () => {
  it('localizes default and levels from the shipped Chinese catalog', async () => {
    await page.viewport(420, 640);
    const copy = createLocalizedReasoningControlCopy({ t: (key) => {
      const name = key.split('.').at(-1)! as keyof typeof zhCN.flowerSurface.reasoningControl;
      return zhCN.flowerSurface.reasoningControl[name];
    } });
    mount(effort, 'segment', undefined, copy);
    const trigger = root.querySelector<HTMLButtonElement>('button')!;
    expect(trigger.textContent).toBe('默认');
    expect(trigger.title).toBe('使用模型默认推理配置');
    trigger.click();
    expect(Array.from(root.querySelectorAll('[role="menuitemradio"]')).map((item) => item.textContent)).toEqual(['默认', '关闭', '低', '高', '最高']);
    expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('supports keyboard selection, Escape, and normal Tab navigation', async () => {
    mount();
    const trigger = root.querySelector<HTMLButtonElement>('button')!;
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(trigger.textContent).toBe('High');
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard('{Enter}{Escape}');
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    const next = document.createElement('button');
    next.textContent = 'Next';
    root.append(next);
    await userEvent.keyboard('{Enter}{Tab}');
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('renders confirmed settings without an editable control while read-only', () => {
    const change = mount(effort, 'segment', { level: 'off' }, undefined, true);
    expect(root.textContent).toBe('Off');
    expect(root.querySelector('button')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('uses the catalog default only when no explicit choice exists', () => {
    const change = mount({ ...effort, default_level: 'high' });
    expect(root.querySelector('button')?.textContent).toBe('High');
    expect(change).not.toHaveBeenCalled();
  });

  it('preserves the always-on label for a model with a budget control', () => {
    mount({ kind: 'always_on', min_budget_tokens: 1024 });
    expect(root.querySelector('button')?.textContent).toBe('Always on');
  });

  it('preserves explicit budget values and clears them when switching Off', () => {
    const change = mount({ kind: 'toggle_budget', disable_supported: true, min_budget_tokens: 1024 }, 'segment', { level: 'default', budget_tokens: 2048 });
    const trigger = root.querySelector<HTMLButtonElement>('button')!;
    expect(trigger.textContent).toBe('2048 tokens');
    trigger.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find((item) => item.textContent === 'Off')!.click();
    expect(change).toHaveBeenLastCalledWith({ level: 'off' });
    expect(trigger.textContent).toBe('Off');
  });

  it.each(['segment', 'badge'] as const)('keeps default distinct from enabled in the %s menu', (variant) => {
    const change = mount(effort, variant);
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(trigger.textContent).toBe('Default');
    expect(change).not.toHaveBeenCalled();
    trigger.click();
    const options = () => Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    expect(options().map((item) => item.textContent)).toEqual(['Default', 'Off', 'Low', 'High', 'Max']);
    expect(options().find((item) => item.getAttribute('aria-checked') === 'true')?.textContent).toBe('Default');
    options().find((item) => item.textContent === 'High')!.click();
    expect(trigger.textContent).toBe('High');
    trigger.click();
    options().find((item) => item.textContent === 'Default')!.click();
    expect(change.mock.calls.map(([value]) => value?.level)).toEqual(['high', 'default']);
    expect(trigger.textContent).toBe('Default');
  });

  it('offers the same default and effort options in settings', () => {
    mount(effort, 'full');
    expect(Array.from(root.querySelectorAll('button[aria-pressed]')).map((item) => item.textContent)).toEqual(['Default', 'Off', 'Low', 'High', 'Max']);
  });

  it('preserves an explicit default over a catalog default', () => {
    mount({ ...effort, default_level: 'high' }, 'segment', { level: 'default' });
    expect(root.querySelector('button')?.textContent).toBe('Default');
  });

  it('does not claim that a toggle default is enabled', () => {
    mount({ kind: 'toggle', disable_supported: true, default_enabled: false });
    expect(root.querySelector('button')?.textContent).toBe('Default');
  });

  it('keeps budget reasoning Off visible', () => {
    mount({ kind: 'toggle_budget', disable_supported: true, min_budget_tokens: 1024 }, 'segment', { level: 'off' });
    expect(root.querySelector('button')?.textContent).toBe('Off');
  });
});
