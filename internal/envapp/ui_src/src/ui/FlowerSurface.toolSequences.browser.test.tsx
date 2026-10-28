import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerRuntimeCurrentView, FlowerRuntimeCurrentItem, FlowerToolCallPreview } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import type { FlowerSurfaceCopy } from '../../../../flower_ui/src/copy';
import type { FlowerSurfaceProps } from '../../../../flower_ui/src/FlowerSurface';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { flowerActivityIdentity } from '../../../../flower_ui/src/flowerActivityIdentity';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void>; emulateMediaPreferences: (input: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
const item = (id: string, kind: FlowerRuntimeCurrentItem['kind'], text = id): FlowerRuntimeCurrentItem => ({ id, kind, text, turn_id: 'turn', run_id: 'run', ordinal: 0 });
const emptyLiveText = (id: string): FlowerRuntimeCurrentItem => ({ ...item(id, 'assistant', ''), live: true });
const tool = (id: string, status: 'success' | 'running' | 'error' = 'success', toolName = 'terminal.exec', renderer = 'terminal'): FlowerRuntimeCurrentItem => ({ ...item(id, 'tool'), activity: {
  item_id: id, tool_id: id, kind: 'tool', tool_name: toolName, status, severity: status === 'error' ? 'error' : status === 'running' ? 'normal' : 'quiet',
  needs_attention: status !== 'success', requires_approval: false,
  ...(status === 'error' ? { attention_reasons: ['error'] } : status === 'running' ? { attention_reasons: ['running'] } : {}),
  presentation: { label: `Execute ${id}`, renderer, payload: renderer === 'subagent_operation'
    ? { action: 'spawn', requested_count: 1 }
    : { operation: renderer === 'web_search' ? 'search' : 'exec', query: `query ${id}`, command: `echo ${id}`, output: `${id} output`, ...(status === 'error' ? { error: { message: `${id} failed` } } : {}) } },
} });
function current(items: FlowerRuntimeCurrentItem[], version = 1, parentEvents: readonly FlowerParentEvent[] = []): FlowerRuntimeCurrentView {
  return { thread_id: 'sequences', turn_id: 'turn', run_id: 'run', view_version: version, activity: 'active', run_progress: { phase: 'streaming' },
    turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-21T10:00:00Z', elapsed_ms: 0, waiting_ms: 0,
      work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }],
    items: items.map((value, i) => ({ ...value, ordinal: i + 1 })),
    ...(parentEvents.length ? { parent_events: { thread_id: 'sequences', events: parentEvents,
      first_event_id: parentEvents[0]!.id, last_event_id: parentEvents.at(-1)!.id } } : {}),
  };
}
const preview = (id: string): FlowerToolCallPreview => ({
  thread_id: 'sequences', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
  attempt_id: 'attempt', attempt_epoch: 0, call_id: id, name: 'apply_patch', arguments_complete: false,
  preview: { display_name: `${id}.ts`, additions: 2 },
});
async function mount(items: FlowerRuntimeCurrentItem[], previews: readonly FlowerToolCallPreview[] = [], parentEvents: readonly FlowerParentEvent[] = [], partial = false, copy?: FlowerSurfaceCopy, surfaceProps?: Pick<FlowerSurfaceProps, 'presentation'>) {
  await page.viewport(1280, 900);
  const window = partial ? { first_item_id: items[0].id, last_item_id: items.at(-1)!.id, has_before: true, has_after: false } : undefined;
  let latest = { ...current(items, 1, parentEvents), ...(window ? { window } : {}), ...(previews.length ? { tool_call_previews: previews } : {}) };
  const seed = applyFlowerRuntimeCurrentView(thread({ thread_id: 'sequences', title: 'Tool sequences', messages: [] }), latest);
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [seed, peer] }];
  let wake: (() => void) | undefined;
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [applyFlowerRuntimeCurrentView(seed, latest), peer]),
    loadThread: vi.fn(async id => id === peer.thread_id ? liveBootstrap(peer) : { thread: applyFlowerRuntimeCurrentView(seed, latest), current: latest }),
    async *connectLiveStream({ signal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const value = values.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  }, { copy, ...surfaceProps });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="sequences"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id], .flower-thinking-disclosure, .flower-tool-sequence-toggle')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, push(next: FlowerRuntimeCurrentItem[], nextPreviews: readonly FlowerToolCallPreview[] = [], terminal = false) {
    latest = { ...current(next, latest.view_version + 1), ...(window ? { window } : {}), ...(nextPreviews.length ? { tool_call_previews: nextPreviews } : {}) };
    if (terminal) latest = { ...latest, activity: 'idle', run_progress: undefined, last_outcome: 'completed',
      turns: [{ ...latest.turns![0], ended_at: '2026-10-21T10:01:00Z', outcome: 'completed', elapsed_ms: 60000, work_duration_ms: 60000,
        final_item_ids: next.filter(value => value.kind === 'assistant').map(value => value.id), final_boundary_complete: true }] };
    values.push({ schema_version: 3, kind: 'thread.batch', thread_id: 'sequences', current: latest }); wake?.();
  } };
}
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-activity-item-id="${id}"]`)!;
const group = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-tool-row-identity="${id}"]`)
  ?? root.querySelector<HTMLElement>(`[data-flower-tool-row-identity="${CSS.escape(flowerActivityIdentity({ threadID: 'sequences', runID: 'run', turnID: 'turn', itemID: id }))}"]`)
  ?? row(root, id).closest<HTMLElement>('.flower-tool-sequence-node')!;
