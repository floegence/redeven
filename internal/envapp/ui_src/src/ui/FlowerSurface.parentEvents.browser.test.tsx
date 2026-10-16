import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ParentEventsPanel } from '../../../../flower_ui/src/ParentEventsPanel';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerParentEvent, FlowerParentEventPage } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const event = (id: string): FlowerParentEvent => ({ id, parent_thread_id: 'parent', source_thread_id: 'child', source_turn_id: 'turn-child', source_run_id: 'run-child', source_entry_id: 'entry-' + id, kind: 'report', received_at: '2026-10-16T00:00:00Z', admitted: false });

it('reads complete Unicode reports, pages a fixed range and refreshes admission without claiming model read', async () => {
 const host = document.createElement('div'); document.body.append(host);
 const first = event('first'), last = event('last');
 const [value, setValue] = createSignal<FlowerParentEventPage>({ events: [first], first_event_id: first.id, last_event_id: last.id, next_after_event_id: first.id });
 const message = '界'.repeat(2700);
 const read = vi.fn(async (_thread: string, query: { event_id?: string }) => query.event_id
  ? { events: [{ ...first, message }] }
  : { events: [last], first_event_id: first.id, last_event_id: last.id });
 const open = vi.fn();
 const dispose = render(() => <ParentEventsPanel threadID="parent" page={value()} copy={DEFAULT_FLOWER_SURFACE_COPY.subagents!} sourceName={() => 'Research'} onOpenSource={open} read={read} />, host);
 onTestFinished(() => { dispose(); host.remove(); });
 const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === text)!;
 button(DEFAULT_FLOWER_SURFACE_COPY.subagents!.events.read).click();
 await waitFor(() => Boolean(host.querySelector('[data-parent-event-body]')));
 expect(host.querySelector('[data-parent-event-body]')?.textContent).toBe(message);
 button(DEFAULT_FLOWER_SURFACE_COPY.subagents!.events.more).click();
 await waitFor(() => host.querySelectorAll('[data-parent-event]').length === 2);
 expect(read).toHaveBeenLastCalledWith('parent', { action: 'read', first_event_id: 'first', last_event_id: 'last', after_event_id: 'first', limit: 50 });
 button('Research').click(); expect(open).toHaveBeenCalledWith('child');
 setValue({ ...value(), events: [{ ...first, admitted: true }] });
 await waitFor(() => host.textContent!.includes(DEFAULT_FLOWER_SURFACE_COPY.subagents!.events.admitted));
 expect(host.querySelector('[data-parent-event-body]')?.textContent).toBe(message);
 expect(host.textContent).not.toContain('model read');
});

for (const theme of ['light', 'dark']) it('keeps event disclosures scrollable in a narrow projected surface in ' + theme, async () => {
 await page.viewport(380, 780);
 document.documentElement.classList.add(theme);
 onTestFinished(() => document.documentElement.classList.remove(theme));
 const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'child', task_name: 'Research', status: 'running' });
 const events = { events: [event('first')], first_event_id: 'first', last_event_id: 'first' };
 const parent = thread({ thread_id: 'parent', subagents: [child], parent_events: events });
 const initial = liveBootstrap(parent, 1);
 const bootstrap = { ...initial, current: { ...initial.current, parent_events: events } };
 const read = vi.fn(async () => ({ events: [{ ...event('first'), message: 'Long complete report '.repeat(500) }] }));
 const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => bootstrap), readParentEvents: read }, { focusThreadRequest: { request_id: 'focus-events', thread_id: 'parent' } });
 runtime.style.height = '720px'; runtime.style.transform = 'translate(4px, 2px) scale(0.95)'; runtime.style.transformOrigin = 'top left';
 await waitFor(() => Boolean(runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]')));
 runtime.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
 await waitFor(() => Boolean(document.querySelector('[data-parent-event="first"]')));
 const dropdown = document.querySelector<HTMLElement>('.flower-subagents-dropdown')!;
 expect(dropdown.closest('[data-floe-surface-floating-layer]')).not.toBeNull();
 expect(dropdown.style.position).not.toBe('fixed');
 const readButton = [...dropdown.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === DEFAULT_FLOWER_SURFACE_COPY.subagents!.events.read)!;
 expect(getComputedStyle(readButton).cursor).toBe('pointer'); readButton.click();
 await waitFor(() => Boolean(dropdown.querySelector('[data-parent-event-body]')));
 const viewport = dropdown.querySelector<HTMLElement>('.flower-subagents-dropdown-content')!;
 expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
 expect(dropdown.scrollWidth).toBeLessThanOrEqual(dropdown.clientWidth + 1);
 expect(dropdown.getBoundingClientRect().right).toBeLessThanOrEqual(380);
 await page.screenshot({ element: dropdown, path: '__screenshots__/parent-events/' + theme + '.png' });
});
