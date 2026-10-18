// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { createParentEventReading } from '../../../../flower_ui/src/parentEvents';
import type { FlowerParentEvent, FlowerParentEventPage } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
const event = (id: string, message?: string): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn', source_run_id: 'run', source_entry_id: 'entry', kind: 'report', received_at: '2026-10-18T00:00:00Z', admitted: false, ...(message ? { message } : {}) });
const page = (events: FlowerParentEvent[], more = false): FlowerParentEventPage => ({ thread_id: 'parent', events, first_event_id: 'first', last_event_id: 'last', ...(more ? { next_after_event_id: events.at(-1)!.id } : {}) });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function mount(read: Parameters<typeof createParentEventReading>[0]['read'], initial: FlowerParentEventPage) {
  const [value, setValue] = createSignal(initial);
  const [epoch, setEpoch] = createSignal(1);
  let reading!: ReturnType<typeof createParentEventReading>;
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', get page() { return value(); }, read, get connectionEpoch() { return epoch(); }, timeoutMessage: 'timeout' }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  return { reading, setValue, setEpoch, dispose };
}
it('keeps empty event pages idle without making a request', async () => {
  const read = vi.fn();
  const { reading } = mount(read, JSON.parse('{"thread_id":"parent","events":[]}'));
  await flush();
  expect(reading.events()).toEqual([]); expect(reading.failed()).toBe(false); expect(reading.busy()).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
it('retains the failed page when reading becomes unavailable and resumes when restored', async () => {
  vi.useFakeTimers();
  const pending = vi.fn(() => new Promise<FlowerParentEventPage>(() => {}));
  const restored = vi.fn(async () => page([event('first', 'Restored'), event('last', 'Last')]));
  const [reader, setReader] = createSignal<NonNullable<Parameters<typeof createParentEventReading>[0]['read']> | undefined>(pending);
  let reading!: ReturnType<typeof createParentEventReading>;
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => { reading = createParentEventReading({ threadID: 'parent', page: page([event('first')]), get read() { return reader(); } }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await flush(); setReader(undefined); await flush();
  expect(reading.failed()).toBe(true); expect(reading.busy()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  setReader(() => restored); await flush();
  expect(reading.events()[0].message).toBe('Restored'); expect(reading.failed()).toBe(false);
});
it('keeps a missing reader recoverable without starting a timer or request', async () => {
  vi.useFakeTimers();
  const { reading } = mount(undefined, page([event('first')]));
  await flush();
  expect(reading.failed()).toBe(true); expect(reading.recovering()).toBe(true); expect(reading.busy()).toBe(false);
  await reading.retry();
  expect(reading.failed()).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('retries the exact failed continuation without dropping loaded reports', async () => {
  const read = vi.fn().mockResolvedValueOnce(page([event('first', 'Saved report')], true)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([event('last', 'Final report')]));
  const { reading } = mount(read, page([event('first')], true));
  await flush(); await reading.more();
  expect(reading.failed()).toBe(true); expect(reading.busy()).toBe(false); expect(reading.events()[0].message).toBe('Saved report'); expect(reading.cursor()).toBe('first');
  await reading.retry();
  expect(read.mock.calls[2]).toEqual(read.mock.calls[1]);
  expect(reading.events().map(value => value.message)).toEqual(['Saved report', 'Final report']);
  expect(reading.failed()).toBe(false); expect(reading.cursor()).toBe('');
});
it('releases a stalled read and ignores its late result after retry', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; })).mockResolvedValue(page([event('first', 'Current'), event('last', 'Last')]));
  const { reading } = mount(read, page([event('first')]));
  await flush(); expect(reading.busy()).toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(reading.failed()).toBe(true); expect(reading.busy()).toBe(false); expect(reading.timedOut()).toBe(true);
  await reading.retry();
  finish(page([event('first', 'Stale'), event('last', 'Stale')])); await flush();
  expect(reading.events()[0].message).toBe('Current'); expect(reading.failed()).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
it('invalidates a read on reconnect, preserves reports and releases all timers on disposal', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; })).mockResolvedValue(page([event('first', 'Reconnected'), event('last', 'Last')]));
  const { reading, setEpoch, setValue, dispose } = mount(read, page([event('first')]));
  await flush(); setEpoch(2); await flush();
  finish(page([event('first', 'Stale'), event('last', 'Stale')])); await flush();
  expect(reading.events()[0].message).toBe('Reconnected');
  setValue(page([{ ...event('first'), admitted: true }])); await flush();
  expect(reading.events()[0].message).toBe('Reconnected'); expect(read).toHaveBeenCalledTimes(2);
  dispose(); expect(vi.getTimerCount()).toBe(0);
});
it('rejects an invalid explicit page locally and recovers on retry', async () => {
  const read = vi.fn().mockResolvedValueOnce({ events: null }).mockResolvedValueOnce(page([event('first', 'Recovered'), event('last', 'Last')]));
  const { reading } = mount(read, page([event('first')]));
  await flush(); expect(reading.failed()).toBe(true); expect(reading.busy()).toBe(false);
  await reading.retry(); expect(reading.failed()).toBe(false); expect(reading.events()[0].message).toBe('Recovered');
});

it('invalidates a stalled read when its fixed range changes and on unmount', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; }))
    .mockImplementationOnce(() => new Promise<FlowerParentEventPage>(() => {}));
  const { reading, setValue, dispose } = mount(read, page([event('first')]));
  await flush();
  setValue({ thread_id: 'parent', events: [event('new')], first_event_id: 'new', last_event_id: 'new' }); await flush();
  finish(page([event('first', 'Obsolete'), event('last', 'Obsolete')])); await flush();
  expect(reading.events().map(value => value.id)).toEqual(['new']);
  expect(vi.getTimerCount()).toBe(1);
  dispose(); await flush(); expect(vi.getTimerCount()).toBe(0);
});
it('discards a previous thread read and releases its timer when navigating away', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; }));
  const [selected, setSelected] = createSignal('parent');
  let reading!: ReturnType<typeof createParentEventReading>;
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => { reading = createParentEventReading({ get threadID() { return selected(); },
    get page() { return selected() === 'parent' ? page([event('first')]) : { thread_id: selected(), events: [] }; }, read }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  await flush(); setSelected('other'); await flush();
  finish(page([event('first', 'Obsolete'), event('last', 'Obsolete')])); await flush();
  expect(reading.events()).toEqual([]); expect(reading.busy()).toBe(false); expect(reading.failed()).toBe(false);
  expect(vi.getTimerCount()).toBe(0); expect(read).toHaveBeenCalledTimes(1);
});

