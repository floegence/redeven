// @vitest-environment jsdom

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerThinkingDisclosure } from '../../../../../flower_ui/src/FlowerThinkingDisclosure';

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  ChevronRight: () => <span data-chevron />,
}));

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount(initialLive = true) {
  const root = document.createElement('div');
  document.body.append(root);
  const [live, setLive] = createSignal(initialLive);
  const [confirmed, setConfirmed] = createSignal(true);
  const [abnormal, setAbnormal] = createSignal(false);
  const [content, setContent] = createSignal('First reasoning line');
  disposers.push(render(() => <FlowerThinkingDisclosure contentID="thinking-test" content={content}
    live={live} liveConfirmed={confirmed} preserveOnEnd={abnormal}
    label={() => live() && confirmed() ? 'Thinking...' : 'Thought process'} elapsed={() => '4s'}
    expandLabel={() => 'Expand full thinking'} collapseLabel={() => 'Collapse thinking'}
    contentBody={() => <><span>{content()}</span><button data-inner-control>Copy reasoning</button></>} />, root));
  return {
    root, setLive, setConfirmed, setAbnormal, setContent,
    view: () => root.querySelector('.flower-thinking-disclosure')?.getAttribute('data-flower-thinking-view'),
    button: () => root.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!,
    content: () => root.querySelector<HTMLElement>('.flower-thinking-content'),
    finish: (preserve = false) => batch(() => { setAbnormal(preserve); setLive(false); }),
  };
}

describe('Thinking segment disclosure', () => {
  it('uses the shared activity row for live thinking', () => {
    const thinking = mount();
    expect(thinking.view()).toBe('collapsed');
    expect(thinking.root.querySelector('.flower-thinking-disclosure')?.classList.contains('flower-activity-inline')).toBe(true);
    expect(thinking.button().getAttribute('aria-expanded')).toBe('false');
    expect(thinking.button().classList.contains('flower-activity-inline-button')).toBe(true);
    expect(thinking.button().querySelector('.flower-activity-inline-icon')).not.toBeNull();
    expect(thinking.button().querySelector('.flower-activity-inline-title')).not.toBeNull();
    expect(thinking.button().querySelector('.flower-thinking-flower')?.getAttribute('aria-hidden')).toBe('true');
    expect(thinking.button().querySelectorAll('.flower-thinking-petal')).toHaveLength(5);
    expect(thinking.button().textContent).toContain('Thinking...');
    expect(thinking.button().textContent).toContain('4s');
    expect(thinking.button().querySelector('[data-floe-progress-shimmer]')).toBeNull();
    thinking.button().click();
    expect(thinking.view()).toBe('expanded');
    thinking.button().click();
    expect(thinking.view()).toBe('collapsed');
    thinking.button().click();
    expect(thinking.view()).toBe('expanded');
  });

  it.each(['collapsed', 'expanded'] as const)('collapses a normally completed %s immediately and permits reopening', (view) => {
    const thinking = mount();
    expect(thinking.view()).toBe('collapsed');
    if (view === 'expanded') thinking.button().click();
    expect(thinking.view()).toBe(view);
    thinking.finish();
    expect(thinking.view()).toBe('collapsed');
    expect(thinking.content()).toBeNull();
    expect(thinking.button().textContent).toContain('Thought process');
    expect(thinking.button().getAttribute('aria-expanded')).toBe('false');
    thinking.button().click();
    expect(thinking.view()).toBe('expanded');
    expect(thinking.content()?.textContent).toContain('First reasoning line');
    thinking.setContent('Accepted complete reasoning');
    thinking.setLive(false);
    thinking.setAbnormal(true);
    expect(thinking.view()).toBe('expanded');
    thinking.button().click();
    expect(thinking.view()).toBe('collapsed');
  });

  it.each(['collapsed', 'expanded'] as const)('preserves the %s on abnormal completion without reopening older segments', (view) => {
    const thinking = mount();
    if (view === 'expanded') thinking.button().click();
    thinking.finish(true);
    expect(thinking.view()).toBe(view);
    expect(Boolean(thinking.content())).toBe(view === 'expanded');
    thinking.button().click();
    if (view === 'collapsed') thinking.button().click();
    expect(thinking.view()).toBe('collapsed');
    thinking.setContent('Updated abnormal detail');
    thinking.setAbnormal(false);
    expect(thinking.view()).toBe('collapsed');
  });

  it('starts completed history collapsed', () => {
    const thinking = mount(false);
    expect(thinking.view()).toBe('collapsed');
    expect(thinking.content()).toBeNull();
    thinking.button().click();
    thinking.setContent('Historical reasoning detail');
    expect(thinking.view()).toBe('expanded');
  });

  it('preserves collapsed and manual expansion through disconnect and reconnect', () => {
    const thinking = mount();
    thinking.setConfirmed(false);
    expect(thinking.view()).toBe('collapsed');
    expect(thinking.root.querySelector('[data-flower-thinking-active="false"]')).not.toBeNull();
    expect(thinking.button().textContent).toContain('Thought process');
    thinking.button().click();
    thinking.setConfirmed(true);
    expect(thinking.view()).toBe('expanded');
    thinking.setConfirmed(false);
    thinking.finish();
    expect(thinking.view()).toBe('collapsed');
  });

  it('keeps segments independent while later reasoning continues', () => {
    const first = mount();
    first.finish();
    const second = mount();
    second.setContent('Next provider step');
    expect(first.view()).toBe('collapsed');
    expect(second.view()).toBe('collapsed');
    first.button().click();
    second.finish();
    expect(first.view()).toBe('expanded');
    expect(second.view()).toBe('collapsed');
  });

  it('returns focus from completed content to its reachable disclosure button', () => {
    const thinking = mount();
    thinking.button().click();
    const inner = thinking.root.querySelector<HTMLButtonElement>('[data-inner-control]')!;
    inner.focus();
    expect(document.activeElement).toBe(inner);
    thinking.finish();
    expect(document.activeElement).toBe(thinking.button());
    expect(thinking.button().getAttribute('aria-expanded')).toBe('false');
  });

  it('follows confirmed active thinking only while the shared disclosure is expanded', async () => {
    const thinking = mount();
    expect(thinking.view()).toBe('collapsed');
    expect(thinking.content()).toBeNull();
    thinking.button().click();
    const viewport = thinking.content()!;
    Object.defineProperties(viewport, { scrollHeight: { value: 400 }, clientHeight: { value: 80 } });
    thinking.setContent('More reasoning');
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(viewport.scrollTop).toBe(400);
    viewport.scrollTop = 100;
    thinking.setConfirmed(false);
    thinking.setContent('Unconfirmed cached reasoning');
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(viewport.scrollTop).toBe(100);
    thinking.setConfirmed(true);
    viewport.scrollTop = 50;
    thinking.setContent('Full reasoning expansion');
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(viewport.scrollTop).toBe(400);
  });
});
