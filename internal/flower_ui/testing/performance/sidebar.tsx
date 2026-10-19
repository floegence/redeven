import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { FlowerSurface } from '../../src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../../src/composer/createFlowerComposerDraftCoordinator';
import { applyFlowerRuntimeCurrentView } from '../../src/runtimeCurrentView';
import { streamingFixture } from '../streamingFixture';
import type { FlowerThreadPinMetadata, FlowerThreadSnapshot } from '../../src/contracts/flowerSurfaceContracts';
import '../../../../desktop/src/welcome/index.css';

window.__flowerPerfCounts = { parses: 0, lexes: 0 };
const fixture = streamingFixture(610, 220);
const base = fixture.thread;
const current = fixture.current();
const smallID = 'sidebar-small';
const bigID = 'sidebar-large';
let summaries: FlowerThreadSnapshot[] = Array.from({ length: 247 }, (_, index) => ({
  ...base, thread_id: index === 0 ? smallID : index === 1 ? bigID : 'sidebar-' + index,
  title: index === 0 ? 'Small conversation' : index === 1 ? 'Large conversation' : 'Conversation title ' + index,
  created_at_ms: Date.now() - index * 1000, pinned_at_ms: index > 1 && index < 5 ? 10 - index : 0,
  pin_rank: index > 1 && index < 5 ? 10 - index : 0,
}));
let nextPinFailure = false;
let pinDelay = 100;
let listDelay = 0;
let pinStarted = 0;
let pinSettled = 0;
let listStarted = 0;
let listSettled = 0;
const pinCalls: { id: string; pinned: boolean }[] = [];
let loads = 0;
let lastContent = '';
const selectionEvents: unknown[] = [];
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const summary = (id: string) => summaries.find(value => value.thread_id === id)!;
const commitPins = (pins: readonly FlowerThreadPinMetadata[]) => {
  summaries = summaries.map(value => ({ ...value, ...pins.find(pin => pin.thread_id === value.thread_id) }));
  fixture.emit({ schema_version: 1, kind: 'summary.batch', summaries });
};
const confirmPins = async (pins: readonly FlowerThreadPinMetadata[]) => {
  pinStarted++;
  try {
    await pause(pinDelay);
    if (nextPinFailure) { nextPinFailure = false; throw new Error('Fixture pin failure'); }
    commitPins(pins);
    return pins;
  } finally { pinSettled++; }
};
const root = document.getElementById('root')!;
root.style.height = '100vh';
render(() => <FloeProvider><FlowerSurface notify={() => undefined} draftCoordinator={createFlowerComposerDraftCoordinator()} adapter={{
  ...fixture.adapter,
  listThreads: async () => {
    listStarted++;
    const snapshot = summaries;
    try { await pause(listDelay); return snapshot; } finally { listSettled++; }
  },
  loadThread: async id => {
    loads++;
    const view = { ...current, thread_id: id, items: id === bigID ? current.items : current.items?.slice(0, 2), queue: [] };
    return { thread: applyFlowerRuntimeCurrentView(summary(id), view), current: view };
  },
  setThreadPinned: async (id, pinned) => {
    pinCalls.push({ id, pinned });
    return (await confirmPins([{ thread_id: id, pinned_at_ms: pinned ? Date.now() : 0,
      pin_rank: pinned ? Math.max(...summaries.map(value => value.pin_rank || 0)) + 1 : 0, settings_revision: summary(id).settings_revision! + 1 }]))[0];
  },
  movePinnedThread: async (id, position) => confirmPins([
    { thread_id: id, pin_rank: summary(position.anchor_thread_id).pin_rank!, pinned_at_ms: summary(id).pinned_at_ms!, settings_revision: summary(id).settings_revision! + 1 },
    { thread_id: position.anchor_thread_id, pin_rank: summary(id).pin_rank!, pinned_at_ms: summary(position.anchor_thread_id).pinned_at_ms!, settings_revision: summary(position.anchor_thread_id).settings_revision! + 1 },
  ]),
  async *connectLiveStream(input) {
    yield { schema_version: 1 as const, kind: 'ready' as const, summaries };
    for await (const event of fixture.adapter.connectLiveStream!(input)) {
      if (event.kind !== 'ready') yield event;
    }
  },
}} onThreadSelectionEvent={event => {
  selectionEvents.push({ ...event, rows: root.querySelectorAll('.flower-turn-row').length, parses: window.__flowerPerfCounts.parses });
  performance.mark('sidebar-selection-' + event.phase);
  if (event.phase === 'content_presented') lastContent = event.value;
}} /></FloeProvider>, root);

async function until(condition: () => boolean) {
  const deadline = performance.now() + 10000;
  while (!condition()) { if (performance.now() > deadline) throw new Error('Sidebar fixture timed out'); await pause(10); }
}
const sidebar = {
  smallID, bigID,
  pinState: () => ({ pinStarted, pinSettled, listStarted, listSettled, pinCalls: [...pinCalls] }),
  setDelays(pin: number, list: number) { pinDelay = pin; listDelay = list; },
  failNextPin() { nextPinFailure = true; },
  updateTitle(id: string) {
    const value = summary(id);
    summaries = summaries.map(item => item.thread_id === id ? { ...item, title: item.title + ' updated', title_generation: (item.title_generation || 0) + 1 } : item);
    fixture.emit({ schema_version: 1, kind: 'summary.batch', summaries });
  },
  async select(id: string) {
    await until(() => !!root.querySelector('[data-thread-id="' + id + '"]'));
    selectionEvents.length = 0; lastContent = ''; window.__flowerPerfCounts = { parses: 0, lexes: 0 };
    const beforeRows = root.querySelectorAll('.flower-turn-row').length;
    const committedBefore = root.querySelector('main')!.getAttribute('data-flower-selected-thread-id');
    const start = performance.now();
    root.querySelector<HTMLButtonElement>('[data-thread-id="' + id + '"] .flower-thread-card-select-button')!.click();
    const syncMs = performance.now() - start;
    const synchronous = { parses: window.__flowerPerfCounts.parses, rows: root.querySelectorAll('.flower-turn-row').length,
      active: root.querySelector('[data-flower-thread-active="true"]')?.getAttribute('data-thread-id'),
      committed: root.querySelector('main')!.getAttribute('data-flower-selected-thread-id') };
    const frameMs = await new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now() - start)));
    await until(() => lastContent === id);
    await pause(80);
    return { id, syncMs, frameMs, beforeRows, committedBefore, synchronous, loads, events: [...selectionEvents] };
  },
};
Object.assign(window, { flowerSidebar: sidebar });
