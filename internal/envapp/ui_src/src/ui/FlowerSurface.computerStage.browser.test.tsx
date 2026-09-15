import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { FlowerComputerUserInput, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { FlowerComputerStage } from '../../../../flower_ui/src/FlowerComputerStage';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const FRAME_REF = `computer://browser-main/${'a'.repeat(64)}`;
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Flower computer stage', () => {
  it('keeps decoded pixels during status updates and replacement frame loading', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const png = () => new Blob([Uint8Array.from(atob(ONE_PIXEL_PNG), (value) => value.charCodeAt(0))], { type: 'image/png' });
    let finishFrame: (blob: Blob) => void = () => undefined;
    const loadFrame = vi.fn(() => new Promise<Blob>((resolve) => { finishFrame = resolve; }));
    const [status, setStatus] = createSignal<'running' | 'success'>('running');
    const [frame, setFrame] = createSignal(FRAME_REF);
    const [owner, setOwner] = createSignal('thread');
    const dispose = render(() => <FlowerComputerStage
      snapshot={{ item: activityItem({ item_id: 'frame', status: status() }), status: status(), targetID: 'browser-main', target: 'Managed browser', action: 'Screenshot', location: 'local', safety: '' }}
      threadID={owner()} frameRef={frame()} loadFrame={loadFrame}
      copy={{ title: 'Computer', close: 'Close', noFrame: 'Loading', retry: 'Retry' }} onClose={() => undefined}
    />, host);
    try {
      await waitFor(() => loadFrame.mock.calls.length === 1);
      finishFrame(png());
      await waitFor(() => (host.querySelector('img') as HTMLImageElement | null)?.naturalWidth === 1);
      const originalURL = host.querySelector('img')!.src;
      setStatus('success');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(loadFrame).toHaveBeenCalledTimes(1);
      expect(host.querySelector('img')!.src).toBe(originalURL);
      setFrame(`computer://browser-main/${'b'.repeat(64)}`);
      await waitFor(() => loadFrame.mock.calls.length === 2);
      expect(host.querySelector('img')!.src).toBe(originalURL);
      finishFrame(png());
      await waitFor(() => host.querySelector('img')?.src !== originalURL);
      expect((host.querySelector('img') as HTMLImageElement).naturalWidth).toBe(1);
      expect(host.innerText.trim()).toBe('');
      setOwner('another-thread');
      await waitFor(() => loadFrame.mock.calls.length === 3);
      expect(host.querySelector('img')).toBeNull();
    } finally { dispose(); host.remove(); }
  });

  it('resolves opaque computer frames into an image in the floating stage', async () => {
    const threadID = 'computer-stage-thread';
    const current = thread({
      thread_id: threadID,
      title: 'Open test page',
      status: 'running',
      active_run_id: 'computer-run',
      messages: [{
        id: 'computer-message', turn_id: 'computer-turn', run_id: 'computer-run', role: 'assistant', content: '', status: 'streaming', created_at_ms: 10,
        blocks: [activityTimeline({
          thread_id: threadID, run_id: 'computer-run', turn_id: 'computer-turn', status: 'running',
          items: [activityItem({
            item_id: 'computer-screenshot', tool_id: 'computer-screenshot', tool_name: 'computer.screenshot',
            renderer: 'structured', status: 'running', label: 'Reading test page',
            target_refs: [{ kind: 'computer_frame', label: 'Redeven Managed Browser', resource_ref: FRAME_REF }],
            payload: { operation: 'screenshot', status: 'success' },
          })],
        })],
      }],
    });
    const loadComputerFrame = vi.fn(async () => new Blob([
      Uint8Array.from(atob(ONE_PIXEL_PNG), (value) => value.charCodeAt(0)),
    ], { type: 'image/png' })).mockRejectedValueOnce(new Error('FRAME_UNAVAILABLE'));
    let deliver: (envelope: FlowerLiveStreamEnvelope) => void = () => undefined;
    const setComputerViewer = vi.fn(async () => undefined);
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      loadComputerFrame,
      setComputerViewer,
      connectLiveStream: async function* ({ signal }) {
        yield { schema_version: 1, kind: 'ready', observer_id: 'observer-1', summaries: [current] };
        while (!signal.aborted) {
          const envelope = await new Promise<FlowerLiveStreamEnvelope | undefined>((resolve) => {
            const abort = () => resolve(undefined);
            deliver = (value) => { signal.removeEventListener('abort', abort); resolve(value); };
            signal.addEventListener('abort', abort, { once: true });
          });
          if (envelope) yield envelope;
        }
      },
      listThreads: vi.fn(async () => [current]),
      loadThread: vi.fn(async () => liveBootstrap(current, 1)),
    }, { focusThreadRequest: { request_id: 'focus-computer-stage', thread_id: threadID } });

    await waitFor(() => runtime.querySelector('.flower-computer-stage') !== null);
    await waitFor(() => loadComputerFrame.mock.calls.length === 1);
    await waitFor(() => runtime.querySelector('.flower-computer-stage-no-frame button') !== null);
    (runtime.querySelector('.flower-computer-stage-no-frame button') as HTMLButtonElement).click();
    await waitFor(() => (runtime.querySelector('.flower-computer-stage-frame') as HTMLImageElement | null)?.naturalWidth === 1);
    expect(runtime.querySelector('.flower-computer-stage')?.getAttribute('role')).toBe('dialog');
    expect(runtime.querySelector('.flower-computer-stage-header')).toBeNull();
    expect(runtime.querySelector('.flower-computer-stage-footer')).toBeNull();
    expect(runtime.querySelector('.flower-computer-stage-frame')).not.toBeNull();
    expect(loadComputerFrame).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: threadID, target_id: 'browser-main', resource_ref: FRAME_REF, sha256: 'a'.repeat(64),
    }));
    expect(loadComputerFrame).toHaveBeenCalledTimes(2);
    await waitFor(() => setComputerViewer.mock.calls.length > 0);
    expect(setComputerViewer).toHaveBeenCalledWith(expect.objectContaining({ observer_id: 'observer-1', thread_id: threadID, target_id: 'browser-main' }));
    const frame = { session_id: 'observer-1', target_id: 'browser-main', resource_ref: `computer://browser-main/${'b'.repeat(64)}`, sha256: 'b'.repeat(64), mime_type: 'image/png', sequence: 2 };
    deliver({ schema_version: 1, kind: 'computer.frame', thread_id: 'another-thread', computer_frame: frame });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(loadComputerFrame).toHaveBeenCalledTimes(2);
    deliver({ schema_version: 1, kind: 'computer.frame', thread_id: threadID, computer_frame: frame });
    await waitFor(() => loadComputerFrame.mock.calls.length === 3);
    await waitFor(() => (runtime.querySelector('.flower-computer-stage-frame') as HTMLImageElement | null)?.naturalWidth === 1);
    expect(loadComputerFrame).toHaveBeenLastCalledWith(expect.objectContaining({ resource_ref: frame.resource_ref }));
    expect(runtime.querySelector('.flower-computer-stage')?.textContent?.trim()).toBe('');
    // Completion retires the ephemeral sampler. A reopened viewer must load
    // the durable keyframe, never the expired last live sample.
    const completedBase = runtimeCurrentView({ ...current, status: 'success', run_progress: undefined }, 2);
    const completed = { ...completedBase, items: completedBase.items?.map((item) => {
      if (!item.activity) return item;
      const { label, description, renderer, payload, chips, target_refs, ...facts } = item.activity;
      return { ...item, activity: { ...facts, status: 'success', presentation: { label, description, renderer, payload, chips, target_refs } } };
    }) };
    deliver({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: completed });
    await waitFor(() => loadComputerFrame.mock.calls.length === 4);
    expect(loadComputerFrame).toHaveBeenLastCalledWith(expect.objectContaining({ resource_ref: FRAME_REF }));
    (runtime.querySelector('.flower-computer-stage-close') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-computer-stage') === null);
    await waitFor(() => setComputerViewer.mock.calls.length === 2);
    expect(setComputerViewer).toHaveBeenLastCalledWith({ observer_id: 'observer-1', revision: 2 });
    (runtime.querySelector('.flower-activity-inline-button[aria-expanded="false"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-activity-computer-block .flower-activity-inline-button') !== null);
    (runtime.querySelector('.flower-activity-computer-block .flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => (runtime.querySelector('.flower-computer-stage-frame') as HTMLImageElement | null)?.naturalWidth === 1);
    expect(loadComputerFrame).toHaveBeenLastCalledWith(expect.objectContaining({ resource_ref: FRAME_REF }));

    // A new run still displays the historical keyframe, but it cannot start
    // capturing a shared target until this run has actually observed it.
    const nextRun = { ...completed, view_version: 3, activity: 'active' as const, last_outcome: undefined,
      run_id: 'next-run', turn_id: 'next-turn', run_progress: { phase: 'preparing' as const } };
    deliver({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: nextRun });
    await waitFor(() => runtime.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-status') === 'running');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(setComputerViewer).toHaveBeenCalledTimes(2);

    const nextFrame = `computer://browser-main/${'c'.repeat(64)}`;
    const observed = completed.items!.find((item) => item.activity)!;
    deliver({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: { ...nextRun, view_version: 4,
      items: [...nextRun.items!, { ...observed, id: 'next-observation', ordinal: 100, run_id: 'next-run', turn_id: 'next-turn',
        activity: { ...observed.activity, tool_id: 'next-observation', status: 'success', presentation: {
          label: 'Screenshot', renderer: 'structured', payload: { operation: 'screenshot', status: 'success' },
          target_refs: [{ kind: 'computer_frame', label: 'Managed browser', resource_ref: nextFrame }],
        } },
      }],
    } });
    await waitFor(() => setComputerViewer.mock.calls.length === 3);
    expect(setComputerViewer).toHaveBeenLastCalledWith(expect.objectContaining({ thread_id: threadID, target_id: 'browser-main', resource_ref: nextFrame }));
  });
});

