import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { AlertCircle, Check, ChevronDown, Clock, ExternalLink, XCircle } from '@floegence/floe-webapp-core/icons';
import type { FlowerParentEvent, FlowerParentEventPage, FlowerParentEventQuery } from './contracts/flowerSurfaceContracts';
import type { FlowerSubagentsCopy } from './copy';
import { SubagentAvatar } from './SubagentAvatar';

type ParentEventReader = (threadID: string, query: FlowerParentEventQuery) => Promise<FlowerParentEventPage>;

// Only presentation pages live here. Floret remains the event and admission owner.
export function createParentEventReading(props: Readonly<{
  threadID: string; page?: FlowerParentEventPage; read?: ParentEventReader;
}>) {
  const [extra, setExtra] = createSignal<readonly FlowerParentEvent[]>([]);
  const [bodies, setBodies] = createSignal<Readonly<Record<string, FlowerParentEvent>>>({});
  const [cursor, setCursor] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let generation = 0;
  let previousThread = '';
  let previousRange = '';
  onCleanup(() => { generation++; });
  const events = createMemo(() => [...(props.page?.events ?? []), ...extra()].map(event => ({
    ...event, ...(bodies()[event.id]?.message !== undefined ? { message: bodies()[event.id].message } : {}),
  })));
  const read = async (more: boolean) => {
    if (!props.read || busy()) return;
    const page = props.page;
    if (!page?.first_event_id || !page.last_event_id || page.events.some(event => event.parent_thread_id !== props.threadID)) return;
    const current = generation;
    setBusy(true); setFailed(false);
    try {
      const result = await props.read(props.threadID, { action: 'read', first_event_id: page.first_event_id,
        last_event_id: page.last_event_id, ...(more ? { after_event_id: cursor() } : {}), limit: 50 });
      if (current !== generation) return;
      setBodies(previous => ({ ...previous, ...Object.fromEntries(result.events.map(event => [event.id, event])) }));
      const existing = new Set((more ? [...(page.events ?? []), ...extra()] : page.events).map(event => event.id));
      setExtra(previous => [...(more ? previous : []), ...result.events.filter(event => !existing.has(event.id))]);
      setCursor(result.next_after_event_id ?? '');
    } catch {
      if (current === generation) setFailed(true);
    } finally {
      if (current === generation) setBusy(false);
    }
  };
  createEffect(() => {
    const threadID = props.threadID;
    const page = props.page;
    const range = JSON.stringify([page?.first_event_id, page?.last_event_id]);
    if (threadID === previousThread && range === previousRange) return;
    generation++;
    const ids = new Set(page?.events.map(event => event.id));
    setBodies(previous => threadID !== previousThread ? {} : Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))));
    previousThread = threadID; previousRange = range;
    setExtra([]); setCursor(page?.next_after_event_id ?? ''); setBusy(false); setFailed(false);
    if (page?.events.some(event => event.kind === 'report' && event.message === undefined)) untrack(() => void read(false));
  });
  return { events, cursor, busy, failed, retry: () => read(false), more: () => read(true) };
}

export function parentEventLabel(event: FlowerParentEvent, copy: FlowerSubagentsCopy): string {
  switch (event.kind) {
    case 'report': return copy.events.report;
    case 'input_required': return copy.events.input;
    case 'approval_required': return copy.events.approval;
    case 'interrupted': return copy.events.interrupted;
    case 'cancelled': return copy.statusLabels.canceled;
    default: return copy.statusLabels[event.kind];
  }
}

export function ParentEventRow(props: Readonly<{
  event: FlowerParentEvent; copy: FlowerSubagentsCopy; sourceName: string;
  canOpenSource: boolean; onOpenSource: () => void; onDisclosureClick: (title: HTMLElement) => void;
}>) {
  const [open, setOpen] = createSignal(false);
  const report = () => props.event.kind === 'report';
  const message = () => props.event.message ?? '';
  const preview = () => message().trim().split(/\r?\n/, 1)[0];
  const time = () => {
    const date = new Date(props.event.received_at);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  };
  return <article class="flower-parent-event" data-parent-event={props.event.id} data-parent-event-kind={props.event.kind}>
    <div class="flower-parent-event-heading">
      <SubagentAvatar threadID={props.event.source_thread_id} class="flower-parent-event-avatar" />
      <Show when={report()}><span class="flower-parent-event-type">{props.copy.events.report}</span></Show>
      <Show when={props.canOpenSource} fallback={<span class="flower-parent-event-source">{props.sourceName}</span>}>
        <button type="button" class="flower-parent-event-source" onClick={props.onOpenSource}>{props.sourceName}</button>
      </Show>
      <Show when={!report()}>
        <span class="flower-parent-event-status">
          <Show when={props.event.kind === 'completed'} fallback={
            <Show when={props.event.kind === 'cancelled'} fallback={
              <Show when={props.event.kind === 'timed_out' || props.event.kind === 'interrupted'} fallback={<AlertCircle aria-hidden="true" />}>
                <Clock aria-hidden="true" />
              </Show>
            }><XCircle aria-hidden="true" /></Show>
          }><Check aria-hidden="true" /></Show>
          {parentEventLabel(props.event, props.copy)}
        </span>
      </Show>
      <time dateTime={props.event.received_at}>{time()}</time>
      <Show when={!report() && props.canOpenSource}>
        <button type="button" class="flower-parent-event-action flower-parent-event-open" onClick={props.onOpenSource}>
          {props.copy.events.open}<ExternalLink aria-hidden="true" />
        </button>
      </Show>
    </div>
    <Show when={report()}>
      <div class="flower-parent-event-report">
        <Show when={preview()}><p class="flower-parent-event-preview">{preview()}</p></Show>
        <div class="flower-parent-event-actions">
          <Show when={message()}>
            <button type="button" class="flower-parent-event-action flower-parent-event-disclosure" data-flower-disclosure-trigger aria-expanded={open()}
              aria-controls={`flower-parent-event-body-${encodeURIComponent(props.event.parent_thread_id + ':' + props.event.id)}`}
              onClick={event => { props.onDisclosureClick(event.currentTarget); setOpen(value => !value); }}>
              {open() ? props.copy.events.collapse : props.copy.events.read}<ChevronDown aria-hidden="true" />
            </button>
          </Show>
          <Show when={props.canOpenSource}>
            <button type="button" class="flower-parent-event-action flower-parent-event-open" onClick={props.onOpenSource}>
              {props.copy.events.open}<ExternalLink aria-hidden="true" />
            </button>
          </Show>
        </div>
        <Show when={open()}>
          <div id={`flower-parent-event-body-${encodeURIComponent(props.event.parent_thread_id + ':' + props.event.id)}`}
            class="flower-parent-event-body" data-parent-event-body={props.event.id}>{message()}</div>
        </Show>
      </div>
    </Show>
  </article>;
}
