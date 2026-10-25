// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { createParentEventReading } from '../../../../flower_ui/src/parentEvents';
import type { FlowerParentEvent, FlowerParentEventPage } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
const event = (id: string, message?: string): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn', source_run_id: 'run', source_entry_id: 'entry', kind: 'report', received_at: '2026-10-18T00:00:00Z', admitted: false, ...(message ? { message } : {}) });
const page = (events: FlowerParentEvent[], more = false): FlowerParentEventPage => ({ thread_id: 'parent', events, first_event_id: 'first', last_event_id: 'last', ...(more ? { next_after_event_id: events.at(-1)!.id } : {}) });
const body = (id: string, message: string): FlowerParentEventPage => ({ thread_id: 'parent', events: [event(id, message)], first_event_id: id, last_event_id: id });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
function mount(read: Parameters<typeof createParentEventReading>[0]['read'], initial: FlowerParentEventPage) {
  const [value, setValue] = createSignal(initial);
  const [epoch, setEpoch] = createSignal(1);
  const [selected, setSelected] = createSignal('parent');
  const [reader, setReader] = createSignal(read);
  let reading!: ReturnType<typeof createParentEventReading>;
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => { reading = createParentEventReading({ get threadID() { return selected(); }, get page() { return value(); }, get read() { return reader(); }, get connectionEpoch() { return epoch(); }, timeoutMessage: 'timeout' }); return null; }, host);
  onTestFinished(() => { dispose(); host.remove(); });
  return { reading, setValue, setEpoch, setSelected, setReader, dispose };
}
it('keeps empty and collapsed event pages idle without requesting bodies', async () => {
  const read = vi.fn();
  const { reading, setValue } = mount(read, { thread_id: 'parent', events: [] });
  await flush();
  setValue(page([event('first')])); await flush();
  expect(reading.events()).toHaveLength(1); expect(reading.failed()).toBe(false); expect(reading.busy()).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
it('retains visible demand when the reader becomes unavailable and resumes when restored', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const pending = vi.fn(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; }));
  const restored = vi.fn(async () => body('first', 'Restored'));
  const { reading, setReader } = mount(pending, page([event('first')]));
  const release = reading.retainBody('first');
  await flush(); setReader(undefined); await flush();
  expect(reading.bodyState('first')).toBe('failed'); expect(vi.getTimerCount()).toBe(0);
  setReader(() => restored); await flush();
  finish(body('first', 'Obsolete')); await flush();
  expect(reading.events()[0].message).toBe('Restored'); expect(reading.bodyState('first')).toBe('ready'); release();
});
it('reports missing readers only for expanded bodies without starting timers', async () => {
  vi.useFakeTimers();
  const { reading } = mount(undefined, page([event('first')]));
  await flush(); expect(reading.bodyState('first')).toBeUndefined();
  const release = reading.retainBody('first'); await flush();
  expect(reading.bodyState('first')).toBe('failed'); expect(vi.getTimerCount()).toBe(0); release();
});
it('retries the exact failed continuation on further scrolling without dropping reports', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([event('last', 'Final report')]));
  const { reading } = mount(read, page([event('first', 'Saved report')], true));
  await flush(); await reading.more();
  expect(reading.failed()).toBe(true); expect(reading.events()[0].message).toBe('Saved report');
  reading.schedule('after'); await flush();
  expect(read.mock.calls[1]?.slice(0, 2)).toEqual(read.mock.calls[0]?.slice(0, 2));
  expect(reading.events().map(value => value.message)).toEqual(['Saved report', 'Final report']);
  expect(reading.failed()).toBe(false); expect(reading.cursor()).toBe('');
});
it('releases a stalled body when collapsed and ignores late completion after re-expansion', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; })).mockResolvedValue(body('first', 'Current'));
  const { reading } = mount(read, page([event('first')]));
  const release = reading.retainBody('first'); await flush();
  expect(reading.bodyState('first')).toBe('reading'); release(); await flush();
  expect(vi.getTimerCount()).toBe(0);
  const second = reading.retainBody('first'); await flush();
  finish(body('first', 'Stale')); await flush();
  expect(reading.events()[0].message).toBe('Current'); expect(reading.bodyState('first')).toBe('ready'); second();
});
it('bounds deadline retries and releases timers after exhausted body reads', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => new Promise<FlowerParentEventPage>(() => {}));
  const { reading } = mount(read, page([event('first')]));
  const release = reading.retainBody('first'); await flush();
  await vi.advanceTimersByTimeAsync(63_000); await flush();
  expect(read).toHaveBeenCalledTimes(4); expect(reading.bodyState('first')).toBe('failed');
  expect(vi.getTimerCount()).toBe(0); release();
});
it('reconnects demanded bodies and preserves completed reports across metadata updates', async () => {
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; })).mockResolvedValue(body('first', 'Reconnected'));
  const { reading, setEpoch, setValue } = mount(read, page([event('first')]));
  const release = reading.retainBody('first'); await flush(); setEpoch(2); await flush();
  finish(body('first', 'Stale')); await flush();
  expect(reading.events()[0].message).toBe('Reconnected');
  setValue(page([{ ...event('first'), admitted: true }])); await flush();
  expect(reading.events()[0]).toMatchObject({ message: 'Reconnected', admitted: true }); expect(read).toHaveBeenCalledTimes(2); release();
});
it('rejects malformed pages locally and recovers the same continuation', async () => {
  const read = vi.fn().mockResolvedValueOnce({ events: null }).mockResolvedValueOnce(page([event('last', 'Recovered')]));
  const { reading } = mount(read, page([event('first', 'Saved')], true));
  await flush(); await reading.more(); expect(reading.failed()).toBe(true);
  await reading.retry(); expect(reading.failed()).toBe(false); expect(reading.events().at(-1)?.message).toBe('Recovered');
});
it('discards old thread body reads and releases timers when navigating away', async () => {
  vi.useFakeTimers();
  let finish!: (value: FlowerParentEventPage) => void;
  const read = vi.fn(() => new Promise<FlowerParentEventPage>(resolve => { finish = resolve; }));
  const { reading, setSelected, setValue } = mount(read, page([event('first')]));
  reading.retainBody('first'); await flush();
  setSelected('other'); setValue({ thread_id: 'other', events: [] }); await flush();
  finish(body('first', 'Obsolete')); await flush();
  expect(reading.events()).toEqual([]); expect(reading.bodyState('first')).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});