it('opens user-only pixels for canonical takeover without submitting typing as conversation input', async () => {
  const threadID = 'takeover-ui';
  const paused = thread({ thread_id: threadID, title: 'Sign in', status: 'waiting_user', active_run_id: 'run-control', messages: [{
    id: 'paused-message', turn_id: 'turn-control', run_id: 'run-control', role: 'assistant', content: '', status: 'complete', created_at_ms: 10,
    blocks: [activityTimeline({ thread_id: threadID, run_id: 'run-control', turn_id: 'turn-control', status: 'success', items: [activityItem({
      item_id: 'control-item', tool_id: 'control-call', tool_name: 'browser.navigate', renderer: 'structured', status: 'success',
      target_refs: [{ kind: 'computer_control', label: 'Managed Browser', resource_ref: 'browser-main' }], payload: { operation: 'navigate', status: 'success' },
    })] })],
  }] });
  const base = runtimeCurrentView(paused, 1);
  const canonical = { ...base, items: base.items?.map((item) => {
    if (!item.activity) return item;
    const { label, description, renderer, payload, chips, target_refs, ...facts } = item.activity;
    return { ...item, activity: { ...facts, presentation: { label, description, renderer, payload, chips, target_refs } } };
  }), interactions: [{
    id: 'tool-input:result-control', turn_id: 'turn-control', run_id: 'run-control', kind: 'input' as const, tool_call_id: 'control-call',
    input: { summary: 'External sign-in', questions: [{ id: 'computer_control', prompt: 'Return control', kind: 'select', options: ['Return control to Flower'] }] },
  }] };
  const png = () => new Blob([Uint8Array.from(atob(ONE_PIXEL_PNG), (value) => value.charCodeAt(0))], { type: 'image/png' });
  const inputComputerControl = vi.fn(async (_input: FlowerComputerUserInput) => png());
  const submitInput = vi.fn(async () => ({ thread_id: threadID, consumed_prompt_id: 'tool-input:result-control', current: { ...canonical, view_version: 3, activity: 'idle' as const, interactions: [], last_outcome: 'completed' as const } }));
  let deliver: (envelope: FlowerLiveStreamEnvelope) => void = () => undefined;
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), inputComputerControl, submitInput,
    connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 1, kind: 'ready', observer_id: 'takeover-observer', summaries: [paused] };
      while (!signal.aborted) {
        const envelope = await new Promise<FlowerLiveStreamEnvelope | undefined>((resolve) => {
          const abort = () => resolve(undefined);
          deliver = (value) => { signal.removeEventListener('abort', abort); resolve(value); };
          signal.addEventListener('abort', abort, { once: true });
        });
        if (envelope) yield envelope;
      }
    },
    listThreads: vi.fn(async () => [paused]), loadThread: vi.fn(async () => ({ thread: applyFlowerRuntimeCurrentView(paused, canonical), current: canonical })),
  }, { focusThreadRequest: { request_id: 'takeover-focus', thread_id: threadID } });
  const controlButton = () => Array.from(surface.querySelectorAll('button')).find((button) => button.textContent === 'Take control');
  await waitFor(() => Boolean(controlButton()));
  expect(surface.querySelector('.flower-computer-stage')).toBeNull();
  controlButton()!.click();
  await waitFor(() => (surface.querySelector('.flower-computer-stage img') as HTMLImageElement | null)?.naturalWidth === 1);
  const img = surface.querySelector('.flower-computer-stage img') as HTMLImageElement;
  img.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
  await waitFor(() => inputComputerControl.mock.calls.length === 2);
  expect(inputComputerControl).toHaveBeenLastCalledWith({ thread_id: threadID, interaction_id: 'tool-input:result-control', action: 'type', text: 's' });
  expect(submitInput).not.toHaveBeenCalled();
  expect(surface.querySelector('.flower-computer-stage')?.textContent?.trim()).toBe('');
  const handback = Array.from(surface.querySelectorAll('button')).find((button) => button.textContent === 'Return to Flower')!;
  await waitFor(() => !handback.disabled);
  const privateURL = surface.querySelector<HTMLImageElement>('.flower-computer-stage img')!.src;
  deliver({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: { ...canonical, view_version: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(surface.querySelector<HTMLImageElement>('.flower-computer-stage img')?.src).toBe(privateURL);
  expect(inputComputerControl).toHaveBeenCalledTimes(2);
  const rapidText = 'A'.repeat(80);
  for (const key of rapidText) img.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await waitFor(() => !handback.disabled);
  const forwarded = inputComputerControl.mock.calls.slice(2).map(([call]) => call.action === 'type' ? call.text : '').join('');
  expect(forwarded).toBe(rapidText);
  expect(submitInput).not.toHaveBeenCalled();
  const orderedStart = inputComputerControl.mock.calls.length;
  for (const key of ['a', 'b', 'Tab', 'c', 'd', 'Enter']) {
    img.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  await waitFor(() => !handback.disabled);
  expect(inputComputerControl.mock.calls.slice(orderedStart).map(([call]) => ({ action: call.action, value: call.text ?? call.key }))).toEqual([
    { action: 'type', value: 'ab' }, { action: 'key', value: 'Tab' }, { action: 'type', value: 'cd' }, { action: 'key', value: 'Enter' },
  ]);
  const beforeOverflow = inputComputerControl.mock.calls.length;
  for (let index = 0; index < 40; index++) img.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await waitFor(() => !handback.disabled);
  expect(inputComputerControl).toHaveBeenCalledTimes(beforeOverflow);
  expect(surface.querySelector('.flower-input-request [role="alert"]') ?? surface.querySelector('[role="alert"]')).not.toBeNull();
  img.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(inputComputerControl).toHaveBeenCalledTimes(beforeOverflow);
  controlButton()!.click();
  await waitFor(() => !handback.disabled);
  expect(inputComputerControl).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'observe' }));
  handback.click();
  await waitFor(() => submitInput.mock.calls.length === 1);
  expect(submitInput).toHaveBeenCalledWith(expect.objectContaining({ answers: { computer_control: { choice_id: 'Return control to Flower' } } }));
  await waitFor(() => surface.querySelector('.flower-computer-stage') === null);
});
