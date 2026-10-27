import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerRuntimeCurrentView, FlowerRuntimeCurrentItem, FlowerToolCallPreview } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import type { FlowerSurfaceCopy } from '../../../../flower_ui/src/copy';
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
async function mount(items: FlowerRuntimeCurrentItem[], previews: readonly FlowerToolCallPreview[] = [], parentEvents: readonly FlowerParentEvent[] = [], partial = false, copy?: FlowerSurfaceCopy) {
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
  }, { copy });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="sequences"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id], .flower-thinking-disclosure, .flower-tool-sequence-toggle')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, push(next: FlowerRuntimeCurrentItem[], nextPreviews: readonly FlowerToolCallPreview[] = []) {
    latest = { ...current(next, latest.view_version + 1), ...(window ? { window } : {}), ...(nextPreviews.length ? { tool_call_previews: nextPreviews } : {}) };
    values.push({ schema_version: 3, kind: 'thread.batch', thread_id: 'sequences', current: latest }); wake?.();
  } };
}
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-activity-item-id="${id}"]`)!;
const group = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-tool-row-identity="${id}"]`)
  ?? root.querySelector<HTMLElement>(`[data-flower-tool-row-identity="${CSS.escape(flowerActivityIdentity({ threadID: 'sequences', runID: 'run', turnID: 'turn', itemID: id }))}"]`)
  ?? row(root, id).closest<HTMLElement>('.flower-tool-sequence-node')!;
