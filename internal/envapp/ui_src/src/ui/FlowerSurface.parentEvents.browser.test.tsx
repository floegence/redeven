import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createEffect, onCleanup, createSignal, type ComponentProps } from 'solid-js';
import { render } from 'solid-js/web';
import { ParentEventRow as ControlledParentEventRow, createParentEventReading } from '../../../../flower_ui/src/parentEvents';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerParentEventPage, FlowerRuntimeCurrentItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { loadEnvAppDictionary } from './i18n/locales';
import { SUPPORTED_LOCALES } from './i18n/localeMeta';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { EnvAppTranslationKey } from './i18n';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';

function ParentEventRow(props: Omit<ComponentProps<typeof ControlledParentEventRow>, 'expanded' | 'onExpandedChange'>) {
  const [expanded, setExpanded] = createSignal(false);
  return <ControlledParentEventRow {...props} expanded={expanded()} onExpandedChange={setExpanded} />;
}

const copy = DEFAULT_FLOWER_SURFACE_COPY.subagents!;
const event = (id: string, kind: FlowerParentEvent['kind'] = 'report'): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn-child', source_run_id: 'run-child', source_entry_id: 'entry-' + id, kind, received_at: '2026-10-16T00:00:00Z', admitted: false });

it('aligns receipt reads to the displayed canonical interval instead of the default first page', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const all = Array.from({ length: 1000 }, (_, index) => ({ ...event('position-' + index, 'completed'), canonical_ordinal: index * 10 + 5 }));
  const pageOf = (events: FlowerParentEvent[]): FlowerParentEventPage => ({ thread_id: 'parent', leaf_id: 'receipt-leaf',
    first_event_id: all[0].id, last_event_id: all.at(-1)!.id, events });
  const [interval, setInterval] = createSignal({ first: 9800, last: 10000, hasAfter: false });
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string; after_ordinal?: number; before_ordinal?: number; limit?: number }) =>
    pageOf(all.filter(value => value.canonical_ordinal > (query.after_ordinal ?? 0)
      && (!query.before_ordinal || value.canonical_ordinal < query.before_ordinal)).slice(-(query.limit ?? 50))));
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: pageOf(all.slice(0, 100)), read,
    get interval() { return interval(); } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  expect(reading.events().some(value => value.canonical_ordinal! < 9800)).toBe(false);
  await waitFor(() => reading.events().at(-1)?.id === 'position-999');
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][1]).toMatchObject({ leaf_id: 'receipt-leaf', latest: true, limit: 50 });
  expect(reading.events()).toHaveLength(20);
  setInterval({ first: 4000, last: 4100, hasAfter: true });
  await waitFor(() => reading.events().length === 10 && reading.events()[0].id === 'position-400');
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1][1]).toMatchObject({ after_ordinal: 3999, before_ordinal: 4101 });
  expect(reading.events().every(value => value.canonical_ordinal! >= 4000 && value.canonical_ordinal! <= 4100)).toBe(true);
});

it('does not fetch report bodies while every report is collapsed', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const events = { thread_id: 'parent', events: [event('report')], first_event_id: 'report', last_event_id: 'report' };
  const read = vi.fn(async () => ({ ...events, events: [{ ...event('report'), message: 'Deferred report' }] }));
  const dispose = render(() => { createParentEventReading({ threadID: 'parent', page: events, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(read).not.toHaveBeenCalled();
});

it('preserves receipt projection identity when unrelated cache metadata changes', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const tail = { ...event('tail', 'completed'), canonical_ordinal: 950 };
  const source: FlowerParentEventPage = { thread_id: 'parent', leaf_id: 'leaf', first_event_id: tail.id, last_event_id: tail.id, events: [tail] };
  const [metadata, setMetadata] = createSignal(0);
  let reading!: ReturnType<typeof createParentEventReading>;
  const read = vi.fn(async () => source);
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: source, read,
    get interval() { metadata(); return { first: 900, last: 1000, hasAfter: false, revision: 1, spans: [{ first: 900, last: 1000 }] }; } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => reading.initialReady());
  const accepted = reading.events();
  for (let index = 1; index <= 200; index++) setMetadata(index);
  expect(reading.events()).toBe(accepted);
  expect(read).toHaveBeenCalledTimes(1);
});

it('publishes the complete displayed receipt interval using bounded preview pages', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const all = Array.from({ length: 1000 }, (_, index) => ({ ...event('dense-' + index, 'completed'), canonical_ordinal: index + 1 }));
  const source: FlowerParentEventPage = { thread_id: 'parent', leaf_id: 'leaf', first_event_id: all[0].id,
    last_event_id: all.at(-1)!.id, events: all.slice(0, 100), next_after_event_id: all[99].id };
  const read = vi.fn(async (_thread: string, query: { latest?: boolean; after_ordinal?: number; before_ordinal?: number; limit?: number }) => {
    const eligible = all.filter(value => value.canonical_ordinal > (query.after_ordinal ?? 0)
      && (!query.before_ordinal || value.canonical_ordinal < query.before_ordinal));
    const events = query.latest || query.before_ordinal ? eligible.slice(-(query.limit ?? 50)) : eligible.slice(0, query.limit ?? 50);
    return { ...source, events, next_after_event_id: events.at(-1)?.id === source.last_event_id ? undefined : events.at(-1)?.id,
      previous_before_event_id: events[0]?.id === source.first_event_id ? undefined : events[0]?.id };
  });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: source, read,
    interval: { first: 100, last: 200, hasAfter: false } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => !reading.busy());
  expect(reading.events().map(value => value.id)).toEqual(all.slice(99).map(value => value.id));
  expect(read).toHaveBeenCalledTimes(19);
  expect(read.mock.calls.every(([, query]) => query.limit === 50)).toBe(true);
  expect(reading.cursor()).toBe('');
});

it('accepts newly appended receipts after an aligned empty interval', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const old = { ...event('old', 'completed'), canonical_ordinal: 5 };
  const appended = { ...event('appended', 'completed'), canonical_ordinal: 1100 };
  const [source, setSource] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', leaf_id: 'before',
    first_event_id: old.id, last_event_id: old.id, events: [old] });
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string }) => ({ ...source(), leaf_id: query.leaf_id,
    events: query.leaf_id === 'before' ? [] : [appended] }));
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read,
    interval: { first: 900, last: 1000, hasAfter: false } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => reading.initialReady());
  setSource({ ...source(), leaf_id: 'after', last_event_id: appended.id });
  await waitFor(() => !reading.busy());
  expect(reading.events().map(value => value.id)).toEqual([appended.id]);
  expect(read).toHaveBeenCalledTimes(2);
});

it('shows an initial receipt failure outside the hidden preparing transcript', async () => {
  await page.viewport(1100, 850);
  const seed = thread({ thread_id: 'parent' });
  const base = liveBootstrap(seed, 1);
  const first = { ...event('first', 'completed'), canonical_ordinal: 1 };
  const last = { ...event('last', 'completed'), canonical_ordinal: 1000 };
  const initial = { ...base, current: { ...base.current,
    items: base.current.items!.map(item => ({ ...item, canonical_ordinal: 950 })),
    window: { first_item_id: 'm1', last_item_id: 'm1', has_before: true, has_after: false },
    parent_events: { thread_id: 'parent', leaf_id: 'receipt-leaf', events: [first], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id },
  } };
  const read = vi.fn(async () => { throw Object.assign(new Error('Read denied'), { status: 403 }); });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed],
    loadHistory: async () => ({ ...initial, thread: applyFlowerRuntimeCurrentView(seed, initial.current) }), readParentEvents: read,
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'receipt-observer', summaries: [seed] };
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    },
  }, { focusThreadRequest: { request_id: 'receipt-failure', thread_id: seed.thread_id } });
  await waitFor(() => read.mock.calls.length === 1 && Boolean(root.querySelector('.flower-parent-event-reading')));
  const notice = root.querySelector<HTMLElement>('.flower-parent-event-reading')!;
  expect(notice.checkVisibility({ visibilityProperty: true, opacityProperty: true })).toBe(true);
  expect(notice.closest('[inert]')).toBeNull();
  expect(notice.textContent).toContain(copy.events.readFailed);
});

