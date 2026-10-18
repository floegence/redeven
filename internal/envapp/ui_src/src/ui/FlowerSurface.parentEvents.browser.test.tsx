import '../index.css';
import './flower-feature.css';
import { page, userEvent } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ParentEventRow, createParentEventReading } from '../../../../flower_ui/src/parentEvents';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerParentEventPage } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { loadEnvAppDictionary } from './i18n/locales';
import { SUPPORTED_LOCALES } from './i18n/localeMeta';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { EnvAppTranslationKey } from './i18n';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';

const copy = DEFAULT_FLOWER_SURFACE_COPY.subagents!;
const event = (id: string, kind: FlowerParentEvent['kind'] = 'report'): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn-child', source_run_id: 'run-child', source_entry_id: 'entry-' + id, kind, received_at: '2026-10-16T00:00:00Z', admitted: false });

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
  const read = vi.fn(async () => ({ ...events, events: [{ ...event('report'), message: 'Verified source dates\nComplete findings' }, event('failed', 'failed')] }));
  const loadChild = vi.fn(async () => { throw new Error('Child details unavailable'); });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => bootstrap), readParentEvents: read, loadSubagentDetail: loadChild }, { focusThreadRequest: { request_id: 'focus-events', thread_id: 'parent' } });
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event="report"] [data-parent-event-body]')));
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
  const [value, setValue] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', events: [first], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id });
  const message = '核验摘要\n' + '界'.repeat(2700);
  const read = vi.fn(async (_thread: string, query: { after_event_id?: string }) => query.after_event_id
    ? { thread_id: 'parent', events: [{ ...last, message: 'Additional findings' }], first_event_id: first.id, last_event_id: last.id }
    : { thread_id: 'parent', events: [{ ...first, message }], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => {
    reading = createParentEventReading({ threadID: 'parent', get page() { return value(); }, read });
    return <For each={reading.events()}>{event => <ParentEventRow event={event} copy={copy} sourceName="Research" canOpenSource onOpenSource={() => {}} onDisclosureClick={() => {}} />}</For>;
  }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => Boolean(host.querySelector('[data-parent-event-body]')));
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
  const [value, setValue] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', events: [event('first')], first_event_id: 'first', last_event_id: 'first' });
  let resolve!: (page: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(done => { resolve = done; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ thread_id: 'other', events: [{ ...event('second'), parent_thread_id: 'other', message: 'Other report' }], first_event_id: 'second', last_event_id: 'second' });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ get threadID() { return id(); }, get page() { return value(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => read.mock.calls.length === 1);
  setID('other');
  setValue({ thread_id: 'other', events: [{ ...event('second'), parent_thread_id: 'other' }], first_event_id: 'second', last_event_id: 'second' });
  await waitFor(reading.failed);
  resolve({ thread_id: 'parent', events: [{ ...event('first'), message: 'Stale report' }] });
  await Promise.resolve();
  expect(reading.events().some(event => event.message === 'Stale report')).toBe(false);
  await reading.retry();
  expect(reading.events()[0].message).toBe('Other report');
  expect(reading.failed()).toBe(false);
});

it('drops pages outside a changed fixed range and ignores the old range response', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const [value, setValue] = createSignal<FlowerParentEventPage>({ thread_id: 'parent', events: [event('first')], first_event_id: 'first', last_event_id: 'first' });
  let resolve!: (page: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(done => { resolve = done; }))
    .mockResolvedValue({ thread_id: 'parent', events: [{ ...event('next'), message: 'Current range' }], first_event_id: 'next', last_event_id: 'next' });
  let reading!: ReturnType<typeof createParentEventReading>;
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return value(); }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await waitFor(() => read.mock.calls.length === 1);
  setValue({ thread_id: 'parent', events: [event('next')], first_event_id: 'next', last_event_id: 'next' });
  await waitFor(() => reading.events()[0]?.message === 'Current range');
  resolve({ thread_id: 'parent', events: [{ ...event('first'), message: 'Old range' }], next_after_event_id: 'first' });
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

it('keeps accepted report receipts in the child view and locates their canonical parent report', async () => {
  await page.viewport(1100, 850);
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research' });
  const events = { thread_id: 'parent', events: [{ ...event('receipt-event'), message: 'Verified finding' }], first_event_id: 'receipt-event', last_event_id: 'receipt-event' };
  const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
  const base = liveBootstrap(parent, 1);
  const childCurrent = { thread_id: 'child', view_version: 1, activity: 'idle' as const, last_outcome: 'completed' as const, items: [{
    id: 'submitted-report', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1, kind: 'tool' as const,
    activity: { item_id: 'submitted-report', tool_id: 'report-call', tool_name: 'report_to_parent', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
      presentation: { renderer: 'structured', target_refs: [{ kind: 'parent_event', label: 'parent', resource_ref: 'receipt-event' }], payload: { inputs: [{ title: 'message', content: 'Verified finding', format: 'text' }], rows_provided: true } } },
  }] };
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent], loadThread: async () => ({ ...base, current: { ...base.current, parent_events: events } }),
    loadSubagentDetail: async () => ({ summary: child, current: childCurrent }) }, { focusThreadRequest: { request_id: 'receipt-parent', thread_id: 'parent' } });
  await waitFor(() => Boolean(surface.querySelector('[data-parent-event="receipt-event"]')));
  surface.querySelector<HTMLButtonElement>('[data-parent-event="receipt-event"] .flower-parent-event-source')!.click();
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
});
