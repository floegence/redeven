import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { AlertCircle, Check, ChevronDown, Clock, ExternalLink, XCircle } from '@floegence/floe-webapp-core/icons';
import type { FlowerParentEvent, FlowerParentEventPage, FlowerParentEventQuery } from './contracts/flowerSurfaceContracts';
import type { FlowerSubagentsCopy } from './copy';
import { SubagentAvatar } from './SubagentAvatar';
import { validateParentEventPage } from './parentEventPage';
import { FlowerReadDeadlineError, withFlowerReadDeadline } from './requestDeadline';

type ParentEventReader = (threadID: string, query: FlowerParentEventQuery) => Promise<FlowerParentEventPage>;

type EventReadRequest = Readonly<{ threadID: string; query: FlowerParentEventQuery }>;
type EventReadState = Readonly<
  { status: 'idle' } | { status: 'reading' | 'failed'; request: EventReadRequest; failure?: 'error' | 'timeout' }
>;
const emptyEvents: readonly FlowerParentEvent[] = [];

// Only presentation pages live here. Floret remains the event and admission owner.
export function createParentEventReading(props: Readonly<{
  threadID: string; page?: FlowerParentEventPage; read?: ParentEventReader;
  connectionEpoch?: number; timeoutMessage?: string;
}>) {
  const [extra, setExtra] = createSignal<readonly FlowerParentEvent[]>([]);
  const [bodies, setBodies] = createSignal<Readonly<Record<string, FlowerParentEvent>>>({});
  const [cursor, setCursor] = createSignal('');
  const [state, setState] = createSignal<EventReadState>({ status: 'idle' });
  let generation = 0;
  let controller: AbortController | undefined;
  let previousThread = '';
  let previousRange = '';
  let previousEpoch: number | undefined;
  let previousReader: ParentEventReader | undefined;
  let readIDs = new Set<string>();
  const invalidate = () => { generation++; controller?.abort(); controller = undefined; };
  onCleanup(invalidate);
  const events = createMemo(() => [...(props.page ? props.page.events : emptyEvents), ...extra()].map(event => ({
    ...event, ...(bodies()[event.id]?.message !== undefined ? { message: bodies()[event.id].message } : {}),
  })));
  const read = async (request: EventReadRequest) => {
    const reader = props.read;
    if (state().status === 'reading') return;
    if (!reader) { setState({ status: 'failed', request, failure: 'error' }); return; }
    const current = ++generation;
    controller = new AbortController();
    const previous = state();
    setState({ status: 'reading', request, ...(previous.status === 'failed' ? { failure: previous.failure } : {}) });
    try {
      const result = validateParentEventPage(await withFlowerReadDeadline(
        () => reader(request.threadID, request.query), props.timeoutMessage ?? 'Event read timed out.', controller.signal,
      ), request.threadID, request.query);
      if (current !== generation) return;
      const page = props.page;
      if (!page) { setState({ status: 'idle' }); return; }
      if (request.query.after_event_id && result.events.some(event => readIDs.has(event.id))) {
        throw new Error('Flower contract error: parent event continuation repeated a loaded event.');
      }
      if (!request.query.after_event_id) readIDs = new Set();
      for (const event of result.events) readIDs.add(event.id);
      const existing = new Set([...page.events, ...extra()].map(event => event.id));
      setBodies(previous => ({ ...previous, ...Object.fromEntries(result.events.map(event => [event.id, event])) }));
      setExtra(previous => [...previous, ...result.events.filter(event => !existing.has(event.id))]);
      setCursor(result.next_after_event_id ?? '');
      setState({ status: 'idle' });
    } catch (error) {
      if (current === generation) setState({ status: 'failed', request, failure: error instanceof FlowerReadDeadlineError ? 'timeout' : 'error' });
    } finally {
      if (current === generation) controller = undefined;
    }
  };
  const request = (more: boolean): EventReadRequest | undefined => {
    const page = props.page;
    if (!page?.first_event_id || !page.last_event_id || (more && !cursor())
      || page.thread_id !== props.threadID) return;
    return { threadID: props.threadID, query: { action: 'read', first_event_id: page.first_event_id,
      last_event_id: page.last_event_id, ...(more ? { after_event_id: cursor() } : {}), limit: 50 } };
  };
  createEffect(() => {
    const threadID = props.threadID;
    const page = props.page;
    const epoch = props.connectionEpoch;
    const reader = props.read;
    const range = JSON.stringify([page?.first_event_id, page?.last_event_id]);
    if (threadID === previousThread && range === previousRange && epoch === previousEpoch && reader === previousReader) return;
    const sameRange = threadID === previousThread && range === previousRange;
    const interrupted = untrack(state);
    invalidate();
    if (!sameRange) {
      const ids = new Set(page ? page.events.map(event => event.id) : []);
      readIDs = new Set(ids);
      setBodies(previous => threadID !== previousThread ? {} : Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))));
      setExtra([]); setCursor(page?.next_after_event_id ?? '');
    }
    previousThread = threadID; previousRange = range; previousEpoch = epoch;
    previousReader = reader;
    setState(sameRange && interrupted.status !== 'idle'
      ? { ...interrupted, status: 'failed', failure: interrupted.failure ?? (!reader ? 'error' : undefined) }
      : { status: 'idle' });
    untrack(() => {
      if (sameRange && interrupted.status !== 'idle') { void read(interrupted.request); return; }
      if (page?.events.some(event => event.kind === 'report' && event.message === undefined && !bodies()[event.id]?.message)) {
        const next = request(false);
        if (next) void read(next);
      }
    });
  });
  return { events, cursor, busy: () => state().status === 'reading', failed: () => state().status === 'failed',
    recovering: () => { const current = state(); return current.status !== 'idle' && current.failure !== undefined; },
    timedOut: () => { const current = state(); return current.status !== 'idle' && current.failure === 'timeout'; },
    retry: () => { const current = state(); return current.status === 'failed' ? read(current.request) : Promise.resolve(); },
    more: () => { const next = request(true); return next && state().status !== 'failed' ? read(next) : Promise.resolve(); } };
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
  let reportBody!: HTMLDivElement;
  const time = () => {
    const date = new Date(props.event.received_at);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  };
  return <article class="flower-parent-event" data-parent-event={props.event.id} data-parent-event-kind={props.event.kind}>
    <div class="flower-parent-event-heading">
      <SubagentAvatar threadID={props.event.source_thread_id} class="flower-parent-event-avatar" />
      <Show when={report()}><span class="flower-parent-event-type">{props.copy.events.report}</span></Show>
      <Show when={props.canOpenSource} fallback={<span class="flower-parent-event-source" title={props.sourceName}>{props.sourceName}</span>}>
        <button type="button" class="flower-parent-event-source" title={props.sourceName} onClick={props.onOpenSource}>{props.sourceName}</button>
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
        <Show when={message()}>
          <div ref={reportBody} id={`flower-parent-event-body-${encodeURIComponent(props.event.parent_thread_id + ':' + props.event.id)}`}
            class="flower-parent-event-body" data-parent-event-body={props.event.id} data-expanded={open()}>{message()}</div>
        </Show>
        <div class="flower-parent-event-actions">
          <Show when={message()}>
            <button type="button" class="flower-parent-event-action flower-parent-event-disclosure" data-flower-disclosure-trigger aria-expanded={open()}
              aria-controls={`flower-parent-event-body-${encodeURIComponent(props.event.parent_thread_id + ':' + props.event.id)}`}
              onClick={event => {
                props.onDisclosureClick(open() ? event.currentTarget : reportBody);
                setOpen(value => !value);
              }}>
              {open() ? props.copy.events.collapse : props.copy.events.read}<ChevronDown aria-hidden="true" />
            </button>
          </Show>
          <Show when={props.canOpenSource}>
            <button type="button" class="flower-parent-event-action flower-parent-event-open" onClick={props.onOpenSource}>
              {props.copy.events.open}<ExternalLink aria-hidden="true" />
            </button>
          </Show>
        </div>
      </div>
    </Show>
  </article>;
}