it('does not fill an evicted message gap with unrelated receipt history', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const all = Array.from({ length: 1000 }, (_, index) => ({ ...event('sparse-' + index, 'completed'), canonical_ordinal: index * 10 + 5 }));
  const source: FlowerParentEventPage = { thread_id: 'parent', leaf_id: 'leaf', first_event_id: all[0].id,
    last_event_id: all.at(-1)!.id, events: all.slice(0, 100), next_after_event_id: all[99].id };
  const read = vi.fn(async (_thread: string, query: { after_ordinal?: number; before_ordinal?: number; limit?: number }) => ({ ...source, next_after_event_id: undefined,
    events: all.filter(value => value.canonical_ordinal > (query.after_ordinal ?? 0)
      && (!query.before_ordinal || value.canonical_ordinal < query.before_ordinal)).slice(-(query.limit ?? 50)) }));
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: source, read,
    interval: { first: 10, last: 9999, hasAfter: false, spans: [{ first: 10, last: 30 }, { first: 9900, last: 9999 }] } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => reading.events().some(value => value.id === 'sparse-999'));
  expect(reading.events().every(value => value.canonical_ordinal! <= 30 || value.canonical_ordinal! >= 9900)).toBe(true);
  expect(reading.events()).toHaveLength(12);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[0][1]).toMatchObject({ after_ordinal: 9, before_ordinal: 31 });
  expect(read.mock.calls[1][1]).toMatchObject({ latest: true });
});

it('finishes a frozen receipt alignment while live appends keep changing the default page', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const first = { ...event('first', 'completed'), canonical_ordinal: 5 };
  const current = { ...event('current', 'completed'), canonical_ordinal: 995 };
  const [source, setSource] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', leaf_id: 'old-leaf',
    first_event_id: first.id, last_event_id: current.id, events: [first], next_after_event_id: first.id });
  let resolve!: (page: FlowerParentEventPage) => void;
  const read = vi.fn((_thread: string, query: { leaf_id?: string; after_ordinal?: number; before_ordinal?: number }, _signal?: AbortSignal) =>
    read.mock.calls.length === 1 ? new Promise<FlowerParentEventPage>(done => { resolve = done; }) : Promise.resolve({
      thread_id: 'parent', leaf_id: query.leaf_id, first_event_id: first.id, last_event_id: current.id, events: [current] }));
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read,
    interval: { first: 900, last: 1000, hasAfter: true } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => read.mock.calls.length === 1);
  for (let index = 0; index < 50; index++) setSource({ ...source(), leaf_id: 'new-leaf-' + index, last_event_id: 'new-' + index });
  expect(read.mock.calls[0][2]?.aborted).toBe(false);
  resolve({ thread_id: 'parent', leaf_id: 'old-leaf', first_event_id: first.id, last_event_id: current.id, events: [current] });
  await waitFor(() => reading.events().some(value => value.id === current.id));
  expect(reading.failed()).toBe(false);
  expect(read.mock.calls.length).toBeLessThanOrEqual(2);
});

it('coalesces moving live message bounds without canceling the accepted receipt read', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const first = { ...event('start', 'completed'), canonical_ordinal: 1 };
  const current = { ...event('tail', 'completed'), canonical_ordinal: 1000 };
  const source: FlowerParentEventPage = { thread_id: 'parent', leaf_id: 'leaf', first_event_id: first.id, last_event_id: current.id, events: [first] };
  const [interval, setInterval] = createSignal({ first: 900, last: 1001, hasAfter: false, revision: 1 });
  let release!: () => void;
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string }, _signal?: AbortSignal) => {
    if (read.mock.calls.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return { ...source, leaf_id: query.leaf_id, events: [current] };
  });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: source, read, get interval() { return interval(); } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => read.mock.calls.length === 1);
  expect(reading.initialReady()).toBe(false);
  for (let index = 0; index < 50; index++) setInterval({ first: 901 + index, last: 1002 + index, hasAfter: false, revision: 1 });
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][2]?.aborted).toBe(false);
  release();
  await waitFor(() => !reading.busy());
  expect(read).toHaveBeenCalledTimes(1);
  expect(reading.initialReady()).toBe(true);
  expect(reading.failed()).toBe(false);
  expect(reading.events().map(value => value.id)).toEqual(['tail']);
});

it('recovers a transient expanded report read without another user action', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const events = { thread_id: 'parent', events: [event('report')], first_event_id: 'report', last_event_id: 'report' };
  const read = vi.fn(async () => {
    if (read.mock.calls.length === 1) throw Object.assign(new Error('Connection interrupted'), { code: 'connection_closed' });
    return { ...events, events: [{ ...event('report'), message: 'Recovered report' }] };
  });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: events, read }); return null; }, host);
  const release = reading.retainBody('report');
  onTestFinished(() => { release(); dispose(); host.remove(); });
  await waitFor(() => reading.bodyState('report') === 'ready');
  expect(read).toHaveBeenCalledTimes(2);
  expect(reading.events()[0].message).toBe('Recovered report');
});

it('does not retry a denied report or a collapsed transient request', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const events = { thread_id: 'parent', events: [event('report')], first_event_id: 'report', last_event_id: 'report' };
  let status = 403;
  const read = vi.fn(async () => { throw Object.assign(new Error('Read unavailable'), { status }); });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: events, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const release = reading.retainBody('report');
  await waitFor(() => reading.bodyState('report') === 'failed');
  expect(read).toHaveBeenCalledTimes(1);
  release(); status = 503;
  const releaseAgain = reading.retainBody('report');
  await waitFor(() => read.mock.calls.length === 2);
  releaseAgain();
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(read).toHaveBeenCalledTimes(2);
});

