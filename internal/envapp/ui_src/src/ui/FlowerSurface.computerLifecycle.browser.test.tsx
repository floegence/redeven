import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import type { FlowerSurfaceAdapter, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const threadID = 'computer-lifecycle';
const frameRef = `computer://browser-main/${'a'.repeat(64)}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const png = () => new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0))], { type: 'image/png' });
function current(outcome?: FlowerRuntimeCurrentView['last_outcome']): FlowerRuntimeCurrentView {
  return { thread_id: threadID, view_version: 1, turn_id: 'computer-turn', run_id: 'computer-run', activity: outcome ? 'idle' : 'active',
    ...(outcome ? { last_outcome: outcome } : { run_progress: { phase: 'tool_execution' as const } }),
    items: [{ id: 'observed', kind: 'tool', ordinal: 1, turn_id: 'computer-turn', run_id: 'computer-run', activity: {
      item_id: 'observed', tool_id: 'observe', tool_name: 'browser.navigate', status: 'success',
      presentation: { label: 'Observed page', renderer: 'structured', payload: { operation: 'navigate', status: 'success' }, target_refs: [{ kind: 'computer_frame', label: 'Managed browser', resource_ref: frameRef }] },
    } }], interactions: [],
  };
}
function fixture(initial: FlowerRuntimeCurrentView) {
  let canonical = initial;
  const base = thread({ thread_id: threadID });
  const other = thread({ thread_id: 'other-thread', title: 'Another conversation' });
  let revision = 2;
  const snapshot = () => applyFlowerRuntimeCurrentView({ ...base, updated_at_ms: revision,
    read_status: { ...base.read_status, snapshot: { activity_revision: revision } },
  }, canonical);
  let receive: (value: FlowerLiveStreamEnvelope | undefined) => void = () => undefined;
  let connections = 0;
  const setComputerViewer = vi.fn(async (_value: { observer_id: string; revision: number; thread_id?: string; interaction_id?: string }) => undefined);
  const inputComputerControl = vi.fn(async () => undefined);
  const submitInput = vi.fn(adapter(true).submitInput);
  const loadComputerFrame = vi.fn(async (_frame: Parameters<NonNullable<FlowerSurfaceAdapter['loadComputerFrame']>>[0]) => png());
  const loadThread = vi.fn(async (id: string) => id === threadID ? ({ thread: snapshot(), current: canonical }) : ({ thread: other, current: { thread_id: other.thread_id, view_version: 1, activity: 'idle' as const } }));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), submitInput, setComputerViewer, inputComputerControl, loadComputerFrame,
    listThreads: vi.fn(async () => [snapshot(), other]), loadThread,
    connectLiveStream: async function* ({ signal }) {
      connections++;
      yield { schema_version: 1, kind: 'ready', observer_id: `observer-${connections}`, summaries: [snapshot(), other] };
      while (!signal.aborted) {
        const value = await new Promise<FlowerLiveStreamEnvelope | undefined>(resolve => {
          const abort = () => resolve(undefined);
          receive = value => { signal.removeEventListener('abort', abort); resolve(value); };
          signal.addEventListener('abort', abort, { once: true });
        });
        if (!value) return;
        yield value;
      }
    },
  }, { layout: true, focusThreadRequest: { request_id: 'focus', thread_id: threadID } });
  return { surface, loadThread, snapshot, submitInput, setComputerViewer, inputComputerControl, loadComputerFrame, connections: () => connections,
    restart: (next: FlowerRuntimeCurrentView) => { canonical = next; revision++; receive(undefined); },
    disconnect: () => receive(undefined), emit: (value: FlowerLiveStreamEnvelope) => receive(value),
    update: (next: FlowerRuntimeCurrentView) => { canonical = next; revision++; receive({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: next }); },
  };
}

it.each([['completed', 'completed'], ['cancelled', 'stopped'], ['failed', 'failed']] as const)('loads %s history without opening or sampling and exposes only an explicit historical image', async (outcome, state) => {
  const f = fixture(current(outcome));
  await waitFor(() => Boolean(f.surface.querySelector('.flower-computer-entry')));
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
  expect(f.setComputerViewer).not.toHaveBeenCalled();
  expect(f.loadComputerFrame).not.toHaveBeenCalled();
  expect(f.surface.querySelector('.flower-computer-entry')?.textContent).toContain('View last screenshot');
  f.surface.querySelector<HTMLButtonElement>('.flower-computer-entry')!.click();
  await waitFor(() => document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.naturalWidth === 1);
  expect(document.querySelector('.flower-computer-stage')?.textContent).toContain('Historical screenshot');
  expect(document.querySelector('.flower-computer-stage .flower-computer-state')?.getAttribute('data-session-state')).toBe(state);
  expect(document.querySelector('.flower-computer-frame-rate')).toBeNull();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(f.setComputerViewer).not.toHaveBeenCalled();
});

it('collapses a terminal run once and does not infer history success from a later text run', async () => {
  const f = fixture(current());
  await waitFor(() => document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.naturalWidth === 1);
  f.update({ ...current('cancelled'), view_version: 2 });
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
  const requests = f.setComputerViewer.mock.calls.length;
  f.surface.querySelector<HTMLButtonElement>('.flower-computer-entry')!.click();
  await waitFor(() => document.querySelector('.flower-computer-stage') !== null);
  f.update({ ...current('cancelled'), view_version: 3 });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(document.querySelector('.flower-computer-stage')).not.toBeNull();
  f.update({ ...current(), view_version: 4, turn_id: 'text-turn', run_id: 'text-run' });
  await waitFor(() => document.querySelector('.flower-computer-stage .flower-computer-state') === null);
  expect(document.querySelector('.flower-computer-stage')?.textContent).toContain('Historical screenshot');
  expect(f.setComputerViewer.mock.calls.length).toBe(requests);
});

it('requires explicit recovery and a newly decoded private frame after the workspace disconnects', async () => {
  const waiting = { ...current(), interactions: [{ id: 'takeover', kind: 'input' as const, turn_id: 'computer-turn', run_id: 'computer-run', tool_call_id: 'observe', input: { summary: 'Verification', questions: [{ id: 'computer_control', prompt: 'Return control', kind: 'select', options: ['Return control to Flower'] }] } }] };
  const f = fixture(waiting);
  await waitFor(() => Array.from(f.surface.querySelectorAll('button')).some(b => b.textContent === 'Take control'));
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!.click();
  await waitFor(() => Boolean(f.setComputerViewer.mock.calls.at(-1)?.[0].interaction_id));
  const offerFrame = () => {
    const viewer = f.setComputerViewer.mock.calls.at(-1)![0];
    f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: viewer.observer_id, viewer_revision: viewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: '1', sequence: 1, mime_type: 'image/png' } });
  };
  offerFrame();
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage textarea')));
  const before = document.querySelector<HTMLImageElement>('.flower-computer-stage img')!.src;
  const oldViewer = f.setComputerViewer.mock.calls.at(-1)![0];
  let finishOldFrame: (value: Blob) => void = () => undefined;
  f.loadComputerFrame.mockImplementationOnce(() => new Promise(resolve => { finishOldFrame = resolve; }));
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: oldViewer.observer_id, viewer_revision: oldViewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: 'late', sequence: 2, mime_type: 'image/png' } });
  await waitFor(() => f.loadComputerFrame.mock.calls.some(([frame]) => frame.private_frame?.frame_id === 'late'));
  let finishInput: () => void = () => undefined;
  f.inputComputerControl.mockImplementationOnce(() => new Promise(resolve => { finishInput = () => resolve(undefined); }));
  const keyboard = document.querySelector<HTMLTextAreaElement>('.flower-computer-stage textarea')!;
  keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  await waitFor(() => f.inputComputerControl.mock.calls.length === 1);
  keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="return"]')!.click();
  f.disconnect();
  await waitFor(() => document.querySelector('.flower-computer-stage textarea') === null);
  await waitFor(() => f.connections() === 2);
  expect(document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.src).toBe(before);
  expect(document.querySelector('.flower-computer-stage .flower-computer-state')?.getAttribute('data-session-state')).toBe('disconnected');
  expect(f.setComputerViewer.mock.calls.filter(([v]) => v.interaction_id)).toHaveLength(1);
  finishOldFrame(png()); finishInput();
  await settle();
  expect(f.submitInput).not.toHaveBeenCalled();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(document.querySelector<HTMLImageElement>('.flower-computer-stage img')?.src).toBe(before);
  const loads = f.loadComputerFrame.mock.calls.length;
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: oldViewer.observer_id, viewer_revision: oldViewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: 'stale', sequence: 3, mime_type: 'image/png' } });
  await settle();
  expect(f.loadComputerFrame.mock.calls.length).toBe(loads);
  const take = f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!;
  expect(take.textContent).toBe('Resume control');
  take.click();
  await waitFor(() => f.setComputerViewer.mock.calls.filter(([v]) => v.interaction_id).length === 2);
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  offerFrame();
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage textarea')));
  expect(f.inputComputerControl).toHaveBeenCalledTimes(1);
});

it('opens the next task on its first public frame after automatic terminal collapse', async () => {
  const f = fixture(current());
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage img')));
  f.update({ ...current('completed'), view_version: 2 });
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  const text = { ...current(), view_version: 3, turn_id: 'next-turn', run_id: 'next-run' };
  f.update(text); await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  const observed = current().items![0];
  f.update({ ...text, view_version: 4, items: [...text.items!, { ...observed, id: 'next-frame', ordinal: 2, turn_id: 'next-turn', run_id: 'next-run' }] });
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage img')));
  document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  f.disconnect(); await waitFor(() => f.connections() === 2); await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage-ball')).not.toBeNull();
});

it.each(['close', 'switch', 'expire'] as const)('discards private decoding when recovery is interrupted by %s', async action => {
  const waiting = { ...current(), interactions: [{ id: 'takeover', kind: 'input' as const, turn_id: 'computer-turn', run_id: 'computer-run', tool_call_id: 'observe', input: { summary: 'Verification', questions: [{ id: 'computer_control', prompt: 'Return control', kind: 'select', options: ['Return control to Flower'] }] } }] };
  const f = fixture(waiting);
  await waitFor(() => Boolean(f.surface.querySelector('[data-computer-control-action="take"]')));
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!.click();
  await waitFor(() => Boolean(f.setComputerViewer.mock.calls.at(-1)?.[0].interaction_id));
  f.disconnect(); await waitFor(() => f.connections() === 2);
  f.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="take"]')!.click();
  await waitFor(() => f.setComputerViewer.mock.calls.filter(([v]) => v.interaction_id).length === 2);
  const viewer = f.setComputerViewer.mock.calls.at(-1)![0];
  let finish: (value: Blob) => void = () => undefined;
  f.loadComputerFrame.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loads = f.loadComputerFrame.mock.calls.length;
  f.emit({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: { session_id: viewer.observer_id, viewer_revision: viewer.revision, target_id: 'browser-main', interaction_id: 'takeover', frame_id: 'recovering', sequence: 1, mime_type: 'image/png' } });
  await waitFor(() => f.loadComputerFrame.mock.calls.length > loads);
  if (action === 'close') document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
  else if (action === 'expire') f.update({ ...current('cancelled'), view_version: 2 });
  else {
    const row = f.surface.querySelector<HTMLElement>('[data-thread-id="other-thread"] button');
    expect(row).not.toBeNull(); row!.click();
  }
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  finish(png()); await settle();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  expect(document.querySelector('.flower-computer-stage textarea')).toBeNull();
  expect(f.inputComputerControl).not.toHaveBeenCalled();
});

it('accepts fresh canonical results when Runtime restart resets process-local view versions', async () => {
  const f = fixture({ ...current(), view_version: 27 });
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage img')));
  f.restart({ ...current('cancelled'), view_version: 1 });
  await waitFor(() => f.connections() === 2);
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  expect(f.surface.querySelector('.flower-computer-entry')?.textContent).toContain('Computer task stopped');
  expect(document.querySelector('.flower-computer-stage-ball')).toBeNull();
  f.update({ ...current('failed'), view_version: 2 });
  await waitFor(() => f.surface.querySelector('.flower-computer-entry')?.textContent?.includes('Computer task failed') === true);
});

it('rejects a delayed HTTP current from the previous Runtime connection', async () => {
  const f = fixture({ ...current(), view_version: 27 });
  await waitFor(() => Boolean(document.querySelector('.flower-computer-stage img')));
  let finish: (value: Awaited<ReturnType<typeof f.loadThread>>) => void = () => undefined;
  const calls = f.loadThread.mock.calls.length;
  f.loadThread.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.emit({ schema_version: 1, kind: 'summary.batch', summaries: [{ ...f.snapshot(), updated_at_ms: 3, read_status: { ...f.snapshot().read_status, snapshot: { activity_revision: 3 } } }] });
  await waitFor(() => f.loadThread.mock.calls.length > calls);
  f.restart({ ...current('cancelled'), view_version: 1 });
  await waitFor(() => f.connections() === 2);
  finish({ thread: applyFlowerRuntimeCurrentView(f.snapshot(), current()), current: { ...current(), view_version: 99 } });
  await waitFor(() => document.querySelector('.flower-computer-stage') === null);
  expect(f.surface.querySelector('.flower-computer-entry')?.textContent).toContain('Computer task stopped');
});
