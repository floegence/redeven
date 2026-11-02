import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerTurnHeader } from '../../../../flower_ui/src/FlowerTurnHeader';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerTurnProcess } from '../../../../flower_ui/src/flowerTurnPresentation';
import { sampleFlowerTurnClock } from '../../../../flower_ui/src/flowerTurnClock';
import { waitFor } from './FlowerSurface.navigation.testHarness';

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

it('bounds clock subscriptions to visible active headers and restores elapsed time after reconnect', async () => {
  const root = document.createElement('div'); document.body.append(root);
  Object.assign(root.style, { height: '220px', width: '600px', overflow: 'auto' });
  const started = Date.parse('2026-11-02T00:00:00Z');
  const initial: FlowerTurnProcess = { turnID: 'turn', turn: { turn_id: 'turn', run_id: 'run', started_at: new Date(started).toISOString(),
    elapsed_ms: 0, work_duration_ms: 0, waiting_ms: 0, final_item_ids: [], final_boundary_complete: false },
    processKeys: [], processMembers: new Set(), parentEventCount: 0, interleavedInputs: false,
    countsComplete: true, inputResponseCount: 0, toolCallCount: 0, failedCallCount: 0, disclosure: 'none' };
  const [group, setGroup] = createSignal(initial);
  const [sample, setSample] = createSignal(sampleFlowerTurnClock('turn', started + 10000));
  const [tick, setTick] = createSignal(0);
  const [visible, setVisible] = createSignal(true);
  const [connected, setConnected] = createSignal(true);
  const readTick = vi.fn(tick);
  const dispose = render(() => <><FlowerTurnHeader group={group()} status="running" sample={sample()}
    tick={readTick} visible={visible} connected={connected} viewport={() => root}
    toggleable={false} expanded={true} controls="" copy={DEFAULT_FLOWER_SURFACE_COPY.chat.turnProcess} onToggle={() => {}} />
    <div style={{ height: '900px' }} /></>, root);
  disposers.push(() => { dispose(); root.remove(); });
  await waitFor(() => readTick.mock.calls.length > 0);
  readTick.mockClear();
  for (let i = 1; i <= 120; i++) setTick(i);
  expect(readTick).toHaveBeenCalledTimes(120);
  setVisible(false); readTick.mockClear();
  for (let i = 121; i <= 240; i++) setTick(i);
  expect(readTick).not.toHaveBeenCalled();
  setVisible(true);
  await waitFor(() => readTick.mock.calls.length > 0);
  root.scrollTop = 500;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise(resolve => setTimeout(resolve, 60));
  readTick.mockClear();
  setTick(241);
  expect(readTick).not.toHaveBeenCalled();
  root.scrollTop = 0;
  await waitFor(() => readTick.mock.calls.length > 0);
  setConnected(false); readTick.mockClear();
  const frozen = root.querySelector('.flower-turn-header-time')!.textContent;
  setTick(242);
  expect(readTick).not.toHaveBeenCalled();
  expect(root.textContent).toContain('Reconnecting');
  expect(root.querySelector('.flower-turn-header-time')!.textContent).toBe(frozen);
  setSample(sampleFlowerTurnClock('turn', started + 3600000, sample()));
  setConnected(true);
  await waitFor(() => Boolean(root.textContent?.includes('1 hour')));
  setGroup({ ...initial, turn: { ...initial.turn!, outcome: 'completed', ended_at: new Date(started + 3601000).toISOString(),
    elapsed_ms: 3601000, work_duration_ms: 1000, waiting_ms: 3600000 } });
  readTick.mockClear();
  for (let i = 243; i <= 360; i++) setTick(i);
  expect(readTick).not.toHaveBeenCalled();
  expect(root.textContent).toContain('Completed · Total 1 hour 1 second');
});

it.each([320, 390, 1280])('keeps live and terminal header geometry stable at %i pixels', async width => {
  await page.viewport(width, 900);
  const root = document.createElement('div'); document.body.append(root);
  root.style.width = '100%';
  const started = Date.parse('2026-11-02T00:00:00Z');
  const initial: FlowerTurnProcess = { turnID: 'turn', turn: { turn_id: 'turn', run_id: 'run', started_at: new Date(started).toISOString(),
    elapsed_ms: 0, work_duration_ms: 0, waiting_ms: 0, final_item_ids: [], final_boundary_complete: false },
    processKeys: [], processMembers: new Set(), parentEventCount: 0, interleavedInputs: false,
    countsComplete: true, inputResponseCount: 0, toolCallCount: 0, failedCallCount: 0, disclosure: 'none' };
  const [group, setGroup] = createSignal(initial);
  const [sample, setSample] = createSignal(sampleFlowerTurnClock('turn', started + 59000));
  const [toggle, setToggle] = createSignal(false);
  const dispose = render(() => <FlowerTurnHeader group={group()} status="running" sample={sample()} tick={() => 0}
    visible={() => true} connected={() => true} viewport={() => undefined} toggleable={toggle()}
    expanded={false} controls="" copy={DEFAULT_FLOWER_SURFACE_COPY.chat.turnProcess} onToggle={() => {}} />, root);
  disposers.push(() => { dispose(); root.remove(); });
  const header = root.querySelector<HTMLElement>('.flower-turn-summary')!;
  const height = header.getBoundingClientRect().height;
  const contentWidth = header.firstElementChild!.getBoundingClientRect().width;
  for (const elapsed of [60000, 599000, 600000, 3599000, 3600000, 360000000]) {
    setSample(sampleFlowerTurnClock('turn', started + elapsed, sample()));
    expect(header.getBoundingClientRect().height).toBe(height);
    expect(header.firstElementChild!.getBoundingClientRect().width).toBe(contentWidth);
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
  }
  setGroup({ ...initial, turn: { ...initial.turn!, outcome: 'completed', ended_at: new Date(started + 360000000).toISOString(),
    elapsed_ms: 360000000, work_duration_ms: 360000000 } });
  setToggle(true);
  expect(header.getBoundingClientRect().height).toBe(height);
  expect(header.firstElementChild!.getBoundingClientRect().width).toBe(contentWidth);
  expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth + 1);
});