it('expands the original report in place without repeating its preview', async () => {
  await page.viewport(700, 850);
  const host = document.createElement('div'); host.style.width = '620px'; document.body.append(host);
  const message = 'Verified source dates\n' + 'Complete findings with original formatting.\n'.repeat(12);
  const onDisclosureClick = vi.fn();
  const dispose = render(() => <ParentEventRow event={{ ...event('report'), message }} copy={copy}
    sourceName="Research" canOpenSource onOpenSource={() => {}} onDisclosureClick={onDisclosureClick} />, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const disclosure = host.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
  const content = document.getElementById(disclosure.getAttribute('aria-controls')!);
  expect(content).not.toBeNull();
  expect(content!.textContent).toBe(message);
  const collapsed = content!.getBoundingClientRect();
  expect(content!.scrollHeight).toBeGreaterThan(collapsed.height);
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  disclosure.click(); disclosure.focus();
  expect(document.getElementById(disclosure.getAttribute('aria-controls')!)).toBe(content);
  expect(host.textContent!.split('Verified source dates')).toHaveLength(2);
  expect(content!.getBoundingClientRect().top).toBe(collapsed.top);
  expect(content!.getBoundingClientRect().height).toBeGreaterThan(collapsed.height);
  expect(content!.scrollHeight).toBeLessThanOrEqual(content!.clientHeight + 1);
  expect(getComputedStyle(content!).userSelect).toBe('text');
  const actions = host.querySelector<HTMLElement>('.flower-parent-event-actions')!;
  expect(actions.getBoundingClientRect().top).toBeGreaterThanOrEqual(content!.getBoundingClientRect().bottom);
  expect(onDisclosureClick).toHaveBeenLastCalledWith(content);
  expect(document.activeElement).toBe(disclosure);
  await page.screenshot({ element: host, path: '__screenshots__/parent-events/expanded-in-place.png' });
  disclosure.click();
  expect(document.getElementById(disclosure.getAttribute('aria-controls')!)).toBe(content);
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  expect(content!.getBoundingClientRect().height).toBe(collapsed.height);
  expect(host.textContent!.split('Verified source dates')).toHaveLength(2);
  expect(onDisclosureClick).toHaveBeenLastCalledWith(disclosure);
});

it.each(['mouse', 'keyboard'] as const)('keeps the report start visible on %s expansion and the action stable on collapse', async input => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const message = 'Verified source dates\n' + 'Complete findings with original formatting.\n'.repeat(80);
  const events = { thread_id: 'parent', events: Array.from({ length: 41 }, (_, index) => ({
    ...event('event-' + index, index === 36 ? 'report' : 'completed'),
    received_at: new Date(Date.UTC(2026, 9, 16, 0, 0, index)).toISOString(),
    ...(index === 36 ? { message } : {}),
  })), first_event_id: 'event-0', last_event_id: 'event-40' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
  const base = liveBootstrap(parent, 1);
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => ({ ...base, current: { ...base.current, parent_events: events } })) },
  { focusThreadRequest: { request_id: 'focus-disclosure', thread_id: 'parent' } });
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event="event-36"] [data-parent-event-body]')));
  const viewport = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
  await waitFor(() => viewport.getAttribute('data-flower-tail-preparing') !== 'true');
  const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await settle();
  const row = runtime.querySelector<HTMLElement>('[data-parent-event="event-36"]')!;
  const content = row.querySelector<HTMLElement>('[data-parent-event-body]')!;
  const disclosure = row.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
  let contentTop = 0, actionTop = 0;
  const capturePosition = () => { contentTop = content.getBoundingClientRect().top; actionTop = disclosure.getBoundingClientRect().top; };
  disclosure.addEventListener(input === 'mouse' ? 'pointerdown' : 'keydown', capturePosition);
  const activate = async () => {
    if (input === 'mouse') await userEvent.click(disclosure);
    else { disclosure.focus(); await settle(); await userEvent.keyboard('{Enter}'); }
    await settle();
  };
  await activate();
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(Math.abs(content.getBoundingClientRect().top - contentTop)).toBeLessThanOrEqual(1);
  expect(content.getBoundingClientRect().top).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().top);
  expect(content.getBoundingClientRect().top).toBeLessThan(viewport.getBoundingClientRect().bottom);
  expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBeGreaterThan(100);
  expect(row.textContent!.split('Verified source dates')).toHaveLength(2);
  await activate();
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  expect(Math.abs(disclosure.getBoundingClientRect().top - actionTop)).toBeLessThanOrEqual(1);
  expect(document.activeElement).toBe(disclosure);
});

it('shows reports and terminal events with child avatars in the parent transcript before opening the dropdown', async () => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research', status: 'failed' });
  const events = { thread_id: 'parent', events: [event('report'), event('failed', 'failed')], first_event_id: 'report', last_event_id: 'failed' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
  const initial = liveBootstrap(parent, 1);
  const bootstrap = { ...initial, current: { ...initial.current, parent_events: events } };
  const read = vi.fn(async () => ({ thread_id: 'parent', first_event_id: 'report', last_event_id: 'report', events: [{ ...event('report'), message: 'Verified source dates\nComplete findings' }] }));
  const loadChild = vi.fn(async () => { throw new Error('Child details unavailable'); });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => bootstrap), readParentEvents: read, loadSubagentDetail: loadChild }, { focusThreadRequest: { request_id: 'focus-events', thread_id: 'parent' } });
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event="report"] .flower-parent-event-disclosure')));
  expect(read).not.toHaveBeenCalled();
  runtime.querySelector<HTMLButtonElement>('[data-parent-event="report"] .flower-parent-event-disclosure')!.click();
  await waitFor(() => runtime.querySelector('[data-parent-event="report"] [data-parent-event-body]')?.textContent?.includes('Verified source dates') === true);
  expect(runtime.querySelectorAll('.flower-transcript-stack [data-parent-event]')).toHaveLength(2);
  const avatars = [...runtime.querySelectorAll('[data-parent-event] [data-flower-subagent-avatar]')];
  expect(avatars).toHaveLength(2);
  expect(avatars[0].getAttribute('data-flower-subagent-avatar')).toBe(avatars[1].getAttribute('data-flower-subagent-avatar'));
  expect(runtime.textContent).not.toContain(copy.events.admitted);
  expect(runtime.textContent).not.toContain(copy.events.received);
  await page.screenshot({ element: runtime, path: '__screenshots__/parent-events/transcript.png' });
  runtime.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-subagents-dropdown')));
  expect(document.querySelector('.flower-subagents-dropdown [data-parent-event]')).toBeNull();
  expect(document.querySelector('.flower-subagents-dropdown [data-flower-subagent-avatar]')?.getAttribute('data-flower-subagent-avatar')).toBe(avatars[0].getAttribute('data-flower-subagent-avatar'));
  runtime.querySelector<HTMLButtonElement>('[data-parent-event="failed"] .flower-parent-event-open')!.click();
  await waitFor(() => loadChild.mock.calls.length > 0);
});

it('preserves the mounted report, expansion and keyboard focus across canonical current updates', async () => {
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const events = { thread_id: 'parent', events: [event('report')], first_event_id: 'report', last_event_id: 'report' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
  const base = liveBootstrap(parent, 1);
  const current = { ...base.current, parent_events: events };
  const queued: FlowerLiveStreamEnvelope[] = [{ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [parent] }];
  let wake: (() => void) | undefined;
  const connectLiveStream = async function* ({ signal }: { signal: AbortSignal }): AsyncIterable<FlowerLiveStreamEnvelope> {
    while (!signal.aborted) {
      const next = queued.shift();
      if (next) { yield next; continue; }
      await new Promise<void>(resolve => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
    }
  };
  const read = vi.fn(async () => ({ ...events, events: [{ ...event('report'), message: 'Verified finding\nComplete report' }] }));
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), connectLiveStream, listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => ({ ...base, current })), readParentEvents: read },
  { focusThreadRequest: { request_id: 'focus-live-events', thread_id: 'parent' } });
  await waitFor(() => Boolean(runtime.querySelector('.flower-parent-event-disclosure')));
  const row = runtime.querySelector('[data-parent-event="report"]')!;
  const disclosure = row.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
  disclosure.click(); disclosure.focus();
  await waitFor(() => row.querySelector('[data-parent-event-body]')?.textContent === 'Verified finding\nComplete report');
  const body = row.querySelector('[data-parent-event-body]');
  queued.push({ schema_version: 3, kind: 'thread.batch', thread_id: 'parent', current: { ...current, view_version: 2,
    parent_events: { ...events, events: [{ ...event('report'), admitted: true }, event('completed', 'completed')], last_event_id: 'completed' } } });
  wake?.();
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event="completed"]')));
  expect(runtime.querySelector('[data-parent-event="report"]')).toBe(row);
  expect(row.querySelector('[data-parent-event-body]')).toBe(body);
  expect(body?.textContent).toBe('Verified finding\nComplete report');
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(disclosure);
});

