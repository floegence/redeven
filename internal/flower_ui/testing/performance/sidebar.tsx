import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { FlowerSurface } from '../../src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../../src/composer/createFlowerComposerDraftCoordinator';
import { applyFlowerRuntimeCurrentView } from '../../src/runtimeCurrentView';
import { streamingFixture } from '../streamingFixture';
import { qualifyDetailReads } from './detailReads';
import type { FlowerThreadPinMetadata, FlowerThreadSnapshot } from '../../src/contracts/flowerSurfaceContracts';
import '../../../../desktop/src/welcome/index.css';

window.__flowerPerfCounts = { parses: 0, lexes: 0 };
const fixture = streamingFixture(610, 220);
const base = fixture.thread;
const current = fixture.current();
const hugeCurrent = streamingFixture(4010, 0).current();
const smallID = 'sidebar-small';
const bigID = 'sidebar-large';
const hugeID = 'sidebar-huge';
let summaries: FlowerThreadSnapshot[] = Array.from({ length: 247 }, (_, index) => ({
  ...base, thread_id: index === 0 ? smallID : index === 1 ? bigID : index === 8 ? hugeID : 'sidebar-' + index,
  title: index === 0 ? 'Small conversation' : index === 1 ? 'Large conversation' : index === 8 ? 'Very large conversation' : 'Conversation title ' + index,
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
  fixture.emit({ schema_version: 3, kind: 'summary.batch', summaries });
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
    const view = { ...current, thread_id: id, items: id === hugeID ? hugeCurrent.items : id === bigID ? current.items : current.items?.slice(0, 2), queue: [] };
    return { thread: applyFlowerRuntimeCurrentView(summary(id), view), current: view };
  },
  setThreadPinned: async (id, pinned) => {
    pinCalls.push({ id, pinned });
    const target = summary(id);
    const retained = pinned && !target.pinned_at_ms
      ? summaries.filter(value => value.pinned_at_ms).sort((a, b) => b.pin_rank! - a.pin_rank!)
      : [];
    return confirmPins([
      ...retained.map((value, index) => ({ thread_id: value.thread_id, pinned_at_ms: value.pinned_at_ms!,
        pin_rank: retained.length - index + 1, settings_revision: value.settings_revision! + 1 })),
      { thread_id: id, pinned_at_ms: pinned ? target.pinned_at_ms || Date.now() : 0,
        pin_rank: pinned ? target.pin_rank || 1 : 0, settings_revision: target.settings_revision! + 1 },
    ]);
  },
  movePinnedThread: async (id, position) => confirmPins([
    { thread_id: id, pin_rank: summary(position.anchor_thread_id).pin_rank!, pinned_at_ms: summary(id).pinned_at_ms!, settings_revision: summary(id).settings_revision! + 1 },
    { thread_id: position.anchor_thread_id, pin_rank: summary(id).pin_rank!, pinned_at_ms: summary(position.anchor_thread_id).pinned_at_ms!, settings_revision: summary(position.anchor_thread_id).settings_revision! + 1 },
  ]),
  async *connectLiveStream(input) {
    yield { schema_version: 3 as const, kind: 'ready' as const, baseline_complete: true, summaries };
    for await (const event of fixture.adapter.connectLiveStream!(input)) {
      if (event.kind !== 'ready') yield event;
    }
  },
}} onThreadSelectionEvent={event => {
  const row = event.phase === 'commit_started' ? root.querySelector<HTMLElement>('[data-thread-id="' + event.value + '"]') : null;
  selectionEvents.push({ ...event, rows: root.querySelectorAll('.flower-turn-row').length, parses: window.__flowerPerfCounts.parses,
    background: row ? getComputedStyle(row).backgroundColor : undefined, hovered: row?.matches(':hover') });
  performance.mark('sidebar-selection-' + event.phase);
  if (event.phase === 'content_presented') lastContent = event.value;
}} /></FloeProvider>, root);

async function until(condition: () => boolean) {
  const deadline = performance.now() + 10000;
  while (!condition()) { if (performance.now() > deadline) throw new Error('Sidebar fixture timed out'); await pause(10); }
}
const sidebar = {
  qualifyDetailReads,
  smallID, bigID, hugeID,
  beginResizeStream() {
    let version = current.view_version;
    let count = 0;
    let offset = new TextEncoder().encode(current.items!.find(item => item.id === 'streaming-tail')!.text!).length;
    const timer = window.setInterval(() => {
      const text = ` resize-live-${++count} `;
      fixture.emit({ schema_version: 3, kind: 'thread.batch', thread_id: bigID, update: {
        thread_id: bigID, turn_id: current.turn_id!, run_id: current.run_id!, base_version: version, view_version: ++version,
        facts: { activity: current.activity, queue_count: 0, run_progress: current.run_progress },
        items: [{ kind: 'append', item_id: 'streaming-tail', append: { offset_bytes: offset, text } }],
      } });
      offset += new TextEncoder().encode(text).length;
    }, 50);
    return () => { window.clearInterval(timer); return count; };
  },
  pinState: () => ({ pinStarted, pinSettled, listStarted, listSettled, pinCalls: [...pinCalls] }),
  setDelays(pin: number, list: number) { pinDelay = pin; listDelay = list; },
  failNextPin() { nextPinFailure = true; },
  updateTitle(id: string) {
    const value = summary(id);
    summaries = summaries.map(item => item.thread_id === id ? { ...item, title: item.title + ' updated', title_generation: (item.title_generation || 0) + 1 } : item);
    fixture.emit({ schema_version: 3, kind: 'summary.batch', summaries });
  },
  async select(id: string) {
    await until(() => !!root.querySelector('[data-thread-id="' + id + '"]'));
    selectionEvents.length = 0; lastContent = ''; window.__flowerPerfCounts = { parses: 0, lexes: 0 };
    const beforeRows = root.querySelectorAll('.flower-turn-row').length;
    const committedBefore = root.querySelector('main')!.getAttribute('data-flower-selected-thread-id');
    const row = root.querySelector<HTMLElement>('[data-thread-id="' + id + '"]')!;
    const bounds = row.getBoundingClientRect();
    const sample = { x: bounds.x + bounds.width / 2, y: bounds.y + 3, viewportWidth: innerWidth };
    const start = performance.now();
    root.querySelector<HTMLButtonElement>('[data-thread-id="' + id + '"] .flower-thread-card-select-button')!.click();
    const syncMs = performance.now() - start;
    const synchronous = { parses: window.__flowerPerfCounts.parses, rows: root.querySelectorAll('.flower-turn-row').length,
      active: root.querySelector('[data-flower-thread-active="true"]')?.getAttribute('data-thread-id'),
      committed: root.querySelector('main')!.getAttribute('data-flower-selected-thread-id') };
    const frameMs = await new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now() - start)));
    await until(() => lastContent === id);
    await pause(80);
    return { id, syncMs, frameMs, beforeRows, committedBefore, synchronous, loads, events: [...selectionEvents],
      sample, background: getComputedStyle(row).backgroundColor };
  },
};
Object.assign(window, { flowerSidebar: sidebar });