const toggle = (root: HTMLElement, id: string) => group(root, id).querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
const collapsed = (root: HTMLElement, id: string) => group(root, id).querySelector('.flower-tool-sequence-viewport')!.getAttribute('aria-hidden') === 'true';
function expectConnectorBetweenNodes(previousNode: HTMLElement, nextNode: HTMLElement) {
  const previousIcon = previousNode.querySelector('.flower-activity-inline-icon, .flower-parent-event-avatar')!.getBoundingClientRect();
  const nextIcon = nextNode.querySelector('.flower-activity-inline-icon, .flower-parent-event-avatar')!.getBoundingClientRect();
  const content = previousNode.querySelector('.flower-tool-sequence-content')!;
  const rect = content.getBoundingClientRect();
  const connector = getComputedStyle(content, '::after');
  const connectorX = rect.left + Number.parseFloat(connector.left);
  const start = rect.top + Number.parseFloat(connector.top);
  const end = rect.bottom - Number.parseFloat(connector.bottom);
  expect(connector.width).toBe('1px');
  expect(Number.parseFloat(connector.height)).toBeGreaterThan(0);
  expect(connector.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(Number.parseFloat(connector.opacity)).toBeGreaterThan(0.5);
  expect(connector.content).not.toBe('none');
  expect(Math.abs(connectorX - (previousIcon.left + previousIcon.width / 2))).toBeLessThan(1);
  expect(Math.abs(start - (previousIcon.bottom + 4))).toBeLessThan(1);
  expect(Math.abs(end - (nextIcon.top - 4))).toBeLessThan(1);
}
function expectConnectorBetween(root: HTMLElement, previousID: string, nextID: string) {
  expectConnectorBetweenNodes(group(root, previousID), group(root, nextID));
}
afterEach(async () => { await media.emulateTouchInput(false); document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('consecutive tools in the shared Flower surface', () => {
  it.each([{ width: 1280, touch: false }, { width: 360, touch: false }, { width: 360, touch: true }])('reserves the sequence header without shifting the first tool at $width pixels, touch=$touch', async ({ width, touch }) => {
    await media.emulateTouchInput(touch);
    const { root, push } = await mount([tool('reserve-first', 'running')]);
    await page.viewport(width, 900);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(matchMedia('(pointer: coarse)').matches).toBe(touch);
    const first = row(root, 'reserve-first').querySelector<HTMLElement>('.flower-activity-inline-button')!;
    const top = first.getBoundingClientRect().top;
    const height = first.getBoundingClientRect().height;
    const widthBefore = first.getBoundingClientRect().width;
    expect(height).toBe(touch ? 44 : 32);
    push([tool('reserve-first'), tool('reserve-second', 'running')]);
    await waitFor(() => Boolean(toggle(root, 'reserve-first')));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(Math.abs(first.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(first.getBoundingClientRect().height).toBe(height);
    expect(first.getBoundingClientRect().width).toBe(widthBefore);
    expect(toggle(root, 'reserve-first').getBoundingClientRect().height).toBe(height);
  });

  it('reserves the same header for leading thinking before the first tool arrives', async () => {
    const thought = { ...item('reserved-thinking', 'thinking', 'Reviewing the evidence.'), live: true };
    const { root, push } = await mount([thought]);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    const title = thinking.querySelector<HTMLElement>('.flower-thinking-toggle')!;
    const header = thinking.closest('.flower-tool-sequence-node')!.querySelector('.flower-tool-sequence-header');
    expect(header).not.toBeNull();
    const top = title.getBoundingClientRect().top;
    push([thought, tool('thinking-first', 'running')]);
    await waitFor(() => Boolean(root.querySelector('.flower-tool-sequence-toggle')));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(thinking.closest('.flower-tool-sequence-node')!.querySelector('.flower-tool-sequence-header')).toBe(header);
    expect(Math.abs(title.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  });

  it.each(['reduce', 'no-preference'] as const)('keeps earlier content stationary during automatic folding with %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const prefix = item('stationary-prefix', 'assistant', 'Earlier visible content. '.repeat(160));
    const calls = Array.from({ length: 18 }, (_, i) => tool('stationary-' + i));
    const output = item('stationary-output', 'assistant', 'Final result.');
    const { root, push } = await mount([prefix, ...calls, { ...output, live: true }]);
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const header = toggle(root, 'stationary-0');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const initialTop = header.getBoundingClientRect().top;
    const initialOffset = viewport.scrollTop;
    expect(initialOffset).toBeGreaterThan(100);
    const samples: { top: number; offset: number }[] = [];
    let sampling = true;
    const sample = () => { samples.push({ top: header.getBoundingClientRect().top, offset: viewport.scrollTop }); if (sampling) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    push([prefix, ...calls, output]);
    await waitFor(() => collapsed(root, 'stationary-0'));
    await new Promise(resolve => setTimeout(resolve, 260));
    sampling = false;
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map(value => Math.abs(value.top - initialTop)))).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map(value => Math.abs(value.offset - initialOffset)))).toBeLessThanOrEqual(1);
    expect(Number.parseFloat(viewport.style.getPropertyValue('--flower-reading-tail-space'))).toBeGreaterThan(0);
  });

  it.each(['zh-CN', 'en-US', 'de-DE', 'ja-JP'] as const)('keeps the incomplete label concise and accessible at 320 pixels in %s', async locale => {
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const { root } = await mount([tool('a'), tool('b', 'running')], [], [], true, copy);
    await page.viewport(320, 850);
    const button = toggle(root, 'a');
    expect(button.textContent).toBe(copy.chat.turnProcess.continuousTools);
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.continuousTools);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    if (locale === 'zh-CN') expect(button.textContent).toBe('连续工具调用');
  });
  it('shows only the generic label for an incomplete live group, including accessible text', async () => {
    const { root, push } = await mount([tool('a'), tool('b', 'running')], [], [], true);
    const button = toggle(root, 'a');
    expect(button.textContent).toBe('Consecutive tool calls');
    expect(button.getAttribute('aria-label')).toBe('Collapse tool calls: Consecutive tool calls');
    button.click();
    push([tool('a'), tool('b'), tool('c', 'running')]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(button.textContent).toBe('Consecutive tool calls');
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

  it('fits ten compact tool rows in the expanded desktop viewport', async () => {
    const { root } = await mount(Array.from({ length: 30 }, (_, index) => tool(`compact-${index}`)));
    const body = group(root, 'compact-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => body.scrollHeight - body.clientHeight - body.scrollTop).toBeLessThanOrEqual(1);
    const bounds = body.getBoundingClientRect();
    const rows = [...body.querySelectorAll<HTMLElement>('.flower-activity-inline-button')];
    expect(rows.every(row => Math.abs(row.getBoundingClientRect().height - 32) <= 1)).toBe(true);
    expect(rows.filter(row => { const rect = row.getBoundingClientRect(); return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1; })).toHaveLength(10);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: root, path: '__screenshots__/flower-tool-sequence-ten-rows.png' });
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

  it('folds completed tools after output finishes without flickering between consecutive calls', async () => {
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
    expect(header.getAttribute('aria-expanded')).toBe('true');
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
      for (let frame = 0; frame < 24; frame++) {
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
      sequence.scrollTop = sequence.scrollHeight;
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

  it('bounds a long expanded sequence and scrolls its complete contents below the reachable header', async () => {
    const { root } = await mount(Array.from({ length: 98 }, (_, index) => tool(`bounded-${index}`)));
    const header = toggle(root, 'bounded-0');
    const viewport = group(root, 'bounded-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    expect(viewport).not.toBeNull();
    expect(viewport.clientHeight).toBeGreaterThan(100);
    expect(viewport.clientHeight).toBeLessThanOrEqual(384);
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
    expect(viewport.clientHeight).toBeLessThanOrEqual(384);
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
    for (let index = 0; index < nodes.length - 1; index += 1) expectConnectorBetweenNodes(nodes[index]!, nodes[index + 1]!);
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
    for (let index = 0; index < sequenceNodes.length - 1; index += 1) expectConnectorBetweenNodes(sequenceNodes[index]!, sequenceNodes[index + 1]!);
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
    expect(getComputedStyle(group(root, 'a').querySelector('.flower-tool-sequence-content')!, '::after').width).toBe('1px');
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
    expectConnectorBetween(root, 'b', 'c');
    expectConnectorBetween(root, 'c', 'd');
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
    expectConnectorBetween(root, 'b', 'c');
    expectConnectorBetween(root, 'c', 'd');
  });

  it('keeps the argument-generation preview row compact and connected as it becomes a running tool', async () => {
    const { root, push } = await mount([tool('a'), tool('b')], [preview('c')]);
    const pendingRow = root.querySelector<HTMLElement>('[data-flower-tool-call-id="c"]')!;
    const pendingNode = pendingRow.closest<HTMLElement>('.flower-tool-sequence-node')!;
    const groupKey = pendingNode.dataset.flowerSequence;
    expect(pendingRow.classList.contains('flower-activity-inline-row-generating')).toBe(true);
    expect(root.querySelector('.flower-tool-sequence-toggle')?.textContent).toContain('3 tool calls');
    expect(Math.abs(pendingRow.getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    const previewIcon = pendingRow.querySelector('.flower-activity-inline-icon')!.getBoundingClientRect();
    const previousIcon = row(root, 'b').querySelector('.flower-activity-inline-icon')!.getBoundingClientRect();
    const previousConnector = group(root, 'b').querySelector('.flower-tool-sequence-content')!;
    const previousConnectorStyle = getComputedStyle(previousConnector, '::after');
    const previousConnectorRect = previousConnector.getBoundingClientRect();
    expect(previousConnectorStyle.width).toBe('1px');
    expect(Math.abs(previousConnectorRect.top + Number.parseFloat(previousConnectorStyle.top) - (previousIcon.bottom + 4))).toBeLessThan(1);
    expect(Math.abs(previousConnectorRect.bottom - Number.parseFloat(previousConnectorStyle.bottom) - (previewIcon.top - 4))).toBeLessThan(1);

    push([tool('a'), tool('b'), tool('c', 'running')]);
    await waitFor(() => Boolean(row(root, 'c')));
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectConnectorBetween(root, 'b', 'c');
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
    await waitFor(() => Boolean(thinking.querySelector('.flower-thinking-content')));
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