it('reads only demanded Unicode reports and retains them through admission updates', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const first = event('first'), last = event('last');
  const [value, setValue] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', events: [first], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id });
  const message = '核验摘要\n' + '界'.repeat(2700);
  const read = vi.fn(async (_thread: string, query: { event_id?: string; after_event_id?: string }) => query.event_id
    ? { thread_id: 'parent', events: [{ ...first, message }], first_event_id: first.id, last_event_id: first.id }
    : { thread_id: 'parent', events: [last], first_event_id: first.id, last_event_id: last.id });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return value(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const release = reading.retainBody('first');
  await waitFor(() => reading.events()[0].message === message);
  await reading.more();
  expect(read.mock.calls.at(-1)?.[1]).toEqual({ action: 'list', after_event_id: 'first', limit: 50 });
  expect(reading.events()).toHaveLength(2);
  setValue({ ...value(), events: [{ ...first, admitted: true }] });
  expect(reading.events()).toHaveLength(2);
  expect(read).toHaveBeenCalledTimes(2);
  expect(reading.events()[0].message).toBe(message);
  release();
});

it('cancels a collapsed report and ignores its late response after reopening', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const events = { thread_id: 'parent', events: [event('first')], first_event_id: 'first', last_event_id: 'first' };
  const pending: { signal: AbortSignal; resolve: (value: FlowerParentEventPage) => void }[] = [];
  const read = vi.fn((_thread: string, _query: unknown, signal?: AbortSignal) => new Promise<FlowerParentEventPage>(resolve => pending.push({ signal: signal!, resolve })));
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: events, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const first = reading.retainBody('first');
  await waitFor(() => pending.length === 1);
  first();
  expect(pending[0].signal.aborted).toBe(true);
  const second = reading.retainBody('first');
  await waitFor(() => pending.length === 2);
  pending[1].resolve({ ...events, events: [{ ...event('first'), message: 'Current report' }] });
  await waitFor(() => reading.events()[0].message === 'Current report');
  pending[0].resolve({ ...events, events: [{ ...event('first'), message: 'Abandoned report' }] });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(reading.events()[0].message).toBe('Current report');
  second();
});

it('ignores a late body after changing the parent and retries demanded details on reconnection', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [id, setID] = createSignal('parent');
  const [epoch, setEpoch] = createSignal(1);
  const [value, setValue] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', events: [event('first')], first_event_id: 'first', last_event_id: 'first' });
  let resolve!: (page: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(done => { resolve = done; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ thread_id: 'other', events: [{ ...event('second'), parent_thread_id: 'other', message: 'Other report' }], first_event_id: 'second', last_event_id: 'second' });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => {
    reading = createParentEventReading({ get threadID() { return id(); }, get page() { return value(); }, get connectionEpoch() { return epoch(); }, read });
    createEffect(() => { epoch(); const release = reading.retainBody(id() === 'parent' ? 'first' : 'second'); onCleanup(release); });
    return null;
  }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => read.mock.calls.length === 1);
  setID('other');
  setValue({ thread_id: 'other', events: [{ ...event('second'), parent_thread_id: 'other' }], first_event_id: 'second', last_event_id: 'second' });
  await waitFor(() => reading.bodyState('second') === 'failed');
  resolve({ thread_id: 'parent', events: [{ ...event('first'), message: 'Stale report' }] });
  await Promise.resolve();
  expect(reading.events().some(event => event.message === 'Stale report')).toBe(false);
  setEpoch(2);
  await waitFor(() => reading.events()[0]?.message === 'Other report');
  expect(reading.bodyState('second')).toBe('ready');
});

it('keeps report actions readable and non-overlapping in every shipped locale', async () => {
  await page.viewport(320, 780);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = { ...copy, events: (await loadEnvAppDictionary(locale)).flowerSurface.subagents.events };
    const host = document.createElement('div'); host.style.width = '292px'; document.body.append(host);
    const dispose = render(() => <ParentEventRow event={{ ...event('localized'), message: 'Finding\nComplete report' }}
      copy={localized} sourceName="Research" canOpenSource onOpenSource={() => {}} onDisclosureClick={() => {}} />, host);
    try {
      const disclosure = host.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
      const action = host.querySelector<HTMLElement>('.flower-parent-event-report .flower-parent-event-open')!;
      for (const expanded of [false, true]) {
        if (expanded) disclosure.click();
        const a = disclosure.getBoundingClientRect(), b = action.getBoundingClientRect();
        expect(a.right <= b.left || a.bottom <= b.top, locale).toBe(true);
        expect(host.scrollWidth, locale).toBeLessThanOrEqual(host.clientWidth + 1);
      }
    } finally { dispose(); host.remove(); }
  }
});

for (const theme of ['light', 'dark']) it('keeps report actions inline and event avatars consistent on a narrow ' + theme + ' surface', async () => {
  await page.viewport(380, 780);
  document.documentElement.classList.add(theme);
  onTestFinished(() => document.documentElement.classList.remove(theme));
  const host = document.createElement('div'); host.style.width = '320px'; document.body.append(host);
  const dispose = render(() => <>
    <ParentEventRow event={{ ...event('report'), message: 'A verified finding\n' + 'Complete report '.repeat(500) }} copy={copy} sourceName="Power Research Verification" canOpenSource onOpenSource={() => {}} onDisclosureClick={() => {}} />
    <ParentEventRow event={event('failed', 'failed')} copy={copy} sourceName="Power Research Verification" canOpenSource onOpenSource={() => {}} onDisclosureClick={() => {}} />
  </>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const disclosure = host.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
  const action = host.querySelector<HTMLElement>('.flower-parent-event-report .flower-parent-event-open')!;
  const a = disclosure.getBoundingClientRect(), b = action.getBoundingClientRect();
  expect(Math.abs((a.top + a.height / 2) - (b.top + b.height / 2))).toBeLessThan(2);
  expect(a.right).toBeLessThan(b.left);
  expect(getComputedStyle(action).cursor).toBe('pointer');
  const status = host.querySelector<HTMLElement>('.flower-parent-event-status')!.getBoundingClientRect();
  const eventAction = host.querySelector<HTMLElement>('[data-parent-event="failed"] .flower-parent-event-open')!.getBoundingClientRect();
  expect(Math.abs((status.top + status.height / 2) - (eventAction.top + eventAction.height / 2))).toBeLessThan(2);
  disclosure.click();
  expect(host.querySelector('[data-parent-event-body]')?.textContent?.length).toBeGreaterThan(7000);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
  disclosure.click();
  await page.screenshot({ element: host, path: '__screenshots__/parent-events/' + theme + '.png' });
});


it.each([['zh-CN', 320, 'light'], ['zh-CN', 390, 'dark'], ['en-US', 1100, 'light'], ['ja-JP', 320, 'dark']] as const)(
  'keeps report tools static and vertically aligned in %s at %s px (%s)', async (locale, width, theme) => {
    await page.viewport(width, 850);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    onTestFinished(() => document.documentElement.classList.remove('dark'));
    const i18n = createTestI18nHelpers(locale);
    const localized = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const items = ['read', 'list'].map((action, index) => activityItem({ item_id: action, tool_id: action, tool_name: 'subagent_events', renderer: 'structured', label: action,
      started_at_unix_ms: 1000, ended_at_unix_ms: 1250,
      payload: { operation: action, rows_provided: true, inputs: [{ title: 'action', content: action, format: 'text' }] },
      target_refs: (index ? ['child-a'] : ['child-a', 'child-a', 'child-b']).map(id => ({ kind: 'subagent', label: id, resource_ref: id })),
    }));
    const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child-a', task_name: 'Research' });
    const seed = thread({ thread_id: 'parent', subagents: [child, subagentSummary({ parent_thread_id: 'parent', thread_id: 'unrelated' })], messages: [{
      id: 'tools', turn_id: 'turn-tools', run_id: 'run-tools', role: 'assistant', status: 'complete', content: '', created_at_ms: 1,
      blocks: [activityTimeline({ thread_id: 'parent', turn_id: 'turn-tools', run_id: 'run-tools', items })],
    }] });
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed) }, { copy: localized,
      focusThreadRequest: { request_id: 'report-rows', thread_id: seed.thread_id } });
    surface.style.cssText = 'width:' + width + 'px;height:800px;position:relative;';
    await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="read"]')));
    for (const action of ['read', 'list']) {
      const row = surface.querySelector<HTMLElement>('[data-flower-activity-item-id="' + action + '"]')!;
      expect(row.querySelector('button, [aria-expanded], .flower-activity-inline-chevron, .flower-activity-inline-details, .flower-activity-inline-detail')).toBeNull();
      expect(row.querySelectorAll('[data-flower-report-source]')).toHaveLength(action === 'read' ? 2 : 1);
      expect(row.querySelector('[data-flower-report-source="unrelated"]')).toBeNull();
      const title = row.querySelector<HTMLElement>('.flower-activity-inline-title')!;
      expect(title.textContent).toBe(action === 'read' ? localized.chat.toolActivity.subagentReportsRead : localized.chat.toolActivity.subagentReportsList);
      const box = title.getBoundingClientRect();
      for (const avatar of row.querySelectorAll('[data-flower-subagent-avatar]')) {
        const rect = avatar.getBoundingClientRect();
        expect(Math.abs(rect.top + rect.height / 2 - box.top - box.height / 2)).toBeLessThan(1);
      }
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
      expect(getComputedStyle(row.querySelector('.flower-activity-inline-button')!).cursor).toBe('default');
      row.querySelector<HTMLElement>('.flower-activity-inline-button')!.click();
      expect(row.querySelector('.flower-activity-inline-details')).toBeNull();
    }
    await page.screenshot({ element: surface, path: '__screenshots__/parent-events/tool-rows-' + locale + '-' + width + '-' + theme + '.png' });
  },
);


