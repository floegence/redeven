import '../index.css';
import './flower-feature.css';
import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerTurnHeader } from '../../../../flower_ui/src/FlowerTurnHeader';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerTurnProcess } from '../../../../flower_ui/src/flowerTurnPresentation';
import type { FlowerThreadStatus } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { sampleFlowerTurnClock } from '../../../../flower_ui/src/flowerTurnClock';
import { waitFor } from './FlowerSurface.navigation.testHarness';

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

function mountReveal(options: { historical?: boolean; reduced?: boolean; visible?: boolean; offscreen?: boolean } = {}) {
  const root = document.createElement('div'); document.body.append(root);
  root.style.width = '100%';
  const started = Date.parse('2026-11-02T00:00:00Z');
  const initial: FlowerTurnProcess = { turnID: 'turn', turn: { turn_id: 'turn', run_id: 'run', started_at: new Date(started).toISOString(),
    elapsed_ms: 0, work_duration_ms: 0, waiting_ms: 0, final_item_ids: [], final_boundary_complete: false },
    processKeys: [], processMembers: new Set(), parentEventCount: 0, interleavedInputs: false,
    countsComplete: true, inputResponseCount: 0, toolCallCount: 0, failedCallCount: 0, disclosure: 'none' };
  const completed = { ...initial, turn: { ...initial.turn!, outcome: 'completed' as const, ended_at: new Date(started + 90000).toISOString(),
    elapsed_ms: 90000, work_duration_ms: 90000 } };
  const [group, setGroup] = createSignal(options.historical ? completed : initial);
  const [status, setStatus] = createSignal<FlowerThreadStatus>('running');
  const [tick, setTick] = createSignal(0);
  const [visible, setVisible] = createSignal(options.visible ?? true);
  const [connected, setConnected] = createSignal(true);
  const [reduced, setReduced] = createSignal(options.reduced ?? false);
  const [toggle, setToggle] = createSignal(false);
  const [sample, setSample] = createSignal(sampleFlowerTurnClock('turn', started + 10000));
  const dispose = render(() => <><ShowSpacer /><FlowerTurnHeader group={group()} status={status()} sample={sample()}
    tick={tick} visible={visible} connected={connected} viewport={() => undefined} animate={() => true} reducedMotion={reduced}
    toggleable={toggle()} expanded={false} controls="process" copy={DEFAULT_FLOWER_SURFACE_COPY.chat.turnProcess} onToggle={() => {}} />
    <div data-following>Following content</div></>, root);
  function ShowSpacer() { return options.offscreen ? <div style={{ height: '2000px' }} /> : null; }
  disposers.push(() => { dispose(); root.remove(); });
  const header = root.querySelector<HTMLElement>('.flower-turn-summary')!;
  const text = () => header.querySelector<HTMLElement>('.flower-turn-header-text')!;
  return { root, header, text, setStatus, setTick, setVisible, setConnected, setReduced, dispose,
    complete: () => batch(() => { setGroup(completed); setToggle(true); }),
    toggle: setToggle,
    sample: (elapsed: number) => setSample(sampleFlowerTurnClock('turn', started + elapsed)),
  };
}

it('never blanks the line or replaces its text node when completion interrupts entrance', async () => {
  await page.viewport(1280, 900);
  const fixture = mountReveal();
  await waitFor(() => fixture.text().getAnimations().length === 1);
  const text = fixture.text();
  const entrance = text.getAnimations()[0];
  entrance.pause();
  entrance.currentTime = 40;
  fixture.complete();
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(fixture.text()).toBe(text);
  expect(text.getAnimations()).toEqual([entrance]);
  expect(getComputedStyle(text).clipPath).toBe('none');
  expect(Number(getComputedStyle(text).opacity)).toBeGreaterThanOrEqual(0.6);
});