const toggle = (root: HTMLElement, id: string) => group(root, id).querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
const collapsed = (root: HTMLElement, id: string) => group(root, id).querySelector('.flower-tool-sequence-viewport')!.getAttribute('aria-hidden') === 'true';
function expectSharedRailBetweenNodes(previousNode: HTMLElement, nextNode: HTMLElement) {
  const owner = previousNode.closest<HTMLElement>('[data-flower-sequence-start="true"]')!;
  expect(nextNode.closest('[data-flower-sequence-start="true"]')).toBe(owner);
  const rail = owner.querySelector<HTMLElement>('.flower-tool-sequence-rail')!;
  const bounds = rail.getBoundingClientRect();
  const body = owner.querySelector('.flower-tool-sequence-scroll')!.getBoundingClientRect();
  expect(bounds.right).toBeLessThanOrEqual(body.left);
  expect(bounds.top).toBe(body.top);
  expect(bounds.bottom).toBe(body.bottom);
  expect(getComputedStyle(rail, '::before').borderLeftWidth).toBe('1px');
  for (const node of [previousNode, nextNode]) {
    expect(getComputedStyle(node.querySelector('.flower-tool-sequence-content')!, '::after').content).toBe('none');
  }
}
function expectSharedRailBetween(root: HTMLElement, previousID: string, nextID: string) {
  expectSharedRailBetweenNodes(group(root, previousID), group(root, nextID));
}
afterEach(async () => { await media.emulateTouchInput(false); document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('consecutive tools in the shared Flower surface', () => {
  it.each([
    ['terminal.exec', 'terminal'], ['web_search', 'web_search'],
    ['computer.exec', 'computer'], ['browser.navigate', 'browser'], ['computer.screenshot', 'computer'],
    ['read_files', 'structured'], ['extension.inspect', 'structured'],
  ])('points the %s disclosure right when closed and down when open', async (name, renderer) => {
    const base = tool('direction', 'success', name, renderer);
    const defaultOpen = name === 'computer.screenshot';
    const call = { ...base, activity: { ...base.activity!, presentation: { ...base.activity!.presentation as Record<string, unknown>,
      ...(renderer === 'web_search' ? { payload: { operation: 'search', query: 'release', results_provided: true,
        results: [{ title: 'Release notes', url: 'https://example.test/release', snippet: 'A useful result.' }] } } : {}),
      ...(defaultOpen ? { target_refs: [{ kind: 'computer_frame', label: 'Screenshot', resource_ref: 'computer://page/' + 'a'.repeat(64) }] } : {}),
    } } };
    const { root, push } = await mount([call]);
    const button = row(root, 'direction').querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;
    const chevron = button.querySelector<SVGSVGElement>('.flower-activity-inline-chevron')!;
    const glyph = chevron.querySelector<SVGGeometryElement>('path, polyline')!;
    // Assert the rendered direction, including the base glyph and CSS rotation.
    const direction = () => {
      const length = glyph.getTotalLength();
      const start = glyph.getPointAtLength(0);
      const end = glyph.getPointAtLength(length);
      const tip = glyph.getPointAtLength(length / 2);
      const vector = new DOMPoint(tip.x - (start.x + end.x) / 2, tip.y - (start.y + end.y) / 2);
      const transformed = vector.matrixTransform(new DOMMatrix(getComputedStyle(chevron).transform));
      return Math.abs(transformed.y) < 0.01 && transformed.x > 0 ? 'right'
        : Math.abs(transformed.x) < 0.01 && transformed.y > 0 ? 'down' : 'other';
    };
    if (defaultOpen) {
      expect(button.getAttribute('aria-expanded')).toBe('true');
      await waitFor(() => direction() === 'down');
      await userEvent.click(button);
      await waitFor(() => row(root, 'direction').dataset.state === 'closed');
      await waitFor(() => direction() === 'right');
    }
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(direction()).toBe('right');
    await userEvent.click(button);
    await waitFor(() => row(root, 'direction').dataset.state === 'open');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => direction() === 'down');
    push([call]);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(row(root, 'direction').querySelector('.flower-activity-inline-chevron')).toBe(chevron);
    expect(direction()).toBe('down');
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-direction-' + name + '.png' });
    await userEvent.click(button);
    await waitFor(() => row(root, 'direction').dataset.state === 'closed');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => direction() === 'right');
  });

  it.each(['zh-CN', 'en-US'] as const)('omits absent BrowserUse observation copy in %s', async locale => {
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const base = tool('browser-clean', 'success', 'computer.exec', 'computer');
    const call = { ...base, activity: { ...base.activity!, presentation: { ...base.activity!.presentation as Record<string, unknown>,
      chips: [{ kind: 'browser_source', label: 'source', value: 'browser.managed' },
        { kind: 'computer_observation', label: 'observation', value: 'not_observed' }],
      payload: { rows_provided: true, inputs: [{ title: 'script', content: 'return 1;', format: 'code', language: 'javascript' }] },
    } } };
    const { root } = await mount([call], [], [], false, copy);
    const browserRow = row(root, 'browser-clean');
    expect(browserRow.textContent).toContain('BrowserUse');
    expect(browserRow.querySelector('.flower-activity-inline-icon svg')).not.toBeNull();
    const expectClean = () => {
      expect(browserRow.textContent).not.toContain('本次没有新的页面观察');
      expect(browserRow.textContent).not.toContain('No new page observation');
      expect(browserRow.querySelector('.flower-activity-inline-detail')).toBeNull();
    };
    expectClean();
    await userEvent.click(browserRow.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!);
    await waitFor(() => browserRow.dataset.state === 'open');
    expectClean();
    expect(browserRow.textContent).toContain('return 1;');
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-browser-clean-' + locale + '.png' });
  });

  it.each([false, true])('crossfades into the shared summary without a cut (touch=%s)', async touch => {
    await media.emulateTouchInput(touch);
    const calls = Array.from({ length: 24 }, (_, i) => tool('handoff-' + i));
    const { root, push } = await mount(calls);
    const node = group(root, 'handoff-0');
    const viewport = node.querySelector<HTMLElement>('.flower-tool-sequence-viewport')!;
    const label = node.querySelector<HTMLElement>('.flower-tool-sequence-summary')!;
    push([...calls, { ...item('handoff-prose', 'assistant', 'A gentle handoff.'), live: true }]);
    await waitFor(() => node.dataset.state === 'closing');
    const animation = viewport.getAnimations().find(value =>
      (value.effect as KeyframeEffect).getKeyframes().some(frame => 'height' in frame))!;
    animation.pause();
    try {
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      expect(Number.parseFloat(String(frames.at(-1)!.height))).toBe(touch ? 44 : 32);
      const duration = Number(animation.effect!.getTiming().duration);
      const samples: { progress: number; opacity: number; clipped: boolean; height: number }[] = [];
      for (const progress of [0, 0.5, 0.75, 0.95]) {
        for (const active of node.getAnimations({ subtree: true })) {
          active.pause();
          active.currentTime = Number(active.effect!.getComputedTiming().endTime) * progress;
        }
        animation.currentTime = duration * progress;
        await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const style = getComputedStyle(label);
        if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-handoff-' + String(touch) + '-' + progress + '.png' });
        samples.push({ progress, opacity: Number(style.opacity),
          clipped: style.clipPath !== 'none' || label.getBoundingClientRect().width <= 1,
          height: node.getBoundingClientRect().height });
      }
      expect(samples[0].opacity).toBe(0);
      expect(samples.some(sample => !sample.clipped && sample.opacity > 0.05 && sample.opacity < 0.95), JSON.stringify(samples)).toBe(true);
      expect(samples.at(-1)!.opacity).toBeGreaterThan(0.95);
      expect(samples.every(sample => sample.height >= (touch ? 44 : 32))).toBe(true);
    } finally { for (const active of node.getAnimations({ subtree: true })) active.play(); }
    await waitFor(() => node.dataset.state === 'closed');
  });

  it.each([false, true])('finishes one automatic fold before revealing prose (terminal=%s)', async terminal => {
    const calls = Array.from({ length: 24 }, (_, i) => tool('ordered-' + i));
    const { root, push } = await mount(calls);
    const node = group(root, 'ordered-0');
    const viewport = terminal ? node.closest('.flower-turn-row')!.querySelector<HTMLElement>(':scope > .flower-turn-row-viewport')!
      : node.querySelector<HTMLElement>('.flower-tool-sequence-viewport')!;
    const before = viewport.getBoundingClientRect().height;
    const prose = { ...item('ordered-prose', 'assistant', 'A result that must not jump.'), live: !terminal };
    const samples: { state: string | undefined; height: number; visible: boolean; top?: number; opacity: number; animations: number }[] = [];
    push([...calls, prose], [], terminal);
    for (let frame = 0; frame < 36; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const text = root.querySelector<HTMLElement>('[data-flower-message-id="ordered-prose"] .flower-message-bubble');
      samples.push({ state: viewport.dataset.state, height: viewport.getBoundingClientRect().height,
        visible: Boolean(text?.checkVisibility({ visibilityProperty: true })),
        top: text?.getBoundingClientRect().top,
        opacity: text ? Number(getComputedStyle(text.closest('.flower-history-message')!).opacity) : 0,
        animations: viewport.getAnimations({ subtree: true }).filter(animation =>
          (animation.effect as KeyframeEffect).getKeyframes().some(keyframe => 'height' in keyframe)).length });
    }
    expect(samples.some(sample => sample.state === 'closing' && sample.height > 0 && sample.height < before), JSON.stringify(samples)).toBe(true);
    expect(samples.filter(sample => sample.state !== 'closed').every(sample => !sample.visible), JSON.stringify(samples)).toBe(true);
    expect(Math.max(...samples.map(sample => sample.animations))).toBe(1);
    expect(samples.at(-1)).toMatchObject({ state: 'closed', visible: true, opacity: 1 });
    expect(samples.some(sample => sample.visible && sample.opacity > 0 && sample.opacity < 1), JSON.stringify(samples)).toBe(true);
    const lastMoving = samples.map(sample => sample.state).lastIndexOf('closing');
    expect(Math.abs(samples[lastMoving].top! - samples[lastMoving + 1].top!), JSON.stringify(samples)).toBeLessThanOrEqual(2);
    const visibleTops = samples.filter(sample => sample.visible).map(sample => sample.top!);
    expect(Math.max(...visibleTops) - Math.min(...visibleTops), JSON.stringify(samples)).toBeLessThanOrEqual(1);
  });

  it('continues smoothly when completion arrives midway through a sequence fold', async () => {
    const calls = Array.from({ length: 24 }, (_, i) => tool('midway-' + i));
    const { root, push } = await mount(calls);
    const node = group(root, 'midway-0');
    const outer = node.closest('.flower-turn-row')!.querySelector<HTMLElement>(':scope > .flower-turn-row-viewport')!;
    const prose = { ...item('midway-prose', 'assistant', 'Still arriving.'), live: true };
    push([...calls, prose]);
    await waitFor(() => node.dataset.state === 'closing');
    const animation = node.querySelector('.flower-tool-sequence-viewport')!.getAnimations()[0];
    animation.pause(); animation.currentTime = 130;
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const before = outer.getBoundingClientRect().height;
    const innerOpacity = Number(getComputedStyle(node.querySelector('.flower-tool-sequence-viewport')!).opacity);
    push([...calls, { ...prose, live: false }], [], true);
    await waitFor(() => outer.dataset.state === 'closing');
    const first = (outer.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0];
    expect(Number.parseFloat(String(first.height))).toBeLessThanOrEqual(before + 1);
    expect(Number(getComputedStyle(outer).opacity) * Number(getComputedStyle(node.querySelector('.flower-tool-sequence-viewport')!).opacity)).toBeLessThanOrEqual(innerOpacity + 0.02);
    await waitFor(() => outer.dataset.state === 'closed');
  });

  it.each([false, true])('keeps terminal content coherent during the outer fold (reverse=%s)', async reverse => {
    const calls = Array.from({ length: 24 }, (_, i) => tool('outer-' + i));
    const { root, push } = await mount(calls);
    const node = group(root, 'outer-0');
    const viewport = node.closest('.flower-turn-row')!.querySelector<HTMLElement>(':scope > .flower-turn-row-viewport')!;
    push([...calls, item('outer-prose', 'assistant', 'The final result.')], [], true);
    await waitFor(() => viewport.dataset.state === 'closing');
    const animation = viewport.getAnimations()[0];
    animation.pause();
    try {
      expect(node.dataset.state).toBe('open');
      expect(node.querySelector<HTMLElement>('.flower-tool-sequence-viewport')!.getBoundingClientRect().height).toBeCloseTo(256, 3);
      expect(node.getAnimations({ subtree: true }).filter(active =>
        (active.effect as KeyframeEffect).getKeyframes().some(frame => 'height' in frame))).toHaveLength(0);
      const bubble = root.querySelector<HTMLElement>('[data-flower-message-id="outer-prose"] .flower-message-bubble')!;
      expect(bubble.checkVisibility({ visibilityProperty: true })).toBe(false);
      if (reverse) {
        root.querySelector<HTMLButtonElement>('.flower-turn-summary-button')!.click();
        await waitFor(() => viewport.dataset.state === 'opening');
        expect(bubble.checkVisibility({ visibilityProperty: true })).toBe(false);
      }
    } finally { if (!reverse) animation.play(); }
    await waitFor(() => viewport.dataset.state === (reverse ? 'open' : 'closed'));
    const bubble = root.querySelector<HTMLElement>('[data-flower-message-id="outer-prose"] .flower-message-bubble')!;
    expect(bubble.checkVisibility({ visibilityProperty: true })).toBe(true);
    if (reverse) {
      const top = bubble.getBoundingClientRect().top;
      for (let frame = 0; frame < 20; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        expect(Math.abs(bubble.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
      }
      expect(node.dataset.state).toBe('open');
    }
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])('holds every following prose block until folding settles (later arrival=%s, terminal=%s)', async (later, terminal) => {
    const calls = [tool('burst-a'), tool('burst-b')];
    const { root, push } = await mount(calls);
    const first = { ...item('burst-first', 'assistant', 'First paragraph.'), live: !terminal };
    const second = { ...item('burst-second', 'assistant', 'Second paragraph.'), live: !terminal };
    push([...calls, first, ...(later ? [] : [second])], [], terminal);
    const sequence = group(root, 'burst-a');
    const node = terminal ? sequence.closest('.flower-turn-row')!.querySelector<HTMLElement>(':scope > .flower-turn-row-viewport')! : sequence;
    await waitFor(() => node.dataset.state === 'closing');
    const animation = node.getAnimations({ subtree: true }).find(value =>
      (value.effect as KeyframeEffect).getKeyframes().some(frame => 'height' in frame))!;
    animation.pause();
    try {
      if (later) push([...calls, first, second], [], terminal);
      await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="burst-second"] .flower-message-bubble')));
      expect(node.getAnimations({ subtree: true }).find(value =>
        (value.effect as KeyframeEffect).getKeyframes().some(frame => 'height' in frame))).toBe(animation);
      for (const id of ['burst-first', 'burst-second']) {
        expect(root.querySelector<HTMLElement>('[data-flower-message-id="' + id + '"] .flower-message-bubble')!
          .checkVisibility({ visibilityProperty: true }), id).toBe(false);
      }
    } finally { animation.play(); }
    await waitFor(() => node.dataset.state === 'closed');
    for (const id of ['burst-first', 'burst-second']) {
      expect(root.querySelector<HTMLElement>('[data-flower-message-id="' + id + '"] .flower-message-bubble')!
        .checkVisibility({ visibilityProperty: true }), id).toBe(true);
    }
  });

  it('keeps fresh prose hidden when a user reverses an automatic fold', async () => {
    const calls = [tool('reverse-a'), tool('reverse-b')];
    const { root, push } = await mount(calls);
    push([...calls, { ...item('reverse-prose', 'assistant', 'Reveal after the interaction settles.'), live: true }]);
    const node = group(root, 'reverse-a');
    await waitFor(() => node.dataset.state === 'closing');
    toggle(root, 'reverse-a').click();
    expect(node.dataset.state).toBe('opening');
    const bubble = root.querySelector<HTMLElement>('[data-flower-message-id="reverse-prose"] .flower-message-bubble')!;
    expect(bubble.checkVisibility({ visibilityProperty: true })).toBe(false);
    await waitFor(() => node.dataset.state === 'open');
    expect(bubble.checkVisibility({ visibilityProperty: true })).toBe(true);
  });

  it.each([false, true])('settles pending prose when reduced motion changes during a fold (terminal=%s)', async terminal => {
    const calls = [tool('reduce-a'), tool('reduce-b')];
    const { root, push } = await mount(calls);
    push([...calls, { ...item('reduce-prose', 'assistant', 'Visible when motion is disabled.'), live: !terminal }], [], terminal);
    const sequence = group(root, 'reduce-a');
    const node = terminal ? sequence.closest('.flower-turn-row')!.querySelector<HTMLElement>(':scope > .flower-turn-row-viewport')! : sequence;
    await waitFor(() => node.dataset.state === 'closing');
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await waitFor(() => node.dataset.state === 'closed');
    expect(root.querySelector<HTMLElement>('[data-flower-message-id="reduce-prose"] .flower-message-bubble')!
      .checkVisibility({ visibilityProperty: true })).toBe(true);
    expect(node.getAnimations({ subtree: true })).toHaveLength(0);
  });

  it.each([false, true])('keeps one stationary folding rail during repeated upward scrolling (touch=%s)', async touch => {
    await media.emulateTouchInput(touch);
    const { root } = await mount(Array.from({ length: 24 }, (_, i) => tool('clipped-' + i)));
    const body = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    const rail = root.querySelector<HTMLElement>('.flower-tool-sequence-rail')!;
    const initial = rail.getBoundingClientRect();
    const rowHeight = touch ? 44 : 32;
    body.dispatchEvent(new WheelEvent('wheel', { deltaY: -6 }));
    for (let offset = rowHeight * 10 - 6; offset >= 0; offset -= rowHeight) {
      body.scrollTop = offset;
      body.dispatchEvent(new Event('scroll'));
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      expect(rail.getBoundingClientRect().toJSON()).toEqual(initial.toJSON());
      expect(root.querySelectorAll('.flower-tool-sequence-rail')).toHaveLength(1);
      expect(body.querySelector('[data-flower-connector-clipped]')).toBeNull();
      expectSharedRailBetween(root, 'clipped-0', 'clipped-1');
    }
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-sequence-clipped.png' });
  });

  it.each(['reduce', 'no-preference'] as const)('retains new prose while folding and respects %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const calls = [tool('growing-a'), tool('growing-b')];
    const { root, push } = await mount(calls);
    const prose = { ...item('growing-prose', 'assistant', 'First words.'), live: true };
    push([...calls, prose]);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="growing-prose"] .flower-message-bubble')));
    const bubble = root.querySelector<HTMLElement>('[data-flower-message-id="growing-prose"] .flower-message-bubble')!;
    push([...calls, { ...prose, text: 'First words. The newest streamed words remain intact.' }]);
    await waitFor(() => group(root, 'growing-a').dataset.state === 'closed');
    await waitFor(() => bubble.textContent!.includes('newest streamed words'));
    expect(bubble.checkVisibility({ visibilityProperty: true })).toBe(true);
    expect(bubble).toBe(root.querySelector('[data-flower-message-id="growing-prose"] .flower-message-bubble'));
  });

  it.each(['manual', 'reading', 'details'] as const)('does not hold prose when %s inspection keeps the sequence open', async protection => {
    const calls = Array.from({ length: 24 }, (_, i) => tool('protected-' + i));
    const { root, push } = await mount(calls);
    if (protection === 'manual') {
      toggle(root, 'protected-0').click();
      await waitFor(() => group(root, 'protected-0').dataset.state === 'closed');
      toggle(root, 'protected-0').click();
      await waitFor(() => group(root, 'protected-0').dataset.state === 'open');
    } else if (protection === 'details') {
      row(root, 'protected-23').querySelector<HTMLButtonElement>('button')!.click();
    } else {
      const body = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
      body.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
      body.scrollTop -= 120; body.dispatchEvent(new Event('scroll'));
    }
    push([...calls, { ...item('protected-prose', 'assistant', 'Visible without waiting.'), live: true }]);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="protected-prose"] .flower-message-bubble')));
    expect(root.querySelector<HTMLElement>('[data-flower-message-id="protected-prose"] .flower-message-bubble')!.checkVisibility({ visibilityProperty: true })).toBe(true);
    expect(group(root, 'protected-0').dataset.state).toBe('open');
  });

  it('needs no hit testing or rail attribute writes while scrolling a large group', async () => {
    const { root } = await mount(Array.from({ length: 300 }, (_, i) => tool('bounded-' + i)));
    const body = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    const rail = root.querySelector<HTMLElement>('.flower-tool-sequence-rail')!;
    const changed: MutationRecord[] = [];
    const observer = new MutationObserver(records => changed.push(...records));
    observer.observe(rail, { subtree: true, attributes: true, childList: true });
    const hit = vi.spyOn(document, 'elementFromPoint');
    try {
      for (let i = 0; i < 60; i++) { body.scrollTop = 320 + i; body.dispatchEvent(new Event('scroll')); }
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      expect(hit).not.toHaveBeenCalled();
      expect(changed).toHaveLength(0);
    } finally { observer.disconnect(); hit.mockRestore(); }
  });

  it('releases pending prose when navigation disposes the folding sequence', async () => {
    const calls = [tool('leave-a'), tool('leave-b')];
    const { root, push } = await mount(calls);
    push([...calls, { ...item('leave-prose', 'assistant', 'Retained after navigation.'), live: true }]);
    await waitFor(() => group(root, 'leave-a').dataset.state === 'closing');
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => !root.querySelector('[data-flower-message-id="leave-prose"]'));
    root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
    await waitFor(() => root.querySelector<HTMLElement>('[data-flower-message-id="leave-prose"] .flower-message-bubble')?.checkVisibility({ visibilityProperty: true }) === true);
    expect(group(root, 'leave-a').dataset.state).toBe('closed');
  });
  it.each([{ width: 1280, touch: false }, { width: 360, touch: false }, { width: 360, touch: true }])('shares the first activity row without blank space or movement at $width pixels, touch=$touch', async ({ width, touch }) => {
    await media.emulateTouchInput(touch);
    const prose = item('alignment-prose', 'assistant', 'Keep the conversation on one left edge.');
    const { root, push } = await mount([prose, tool('reserve-first')]);
    await page.viewport(width, 900);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(matchMedia('(pointer: coarse)').matches).toBe(touch);
    const first = row(root, 'reserve-first').querySelector<HTMLElement>('.flower-activity-inline-button')!;
    const top = first.getBoundingClientRect().top;
    const left = first.getBoundingClientRect().left;
    expect(Math.abs(top - group(root, 'reserve-first').getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    const height = first.getBoundingClientRect().height;
    const widthBefore = first.getBoundingClientRect().width;
    const icon = first.querySelector<HTMLElement>('.flower-activity-inline-icon')!;
    const toolIcon = icon.querySelector('svg')!;
    expect(toolIcon).not.toBeNull();
    const toolGlyph = toolIcon.innerHTML;
    const proseLeft = root.querySelector('[data-flower-message-id="alignment-prose"] .flower-message-bubble')!.getBoundingClientRect().left;
    expect(Math.abs(icon.getBoundingClientRect().left - proseLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(root.querySelector('.flower-model-status-indicator')!.getBoundingClientRect().left - proseLeft)).toBeLessThanOrEqual(1);
    expect(height).toBe(touch ? 44 : 32);
    push([prose, tool('reserve-first'), tool('reserve-second', 'running', 'web_search', 'web_search')]);
    await waitFor(() => Boolean(toggle(root, 'reserve-first')));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(Math.abs(first.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(first.getBoundingClientRect().height).toBe(height);
    expect(first.getBoundingClientRect().left).toBe(left);
    expect(first.getBoundingClientRect().width).toBe(widthBefore);
    expect(toggle(root, 'reserve-first').getBoundingClientRect().height).toBe(group(root, 'reserve-first').querySelector('.flower-tool-sequence-scroll')!.getBoundingClientRect().height);
    const control = toggle(root, 'reserve-first');
    const bounds = control.getBoundingClientRect();
    expect(Math.abs(bounds.top - top)).toBeLessThanOrEqual(1);
    expect(bounds.right).toBe(first.getBoundingClientRect().left);
    expect(bounds.left).toBeGreaterThanOrEqual(root.querySelector('.flower-chat-transcript')!.getBoundingClientRect().left);
    expect(bounds.width).toBeGreaterThanOrEqual(touch ? 44 : 24);
    expect(control.getAttribute('aria-label')).toContain('2 tool calls');
    expect(first.querySelector('.flower-activity-inline-icon svg')).toBe(toolIcon);
    expect(toolIcon.innerHTML).toBe(toolGlyph);
    expect(row(root, 'reserve-second').querySelector('.flower-activity-inline-icon svg')).not.toBeNull();
    const rail = control.querySelector<HTMLElement>('.flower-tool-sequence-rail')!;
    const railLeft = rail.getBoundingClientRect().left;
    const titleLeft = first.querySelector('.flower-activity-inline-title')!.getBoundingClientRect().left;
    expect(control.querySelector('.flower-tool-sequence-action')).toBeNull();
    expectSharedRailBetween(root, 'reserve-first', 'reserve-second');
    await userEvent.click(control);
    await waitFor(() => group(root, 'reserve-first').dataset.state === 'closed');
    expect(Math.abs(control.querySelector('.flower-tool-sequence-icon')!.getBoundingClientRect().left - proseLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(control.querySelector('.flower-tool-sequence-label')!.getBoundingClientRect().left - titleLeft)).toBeLessThanOrEqual(1);
    expect(rail.getBoundingClientRect().left).toBe(railLeft);
    expect(control.getAttribute('aria-label')).toContain('Expand');
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-sequence-aligned-folded-' + width + '-' + touch + '.png' });
    await userEvent.click(control);
    await waitFor(() => group(root, 'reserve-first').dataset.state === 'open');
    expect(rail.getBoundingClientRect().left).toBe(railLeft);
    expect(first.querySelector('.flower-activity-inline-icon svg')).toBe(toolIcon);
    expect(first.getBoundingClientRect().width).toBe(widthBefore);
    expect(icon.getBoundingClientRect().left).toBe(proseLeft);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: `__screenshots__/flower-sequence-first-row-${width}-${touch}.png` });
  });

  it.each([{ width: 1280, touch: false }, { width: 360, touch: false }, { width: 360, touch: true }])('keeps individual detail controls beside the content tail at $width pixels, touch=$touch', async ({ width, touch }) => {
    await media.emulateTouchInput(touch);
    const shortSource = tool('inline-short');
    const short = { ...shortSource, activity: { ...shortSource.activity!, started_at_unix_ms: 1000, ended_at_unix_ms: 1890,
      presentation: { ...shortSource.activity!.presentation!, label: 'pwd', payload: { operation: 'exec', command: 'pwd', output: '/workspace' } } } };
    const thought = { ...item('inline-thinking', 'thinking', 'Inspecting the result.'), started_at_unix_ms: 1000, ended_at_unix_ms: 1800 };
    const longSource = tool('inline-long-' + 'command-'.repeat(30));
    const long = { ...longSource, activity: { ...longSource.activity!, started_at_unix_ms: 1000, ended_at_unix_ms: 2200 } };
    const { root, push } = await mount([short]);
    await page.viewport(width, 900);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const button = row(root, short.id).querySelector<HTMLElement>('.flower-activity-inline-button')!;
    const chevron = button.querySelector('.flower-activity-inline-chevron')!;
    const chevronCenter = () => { const bounds = chevron.getBoundingClientRect(); return bounds.left + bounds.width / 2; };
    const before = chevronCenter();
    expect(button.querySelector('.flower-activity-inline-title')!.textContent).toBe('Run command');
    const expectAdjacent = (target: HTMLElement) => {
      const copy = target.querySelector<HTMLElement>('.flower-activity-inline-copy, .flower-activity-inline-title')!;
      const elapsed = target.querySelector<HTMLElement>('.flower-activity-inline-duration');
      const arrow = target.querySelector<HTMLElement>('.flower-activity-inline-chevron, .flower-thinking-toggle-icon')!;
      const visibleElapsed = elapsed && getComputedStyle(elapsed).display !== 'none';
      const next = visibleElapsed ? elapsed : arrow;
      const gap = next.getBoundingClientRect().left - copy.getBoundingClientRect().right;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(8);
      if (visibleElapsed) expect(arrow.getBoundingClientRect().left - elapsed.getBoundingClientRect().right).toBeLessThanOrEqual(8);
      const title = copy.querySelector('.flower-activity-inline-title') ?? copy;
      if (target === button) {
        const text = document.createRange(); text.selectNodeContents(title);
        expect(next.getBoundingClientRect().left - text.getBoundingClientRect().right).toBeLessThanOrEqual(8);
      }
      expect(arrow.getBoundingClientRect().right).toBeLessThanOrEqual(target.getBoundingClientRect().right);
      expect(target.scrollWidth).toBeLessThanOrEqual(target.clientWidth + 1);
    };
    expectAdjacent(button);
    push([short, thought, long, tool('inline-running', 'running')]);
    await waitFor(() => Boolean(root.querySelector('.flower-tool-sequence-toggle')));
    expect(Math.abs(chevronCenter() - before)).toBeLessThanOrEqual(0.1);
    for (const target of root.querySelectorAll<HTMLElement>('.flower-activity-inline-button')) {
      if (target.querySelector('.flower-activity-inline-chevron, .flower-thinking-toggle-icon')) expectAdjacent(target);
    }
    await userEvent.click(button);
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    expect(Math.abs(chevronCenter() - before)).toBeLessThanOrEqual(0.1);
    expect(toggle(root, short.id).getAttribute('aria-expanded')).toBe('true');
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
      await new Promise(resolve => setTimeout(resolve, 500));
      await page.screenshot({ element: root, path: '__screenshots__/flower-inline-tail-' + width + '-' + touch + '.png' });
    }
  });

  it.each(['full', 'companion'] as const)('keeps prose, activity and progress aligned through resize in %s', async presentation => {
    const prose = item('resize-prose', 'assistant', 'Stable transcript alignment.');
    const { root, push } = await mount([prose, tool('resize-tool')], [], [], false, undefined, { presentation });
    for (const width of [1280, 800, 360, 1280]) {
      await page.viewport(width, 900);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const left = root.querySelector('[data-flower-message-id="resize-prose"] .flower-message-bubble')!.getBoundingClientRect().left;
      expect(Math.abs(row(root, 'resize-tool').querySelector('.flower-activity-inline-icon')!.getBoundingClientRect().left - left)).toBeLessThanOrEqual(1);
      expect(Math.abs(root.querySelector('.flower-model-status-indicator')!.getBoundingClientRect().left - left)).toBeLessThanOrEqual(1);
    }
    const progress = root.querySelector('.flower-model-status-indicator')!;
    const left = progress.getBoundingClientRect().left;
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const widthRead = vi.spyOn(viewport, 'offsetWidth', 'get');
    try {
      push([prose, tool('resize-tool'), tool('resize-second', 'running')]);
      await waitFor(() => Boolean(toggle(root, 'resize-tool')));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      expect(progress.getBoundingClientRect().left).toBe(left);
      expect(widthRead).not.toHaveBeenCalled();
    } finally { widthRead.mockRestore(); }
  });

  it('shares the leading thinking row before and after the first tool arrives', async () => {
    const thought = { ...item('reserved-thinking', 'thinking', 'Reviewing the evidence.'), live: true };
    const prose = item('thinking-alignment-prose', 'assistant', 'Review the tool results.');
    const { root, push } = await mount([prose, thought]);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    const title = thinking.querySelector<HTMLElement>('.flower-thinking-toggle')!;
    const header = thinking.closest('.flower-tool-sequence-node')!.querySelector('.flower-tool-sequence-header');
    expect(header).not.toBeNull();
    const top = title.getBoundingClientRect().top;
    const left = title.getBoundingClientRect().left;
    const proseLeft = root.querySelector('[data-flower-message-id="thinking-alignment-prose"] .flower-message-bubble')!.getBoundingClientRect().left;
    const icon = title.querySelector('.flower-activity-inline-icon')!;
    expect(icon.getBoundingClientRect().left).toBe(proseLeft);
    expect(Math.abs(top - thinking.closest('.flower-tool-sequence-node')!.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    push([prose, thought, tool('thinking-first', 'running')]);
    await waitFor(() => Boolean(root.querySelector('.flower-tool-sequence-toggle')));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(thinking.closest('.flower-tool-sequence-node')!.querySelector('.flower-tool-sequence-header')).toBe(header);
    expect(Math.abs(title.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(title.getBoundingClientRect().left).toBe(left);
    expect(icon.getBoundingClientRect().left).toBe(proseLeft);
    expect(root.querySelector('.flower-tool-sequence-toggle')!.getBoundingClientRect().right).toBe(title.getBoundingClientRect().left);
  });

  it.each(['reduce', 'no-preference'] as const)('keeps the first-row group and detail controls independent with %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const { root, push } = await mount([tool('shared-first'), tool('shared-second')]);
    const node = group(root, 'shared-first');
    const first = row(root, 'shared-first');
    const control = toggle(root, 'shared-first');
    const details = first.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;
    const label = control.querySelector<HTMLElement>('.flower-tool-sequence-summary')!;
    const top = control.getBoundingClientRect().top;
    expect(getComputedStyle(label).opacity).toBe('0');
    await userEvent.click(details);
    await waitFor(() => details.getAttribute('aria-expanded') === 'true');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => first.dataset.state === 'open');
    expectSharedRailBetween(root, 'shared-first', 'shared-second');
    await userEvent.click(control);
    if (node.dataset.state === 'closing') {
      expect(control.getBoundingClientRect().width).toBe(node.getBoundingClientRect().width);
    }
    await waitFor(() => node.dataset.state === 'closed');
    expect(Math.abs(control.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(node.getBoundingClientRect().height).toBe(32);
    expect(control.getBoundingClientRect().width).toBe(node.getBoundingClientRect().width);
    expect(getComputedStyle(label).opacity).toBe('1');
    expect(document.activeElement).toBe(control);
    push([tool('shared-first'), tool('shared-second'), tool('shared-third', 'running')]);
    await waitFor(() => control.textContent?.includes('3 tool calls') === true);
    expect(node.dataset.state).toBe('closed');
    await userEvent.click(control);
    await waitFor(() => node.dataset.state === 'open');
    expect(row(root, 'shared-first')).toBe(first);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(control.getBoundingClientRect().width).toBeLessThan(node.getBoundingClientRect().width);
    expect(control.getBoundingClientRect().right).toBe(details.getBoundingClientRect().left);
  });

  it.each([
    { reducedMotion: 'reduce', terminal: true, width: 1280 },
    { reducedMotion: 'no-preference', terminal: true, width: 1280 },
    { reducedMotion: 'no-preference', terminal: false, width: 1280 },
    { reducedMotion: 'reduce', terminal: true, width: 390 },
    { reducedMotion: 'no-preference', terminal: true, width: 390 },
    { reducedMotion: 'no-preference', terminal: false, width: 390 },
  ] as const)('keeps the answer at the real tail through folding: %o', async ({ reducedMotion, terminal, width }) => {
    await media.emulateMediaPreferences({ reducedMotion });
    const prefix = item('stationary-prefix', 'assistant', 'Earlier visible content. '.repeat(160));
    const calls = Array.from({ length: 24 }, (_, i) => tool('stationary-' + i));
    const output = item('stationary-output', 'assistant', 'Final result.');
    const { root, push } = await mount([prefix, ...calls]);
    await page.viewport(width, 900);
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const initialOffset = viewport.scrollTop;
    expect(initialOffset).toBeGreaterThan(100);
    const samples: { gap: number; space: number; top: number; bottom: number; visible: boolean }[] = [];
    push([prefix, ...calls, { ...output, live: !terminal }], [], terminal);
    let answer: HTMLElement | undefined;
    for (let frame = 0; frame < 36; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const text = root.querySelector<HTMLElement>('[data-flower-message-id="stationary-output"]');
      if (!text) continue;
      if (answer) expect(text).toBe(answer); else answer = text;
      const bounds = viewport.getBoundingClientRect();
      const rect = text.getBoundingClientRect();
      samples.push({ gap: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        space: parseFloat(viewport.style.getPropertyValue('--flower-reading-tail-space')) || 0,
        top: rect.top - bounds.top, bottom: rect.bottom - bounds.top,
        visible: text.checkVisibility({ visibilityProperty: true }) });
    }
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(sample => Math.abs(sample.gap) <= 1 && sample.space === 0), JSON.stringify(samples)).toBe(true);
    const visible = samples.filter(sample => sample.visible);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every(sample => sample.top >= 0 && sample.bottom <= viewport.clientHeight + 1), JSON.stringify(samples)).toBe(true);
    expect(Math.max(...visible.map(sample => sample.top)) - Math.min(...visible.map(sample => sample.top)), JSON.stringify(samples)).toBeLessThanOrEqual(1);
    expect(root.querySelector('[data-flower-scroll-to-latest]')).toBeNull();
    expect(viewport.scrollTop).toBeLessThan(initialOffset);
  });

  it.each(['zh-CN', 'zh-TW', 'en-US', 'de-DE', 'ja-JP', 'ko-KR', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'] as const)('keeps localized summary and left rail accessible at desktop and narrow widths in %s', async locale => {
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const { root } = await mount([tool('a'), tool('b', 'running')], [], [], true, copy);
    const button = toggle(root, 'a');
    const summary = button.querySelector<HTMLElement>('.flower-tool-sequence-summary')!;
    expect(button.querySelector('.flower-tool-sequence-action')).toBeNull();
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.collapseTools);
    await userEvent.click(button);
    await waitFor(() => group(root, 'a').dataset.state === 'closed');
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.expandTools);
    expect(summary.scrollWidth).toBeLessThanOrEqual(summary.clientWidth + 1);
    await userEvent.click(button);
    await waitFor(() => group(root, 'a').dataset.state === 'open');
    await page.viewport(320, 850);
    expect(summary.querySelector('.flower-tool-sequence-label')!.textContent).toBe(copy.chat.turnProcess.continuousTools);
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.continuousTools);
    expect(button.getBoundingClientRect().right).toBe(row(root, 'a').getBoundingClientRect().left);
    if (locale === 'zh-CN') expect(summary.querySelector('.flower-tool-sequence-label')!.textContent).toBe('连续工具调用');
  });
  it('shows only the generic label for an incomplete live group, including accessible text', async () => {
    const { root, push } = await mount([tool('a'), tool('b', 'running')], [], [], true);
    const button = toggle(root, 'a');
    expect(button.querySelector('.flower-tool-sequence-label')!.textContent).toBe('Consecutive tool calls');
    expect(button.getAttribute('aria-label')).toBe('Collapse tool calls: Consecutive tool calls');
    button.click();
    push([tool('a'), tool('b'), tool('c', 'running')]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(button.querySelector('.flower-tool-sequence-label')!.textContent).toBe('Consecutive tool calls');
    expect(button.querySelector('.flower-tool-sequence-running, .flower-tool-sequence-current')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('shows full group statistics inside a partial history window without waiting for turn completion', async () => {
    const { root } = await mount([item('before', 'assistant'), tool('a'), tool('b', 'running')], [], [], true);
    const button = toggle(root, 'a');
    expect(button.textContent).toContain('2 tool calls');
    expect(button.textContent).toContain('1 running');
    expect(button.textContent).not.toContain('Consecutive tool calls');
  });
  it('keeps returned uncertainty grouped and visible while preserving manual disclosure', async () => {
    const failed = tool('uncertain', 'error', 'computer.exec', 'structured');
    const uncertain = { ...failed, activity: { ...failed.activity!, presentation: { ...failed.activity!.presentation as Record<string, unknown>,
      chips: [{ kind: 'effect_outcome', label: 'result', value: 'uncertain', tone: 'warning' }] } } };
    const { root, push } = await mount([tool('before'), tool('uncertain', 'running')]);
    const header = toggle(root, 'before');
    header.click();
    await waitFor(() => collapsed(root, 'before'));
    push([tool('before'), uncertain, tool('after')]);
    await waitFor(() => header.textContent?.includes('3 tool calls') === true);
    expect(root.querySelectorAll('.flower-tool-sequence-toggle')).toHaveLength(1);
    expect(toggle(root, 'before')).toBe(header);
    expect(collapsed(root, 'before')).toBe(true);
    expect(header.textContent).toContain('Result unconfirmed · 1');
    expect(header.getAttribute('aria-label')).toContain('Result unconfirmed');
    header.click();
    await waitFor(() => group(root, 'before').getAttribute('data-state') === 'open');
    expect(row(root, 'uncertain').textContent).toContain('Result unconfirmed');
  });
  it('keeps following after layout and programmatic scrolling without reading input', async () => {
    const calls = Array.from({ length: 36 }, (_, index) => tool(`layout-${index}`));
    const { root, push } = await mount(calls);
    const body = group(root, 'layout-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => body.scrollHeight - body.clientHeight - body.scrollTop).toBeLessThanOrEqual(1);
    // Native anchoring, restored details and focus can change the offset without
    // a wheel, key, touch or scrollbar gesture. They must not pause following.
    body.scrollTop -= 64;
    body.dispatchEvent(new Event('scroll'));
    expect(body.hasAttribute('data-flower-reading-paused')).toBe(false);
    push([...calls, tool('layout-new', 'running')]);
    await waitFor(() => Boolean(row(root, 'layout-new')));
    await expect.poll(() => body.scrollHeight - body.clientHeight - body.scrollTop).toBeLessThanOrEqual(1);
    const image = document.createElement('img');
    image.alt = 'Delayed tool screenshot';
    row(root, 'layout-30').append(image);
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="gray"/></svg>');
    await image.decode();
    await expect.poll(() => body.scrollHeight - body.clientHeight - body.scrollTop).toBeLessThanOrEqual(1);
    expect(body.hasAttribute('data-flower-reading-paused')).toBe(false);
  });

  it('fits eight compact tool rows in the expanded desktop viewport', async () => {
    const { root } = await mount(Array.from({ length: 30 }, (_, index) => tool(`compact-${index}`)));
    const body = group(root, 'compact-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => body.scrollHeight - body.clientHeight - body.scrollTop).toBeLessThanOrEqual(1);
    const bounds = body.getBoundingClientRect();
    const rows = [...body.querySelectorAll<HTMLElement>('.flower-activity-inline-button')];
    expect(rows.every(row => Math.abs(row.getBoundingClientRect().height - 32) <= 1)).toBe(true);
    expect(rows.filter(row => { const rect = row.getBoundingClientRect(); return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1; })).toHaveLength(8);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-tool-sequence-eight-rows.png' });
  });

  it('keeps a manually folded active group closed while showing its latest activity', async () => {
    const { root, push } = await mount([tool('summary-a'), tool('summary-b', 'running')]);
    toggle(root, 'summary-a').click();
    await waitFor(() => collapsed(root, 'summary-a'));
    push([tool('summary-a'), tool('summary-b'), tool('summary-c', 'running')]);
    await waitFor(() => toggle(root, 'summary-a').textContent?.includes('3 tool calls') === true);
    expect(toggle(root, 'summary-a').textContent).toContain('Execute summary-c');
    expect(toggle(root, 'summary-a').getAttribute('aria-label')).toContain('Execute summary-c');
    expect(collapsed(root, 'summary-a')).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-thread-id=peer] button')!.click();
    await waitFor(() => !root.querySelector('.flower-tool-sequence-toggle'));
    root.querySelector<HTMLButtonElement>('[data-thread-id=sequences] button')!.click();
    await waitFor(() => Boolean(root.querySelector('.flower-tool-sequence-toggle')));
    expect(collapsed(root, 'summary-a')).toBe(true);
    expect(toggle(root, 'summary-a').textContent).toContain('Execute summary-c');
  });

  it.each(['reduce', 'no-preference'] as const)('reveals both tails together after switching back with restored details and %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const calls = Array.from({ length: 48 }, (_, index) => tool(`return-${index}`));
    const { root, push } = await mount(calls);
    row(root, 'return-45').querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
    await waitFor(() => row(root, 'return-45').querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    root.querySelector<HTMLButtonElement>('[data-thread-id=peer] button')!.click();
    await waitFor(() => !root.querySelector('.flower-tool-sequence-toggle'));
    push([...calls, tool('return-48', 'running')]);
    root.querySelector<HTMLButtonElement>('[data-thread-id=sequences] button')!.click();
    const samples: { outer: number; inner: number; animated: number; visible: boolean }[] = [];
    for (let frame = 0; frame < 35; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
      const tail = row(root, 'return-48');
      if (!tail || transcript.dataset.flowerTailPreparing === 'true') continue;
      const body = tail.closest<HTMLElement>('.flower-tool-sequence-scroll')!;
      const bounds = body.getBoundingClientRect(), rect = tail.getBoundingClientRect();
      samples.push({ outer: transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop,
        inner: body.scrollHeight - body.clientHeight - body.scrollTop,
        animated: body.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running'
          && (animation.effect as KeyframeEffect).getKeyframes().some(keyframe => 'height' in keyframe)).length,
        visible: rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 });
    }
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(sample => sample.outer <= 1 && sample.inner <= 1 && sample.visible && sample.animated === 0), JSON.stringify(samples)).toBe(true);
    expect(row(root, 'return-45').querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds completed tools when output starts without flickering between consecutive calls', async () => {
    const initial = [tool('auto-a'), tool('auto-b', 'running')];
    const { root, push } = await mount(initial);
    const header = toggle(root, 'auto-a');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    push([tool('auto-a'), tool('auto-b')]);
    await waitFor(() => !root.querySelector('.flower-tool-sequence-running'));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    push([tool('auto-a'), tool('auto-b'), tool('auto-c', 'running')]);
    await waitFor(() => Boolean(row(root, 'auto-c')));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const prose = item('auto-output', 'assistant', 'Here is the result.');
    const calls = [tool('auto-a'), tool('auto-b'), tool('auto-c')];
    push([...calls, { ...prose, live: true }]);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="auto-output"]')));
    await waitFor(() => header.getAttribute('aria-expanded') === 'false');
    push([...calls, prose]);
    await waitFor(() => header.getAttribute('aria-expanded') === 'false');
    expect(header.textContent).toContain('3 tool calls');
    header.click();
    await waitFor(() => group(root, 'auto-a').dataset.state === 'open');
    push([...calls, prose, tool('auto-next')]);
    await waitFor(() => Boolean(row(root, 'auto-next')));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    header.click();
    push([...calls, prose, tool('auto-next'), tool('auto-last')]);
    await waitFor(() => Boolean(toggle(root, 'auto-next')));
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });
  it('opens a long sequence at the latest call on every painted frame', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const calls = Array.from({ length: 126 }, (_, index) => tool(`entry-${index}`));
    const { root } = await mount([...calls, item('later-text', 'assistant'), tool('next-a'), tool('next-b')]);
    const header = toggle(root, 'entry-0');
    const body = group(root, 'entry-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    const inspectOpen = async () => {
      const samples: number[] = [];
      header.click();
      for (let frame = 0; frame < 36; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const panel = body.parentElement!;
        if (panel.getBoundingClientRect().height > 1 && Number(getComputedStyle(panel).opacity) > 0.01) {
          samples.push(body.scrollHeight - body.clientHeight - body.scrollTop);
        }
      }
      expect(samples.length).toBeGreaterThan(0);
      expect(Math.max(...samples), JSON.stringify(samples)).toBeLessThanOrEqual(1);
    };
    await inspectOpen();
    body.scrollTop = 40; body.dispatchEvent(new Event('scroll'));
    header.click();
    await waitFor(() => group(root, 'entry-0').dataset.state === 'closed');
    await inspectOpen();
  });

  it('defers unopened historical tool details until expansion and retains inspected content', async () => {
    const history = Array.from({ length: 300 }, (_, index) => tool(`deferred-${index}`));
    const tail = [item('progress', 'assistant'), tool('active-a'), tool('active-b', 'running')];
    const { root, push } = await mount([...history, ...tail]);
    const header = toggle(root, 'deferred-0');
    expect(header.textContent).toContain('300 tool calls');
    expect(collapsed(root, 'deferred-0')).toBe(true);
    expect(root.querySelector('[data-flower-activity-item-id="deferred-0"]')).toBeNull();
    expect(root.querySelector('[data-flower-activity-item-id="deferred-299"]')).toBeNull();
    expect(root.querySelectorAll('[data-flower-activity-item-id]')).toHaveLength(2);
    push([...history, tool('deferred-300'), ...tail]);
    await waitFor(() => header.textContent?.includes('301 tool calls') === true);
    expect(row(root, 'deferred-300')).toBeNull();
    header.click();
    await waitFor(() => group(root, 'deferred-0').dataset.state === 'open');
    const inspected = row(root, 'deferred-299');
    expect(inspected).not.toBeNull();
    expect(root.querySelectorAll('[data-flower-activity-item-id]')).toHaveLength(303);
    expect(row(root, 'deferred-300')).not.toBeNull();
    header.click();
    await waitFor(() => group(root, 'deferred-0').dataset.state === 'closed');
    header.click();
    await waitFor(() => group(root, 'deferred-0').dataset.state === 'open');
    expect(row(root, 'deferred-299')).toBe(inspected);
  });

  it.each([
    ['success', false, 1280], ['running', false, 1280],
    ['success', true, 1280], ['running', false, 390],
  ] as const)('scrolls over short %s tool rows with details open=%s at width %i', async (status, detailsOpen, width) => {
    const history = item('scroll-history', 'assistant', 'Earlier conversation paragraph.\n\n'.repeat(60));
    const initial = [history, tool('scroll-first'), tool('scroll-last', status)];
    const { root, push } = await mount(initial);
    await page.viewport(width, 900);
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const sequence = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop).toBeLessThanOrEqual(1);
    const trigger = row(root, 'scroll-last').querySelector<HTMLButtonElement>('button')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    if (detailsOpen) {
      trigger.click();
      await waitFor(() => row(root, 'scroll-last').dataset.state === 'open');
    }
    expect(sequence.scrollHeight).toBe(sequence.clientHeight);
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; targetSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };
    let beforeWheel = transcript.scrollTop;
    transcript.addEventListener('wheel', () => { beforeWheel = transcript.scrollTop; }, { once: true });
    await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', targetSelector: '[data-flower-activity-item-id="scroll-last"] button', deltaY: -180 });
    await expect.poll(() => transcript.scrollTop).toBeLessThan(beforeWheel - 100);
    const readingTop = transcript.scrollTop;
    push([...initial, item('scroll-growth', 'assistant', 'New output.\n\n'.repeat(10))]);
    await waitFor(() => root.textContent?.includes('New output.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(transcript.scrollTop).toBe(readingTop);
  });

  it.each([1280, 390])('scrolls the conversation over short expanded thinking at width %i', async width => {
    const initial = [item('thinking-history', 'assistant', 'Earlier conversation paragraph.\n\n'.repeat(60)),
      item('short-thinking', 'thinking', 'A short reasoning paragraph.')];
    const { root, push } = await mount(initial);
    await page.viewport(width, 900);
    root.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
    const content = root.querySelector<HTMLElement>('.flower-thinking-content')!;
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    await expect.poll(() => content.closest('.flower-thinking-viewport')!.getAttribute('data-state')).toBe('open');
    expect(content.scrollHeight).toBe(content.clientHeight);
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; targetSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };
    let before = transcript.scrollTop;
    transcript.addEventListener('wheel', () => { before = transcript.scrollTop; }, { once: true });
    await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', targetSelector: '.flower-thinking-content', deltaY: -180 });
    await expect.poll(() => transcript.scrollTop).toBeLessThan(before - 100);
    const readingTop = transcript.scrollTop;
    push([...initial, item('thinking-growth', 'assistant', 'Later output.\n\n'.repeat(10))]);
    await waitFor(() => root.textContent?.includes('Later output.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(transcript.scrollTop).toBe(readingTop);
  });

  it.each([['wheel', false], ['keyboard', false], ['wheel', true], ['keyboard', true]] as const)('hands long thinking edge input to the transcript with %s (grouped: %s)', async (source, grouped) => {
    const initial = [item('thinking-history', 'assistant', 'Earlier conversation paragraph.\n\n'.repeat(60)),
      item('long-thinking', 'thinking', 'Reasoning line.\n'.repeat(100)), ...(grouped ? [tool('after-thinking', 'running')] : [])];
    const { root, push } = await mount(initial);
    root.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
    const content = root.querySelector<HTMLElement>('.flower-thinking-content')!;
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    await expect.poll(() => content.closest('.flower-thinking-viewport')!.getAttribute('data-state')).toBe('open');
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight * 2);
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; targetSelector: string; deltaY: number; preserveScroll?: boolean }) => Promise<{ before: number; after: number }> };
    const input = async (direction: number, preserveScroll = false) => {
      if (source === 'keyboard') { content.focus({ preventScroll: true }); await userEvent.keyboard(direction < 0 ? preserveScroll ? '{PageUp}' : '{ArrowUp}' : '{PageDown}'); }
      else await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', targetSelector: '.flower-thinking-content', deltaY: direction * 120, preserveScroll });
    };
    content.scrollTop = 200;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    let outerTop = transcript.scrollTop;
    // Initial hover makes the reading region visible before measuring ownership.
    if (source === 'wheel') transcript.addEventListener('wheel', () => { outerTop = transcript.scrollTop; }, { once: true });
    const innerEnd = new Promise<void>(resolve => content.addEventListener('scrollend', () => resolve(), { once: true }));
    await input(-1);
    await expect.poll(() => content.scrollTop).toBeLessThan(190);
    await innerEnd;
    expect(transcript.scrollTop).toBe(outerTop);
    content.scrollTop = 0;
    const sequence = content.closest<HTMLElement>('.flower-tool-sequence-scroll');
    expect(Boolean(sequence)).toBe(grouped);
    if (sequence) {
      // Start within one input step of the edge, independent of viewport capacity.
      sequence.scrollTop = Math.min(80, sequence.scrollHeight - sequence.clientHeight);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      expect(sequence.scrollTop).toBeGreaterThan(0);
      const sequenceEnd = new Promise<void>(resolve => sequence.addEventListener('scrollend', () => resolve(), { once: true }));
      await input(-1, true);
      await expect.poll(() => sequence.scrollTop).toBe(0);
      await sequenceEnd;
      expect(transcript.scrollTop).toBe(outerTop);
    }
    const end = new Promise<void>(resolve => transcript.addEventListener('scrollend', () => resolve(), { once: true }));
    await input(-1, true);
    await expect.poll(() => transcript.scrollTop).toBeLessThan(outerTop - 10);
    await end;
    const readingTop = transcript.scrollTop;
    push([...initial, item('thinking-growth', 'assistant', 'Later output.\n\n'.repeat(2))]);
    await waitFor(() => root.textContent?.includes('Later output.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(transcript.scrollTop).toBe(readingTop);
    content.scrollTop = content.scrollHeight;
    if (sequence) sequence.scrollTop = sequence.scrollHeight;
    await input(1);
    await expect.poll(() => transcript.scrollTop).toBeGreaterThan(readingTop + 10);
  });

  it.each([
    ['terminal', 'terminal.exec', '.flower-activity-terminal-output', { operation: 'exec', command: 'echo output', output: 'Output line.\n'.repeat(80) }],
    ['file', 'read_file', '.flower-activity-file-read-content', { operation: 'read', display_name: 'example.txt', content: 'File line.\n'.repeat(80) }],
    ['web_fetch', 'web_fetch', '.flower-activity-web-fetch-preview', { url: 'https://example.com', format: 'text', content_preview: 'Fetched line.\n'.repeat(80) }],
    ['patch', 'apply_patch', '.flower-activity-file-diff-unified', { mutations: [{ display_name: 'example.txt', change_type: 'update', additions: 80, deletions: 1, unified_diff: '@@ -1 +1,80 @@\n-old\n' + '+New line.\n'.repeat(80) }] }],
  ] as const)('hands %s preview edges through a sequence to the transcript', async (renderer, toolName, selector, payload) => {
    const template = tool('preview', 'success', toolName, renderer);
    const result = { ...template, activity: { ...template.activity!, presentation: { label: 'Inspect output', renderer, payload } } };
    const initial = [item('preview-history', 'assistant', 'Earlier conversation paragraph.\n\n'.repeat(60)), result, tool('after-preview', 'running')];
    const { root, push } = await mount(initial);
    row(root, 'preview').querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
    await waitFor(() => row(root, 'preview').querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    const content = root.querySelector<HTMLElement>(selector)!;
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const sequence = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight * 2);
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; targetSelector: string; deltaY: number; preserveScroll?: boolean }) => Promise<{ before: number; after: number }> };
    sequence.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    content.scrollTop = 100; sequence.scrollTop = 0; sequence.dispatchEvent(new Event('scroll'));
    let outerTop = transcript.scrollTop;
    transcript.addEventListener('wheel', () => { outerTop = transcript.scrollTop; }, { once: true });
    await wheel.wheelScrollRegion({ regionSelector: selector, deltaY: -60, targetSelector: selector });
    await expect.poll(() => content.scrollTop).toBeLessThan(80);
    expect(transcript.scrollTop).toBe(outerTop);
    content.scrollTop = 0; sequence.scrollTop = 0;
    let edgeTop = transcript.scrollTop;
    transcript.addEventListener('wheel', () => { edgeTop = transcript.scrollTop; }, { once: true });
    await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', targetSelector: selector, deltaY: -120, preserveScroll: true });
    await expect.poll(() => transcript.scrollTop).toBeLessThan(edgeTop - 50);
    const readingTop = transcript.scrollTop;
    push([...initial, item('preview-growth', 'assistant', 'New preview result.\n\n'.repeat(5))]);
    await waitFor(() => root.textContent?.includes('New preview result.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(transcript.scrollTop).toBe(readingTop);
  });

  it('hands native keyboard scrolling from a sequence edge to the transcript', async () => {
    const initial = [item('key-history', 'assistant', 'Earlier conversation paragraph.\n\n'.repeat(60)),
      ...Array.from({ length: 30 }, (_, index) => tool(`key-${index}`))];
    const { root, push } = await mount(initial);
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const sequence = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop).toBeLessThanOrEqual(1);
    await expect.poll(() => sequence.scrollHeight - sequence.clientHeight - sequence.scrollTop).toBeLessThanOrEqual(1);
    sequence.scrollTop = 0;
    sequence.focus({ preventScroll: true });
    const before = transcript.scrollTop;
    const scrollEnd = new Promise<void>(resolve => {
      // Initial tail positioning may still have a queued scrollend. Wait for
      // the keyboard movement to finish before recording the reading position.
      const onEnd = (event: Event) => {
        if (event.target !== transcript || transcript.scrollTop >= before - 10) return;
        transcript.removeEventListener('scrollend', onEnd);
        resolve();
      };
      transcript.addEventListener('scrollend', onEnd);
    });
    await userEvent.keyboard('{ArrowUp}');
    await expect.poll(() => transcript.scrollTop).toBeLessThan(before - 10);
    await scrollEnd;
    const readingTop = transcript.scrollTop;
    push([...initial, item('key-growth', 'assistant', 'Keyboard reading update.\n\n'.repeat(10))]);
    await waitFor(() => root.textContent?.includes('Keyboard reading update.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(transcript.scrollTop).toBe(readingTop);
  });

  it('chains wheel input at both tool sequence edges and retains internal scrolling between them', async () => {
    const initial = [item('edge-history', 'assistant', 'Earlier conversation paragraph.\n\n'.repeat(60)),
      ...Array.from({ length: 30 }, (_, index) => tool(`edge-${index}`, index === 29 ? 'running' : 'success'))];
    const { root, push } = await mount(initial);
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const sequence = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop).toBeLessThanOrEqual(1);
    await expect.poll(() => sequence.scrollHeight - sequence.clientHeight - sequence.scrollTop).toBeLessThanOrEqual(1);
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; targetSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };
    const outerTop = transcript.scrollTop;
    const internal = await wheel.wheelScrollRegion({ regionSelector: '.flower-tool-sequence-scroll', targetSelector: '[data-flower-activity-item-id="edge-29"] button', deltaY: -120 });
    await expect.poll(() => sequence.scrollTop).toBeLessThan(internal.before - 50);
    expect(transcript.scrollTop).toBe(outerTop);
    sequence.scrollTop = 0;
    sequence.dispatchEvent(new Event('scroll'));
    const upward = await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', targetSelector: '[data-flower-activity-item-id="edge-0"] button', deltaY: -120 });
    await expect.poll(() => transcript.scrollTop).toBeLessThan(upward.before - 50);
    const readingTop = transcript.scrollTop;
    push([...initial.slice(0, -1), tool('edge-29'), tool('edge-30', 'running')]);
    await waitFor(() => Boolean(row(root, 'edge-30')));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(transcript.scrollTop).toBe(readingTop);
    sequence.scrollTop = sequence.scrollHeight;
    sequence.dispatchEvent(new Event('scroll'));
    await wheel.wheelScrollRegion({ regionSelector: '.flower-chat-transcript', targetSelector: '[data-flower-activity-item-id="edge-30"] button', deltaY: 600 });
    await expect.poll(() => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop).toBeLessThanOrEqual(1);
    push([...initial.slice(0, -1), tool('edge-29'), tool('edge-30'), item('edge-growth', 'assistant', 'Following output.\n\n'.repeat(10))]);
    await waitFor(() => root.textContent?.includes('Following output.') === true);
    await expect.poll(() => transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop).toBeLessThanOrEqual(1);
  });

  it.each([
    ['success', 'reduce'], ['success', 'no-preference'],
    ['running', 'reduce'], ['running', 'no-preference'],
  ] as const)('reopens a collapsed %s sequence at latest with %s motion', async (status, reducedMotion) => {
    await media.emulateMediaPreferences({ reducedMotion });
    const initial = Array.from({ length: 40 }, (_, index) => tool(`latest-${index}`, index === 39 ? status : 'success'));
    const later = status === 'success' ? [item('later-prose', 'assistant'), tool('later-first'), tool('later-last')] : [];
    const { root, push } = await mount([...initial, ...later]);
    const header = toggle(root, 'latest-0');
    const viewport = group(root, 'latest-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    if (status === 'running') header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'closed');
    header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'open');
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 2);
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);

    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.hasAttribute('data-flower-reading-paused')).toBe(true);
    header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'closed');
    const updated = [...initial.slice(0, -1), tool('latest-39'), tool('latest-40', status)];
    push([...updated, ...later]);
    await waitFor(() => Boolean(group(root, 'latest-40')));
    expect(row(root, 'latest-40')).toBeNull();
    header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'open');
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    expect(viewport.hasAttribute('data-flower-reading-paused')).toBe(false);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    if (status === 'running') {
      push([...updated.slice(0, -1), tool('latest-40'), tool('latest-41', 'running')]);
      await waitFor(() => Boolean(row(root, 'latest-41')));
      await expect.poll(() => viewport.scrollTop).toBe(40);
    }
  });

  it.each([
    { touch: false, count: 2 }, { touch: false, count: 8 }, { touch: false, count: 9 },
    { touch: true, count: 2 }, { touch: true, count: 8 }, { touch: true, count: 9 },
  ])('shows at most eight rows without stretching short sequences (touch=$touch, count=$count)', async ({ touch, count }) => {
    await media.emulateTouchInput(touch);
    const { root } = await mount(Array.from({ length: count }, (_, index) => tool(`limit-${index}`)));
    const viewport = group(root, 'limit-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    const rowHeight = row(root, 'limit-0').querySelector('.flower-activity-inline-button')!.getBoundingClientRect().height;
    expect(rowHeight).toBe(touch ? 44 : 32);
    expect(viewport.clientHeight).toBe(Math.min(count, 8) * rowHeight);
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    const bounds = viewport.getBoundingClientRect();
    const visible = Array.from({ length: count }, (_, index) => row(root, `limit-${index}`).getBoundingClientRect())
      .filter(rect => rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1);
    expect(visible).toHaveLength(Math.min(count, 8));
    expect(viewport.scrollHeight > viewport.clientHeight).toBe(count > 8);
  });

  it('bounds a long expanded sequence and scrolls its complete contents below the reachable header', async () => {
    const { root } = await mount(Array.from({ length: 98 }, (_, index) => tool(`bounded-${index}`)));
    const header = toggle(root, 'bounded-0');
    const viewport = group(root, 'bounded-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    expect(viewport).not.toBeNull();
    expect(viewport.clientHeight).toBeGreaterThan(100);
    expect(viewport.clientHeight).toBe(256);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 2);
    expect(viewport.contains(row(root, 'bounded-97'))).toBe(true);
    expect(viewport.contains(header)).toBe(false);
    const top = header.getBoundingClientRect().top;
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const transcriptTop = transcript.scrollTop;
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    const result = await wheel.wheelScrollRegion({ regionSelector: '.flower-tool-sequence-scroll', deltaY: -300 });
    expect(result.after).toBeLessThan(result.before);
    expect(transcript.scrollTop).toBe(transcriptTop);
    expect(header.getBoundingClientRect().top).toBe(top);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll'));
    const savedTop = viewport.scrollTop;
    expect(row(root, 'bounded-97').getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1);
    header.click();
    await waitFor(() => collapsed(root, 'bounded-97'));
    header.click();
    await waitFor(() => group(root, 'bounded-97').dataset.state === 'open');
    await expect.poll(() => viewport.scrollTop).toBe(savedTop);
    expect(viewport.clientHeight).toBe(256);
    await page.screenshot({ element: root, path: '__screenshots__/flower-bounded-tools.png' });
    await page.viewport(390, 600);
    root.style.height = '520px';
    await expect.poll(() => viewport.clientHeight).toBeLessThanOrEqual(transcript.clientHeight * 0.65 + 1);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    await page.screenshot({ element: root, path: '__screenshots__/flower-bounded-tools-narrow.png' });
  });

  it('bounds long thinking independently and preserves the reading position while content streams', async () => {
    const longThought = Array.from({ length: 100 }, (_, index) => `Reasoning line ${index}.`).join('\n');
    const initial = [tool('before-thinking'), { ...item('bounded-thinking', 'thinking', longThought), live: true }];
    const { root, push } = await mount(initial);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    thinking.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
    const content = thinking.querySelector<HTMLElement>('.flower-thinking-content')!;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(content.clientHeight).toBeGreaterThan(100);
    expect(content.clientHeight).toBeLessThanOrEqual(320);
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight * 2);
    content.scrollTop = 40;
    content.dispatchEvent(new Event('scroll'));
    push([initial[0], { ...initial[1], text: `${longThought}\nNew reasoning.` }]);
    await waitFor(() => content.textContent?.includes('New reasoning.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(content.scrollTop).toBe(40);
    content.focus();
    expect(document.activeElement).toBe(content);
    await page.screenshot({ element: root, path: '__screenshots__/flower-bounded-thinking.png' });
    content.scrollTop = content.scrollHeight;
    content.dispatchEvent(new Event('scroll'));
    push([initial[0], { ...initial[1], text: `${longThought}\nLatest reasoning.\nMore reasoning.` }]);
    await waitFor(() => content.textContent?.includes('Latest reasoning.') === true);
    await expect.poll(() => content.scrollHeight - content.clientHeight - content.scrollTop).toBeLessThanOrEqual(1);
  });

  it('follows new active tool rows only while the list stays at its tail', async () => {
    const initial = Array.from({ length: 30 }, (_, index) => tool(`live-${index}`));
    const { root, push } = await mount([...initial, tool('live-30', 'running')]);
    const viewport = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    const header = toggle(root, 'live-0');
    push([...initial, tool('live-30'), tool('live-31', 'running')]);
    await waitFor(() => Boolean(row(root, 'live-31')));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(viewport.scrollTop).toBe(40);
    expect(toggle(root, 'live-0')).toBe(header);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll'));
    push([...initial, tool('live-30'), tool('live-31'), tool('live-32', 'running')]);
    await waitFor(() => Boolean(row(root, 'live-32')));
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
  });

  it.each([false, true])('preserves selected thinking and focused controls when grouping grows (standard DOM moves: %s)', async standardMoves => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore');
    if (standardMoves) Object.defineProperty(Element.prototype, 'moveBefore', { configurable: true, value: undefined });
    try {
      const initial = [tool('stable-first')];
      const { root, push } = await mount(initial);
      const firstRow = row(root, 'stable-first');
      firstRow.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.focus();
      const focused = document.activeElement;
      push([...initial, item('selected-thought', 'thinking', 'Keep this selected thought.')]);
      await waitFor(() => Boolean(root.querySelector('[data-flower-thinking-id="selected-thought:block:0"]')));
      expect(row(root, 'stable-first')).toBe(firstRow);
      expect(document.activeElement).toBe(focused);
      const thinking = root.querySelector<HTMLElement>('[data-flower-thinking-id="selected-thought:block:0"]')!;
      thinking.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
      await expect.poll(() => thinking.querySelector('.flower-thinking-viewport')!.getAttribute('data-state')).toBe('open');
      const text = thinking.querySelector('.flower-thinking-content-body')!.firstChild!;
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      push([...initial, item('selected-thought', 'thinking', 'Keep this selected thought.'), tool('stable-third')]);
      await waitFor(() => Boolean(row(root, 'stable-third')));
      expect(selection.toString()).toBe('Keep this selected thought.');
      expect(root.querySelector('[data-flower-thinking-id="selected-thought:block:0"]')).toBe(thinking);
    } finally {
      if (descriptor) Object.defineProperty(Element.prototype, 'moveBefore', descriptor);
      else Reflect.deleteProperty(Element.prototype, 'moveBefore');
    }
  });

  it('folds web search, goal activity and thinking after the final tool into one styled sequence', async () => {
    const { root } = await mount([
      tool('search', 'success', 'web_search', 'web_search'),
      tool('goal', 'success', 'goal', 'structured'),
      item('after-goal', 'thinking'),
    ]);
    const sequenceToggle = toggle(root, 'search');
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    const sequenceKey = group(root, 'search').dataset.flowerSequence;
    expect(sequenceToggle.textContent).toContain('2 tool calls');
    expect(sequenceToggle.textContent).toContain('1 thinking segment');
    expect(group(root, 'goal').dataset.flowerSequence).toBe(sequenceKey);
    expect(thinking.closest<HTMLElement>('.flower-tool-sequence-node')?.dataset.flowerSequence).toBe(sequenceKey);
    expect(thinking.querySelector('.flower-activity-inline-icon .flower-thinking-flower')).not.toBeNull();
    expect(getComputedStyle(thinking.querySelector('.flower-activity-inline-title')!).fontSize).toBe('12px');
    expect(getComputedStyle(thinking.querySelector('.flower-activity-inline-title')!).lineHeight).toBe('18px');

    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'search'));
    expect(row(root, 'search').closest('[inert]')).not.toBeNull();
    expect(row(root, 'goal').closest('[inert]')).not.toBeNull();
    expect(thinking.closest('[inert]')).not.toBeNull();
  });

  it('folds SubAgent activity and surrounding thinking in the shared sequence', async () => {
    const { root } = await mount([
      item('leading-thought', 'thinking'),
      tool('subagent-a', 'success', 'subagents', 'subagent_operation'),
      item('middle-thought', 'thinking'),
      tool('subagent-b', 'success', 'subagents', 'subagent_operation'),
      item('trailing-thought', 'thinking'),
    ]);
    const ids = ['leading-thought', 'subagent-a', 'middle-thought', 'subagent-b', 'trailing-thought'];
    const nodes = [...root.querySelectorAll<HTMLElement>('.flower-tool-sequence-node[data-flower-sequence]')];
    expect(nodes).toHaveLength(ids.length);
    expect(root.querySelectorAll('.flower-tool-sequence-toggle')).toHaveLength(1);
    expect(root.querySelectorAll('.flower-tool-sequence-node[data-flower-sequence] .flower-thinking-disclosure')).toHaveLength(3);
    expect(nodes.map(node => node.dataset.flowerSequence)).toEqual(Array(5).fill(nodes[0].dataset.flowerSequence));
    expect(nodes.map(node => node.dataset.flowerSequenceStart)).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(nodes.map(node => node.dataset.flowerSequenceEnd)).toEqual(['false', 'false', 'false', 'false', 'true']);
    for (let index = 0; index < nodes.length - 1; index += 1) expectSharedRailBetweenNodes(nodes[index]!, nodes[index + 1]!);
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1]!.querySelector('.flower-tool-sequence-content')!;
      expect(Math.abs(nodes[index]!.getBoundingClientRect().top - previous.getBoundingClientRect().bottom)).toBeLessThan(1);
    }
    const sequenceToggle = nodes[0]!.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(sequenceToggle.textContent).toContain('2 tool calls');
    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'subagent-a'));
    expect(nodes.every(node => node.querySelector('.flower-tool-sequence-viewport')?.hasAttribute('inert'))).toBe(true);
  });

  it('folds canonical SubAgent report and completion events with their surrounding tools', async () => {
    const items = [item('before', 'thinking'), tool('spawn', 'success', 'subagents', 'subagent_operation'),
      item('after', 'thinking'), tool('read', 'success', 'subagent_events', 'subagent')];
    const event = (id: string, kind: FlowerParentEvent['kind'], canonical_ordinal: number): FlowerParentEvent => ({
      id, canonical_ordinal, parent_thread_id: 'sequences', parent_turn_id: 'turn',
      source_thread_id: `child-${id}`, source_turn_id: `child-turn-${id}`, source_run_id: `child-run-${id}`,
      source_entry_id: `child-entry-${id}`, kind, received_at: '2026-10-21T10:00:00Z', admitted: true,
      ...(kind === 'report' ? { message: 'A completed research update.' } : {}),
    });
    const events = [event('report', 'report', 5), event('completed', 'completed', 6), event('failed', 'failed', 7)];
    const { root } = await mount(items, [], events);
    const sequenceNodes = [...root.querySelectorAll<HTMLElement>('.flower-tool-sequence-node[data-flower-sequence]')];
    const reportNode = root.querySelector<HTMLElement>('[data-parent-event="report"]')!.closest<HTMLElement>('.flower-tool-sequence-node')!;
    const completeNode = root.querySelector<HTMLElement>('[data-parent-event="completed"]')!.closest<HTMLElement>('.flower-tool-sequence-node')!;
    expect(sequenceNodes).toHaveLength(7);
    expect(reportNode.dataset.flowerSequence).toBe(group(root, 'spawn').dataset.flowerSequence);
    expect(completeNode.dataset.flowerSequence).toBe(group(root, 'spawn').dataset.flowerSequence);
    for (let index = 0; index < sequenceNodes.length - 1; index += 1) expectSharedRailBetweenNodes(sequenceNodes[index]!, sequenceNodes[index + 1]!);
    const sequenceToggle = sequenceNodes[0]!.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(sequenceToggle.textContent).toContain('3 subtask updates');
    expect(sequenceToggle.textContent).toContain('1 failed subtask update');
    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'spawn'));
    expect(root.querySelector('[data-parent-event="report"]')!.closest('[inert]')).not.toBeNull();
    expect(root.querySelector('[data-parent-event="completed"]')!.closest('[inert]')).not.toBeNull();
  });

  it('keeps active inline thinking closed with petal motion and shimmers SubAgent waits', async () => {
    const baseWait = tool('wait', 'running', 'subagents', 'subagent_operation');
    const waiting: FlowerRuntimeCurrentItem = { ...baseWait, activity: { ...baseWait.activity!, presentation: {
      ...baseWait.activity!.presentation!, payload: { action: 'wait', requested_count: 2 },
    } } };
    const activeThinking = { ...item('active-thinking', 'thinking'), live: true };
    const { root } = await mount([tool('before'), activeThinking, waiting, tool('after')]);
    const thinking = root.querySelector<HTMLElement>('[data-flower-thinking-id="active-thinking:block:0"]')!;
    expect(thinking.dataset.flowerThinkingView).toBe('collapsed');
    expect(thinking.querySelector('.flower-thinking-toggle')?.textContent).toContain('Thinking...');
    expect(thinking.querySelector('[data-floe-progress-shimmer="text"]')?.textContent).toContain('Thinking...');
    expect(thinking.querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(6);
    expect(row(root, 'wait').querySelector('[data-floe-progress-shimmer="text"]')?.textContent).not.toBe('');
  });

  it('folds older tools and bounded thinking, keeping prose and outside thinking visible', async () => {
    const { root } = await mount([item('leading', 'thinking'), tool('a'), item('inside', 'thinking'), tool('b'), item('outside', 'thinking'),
      item('progress', 'assistant', 'A useful progress report.'), tool('failure', 'error'), tool('c'), tool('d', 'running')]);
    const firstToggle = root.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(firstToggle.textContent).toContain('2 tool calls');
    expect(firstToggle.textContent).toContain('3 thinking segments');
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'b')).toBe(true);
    expect(collapsed(root, 'failure')).toBe(false);
    expect(toggle(root, 'failure').textContent).toContain('3 tool calls');
    expect(toggle(root, 'failure').textContent).toContain('1 failed tool call');
    expect(toggle(root, 'failure').textContent).toContain('1 running');
    expect(row(root, 'failure').closest('[inert]')).toBeNull();
    expect(root.querySelector('[data-flower-message-id="progress"]')?.closest('[inert]')).toBeNull();
    expect(root.querySelectorAll('.flower-thinking-disclosure')).toHaveLength(0);
    firstToggle.click();
    await waitFor(() => firstToggle.closest('.flower-tool-sequence-node')?.getAttribute('data-state') === 'open');
    const thoughts = [...root.querySelectorAll<HTMLElement>('.flower-thinking-disclosure')];
    expect(thoughts.map(node => Boolean(node.closest<HTMLElement>('.flower-tool-sequence-node')?.dataset.flowerSequence))).toEqual([true, true, true]);
    expect(thoughts[1].querySelectorAll('.flower-thinking-petal')).toHaveLength(5);
    expect(collapsed(root, 'b')).toBe(false);
    expect(row(root, 'a').getBoundingClientRect().height).toBe(32);
    expect(Math.abs(row(root, 'b').getBoundingClientRect().top - thoughts[1].getBoundingClientRect().bottom)).toBeLessThan(1);
    expectSharedRailBetween(root, 'a', 'b');
    expect(getComputedStyle(row(root, 'a').querySelector('.flower-activity-inline-title')!).fontSize).toBe('12px');
    expect(getComputedStyle(row(root, 'a').querySelector('.flower-activity-inline-title')!).lineHeight).toBe('18px');
    await page.screenshot({ element: root, path: '__screenshots__/flower-tools-mixed.png' });
  });

  it('folds failed and successful calls together, and colors failure text and glyph with the warning palette', async () => {
    const { root } = await mount([tool('failed', 'error'), tool('succeeded'), item('progress', 'assistant'), tool('c'), tool('d')]);
    const failedGroup = group(root, 'failed');
    expect(toggle(root, 'failed').textContent).toContain('2 tool calls');
    expect(toggle(root, 'failed').textContent).toContain('1 failed tool call');
    expect(collapsed(root, 'failed')).toBe(true);
    expect(row(root, 'failed')).toBeNull();
    toggle(root, 'failed').click();
    await waitFor(() => failedGroup.getAttribute('data-state') === 'open');
    const failedRow = row(root, 'failed');
    const failedGlyph = failedRow.querySelector<HTMLElement>('.flower-tool-icon')!;
    const failedTitle = failedRow.querySelector<HTMLElement>('.flower-activity-inline-title')!;
    const failedButton = failedRow.querySelector<HTMLElement>('.flower-activity-inline-button')!;
    const warning = document.createElement('span'); warning.style.color = 'var(--redeven-status-warning)'; root.append(warning);
    const warningForeground = document.createElement('span'); warningForeground.style.color = 'var(--redeven-status-warning-foreground)'; root.append(warningForeground);
    expect(failedRow.querySelectorAll('.flower-activity-inline-icon svg')).toHaveLength(1);
    expect(getComputedStyle(failedGlyph).color).toBe(getComputedStyle(warning).color);
    expect(getComputedStyle(failedTitle).color).toBe(getComputedStyle(warningForeground).color);
    expect(getComputedStyle(failedButton).color).toBe(getComputedStyle(warningForeground).color);
    expect(getComputedStyle(failedTitle).fontSize).toBe('12px');
    warningForeground.remove();
    warning.remove();
    failedRow.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
    await waitFor(() => Boolean(failedRow.querySelector('[data-state="open"]')));
    expect(failedRow.textContent).toContain('failed failed');
  });

  it('keeps running and completed commands on the same connected row geometry across empty live messages', async () => {
    const initial = [tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c', 'running'), emptyLiveText('live-empty-2'), tool('d', 'running')];
    const { root, push } = await mount(initial);
    const button = toggle(root, 'a');
    const groupKey = group(root, 'a').dataset.flowerSequence;
    const runningRows = [row(root, 'c'), row(root, 'd')];
    const runningTops = runningRows.map(entry => entry.getBoundingClientRect().top);
    expect(button.textContent).toContain('4 tool calls');
    expect(button.textContent).toContain('2 running');
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(group(root, 'd').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    const completedLine = row(root, 'b').querySelector<HTMLElement>('.flower-activity-inline-button')!.getBoundingClientRect();
    const runningLine = row(root, 'c').querySelector<HTMLElement>('.flower-activity-inline-button')!.getBoundingClientRect();
    expect(Math.abs(completedLine.height - runningLine.height)).toBeLessThan(1);
    expect(getComputedStyle(row(root, 'b').querySelector('.flower-activity-inline-icon')!).width).toBe('16px');
    expect(getComputedStyle(row(root, 'c').querySelector('.flower-activity-inline-icon')!).width).toBe('16px');
    expectSharedRailBetween(root, 'b', 'c');
    expectSharedRailBetween(root, 'c', 'd');
    await page.screenshot({ element: root, path: '__screenshots__/flower-tools-running-connector.png' });
    for (const id of ['b', 'live-empty-1', 'c', 'live-empty-2']) {
      expect(root.querySelector(`[data-flower-row-message-id="${id}"]`)?.closest('.flower-turn-row')
        ?.getAttribute('data-flower-sequence-continues')).toBe('true');
    }

    push([tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c'), emptyLiveText('live-empty-2'), tool('d', 'success')]);
    await waitFor(() => row(root, 'd').classList.contains('flower-activity-inline-row-success'));
    expect(group(root, 'd').dataset.flowerSequence).toBe(groupKey);
    expect(row(root, 'c')).toBe(runningRows[0]);
    expect(row(root, 'd')).toBe(runningRows[1]);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - runningTops[0])).toBeLessThan(1);
    expect(Math.abs(row(root, 'd').getBoundingClientRect().top - runningTops[1])).toBeLessThan(1);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectSharedRailBetween(root, 'b', 'c');
    expectSharedRailBetween(root, 'c', 'd');
  });

  it('keeps the argument-generation preview row compact and connected as it becomes a running tool', async () => {
    const { root, push } = await mount([tool('a'), tool('b')], [preview('c')]);
    const pendingRow = root.querySelector<HTMLElement>('[data-flower-tool-call-id="c"]')!;
    const pendingNode = pendingRow.closest<HTMLElement>('.flower-tool-sequence-node')!;
    const groupKey = pendingNode.dataset.flowerSequence;
    expect(pendingRow.classList.contains('flower-activity-inline-row-generating')).toBe(true);
    expect(root.querySelector('.flower-tool-sequence-toggle')?.textContent).toContain('3 tool calls');
    expect(Math.abs(pendingRow.getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectSharedRailBetweenNodes(group(root, 'b'), pendingNode);

    push([tool('a'), tool('b'), tool('c', 'running')]);
    await waitFor(() => Boolean(row(root, 'c')));
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectSharedRailBetween(root, 'b', 'c');
  });

  it.each(['reduce', 'no-preference'] as const)('retains manual group and tool detail state through updates and navigation with %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const initial = [tool('a'), tool('b')];
    const { root, push } = await mount(initial);
    const original = row(root, 'a');
    const button = original.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;
    button.click();
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    button.focus();
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'closed');
    expect(document.activeElement).toBe(toggle(root, 'a'));
    push([...initial, item('progress', 'assistant'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(collapsed(root, 'a')).toBe(true);
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'open');
    expect(row(root, 'a')).toBe(original);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => !root.querySelector('[data-flower-activity-item-id="a"]'));
    root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="a"]')));
    expect(collapsed(root, 'a')).toBe(false);
    expect(row(root, 'a').querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('bounds each left folding rail to its own group before intervening prose', async () => {
    const { root } = await mount([tool('scope-a'), tool('scope-b'), item('scope-prose', 'assistant', 'Between separate groups.'), tool('scope-c'), tool('scope-d')]);
    const first = toggle(root, 'scope-a');
    const second = toggle(root, 'scope-c');
    await userEvent.click(first);
    await waitFor(() => group(root, 'scope-a').dataset.state === 'open');
    const prose = root.querySelector('[data-flower-message-id="scope-prose"] .flower-message-bubble')!.getBoundingClientRect();
    expect(first.getBoundingClientRect().bottom).toBeLessThan(prose.top);
    expect(second.getBoundingClientRect().top).toBeGreaterThan(prose.bottom);
    expectSharedRailBetween(root, 'scope-a', 'scope-b');
    expectSharedRailBetween(root, 'scope-c', 'scope-d');
    await userEvent.click(first);
    await waitFor(() => group(root, 'scope-a').dataset.state === 'closed');
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(first);
  });

  it('supports native keyboard folding and forced colors without losing focus', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
    const { root } = await mount([tool('a'), tool('b')]);
    const button = toggle(root, 'a');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(collapsed(root, 'a')).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(getComputedStyle(button).outlineStyle).toBe('solid');
    const controlled = button.getAttribute('aria-controls')!.split(' ');
    expect(controlled).toHaveLength(2);
    expect(controlled.every(id => document.getElementById(id)?.hasAttribute('inert'))).toBe(true);
    await userEvent.keyboard(' ');
    expect(collapsed(root, 'a')).toBe(false);
  });

  it('reveals a waiting call and restores focus when a two-call group dissolves', async () => {
    const { root, push } = await mount([tool('a'), tool('b', 'running')]);
    const button = toggle(root, 'a'); button.focus(); button.click();
    push([tool('a'), { ...tool('b'), activity: { ...tool('b').activity!, status: 'waiting' } }]);
    await waitFor(() => !root.querySelector('.flower-tool-sequence-toggle'));
    await waitFor(() => row(root, 'b').closest('[inert]') === null);
    expect(document.activeElement).toBe(row(root, 'a').querySelector('.flower-activity-inline-button'));
  });

  it('respects a manually closed group when more consecutive tools arrive', async () => {
    const initial = [tool('a'), tool('b')];
    const { root, push } = await mount(initial);
    toggle(root, 'a').focus();
    toggle(root, 'a').click();
    push([...initial, tool('c')]);
    await waitFor(() => toggle(root, 'a').textContent?.includes('3 tool calls') === true);
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'c')).toBe(true);
    expect(document.activeElement).toBe(toggle(root, 'a'));
  });

  it.each(['selection', 'focus', 'gesture', 'manual detail'] as const)('protects %s while an existing sequence becomes older', async protection => {
    const initial = [tool('a'), item('thinking', 'thinking'), tool('b')];
    const { root, push } = await mount(initial);
    const node = row(root, 'a');
    if (protection === 'selection') {
      const range = document.createRange(); range.selectNodeContents(node.querySelector('.flower-activity-inline-title')!);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    } else if (protection === 'focus') node.querySelector<HTMLButtonElement>('button')!.focus();
    else if (protection === 'gesture') node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    else {
      node.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
      (document.activeElement as HTMLElement | null)?.blur();
    }
    push([...initial, item('progress', 'assistant'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(collapsed(root, 'a')).toBe(false);
    expect(row(root, 'a')).toBe(node);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  });

  it('keeps a selected trailing thought expanded when its sequence becomes older', async () => {
    const initial = [tool('a'), item('trailing', 'thinking', 'Keep this selected thought.')];
    const { root, push } = await mount(initial);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    thinking.querySelector<HTMLButtonElement>('button')!.click();
    await waitFor(() => thinking.querySelector('.flower-thinking-viewport')?.getAttribute('data-state') === 'open'
      && thinking.querySelector('.flower-thinking-content')?.textContent?.includes('Keep this selected thought.') === true);
    const content = thinking.querySelector('.flower-thinking-content')!;
    const range = document.createRange(); range.selectNodeContents(content);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    push([...initial, item('progress', 'assistant', 'A new visible progress message.'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(root.querySelector('.flower-thinking-disclosure')).toBe(thinking);
    expect(thinking.closest('[inert]')).toBeNull();
    expect(document.getSelection()?.toString()).toContain('Keep this selected thought.');
    expect(toggle(root, 'a').getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps visible prose and the older sequence stable when more tools arrive', async () => {
    const initial = [tool('a'), tool('b'), item('progress', 'assistant', 'Current progress. '.repeat(90))];
    const { root, push } = await mount(initial);
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    viewport.style.height = '110px'; viewport.style.maxHeight = '110px'; viewport.style.flex = 'none';
    await waitFor(() => viewport.scrollHeight > viewport.clientHeight + 50);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true }));
    const prose = root.querySelector<HTMLElement>('[data-flower-message-id="progress"]')!;
    viewport.scrollTop = prose.offsetTop + 15;
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const top = prose.getBoundingClientRect().top;
    push([...initial, tool('c')]);
    await waitFor(() => Boolean(row(root, 'c')));
    expect(collapsed(root, 'a')).toBe(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(Math.abs(prose.getBoundingClientRect().top - top)).toBeLessThan(2);
  });

  it.each(['paper', 'porcelain-dark', 'hc-light'] as const)('uses existing %s theme contrast and keeps active tools bright at narrow widths', async theme => {
    const html = document.documentElement;
    const previous = ['style', 'class', 'data-floe-shell-theme'].map(key => [key, html.getAttribute(key)] as const);
    const preset = builtInShellThemePresets.find(value => value.name === theme)!;
    try {
      html.classList.toggle('dark', preset.mode === 'dark');
      html.classList.toggle('light', preset.mode === 'light');
      html.dataset.floeShellTheme = theme;
      for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) if (value) html.style.setProperty(key, value);
      const { root } = await mount([tool('a'), tool('b', 'running')]);
      await page.viewport(390, 844);
      const quiet = row(root, 'a').querySelector<HTMLElement>('.flower-activity-inline-button')!;
      const running = row(root, 'b').querySelector<HTMLElement>('.flower-activity-inline-button')!;
      const reference = document.createElement('span'); reference.style.color = 'var(--foreground)'; root.append(reference);
      expect(getComputedStyle(quiet).color).not.toBe(getComputedStyle(running).color);
      expect(getComputedStyle(running).color).toBe(getComputedStyle(reference).color);
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
      await page.screenshot({ element: root, path: `__screenshots__/flower-tools-${theme}.png` });
    } finally {
      for (const [key, value] of previous) { if (value === null) html.removeAttribute(key); else html.setAttribute(key, value); }
    }
  });
});