it('shows report-read failures inline without making the compact row expandable', async () => {
  const failed = activityItem({ item_id: 'report-error', tool_id: 'report-error', tool_name: 'subagent_events', renderer: 'structured', status: 'error', label: 'read', payload: { error: { message: 'Report access was revoked.' } } });
  const seed = thread({ thread_id: 'report-error-parent', messages: [{ id: 'error-tools', turn_id: 'turn', run_id: 'run', role: 'assistant', status: 'complete', content: '', created_at_ms: 1,
    blocks: [activityTimeline({ thread_id: 'report-error-parent', turn_id: 'turn', run_id: 'run', items: [failed] })] }] });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed) }, {
    focusThreadRequest: { request_id: 'report-error-focus', thread_id: seed.thread_id } });
  await waitFor(() => Boolean(surface.querySelector('[data-flower-activity-item-id="report-error"] .flower-activity-error-message')));
  const row = surface.querySelector('[data-flower-activity-item-id="report-error"]')!;
  expect(row.querySelector('.flower-activity-error-message')?.textContent).toBe('Report access was revoked.');
  expect(row.querySelector('[aria-expanded], .flower-activity-inline-chevron, .flower-activity-inline-details')).toBeNull();
});

it.each([false, true])('locates the canonical parent report from its accepted child receipt with folded work: %s', async (folded) => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const events = { thread_id: 'parent', events: [{ ...event('receipt-event'), parent_turn_id: folded ? 'parent-turn' : undefined, message: 'Verified finding' }], first_event_id: 'receipt-event', last_event_id: 'receipt-event' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events, turns: [{
    turn_id: 'parent-turn', run_id: 'parent-run', started_at: '2026-10-15T23:59:58Z', ended_at: '2026-10-15T23:59:59Z',
    outcome: 'completed', elapsed_ms: 1000, waiting_ms: 0, work_duration_ms: 1000, final_item_ids: [], final_boundary_complete: false,
  }] });
  const base = liveBootstrap(parent, 1);
  const childCurrent = { thread_id: 'child', view_version: 1, activity: 'idle' as const, last_outcome: 'completed' as const, items: [{
    id: 'submitted-report', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1, kind: 'tool' as const,
    activity: { item_id: 'submitted-report', tool_id: 'report-call', tool_name: 'report_to_parent', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      presentation: { renderer: 'structured', target_refs: [{ kind: 'parent_event', label: 'parent', resource_ref: 'receipt-event' }], payload: { inputs: [{ title: 'message', content: 'Verified finding', format: 'text' }], rows_provided: true } } },
  }] };
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent], loadThread: async () => ({ ...base, current: { ...base.current, parent_events: events } }),
    loadSubagentDetail: async () => ({ summary: child, current: childCurrent }) }, { focusThreadRequest: { request_id: 'receipt-parent', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-flower-row-event-id="receipt-event"]')));
  const report = () => surface.querySelector<HTMLElement>('[data-parent-event="receipt-event"]')!;
  if (folded) {
    expect(surface.querySelector('[data-flower-row-event-id="receipt-event"] .flower-turn-row-viewport[inert]')).not.toBeNull();
    surface.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-row]')!.click();
  } else report().querySelector<HTMLButtonElement>('.flower-parent-event-source')!.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-activity-item-id="submitted-report"]')));
  const row = document.querySelector('[data-flower-activity-item-id="submitted-report"]')!;
  expect(row.querySelector('.flower-activity-inline-title')?.textContent).toBe('Report to parent task');
  expect(row.querySelector('.flower-activity-inline-detail')?.textContent).toBe('Accepted');
  row.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!.click();
  await waitFor(() => row.textContent!.includes('The report was recorded in the parent task.'));
  const view = [...row.querySelectorAll('button')].find(button => button.textContent === 'View report in parent task')!;
  expect(view).toBeTruthy();
  expect(row.textContent!.split('Verified finding')).toHaveLength(2);
  view.click();
  await waitFor(() => surface.querySelector('[data-parent-event="receipt-event"] .flower-parent-event-disclosure')?.getAttribute('aria-expanded') === 'true');
  if (folded) {
    await waitFor(() => report()?.closest('.flower-turn-row-viewport')?.getAttribute('data-state') === 'open');
    await waitFor(() => document.querySelector('[data-flower-subagent-detail="open"]') === null);
    expect(surface.querySelector('.flower-turn-summary-button')?.getAttribute('aria-expanded')).toBe('true');
    expect(report().closest('[inert], [aria-hidden="true"]')).toBeNull();
    expect(report().getBoundingClientRect().height).toBeGreaterThan(0);
    expect(document.activeElement).toBe(report().querySelector('.flower-parent-event-disclosure'));
  }
});

it('continues parent events by scrolling without a load-more button', async () => {
  await page.viewport(1100, 850);
  const events = { thread_id: 'parent', events: [event('first', 'completed')], first_event_id: 'first', last_event_id: 'last', next_after_event_id: 'first' };
  const parent = thread({ thread_id: 'parent', parent_events: events });
  const initial = liveBootstrap(parent, 1);
  const read = vi.fn(async () => ({ thread_id: 'parent', events: [event('last', 'completed')], first_event_id: 'first', last_event_id: 'last' }));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => ({ ...initial, current: { ...initial.current, parent_events: events } })), readParentEvents: read },
    { focusThreadRequest: { request_id: 'continuous-events', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="first"]')));
  expect([...surface.querySelectorAll('button')].some(button => button.textContent?.trim() === copy.events.more)).toBe(false);
  const viewport = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
  viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="last"]')));
  expect(read).toHaveBeenCalledTimes(1);
});

