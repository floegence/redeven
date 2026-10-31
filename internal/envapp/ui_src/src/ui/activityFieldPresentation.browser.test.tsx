import { createRoot, createSignal } from 'solid-js';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createActivityFieldPresentation } from '../../../../flower_ui/src/activityFieldPresentation';
import { createActivityFieldReader } from '../../../../flower_ui/src/activityFieldReader';
import type { FlowerActivityItem, FlowerActivityValue } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { replaceTerminalOutputSnapshot } from '../../../../flower_ui/src/flowerTerminalOutput';

const disposers: (() => void)[] = [];
let warningSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warningSpy = vi.spyOn(console, 'warn');
});
afterEach(() => {
  const warnings = warningSpy.mock.calls.filter((args: unknown[]) => String(args[0]).includes('computations created outside'));
  warningSpy.mockRestore();
  expect(warnings).toEqual([]);
});
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function fixture(execution?: () => readonly [string, string]) {
  return createRoot(dispose => {
    disposers.push(dispose);
    const [active, setActive] = createSignal(true);
    const [thread, setThread] = createSignal('thread');
    const [connection, setConnection] = createSignal(1);
    const [item, setItem] = createSignal<FlowerActivityItem>({ item_id: 'call', tool_id: 'call', kind: 'tool',
      status: 'success', severity: 'normal', requires_approval: false, needs_attention: false, renderer: 'terminal',
      field_summary: { version: 'v1', renderer: 'terminal', fields: [{ path: '/payload/output', kind: 'string', bytes: 4 }] } });
    let release: (() => void) | undefined;
    let hold = false;
    const transport = { loadActivityValue: vi.fn(async (threadID: string, input: { item_id: string; path: string }): Promise<FlowerActivityValue> => {
      if (hold) await new Promise<void>(resolve => { release = resolve; });
      return { thread_id: threadID, item_id: input.item_id, turn_id: 'turn', run_id: 'run', path: input.path, value: { output: 'done' } };
    }) };
    const reader = createActivityFieldReader(transport);
    disposers.push(() => reader.dispose());
    const presentation = createActivityFieldPresentation({ reader, item, threadID: thread, itemID: () => 'tool:turn:call', active, connection, execution });
    return { presentation, transport, setActive, setThread, setConnection, setItem,
      hold: () => { hold = true; }, release: () => release?.() };
  });
}
describe('activity presentation lifetime', () => {
  it.each(['identity', 'range'])('retains accepted output on %s failure and latches until explicit retry', async mode => {
    const f = fixture(() => ['run', 'turn']);
    await vi.waitFor(() => expect(f.presentation.item().payload?.output).toBe('done'));
    f.transport.loadActivityValue.mockResolvedValueOnce({ thread_id: 'thread', item_id: 'tool:turn:call', turn_id: 'turn',
      run_id: mode === 'identity' ? 'other-run' : 'run', path: '/payload',
      value: mode === 'range' ? { output: '', first_seq: 1, last_seq: 3 } : { output: 'wrong execution' } });
    f.setConnection(2);
    await vi.waitFor(() => expect(f.presentation.failed()).toBe(true));
    expect(f.presentation.item().payload?.output).toBe('done');
    for (let i = 0; i < 20; i++) f.setItem(item => ({ ...item, field_summary: { ...item.field_summary!, version: 'v' + i } }));
    expect(f.transport.loadActivityValue).toHaveBeenCalledTimes(2);
    f.presentation.retry(); f.presentation.retry();
    await vi.waitFor(() => expect(f.presentation.failed()).toBe(false));
    expect(f.transport.loadActivityValue).toHaveBeenCalledTimes(3);
    expect(f.presentation.item().payload?.output).toBe('done');
  });
  it.each(['', 'old output'])('retains the accepted terminal tuple while a newer read is pending: %j', async output => {
    const f = fixture();
    await vi.waitFor(() => expect(f.presentation.loading()).toBe(false));
    const previous = { output, first_seq: output ? 1 : 0, last_seq: output ? 2 : 0, truncated: false, process_id: 'process', operation: 'exec' };
    f.transport.loadActivityValue.mockResolvedValueOnce({ thread_id: 'thread', item_id: 'tool:turn:call', turn_id: 'turn', run_id: 'run', path: '/payload', value: previous });
    const fields = Object.entries(previous).map(([name, value]) => typeof value === 'string'
      ? { path: '/payload/' + name, kind: 'string' as const, bytes: value.length }
      : { path: '/payload/' + name, kind: 'scalar' as const, value });
    f.setItem(item => ({ ...item, field_summary: { ...item.field_summary!, version: 'seed', fields } }));
    await vi.waitFor(() => expect(f.presentation.sourcePayload()?.output).toBe(output));
    f.hold();
    f.setItem(item => ({ ...item, payload: { first_seq: 1, last_seq: 30, latest_seq: 30, truncated: true },
      field_summary: { ...item.field_summary!, version: 'new' } }));
    expect(f.presentation.item().payload).toMatchObject(previous);
    const frame = f.presentation.item().payload as typeof previous;
    expect(() => replaceTerminalOutputSnapshot(undefined, frame)).not.toThrow();
    const accepted = replaceTerminalOutputSnapshot(undefined, frame);
    expect(replaceTerminalOutputSnapshot(accepted, { output: 'complete output', first_seq: 1, last_seq: 30 }).output).toBe('complete output');
    f.setActive(false);
    expect(f.presentation.item().payload).toMatchObject(previous);
    f.release();
  });

  it('reads Goal state atomically while retaining its large text as frozen fields', async () => {
    const value = { operation: 'review', applied: false, version: 3, outcome: 'continue' };
    const loadActivityValue = vi.fn(async (threadID: string, input: { item_id: string; path: string }) => ({
      thread_id: threadID, item_id: input.item_id, turn_id: 'turn', run_id: 'run', path: input.path, value,
      text_fields: ['text', 'evidence'].map(name => ({ path: '/payload/goal/' + name, kind: 'string' as const,
        source_id: name, run_id: 'run', bytes: 10 << 20 })),
    }));
    const loadActivityField = vi.fn(async () => { throw new Error('Hidden Goal text was read.'); });
    const result = createRoot(dispose => {
      disposers.push(dispose);
      const reader = createActivityFieldReader({ loadActivityValue, loadActivityField });
      disposers.push(() => reader.dispose());
      const item: FlowerActivityItem = { item_id: 'call', tool_id: 'call', tool_name: 'goal', kind: 'tool',
        status: 'success', severity: 'normal', requires_approval: false, needs_attention: false, renderer: 'structured',
        field_summary: { version: 'v1', renderer: 'structured', fields: [{ path: '/payload/goal', kind: 'object', count: 6 }] } };
      return createActivityFieldPresentation({ reader, item: () => item, threadID: () => 'thread', itemID: () => 'tool:turn:call', active: () => true, connection: () => 1 });
    });
    await vi.waitFor(() => expect(result.item().payload?.goal).toEqual(value));
    expect(loadActivityValue).toHaveBeenCalledExactlyOnceWith('thread', expect.objectContaining({ path: '/payload/goal',
      fields: ['operation', 'applied', 'version', 'outcome'], text_fields: ['text', 'evidence'] }), expect.any(AbortSignal));
    expect(result.field('/payload/goal/text')).toMatchObject({ source_id: 'text', bytes: 10 << 20 });
    expect(result.field('/payload/goal/evidence')).toMatchObject({ source_id: 'evidence', bytes: 10 << 20 });
    expect(loadActivityField).not.toHaveBeenCalled();
  });

  it('retries failed visible details on reentry without a new activity version', async () => {
    const f = fixture();
    await vi.waitFor(() => expect(f.presentation.item().payload?.output).toBe('done'));
    f.transport.loadActivityValue.mockRejectedValueOnce(new Error('temporary detail failure'));
    f.setConnection(2);
    await vi.waitFor(() => expect(f.presentation.failed()).toBe(true));
    f.setActive(false); f.setActive(true);
    await vi.waitFor(() => expect(f.transport.loadActivityValue).toHaveBeenCalledTimes(3));
    expect(f.presentation.failed()).toBe(false);
    expect(f.presentation.item().payload?.output).toBe('done');
  });
  it('reuses accepted details after collapse and reopens without another read', async () => {
    const f = fixture();
    await vi.waitFor(() => expect(f.presentation.item().payload?.output).toBe('done'));
    f.setActive(false); f.setActive(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(f.transport.loadActivityValue).toHaveBeenCalledTimes(1);
    f.setConnection(2);
    await vi.waitFor(() => expect(f.transport.loadActivityValue).toHaveBeenCalledTimes(2));
  });
  it('does not display an old renderer payload while its replacement is loading', async () => {
    const f = fixture();
    await vi.waitFor(() => expect(f.presentation.item().payload?.output).toBe('done'));
    f.hold();
    f.setItem(previous => ({ ...previous, renderer: 'file', field_summary: { ...previous.field_summary!, version: 'v2', renderer: 'file' } }));
    expect(f.presentation.item().payload?.output).toBeUndefined();
    f.release();
  });
  it('evicts old owner details when leaving and returning while collapsed', async () => {
    const f = fixture();
    await vi.waitFor(() => expect(f.presentation.item().payload?.output).toBe('done'));
    f.setActive(false); f.setThread('other'); f.setThread('thread');
    expect(f.presentation.item().payload?.output).toBeUndefined();
  });
  it('updates canonical tool status without mixing a newer terminal payload into accepted output', async () => {
    const f = fixture();
    await vi.waitFor(() => expect(f.presentation.item().payload?.output).toBe('done'));
    f.hold();
    f.setItem(previous => ({ ...previous, status: 'error', payload: { status: 'error', timed_out: true },
      field_summary: { ...previous.field_summary!, version: 'v2' } }));
    expect(f.presentation.item().status).toBe('error');
    expect(f.presentation.item().payload).toEqual({ output: 'done' });
    f.release();
  });
});
