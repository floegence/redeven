import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createSplitWorkspaceArrangements, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { TerminalLayoutPicker } from './TerminalLayoutPicker';

let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  await page.viewport(1280, 800);
});

function mount(count: number, bottom = false) {
  let sequence = 0;
  const choices = createSplitWorkspaceArrangements(Array.from({ length: count }, (_, i) => 'session-' + i), () => 'split-' + ++sequence);
  const [layout, setLayout] = createSignal<SplitWorkspaceLayout>(choices[0].layout);
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '16px', [bottom ? 'bottom' : 'top']: '16px' });
  document.body.append(host);
  dispose = render(() => <TerminalLayoutPicker layout={layout()} choices={choices}
    onSelect={id => setLayout(choices.find(choice => choice.id === id)!.layout)} />, host);
  return host.querySelector<HTMLButtonElement>('button')!;
}

const options = () => [...document.querySelectorAll<HTMLButtonElement>('[data-terminal-layout-option]')];
const gallery = () => document.querySelector<HTMLElement>('[data-terminal-layout-gallery]')!;
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

it.each([2, 3, 5, 8, 32])('renders graphical choices for %i panes without visible option text', async count => {
  const trigger = mount(count);
  await userEvent.click(trigger);
  await expect.poll(() => options().length).toBeGreaterThanOrEqual(6);
  for (const option of options()) {
    expect(option.textContent).toBe('');
    expect(option.getAttribute('aria-label')).toBeTruthy();
    const rectangles = [...option.querySelectorAll('rect')];
    expect(rectangles).toHaveLength(count);
    expect(rectangles.every(rect => rect.width.baseVal.value > 0 && rect.height.baseVal.value > 0)).toBe(true);
  }
  expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
});

it('supports directional selection and restores focus on apply or Escape', async () => {
  const trigger = mount(5);
  await userEvent.click(trigger);
  await expect.poll(() => document.activeElement).toBe(options()[0]);
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(options()[1]);
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(options()[5]);
  const selected = options()[5].dataset.terminalLayoutOption;
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  await expect.poll(() => (document.activeElement as HTMLElement)?.dataset.terminalLayoutOption).toBe(selected);
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(options().at(-1));
  await userEvent.keyboard('{Home}');
  expect(document.activeElement).toBe(options()[0]);
  await userEvent.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

it.each([320, 390, 430, 768, 1280])('keeps top and footer galleries reachable at %ipx', async width => {
  await page.viewport(width, 700);
  for (const bottom of [false, true]) {
    const trigger = mount(8, bottom);
    await userEvent.click(trigger);
    await settle();
    const bounds = gallery().getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(700);
    await userEvent.keyboard('{Escape}');
    dispose?.(); document.body.replaceChildren();
  }
});

it('uses legible neutral previews across all shell themes', async () => {
  const trigger = mount(5);
  await userEvent.click(trigger);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  const luminance = (color: string, surface: string) => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = surface; context.fillRect(0, 0, 1, 1);
    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
      const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const theme of builtInShellThemePresets) {
    for (const [token, value] of Object.entries(theme.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(token, value);
    for (const option of options()) {
      const style = getComputedStyle(option);
      const surface = getComputedStyle(option.closest("[data-floe-popover-panel]")!).backgroundColor;
      const levels = [luminance(style.color, surface), luminance(style.backgroundColor, surface)].sort((a, b) => b - a);
      expect((levels[0] + .05) / (levels[1] + .05), theme.name).toBeGreaterThan(3);
    }
    await settle();
    await page.screenshot({ element: gallery(), path: '../../../node_modules/.cache/terminal-layout-gallery/' + theme.name.replace(/[^a-zA-Z0-9-]/g, '-') + '.png' });
    document.documentElement.removeAttribute('style');
  }
});

it('retains keyboard focus when a remote view update refreshes the available layouts', async () => {
  let sequence = 0;
  const arrange = (count: number) => createSplitWorkspaceArrangements(Array.from({ length: count }, (_, i) => 'session-' + i), () => 'split-' + ++sequence);
  const [choices, setChoices] = createSignal(arrange(3));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <TerminalLayoutPicker layout={choices()[0].layout} choices={choices()} onSelect={() => undefined} />, host);
  await userEvent.click(host.querySelector('button')!);
  const target = options().find(button => button.dataset.terminalLayoutOption === 'main-left')!;
  target.focus();
  setChoices(arrange(5));
  await settle();
  expect(document.activeElement).toBe(target);
  expect(target.querySelectorAll('rect')).toHaveLength(5);
});