it('bounds retained parent events and returns to evicted earlier events', async () => {
  const all = Array.from({ length: 500 }, (_, index) => ({ ...event('receipt-' + index, 'completed'), canonical_ordinal: index * 3 + 1 }));
  const result = (start: number, end: number): FlowerParentEventPage => ({ thread_id: 'parent', first_event_id: all[0].id, last_event_id: all.at(-1)!.id,
    events: all.slice(start, end), ...(start > 0 ? { previous_before_event_id: all[start].id } : {}), ...(end < all.length ? { next_after_event_id: all[end - 1].id } : {}) });
  const host = document.createElement('div'); document.body.append(host);
  const read = vi.fn(async (_thread: string, query: { after_event_id?: string; before_event_id?: string }) => {
    const before = query.before_event_id ? all.findIndex(row => row.id === query.before_event_id) : undefined;
    const start = before !== undefined ? Math.max(0, before - 50) : all.findIndex(row => row.id === query.after_event_id) + 1;
    return result(start, before ?? Math.min(all.length, start + 50));
  });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: result(0, 50), read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  for (let index = 0; index < 9; index++) {
    await reading.more();
    expect(reading.events().length).toBeLessThanOrEqual(150);
    expect(reading.gaps()).toHaveLength(0);
  }
  expect(reading.events().at(-1)?.id).toBe(all.at(-1)!.id);
  expect(reading.beforeCursor()).toBe('receipt-350');
  for (let index = 0; index < 7; index++) {
    await reading.previous();
    expect(reading.events().length).toBeLessThanOrEqual(150);
    expect(reading.gaps()).toHaveLength(0);
  }
  expect(reading.events()[0].id).toBe('receipt-0');
  expect(reading.cursor()).toBe('receipt-149');
  const reads = read.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(read).toHaveBeenCalledTimes(reads);
});

it('ignores a superseded parent page after switching threads', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [id, setID] = createSignal('parent');
  const [source, setSource] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', events: [event('first')], first_event_id: 'first', last_event_id: 'last', next_after_event_id: 'first' });
  let resolve!: (page: FlowerParentEventPage) => void;
  let aborted = false;
  const read = vi.fn((_thread: string, _query: unknown, signal?: AbortSignal) => new Promise<FlowerParentEventPage>(done => { resolve = done; signal?.addEventListener('abort', () => { aborted = true; }); }));
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ get threadID() { return id(); }, get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const pending = reading.more();
  await waitFor(() => read.mock.calls.length === 1);
  setID('other'); setSource({ thread_id: 'other', events: [] });
  resolve({ thread_id: 'parent', events: [event('last')], first_event_id: 'first', last_event_id: 'last' });
  await pending;
  expect(aborted).toBe(true);
  expect(reading.events()).toHaveLength(0);
});

it('keeps an evicted-history tail mounted when an unrelated early receipt updates', async () => {
  const all = Array.from({ length: 400 }, (_, index) => ({ ...event('receipt-' + index, 'completed'), canonical_ordinal: index + 1 }));
  const result = (start: number, end: number): FlowerParentEventPage => ({ thread_id: 'parent', first_event_id: all[0].id, last_event_id: all.at(-1)!.id,
    events: all.slice(start, end), ...(start > 0 ? { previous_before_event_id: all[start].id } : {}), ...(end < all.length ? { next_after_event_id: all[end - 1].id } : {}) });
  const host = document.createElement('div'); document.body.append(host);
  const [source, setSource] = createSignal(result(0, 50));
  const read = vi.fn(async (_thread: string, query: { after_event_id?: string }) => { const start = all.findIndex(row => row.id === query.after_event_id) + 1; return result(start, Math.min(all.length, start + 50)); });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  for (let i = 0; i < 7; i++) await reading.more();
  setSource({ ...source(), events: source().events.map(event => ({ ...event, admitted: true })) });
  expect(reading.events().map(event => event.id)).toEqual(all.slice(-150).map(event => event.id));
  expect(reading.cursor()).toBe('');
  all.push({ ...event('receipt-400', 'completed'), canonical_ordinal: 401 });
  setSource(result(0, 50));
  expect(reading.events().map(event => event.id)).toEqual(all.slice(250, 400).map(event => event.id));
  expect(reading.cursor()).toBe('receipt-399');
});

it('preserves the visible receipt anchor while prepending by ordinary upward scroll', async () => {
  await page.viewport(1100, 850);
  const all = Array.from({ length: 180 }, (_, i) => ({ ...event('anchor-' + i, 'completed'), canonical_ordinal: i + 1 }));
  const result = (start: number, end: number): FlowerParentEventPage => ({ thread_id: 'parent', events: all.slice(start, end), first_event_id: all[0].id, last_event_id: all.at(-1)!.id,
    ...(start > 0 ? { previous_before_event_id: all[start].id } : {}), ...(end < all.length ? { next_after_event_id: all[end - 1].id } : {}) });
  const events = result(130, 180);
  const parent = thread({ thread_id: 'parent', parent_events: events });
  const initial = liveBootstrap(parent, 1);
  const read = vi.fn(async (_thread: string, query: { before_event_id?: string }) => {
    const end = all.findIndex(event => event.id === query.before_event_id);
    return result(Math.max(0, end - 50), end);
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => ({ ...initial, current: { ...initial.current, parent_events: events } })), readParentEvents: read },
    { focusThreadRequest: { request_id: 'receipt-anchor', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="anchor-179"]')));
  const viewport = surface.querySelector<HTMLElement>('.flower-chat-transcript')!;
  viewport.style.height = '420px'; viewport.style.maxHeight = '420px'; viewport.style.overflowY = 'auto';
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
  viewport.scrollTop = 200; viewport.dispatchEvent(new Event('scroll'));
  const bounds = viewport.getBoundingClientRect();
  const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-parent-event]')].find(row => row.getBoundingClientRect().top >= bounds.top)!;
  const top = anchor.getBoundingClientRect().top;
  await new Promise(resolve => setTimeout(resolve, 180));
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="anchor-80"]')));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(Math.abs(anchor.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
  expect(read).toHaveBeenCalledTimes(1);
});