it.each([320, 390, 1280])('keeps state changes readable without ghosting, layout movement or tick replay at %i pixels', async width => {
  await page.viewport(width, 900);
  const fixture = mountReveal();
  await waitFor(() => fixture.text().getAnimations().length === 1);
  const animation = fixture.text().getAnimations()[0];
  animation.pause();
  const duration = Number(animation.effect!.getTiming().duration);
  expect(duration).toBe(180);
  expect(animation.effect!.getTiming().easing).toMatch(/^cubic-bezier\(/);
  const geometry = () => [fixture.header.getBoundingClientRect().height, fixture.header.getBoundingClientRect().width,
    fixture.root.querySelector('[data-following]')!.getBoundingClientRect().top];
  const before = geometry();
  animation.currentTime = duration / 2;
  expect(getComputedStyle(fixture.text()).clipPath).toBe('none');
  expect(Number(getComputedStyle(fixture.text()).opacity)).toBeGreaterThanOrEqual(0.68);
  expect(fixture.text().textContent).toContain('In progress · Elapsed 10 seconds');
  for (let i = 1; i <= 120; i++) fixture.setTick(i);
  expect(fixture.text().getAnimations()).toEqual([animation]);
  expect(geometry()).toEqual(before);
  animation.finish();
  await waitFor(() => fixture.text().getAnimations().length === 0);
  const text = fixture.text();
  fixture.complete();
  await waitFor(() => Boolean(fixture.header.querySelector('button')) && fixture.text().getAnimations().length === 1);
  const settled = fixture.text().getAnimations()[0];
  expect(fixture.text()).toBe(text);
  expect(fixture.header.querySelectorAll('.flower-turn-header-text')).toHaveLength(1);
  expect(fixture.header.textContent).toBe('Completed · Total 1 minute 30 seconds');
  settled.pause();
  expect(settled.effect!.getTiming().duration).toBe(160);
  for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    settled.currentTime = Number(settled.effect!.getTiming().duration) * progress;
    expect(Number(getComputedStyle(text).opacity)).toBeGreaterThanOrEqual(0.88);
    expect(getComputedStyle(text).clipPath).toBe('none');
    expect(geometry()).toEqual(before);
    if (width === 390 && import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ element: fixture.header, path: '__screenshots__/flower-header-transition-' + progress + '.png' });
    }
  }
  settled.currentTime = 80;
  for (let i = 121; i <= 240; i++) fixture.setTick(i);
  expect(text.getAnimations()).toEqual([settled]);
  expect(settled).not.toBe(animation);
  expect(animation.playState).toBe('idle');
  expect(fixture.header.querySelector('button')!.getAttribute('aria-label')).toContain('Completed · Total 1 minute 30 seconds');
  expect(geometry()).toEqual(before);
  expect(fixture.header.scrollWidth).toBeLessThanOrEqual(fixture.header.clientWidth + 1);
  settled.finish();
  await waitFor(() => fixture.text().getAnimations().length === 0);
  expect(getComputedStyle(fixture.text()).clipPath).toBe('none');
});

it('keeps history, hidden, offscreen and reduced-motion headers immediate', async () => {
  await page.viewport(1280, 900);
  for (const options of [{ historical: true }, { reduced: true }, { visible: false }, { offscreen: true }]) {
    const fixture = mountReveal(options);
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(fixture.text().getAnimations()).toHaveLength(0);
    fixture.setVisible(true); fixture.setReduced(false); fixture.setTick(1);
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(fixture.text().getAnimations()).toHaveLength(0);
    fixture.dispose(); fixture.root.remove();
  }
});

it('settles motion for urgent states, reconnect, direct interaction and preference changes', async () => {
  const fixture = mountReveal();
  await waitFor(() => fixture.text().getAnimations().length === 1);
  fixture.text().getAnimations()[0].pause();
  fixture.setStatus('waiting_user');
  expect(fixture.text().getAnimations()).toHaveLength(0);
  expect(fixture.header.textContent).toContain('Waiting for your reply');
  fixture.setStatus('running');
  await waitFor(() => fixture.text().getAnimations().length === 1);
  fixture.setConnected(false);
  expect(fixture.text().getAnimations()).toHaveLength(0);
  fixture.setConnected(true);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(fixture.text().getAnimations()).toHaveLength(0);
  fixture.complete();
  await waitFor(() => fixture.text().getAnimations().length === 1);
  fixture.header.querySelector<HTMLButtonElement>('button')!.focus();
  expect(fixture.text().getAnimations()).toHaveLength(0);
  const next = mountReveal();
  await waitFor(() => next.text().getAnimations().length === 1);
  next.setReduced(true);
  expect(next.text().getAnimations()).toHaveLength(0);
  next.setReduced(false);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(next.text().getAnimations()).toHaveLength(0);
  const hidden = mountReveal();
  await waitFor(() => hidden.text().getAnimations().length === 1);
  hidden.setVisible(false);
  expect(hidden.text().getAnimations()).toHaveLength(0);
});

it('does not replay on timer changes, repeated completion or disclosure wrapper changes', async () => {
  const fixture = mountReveal();
  await waitFor(() => fixture.text().getAnimations().length === 1);
  fixture.text().getAnimations()[0].finish();
  await waitFor(() => fixture.text().getAnimations().length === 0);
  const text = fixture.text();
  const animate = vi.spyOn(text, 'animate');
  for (const elapsed of [11000, 59000, 60000, 61000]) fixture.sample(elapsed);
  expect(animate).not.toHaveBeenCalled();
  expect(text.textContent).toContain('1 minute 1 second');
  fixture.complete();
  await waitFor(() => text.getAnimations().length === 1);
  const motion = text.getAnimations()[0];
  motion.pause();
  for (let index = 0; index < 10; index++) { fixture.complete(); fixture.toggle(false); fixture.toggle(true); }
  expect(fixture.text()).toBe(text);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(fixture.header.querySelectorAll('.flower-turn-header-text')).toHaveLength(1);
  expect(fixture.header.textContent).toBe('Completed · Total 1 minute 30 seconds');
  const animations = fixture.header.getAnimations({ subtree: true });
  fixture.dispose();
  expect(animations.every(animation => animation.playState === 'idle')).toBe(true);
});

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
    tick={readTick} visible={visible} connected={connected} viewport={() => root} animate={() => false} reducedMotion={() => false}
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
    visible={() => true} connected={() => true} viewport={() => undefined} animate={() => false} reducedMotion={() => false} toggleable={toggle()}
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
