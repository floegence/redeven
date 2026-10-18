import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ParentEventRow, createParentEventReading } from '../../../../flower_ui/src/parentEvents';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerParentEventPage } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { loadEnvAppDictionary } from './i18n/locales';
import { SUPPORTED_LOCALES } from './i18n/localeMeta';

const copy = DEFAULT_FLOWER_SURFACE_COPY.subagents!;
const event = (id: string, kind: FlowerParentEvent['kind'] = 'report'): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn-child', source_run_id: 'run-child', source_entry_id: 'entry-' + id, kind, received_at: '2026-10-16T00:00:00Z', admitted: false });

it('shows reports and terminal events with child avatars in the parent transcript before opening the dropdown', async () => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research', status: 'failed' });
  const events = { events: [event('report'), event('failed', 'failed')], first_event_id: 'report', last_event_id: 'failed' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
  const initial = liveBootstrap(parent, 1);
  const bootstrap = { ...initial, current: { ...initial.current, parent_events: events } };
  const read = vi.fn(async () => ({ ...events, events: [{ ...event('report'), message: 'Verified source dates\nComplete findings' }, event('failed', 'failed')] }));
  const loadChild = vi.fn(async () => { throw new Error('Child details unavailable'); });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => bootstrap), readParentEvents: read, loadSubagentDetail: loadChild }, { focusThreadRequest: { request_id: 'focus-events', thread_id: 'parent' } });
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event="report"] .flower-parent-event-preview')));
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
  const events = { events: [event('report')], first_event_id: 'report', last_event_id: 'report' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
  const base = liveBootstrap(parent, 1);
  const current = { ...base.current, parent_events: events };
  const queued: FlowerLiveStreamEnvelope[] = [{ schema_version: 1, kind: 'ready', summaries: [parent] }];
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
  const body = row.querySelector('[data-parent-event-body]');
  queued.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'parent', current: { ...current, view_version: 2,
    parent_events: { ...events, events: [{ ...event('report'), admitted: true }, event('completed', 'completed')], last_event_id: 'completed' } } });
  wake?.();
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event="completed"]')));
  expect(runtime.querySelector('[data-parent-event="report"]')).toBe(row);
  expect(row.querySelector('[data-parent-event-body]')).toBe(body);
  expect(body?.textContent).toBe('Verified finding\nComplete report');
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(disclosure);
});

it('reads full Unicode reports once, pages a fixed range and preserves reports on admission updates', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const first = event('first'), last = event('last');
  const [value, setValue] = createSignal<FlowerParentEventPage>({ events: [first], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id });
  const message = '核验摘要\n' + '界'.repeat(2700);
  const read = vi.fn(async (_thread: string, query: { after_event_id?: string }) => query.after_event_id
    ? { events: [{ ...last, message: 'Additional findings' }], first_event_id: first.id, last_event_id: last.id }
    : { events: [{ ...first, message }], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => {
    reading = createParentEventReading({ threadID: 'parent', get page() { return value(); }, read });
    return <For each={reading.events()}>{event => <ParentEventRow event={event} copy={copy} sourceName="Research" canOpenSource onOpenSource={() => {}} onDisclosureClick={() => {}} />}</For>;
  }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => Boolean(host.querySelector('.flower-parent-event-preview')));
  host.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!.click();
  expect(host.querySelector('[data-parent-event-body]')?.textContent).toBe(message);
  await reading.more();
  expect(read).toHaveBeenLastCalledWith('parent', { action: 'read', first_event_id: 'first', last_event_id: 'last', after_event_id: 'first', limit: 50 });
  expect(reading.events()).toHaveLength(2);
  setValue({ ...value(), events: [{ ...first, admitted: true }] });
  expect(reading.events()).toHaveLength(2);
  expect(read).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain(copy.events.admitted);
  expect(reading.events()[0].message).toBe(message);
});

it('ignores a late report response after selecting another parent and supports retry', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [id, setID] = createSignal('parent');
  const [value, setValue] = createSignal<FlowerParentEventPage>({ events: [event('first')], first_event_id: 'first', last_event_id: 'first' });
  let resolve!: (page: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(done => { resolve = done; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ events: [{ ...event('second'), parent_thread_id: 'other', message: 'Other report' }] });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ get threadID() { return id(); }, get page() { return value(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  setID('other');
  setValue({ events: [{ ...event('second'), parent_thread_id: 'other' }], first_event_id: 'second', last_event_id: 'second' });
  await waitFor(reading.failed);
  resolve({ events: [{ ...event('first'), message: 'Stale report' }] });
  await Promise.resolve();
  expect(reading.events().some(event => event.message === 'Stale report')).toBe(false);
  await reading.retry();
  expect(reading.events()[0].message).toBe('Other report');
  expect(reading.failed()).toBe(false);
});

it('drops pages outside a changed fixed range and ignores the old range response', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [value, setValue] = createSignal<FlowerParentEventPage>({ events: [event('first')], first_event_id: 'first', last_event_id: 'first' });
  let resolve!: (page: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(done => { resolve = done; }))
    .mockResolvedValue({ events: [{ ...event('next'), message: 'Current range' }] });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return value(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  setValue({ events: [event('next')], first_event_id: 'next', last_event_id: 'next' });
  await waitFor(() => reading.events()[0]?.message === 'Current range');
  resolve({ events: [{ ...event('first'), message: 'Old range' }], next_after_event_id: 'first' });
  await Promise.resolve();
  expect(reading.events().map(event => event.id)).toEqual(['next']);
  expect(reading.cursor()).toBe('');
});

it('fits report expansion and navigation on one row in every shipped locale', async () => {
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
        expect(a.right, locale).toBeLessThanOrEqual(b.left);
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