it('keeps the child destination hidden until receipt alignment finishes', async () => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const parentEvents = { thread_id: 'parent', events: [event('open-child', 'completed')], first_event_id: 'open-child', last_event_id: 'open-child' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: parentEvents });
  const initial = liveBootstrap(parent, 1);
  const first = { ...event('child-first', 'completed'), parent_thread_id: 'child', canonical_ordinal: 1 };
  const last = { ...event('child-last', 'completed'), parent_thread_id: 'child', canonical_ordinal: 1000 };
  const childEvents = { thread_id: 'child', leaf_id: 'child-leaf', events: [first], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id };
  let finish!: (page: FlowerParentEventPage) => void;
  const read = vi.fn(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; }));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent],
    loadHistory: async () => ({ ...initial, current: { ...initial.current, parent_events: parentEvents } }),
    readParentEvents: read,
    loadSubagentDetail: async () => ({ summary: child, current: { thread_id: 'child', view_version: 1,
      activity: 'idle', last_outcome: 'completed', items: [{ id: 'child-text', kind: 'assistant', turn_id: 'child-turn', run_id: 'child-run',
        ordinal: 1, canonical_ordinal: 950, text: 'The final child message' }], parent_events: childEvents },
      window: { first_item_id: 'child-text', last_item_id: 'child-text', has_before: true, has_after: false } }),
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'child-receipt-observer', summaries: [parent] };
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    },
  }, { focusThreadRequest: { request_id: 'child-receipt-readiness', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="open-child"] .flower-parent-event-open')));
  surface.querySelector<HTMLButtonElement>('[data-parent-event="open-child"] .flower-parent-event-open')!.click();
  await waitFor(() => read.mock.calls.length === 1 && Boolean(document.querySelector('[data-flower-message-id="child-text"]')));
  const message = document.querySelector<HTMLElement>('[data-flower-message-id="child-text"]')!;
  const viewport = document.querySelector<HTMLElement>('.flower-subagent-detail-transcript')!;
  expect(message.checkVisibility({ visibilityProperty: true })).toBe(false);
  expect(message.closest('[inert]')).not.toBeNull();
  finish({ ...childEvents, events: [last], next_after_event_id: undefined, previous_before_event_id: last.id });
  await waitFor(() => message.checkVisibility({ visibilityProperty: true }) && !message.closest('[inert]'));
  expect(message.isConnected).toBe(true);
  expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBeLessThanOrEqual(1);
  const top = message.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(Math.abs(message.getBoundingClientRect().top - viewport.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
});

it.each(['complete', 'close'] as const)('owns child destination body reads through %s', async (outcome) => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const parentEvents = { thread_id: 'parent', events: [event('open-child', 'completed')], first_event_id: 'open-child', last_event_id: 'open-child' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: parentEvents });
  const initial = liveBootstrap(parent, 1);
  const item: FlowerRuntimeCurrentItem = { id: 'child-body', kind: 'assistant', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1,
    text: 'The com', body: { field: 'content', source_id: 'child-body', bytes: 23, preview_bytes: 7 } };
  let finish!: (item: FlowerRuntimeCurrentItem) => void;
  let bodySignal: AbortSignal | undefined;
  const read = vi.fn((_thread: string, _item: string, signal: AbortSignal) => {
    bodySignal = signal;
    return new Promise<FlowerRuntimeCurrentItem>(resolve => { finish = resolve; });
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent],
    loadHistory: async () => ({ ...initial, current: { ...initial.current, parent_events: parentEvents } }),
    loadHistoryItem: read,
    loadSubagentDetail: async () => ({ summary: child, current: { thread_id: 'child', view_version: 1,
      activity: 'idle', last_outcome: 'completed', items: [item] },
      window: { first_item_id: item.id, last_item_id: item.id, has_before: false, has_after: false } }),
  }, { focusThreadRequest: { request_id: 'child-body-readiness-' + outcome, thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="open-child"] .flower-parent-event-open')));
  surface.querySelector<HTMLButtonElement>('[data-parent-event="open-child"] .flower-parent-event-open')!.click();
  await waitFor(() => read.mock.calls.length === 1);
  expect(read.mock.calls[0].slice(0, 2)).toEqual(['child', item.id]);
  const panel = document.querySelector<HTMLElement>('[data-flower-subagent-detail="open"]')!;
  const message = panel.querySelector<HTMLElement>('[data-flower-message-id="child-body"]')!;
  expect(message.checkVisibility({ visibilityProperty: true })).toBe(false);
  expect(message.closest('[inert]')).not.toBeNull();
  if (outcome === 'close') {
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => bodySignal?.aborted === true);
  }
  finish({ ...item, body: undefined, text: 'The complete child body' });
  if (outcome === 'complete') {
    await waitFor(() => Boolean(panel.textContent?.includes('The complete child body')) && message.checkVisibility({ visibilityProperty: true }) && !message.closest('[inert]'));
    expect(panel.querySelector('.flower-subagent-detail-loading')).toBeNull();
  } else {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await waitFor(() => document.querySelector('[data-flower-subagent-detail="open"]') === null);
  }
  expect(read).toHaveBeenCalledTimes(1);
});

it('shows child receipt failure outside the hidden preparing transcript', async () => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const parentEvents = { thread_id: 'parent', events: [event('open-child', 'completed')], first_event_id: 'open-child', last_event_id: 'open-child' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: parentEvents });
  const initial = liveBootstrap(parent, 1);
  const first = { ...event('child-first', 'completed'), parent_thread_id: 'child', canonical_ordinal: 1 };
  const read = vi.fn(async () => { throw Object.assign(new Error('Read denied'), { status: 403 }); });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent],
    loadHistory: async () => ({ ...initial, current: { ...initial.current, parent_events: parentEvents } }),
    readParentEvents: read,
    loadSubagentDetail: async () => ({ summary: child, current: { thread_id: 'child', view_version: 1, activity: 'idle',
      items: [{ id: 'child-text', kind: 'assistant', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1, canonical_ordinal: 950, text: 'A child message' }],
      parent_events: { thread_id: 'child', leaf_id: 'leaf', events: [first], first_event_id: first.id, last_event_id: 'last', next_after_event_id: first.id } },
      window: { first_item_id: 'child-text', last_item_id: 'child-text', has_before: true, has_after: false } }),
  }, { focusThreadRequest: { request_id: 'child-receipt-failure', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="open-child"] .flower-parent-event-open')));
  surface.querySelector<HTMLButtonElement>('[data-parent-event="open-child"] .flower-parent-event-open')!.click();
  await waitFor(() => read.mock.calls.length === 1 && Boolean(document.querySelector('[data-flower-subagent-detail="open"] .flower-parent-event-reading')));
  const notice = document.querySelector<HTMLElement>('[data-flower-subagent-detail="open"] .flower-parent-event-reading')!;
  expect(notice.checkVisibility({ visibilityProperty: true })).toBe(true);
  expect(notice.closest('[inert]')).toBeNull();
  expect(notice.textContent).toContain(copy.events.readFailed);
});

it('reads nested child reports with the child owner and cancels them when its panel closes', async () => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const parentEvents = { thread_id: 'parent', events: [event('open-child', 'completed')], first_event_id: 'open-child', last_event_id: 'open-child' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: parentEvents });
  const initial = liveBootstrap(parent, 1);
  const receipt = { ...event('nested-report'), parent_thread_id: 'child', source_thread_id: 'grandchild' };
  const childEvents = { thread_id: 'child', events: [receipt], first_event_id: receipt.id, last_event_id: receipt.id };
  let detailSignal: AbortSignal | undefined;
  const read = vi.fn(async (threadID: string, _query: unknown, signal?: AbortSignal) => {
    expect(threadID).toBe('child');
    detailSignal = signal;
    return new Promise<FlowerParentEventPage>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent],
    loadThread: async () => ({ ...initial, current: { ...initial.current, parent_events: parentEvents } }),
    readParentEvents: read,
    loadSubagentDetail: async () => ({ summary: child, current: { thread_id: 'child', view_version: 1,
      activity: 'idle', last_outcome: 'completed', items: [], parent_events: childEvents } }),
  }, { focusThreadRequest: { request_id: 'nested-receipt', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="open-child"] .flower-parent-event-open')));
  surface.querySelector<HTMLButtonElement>('[data-parent-event="open-child"] .flower-parent-event-open')!.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"] [data-parent-event="nested-report"]')));
  const panel = document.querySelector<HTMLElement>('[data-flower-subagent-detail="open"]')!;
  expect(read).not.toHaveBeenCalled();
  panel.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!.click();
  await waitFor(() => read.mock.calls.length === 1);
  expect(detailSignal?.aborted).toBe(false);
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => document.querySelector('[data-flower-subagent-detail="open"]') === null);
  await waitFor(() => detailSignal?.aborted === true);
});

it('revalidates retained receipt status outside the default page when its source advances', async () => {
  const all = Array.from({ length: 250 }, (_, i) => ({ ...event('receipt-' + i, 'completed'), canonical_ordinal: i + 1 }));
  let leaf = 'leaf-1';
  const result = (values: typeof all): FlowerParentEventPage => ({ thread_id: 'parent', leaf_id: leaf,
    first_event_id: all[0].id, last_event_id: all.at(-1)!.id, events: values,
    ...(values[0]?.id !== all[0].id ? { previous_before_event_id: values[0].id } : {}),
    ...(values.at(-1)?.id !== all.at(-1)!.id ? { next_after_event_id: values.at(-1)!.id } : {}) });
  const initial = result(all.slice(0, 50));
  const [source, setSource] = createSignal(initial);
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string; after_event_id?: string; after_ordinal?: number; before_ordinal?: number; limit?: number }) => {
    expect(query.leaf_id).toBe(leaf);
    if (query.after_ordinal !== undefined) return result(all.filter(item => item.canonical_ordinal > query.after_ordinal!
      && (!query.before_ordinal || item.canonical_ordinal < query.before_ordinal)).slice(-query.limit!));
    const start = all.findIndex(item => item.id === query.after_event_id) + 1;
    return result(all.slice(start, start + 50));
  });
  const host = document.createElement('div'); document.body.append(host);
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  for (let i = 0; i < 4; i++) await reading.more();
  expect(reading.events().map(item => item.id)).toEqual(all.slice(100).map(item => item.id));
  all[200] = { ...all[200], admitted: true };
  leaf = 'leaf-2'; setSource(result(all.slice(0, 50)));
  await waitFor(() => reading.events().find(item => item.id === 'receipt-200')?.admitted === true);
  expect(reading.events().map(item => item.id)).toEqual(all.slice(100).map(item => item.id));
  expect(read.mock.calls.filter(([, query]) => query.leaf_id === 'leaf-2')).toHaveLength(2);
});