it('rejects a continuation that repeats an earlier loaded page without advancing the cursor', async () => {
  const read = vi.fn().mockResolvedValueOnce(page([event('first', 'One'), event('middle', 'Two')], true))
    .mockResolvedValueOnce(page([event('first', 'Repeated'), event('last', 'Last')]));
  const { reading } = mount(read, page([event('first')], true));
  await flush(); await reading.more();
  expect(reading.failed()).toBe(true); expect(reading.cursor()).toBe('middle');
  expect(reading.events().map(value => value.message)).toEqual(['One', 'Two']);
});

it('reads inherited reports under the page scope and rejects a response for another scope', async () => {
  const inherited = { ...event('first'), parent_thread_id: 'ancestor' };
  const read = vi.fn().mockResolvedValueOnce({ ...page([inherited, event('last', 'Last')]), thread_id: 'ancestor' })
    .mockResolvedValueOnce(page([{ ...inherited, message: 'Inherited report' }, event('last', 'Last')]));
  const { reading } = mount(read, page([inherited]));
  await flush(); expect(reading.failed()).toBe(true);
  expect(read).toHaveBeenCalledWith('parent', expect.objectContaining({ first_event_id: 'first', last_event_id: 'last' }));
  await reading.retry(); expect(reading.failed()).toBe(false);
  expect(reading.events()[0]).toMatchObject({ parent_thread_id: 'ancestor', message: 'Inherited report' });
});