it('rejects a continuation that overlaps already retained identities', async () => {
  const read = vi.fn().mockResolvedValueOnce(page([event('first', 'Repeated'), event('last', 'Last')]));
  const { reading } = mount(read, page([event('first', 'One'), event('middle', 'Two')], true));
  await flush(); await reading.more();
  expect(reading.failed()).toBe(true); expect(reading.cursor()).toBe('middle');
  expect(reading.events().map(value => value.message)).toEqual(['One', 'Two']);
});
it('reads inherited reports under current authorization and rejects foreign scope', async () => {
  const inherited = { ...event('first'), parent_thread_id: 'ancestor' };
  const read = vi.fn().mockResolvedValueOnce({ ...body('first', 'Foreign'), thread_id: 'ancestor' })
    .mockResolvedValueOnce({ ...body('first', 'Inherited report'), events: [{ ...inherited, message: 'Inherited report' }] });
  const { reading } = mount(read, page([inherited]));
  const release = reading.retainBody('first'); await flush();
  expect(reading.bodyState('first')).toBe('failed');
  expect(read.mock.calls[0]?.slice(0, 2)).toEqual(['parent', { action: 'read', event_id: 'first' }]);
  release(); const second = reading.retainBody('first'); await flush();
  expect(reading.events()[0]).toMatchObject({ parent_thread_id: 'ancestor', message: 'Inherited report' }); second();
});