it('finishes an accepted receipt refresh while newer source notifications coalesce', async () => {
  const all = Array.from({ length: 60 }, (_, i) => ({ ...event('coalesce-' + i, 'completed'), canonical_ordinal: i + 1 }));
  let release!: () => void;
  const result = (leaf: string, values = all): FlowerParentEventPage => ({ thread_id: 'parent', leaf_id: leaf,
    first_event_id: all[0].id, last_event_id: all.at(-1)!.id, events: values,
    ...(values.at(-1)?.id !== all.at(-1)!.id ? { next_after_event_id: values.at(-1)!.id } : {}) });
  const [source, setSource] = createSignal(result('leaf-1'));
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string }) => {
    if (query.leaf_id === 'leaf-2') await new Promise<void>(resolve => { release = resolve; });
    return result(query.leaf_id!, all.map(value => ({ ...value, admitted: true })));
  });
  const host = document.createElement('div'); document.body.append(host);
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  setSource(result('leaf-2', all.slice(0, 10)));
  await waitFor(() => read.mock.calls.length === 1);
  for (let i = 3; i <= 10; i++) setSource(result('leaf-' + i, all.slice(0, 10).map(value => ({ ...value, admitted: true }))));
  expect(read).toHaveBeenCalledTimes(1);
  release();
  await waitFor(() => read.mock.calls.length === 2 && reading.events().every(value => value.admitted));
  expect(read.mock.calls.map(([, query]) => query.leaf_id)).toEqual(['leaf-2', 'leaf-10']);
  expect(reading.events()).toHaveLength(60);
});

it('drops replaced-path receipts when the first receipt identity stays the same', async () => {
  const first = { ...event('common', 'completed'), canonical_ordinal: 1 };
  const old = { ...event('old', 'completed'), canonical_ordinal: 10 };
  const next = { ...event('replacement', 'completed'), canonical_ordinal: 10 };
  const pageOf = (leaf: string, last: FlowerParentEvent, complete = false): FlowerParentEventPage => ({
    thread_id: 'parent', leaf_id: leaf, first_event_id: first.id, last_event_id: last.id,
    events: complete ? [first, last] : [first], ...(complete ? {} : { next_after_event_id: first.id }),
  });
  const [source, setSource] = createSignal(pageOf('old-leaf', old, true));
  const read = vi.fn(async () => pageOf('replacement-leaf', next, true));
  const host = document.createElement('div'); document.body.append(host);
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  setSource(pageOf('replacement-leaf', next));
  await waitFor(() => read.mock.calls.length === 1 && !reading.events().some(value => value.id === old.id));
  expect(reading.events().map(value => value.id)).toEqual([first.id, next.id]);
  expect(reading.cursor()).toBe('');
  expect(reading.beforeCursor()).toBe('');
});

it('does not resurrect evicted receipts when navigation overtakes a retained refresh', async () => {
  const all = Array.from({ length: 300 }, (_, i) => ({ ...event('race-' + i, 'completed'), canonical_ordinal: i + 1 }));
  const pageOf = (leaf: string, values: typeof all): FlowerParentEventPage => ({ thread_id: 'parent', leaf_id: leaf,
    first_event_id: all[0].id, last_event_id: all.at(-1)!.id, events: values,
    ...(values.length && values[0].id !== all[0].id ? { previous_before_event_id: values[0].id } : {}),
    ...(values.length && values.at(-1)!.id !== all.at(-1)!.id ? { next_after_event_id: values.at(-1)!.id } : {}) });
  const [source, setSource] = createSignal(pageOf('first', all.slice(0, 100)));
  let release!: () => void;
  let held = false;
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string; after_event_id?: string; after_ordinal?: number; before_ordinal?: number; limit?: number }) => {
    if (query.after_ordinal !== undefined) {
      if (!held) { held = true; await new Promise<void>(resolve => { release = resolve; }); }
      return pageOf(query.leaf_id!, all.filter(value => value.canonical_ordinal > query.after_ordinal!
        && value.canonical_ordinal < query.before_ordinal!).slice(-query.limit!));
    }
    const start = all.findIndex(value => value.id === query.after_event_id) + 1;
    return pageOf(query.leaf_id!, all.slice(start, start + 50));
  });
  const host = document.createElement('div'); document.body.append(host);
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await reading.more();
  setSource(pageOf('second', all.slice(0, 100)));
  await waitFor(() => held);
  await reading.more();
  const navigated = reading.events().map(value => value.id);
  expect(navigated).toEqual(all.slice(50, 200).map(value => value.id));
  release();
  await waitFor(() => read.mock.calls.filter(([, query]) => query.after_ordinal !== undefined).length === 2);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(reading.events().map(value => value.id)).toEqual(navigated);
  expect(reading.events()).toHaveLength(150);
});

it('does not resurrect replacement identities from an interval evicted during refresh', async () => {
  const all = Array.from({ length: 300 }, (_, i) => ({ ...event('race-' + i, 'completed'), canonical_ordinal: i + 1 }));
  const pageOf = (leaf: string, values: typeof all): FlowerParentEventPage => ({ thread_id: 'parent', leaf_id: leaf,
    first_event_id: all[0].id, last_event_id: all.at(-1)!.id, events: values,
    ...(values.length && values[0].id !== all[0].id ? { previous_before_event_id: values[0].id } : {}),
    ...(values.length && values.at(-1)!.id !== all.at(-1)!.id ? { next_after_event_id: values.at(-1)!.id } : {}) });
  const [source, setSource] = createSignal(pageOf('first', all.slice(0, 100)));
  let release!: () => void;
  let held = false;
  const read = vi.fn(async (_thread: string, query: { leaf_id?: string; after_event_id?: string; after_ordinal?: number; before_ordinal?: number; limit?: number }) => {
    if (query.after_ordinal !== undefined) {
      if (!held) { held = true; await new Promise<void>(resolve => { release = resolve; }); }
      return pageOf(query.leaf_id!, all.filter(value => value.canonical_ordinal > query.after_ordinal!
        && value.canonical_ordinal < query.before_ordinal!).slice(-query.limit!));
    }
    const start = all.findIndex(value => value.id === query.after_event_id) + 1;
    return pageOf(query.leaf_id!, all.slice(start, start + 50));
  });
  const host = document.createElement('div'); document.body.append(host);
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return source(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await reading.more();
  for (let i = 1; i < 50; i++) all[i] = { ...all[i], id: 'replacement-' + i };
  setSource(pageOf('second', all.slice(0, 1)));
  await waitFor(() => held);
  await reading.more();
  const navigated = reading.events().map(value => value.id);
  expect(navigated).toEqual(all.slice(50, 200).map(value => value.id));
  release();
  await waitFor(() => read.mock.calls.filter(([, query]) => query.after_ordinal !== undefined).length === 2);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(reading.events().map(value => value.id)).toEqual(navigated);
  expect(reading.events()).toHaveLength(150);
});
