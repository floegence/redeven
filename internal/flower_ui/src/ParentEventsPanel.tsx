import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { FlowerParentEvent, FlowerParentEventPage, FlowerParentEventQuery } from './contracts/flowerSurfaceContracts';
import type { FlowerSubagentsCopy } from './copy';

export type ParentEventsPanelProps = Readonly<{
  threadID: string;
  page?: FlowerParentEventPage;
  copy: FlowerSubagentsCopy;
  sourceName: (id: string) => string;
  onOpenSource: (id: string) => void;
  canOpenSource?: (id: string) => boolean;
  read?: (threadID: string, query: FlowerParentEventQuery) => Promise<FlowerParentEventPage>;
}>;

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

// Local state contains only explicit reading pages and their disclosure state.
// Receipt/admission truth always comes from the current canonical view.
export function ParentEventsPanel(props: ParentEventsPanelProps) {
  const [extra, setExtra] = createSignal<readonly FlowerParentEvent[]>([]);
  const [cursor, setCursor] = createSignal('');
  const [bodies, setBodies] = createSignal<Readonly<Record<string, FlowerParentEvent>>>({});
  const [open, setOpen] = createSignal('');
  const [busy, setBusy] = createSignal('');
  const [failed, setFailed] = createSignal(false);
  let generation = 0;
  let previousScope = '';
  createEffect(() => {
    const scope = JSON.stringify([props.threadID, props.page?.last_event_id]);
    // Admission changes invalidate explicit metadata pages, but keep an open
    // full report readable while the same fixed range remains selected.
    JSON.stringify(props.page);
    generation++;
    setExtra([]); setCursor(props.page?.next_after_event_id ?? '');
    setBusy(''); setFailed(false);
    if (scope !== previousScope) {
      setBodies({}); setOpen(''); previousScope = scope;
    }
  });
  const events = createMemo(() => [...(props.page?.events ?? []), ...extra()]);
  const load = async (event?: FlowerParentEvent) => {
    if (!props.read || busy()) return;
    const current = generation;
    const key = event?.id ?? 'page';
    setBusy(key); setFailed(false);
    try {
      const page = await props.read(props.threadID, event
        ? { action: 'read', event_id: event.id }
        : { action: 'read', first_event_id: props.page?.first_event_id, last_event_id: props.page?.last_event_id, after_event_id: cursor(), limit: 50 });
      if (current !== generation) return;
      if (event) {
        const full = page.events.find((value) => value.id === event.id);
        if (!full) throw new Error('Missing canonical event.');
        setBodies((previous) => ({ ...previous, [event.id]: full })); setOpen(event.id);
      } else {
        setExtra((previous) => [...previous, ...page.events]); setCursor(page.next_after_event_id ?? '');
      }
    } catch {
      if (current === generation) setFailed(true);
    } finally {
      if (current === generation) setBusy('');
    }
  };
  return (
    <Show when={events().length > 0}>
      <section class="flower-parent-events" aria-label={props.copy.events.title}>
        <h3 class="text-xs font-medium">{props.copy.events.title}</h3>
        <ul class="space-y-2">
          <For each={events()}>{(event) => (
            <li class="rounded border border-border/50 p-2 text-xs" data-parent-event={event.id}>
              <div class="flex items-center justify-between gap-2">
                <Show when={!props.canOpenSource || props.canOpenSource(event.source_thread_id)} fallback={<span class="min-w-0 truncate" title={props.sourceName(event.source_thread_id)}>{props.sourceName(event.source_thread_id)}</span>}>
                  <button type="button" class="min-w-0 truncate text-left underline-offset-2 hover:underline" onClick={() => props.onOpenSource(event.source_thread_id)} title={props.copy.openThread}>
                    {props.sourceName(event.source_thread_id)}
                  </button>
                </Show>
                <span class="shrink-0 text-muted-foreground">{event.admitted ? props.copy.events.admitted : props.copy.events.received}</span>
              </div>
              <div class="mt-1 flex items-center justify-between gap-2">
                <span>{parentEventLabel(event, props.copy)}</span>
                <Show when={props.read}>
                  <button type="button" class="underline underline-offset-2 disabled:opacity-50" disabled={!!busy()} aria-expanded={open() === event.id} onClick={() => open() === event.id ? setOpen('') : bodies()[event.id] ? setOpen(event.id) : void load(event)}>{props.copy.events.read}</button>
                </Show>
              </div>
              <Show when={open() === event.id && bodies()[event.id]}>{(full) => (
                <div class="mt-2 select-text whitespace-pre-wrap break-words" data-parent-event-body={event.id}>
                  {full().message || [full().reason_code, full().interaction_id, full().source_entry_id].filter(Boolean).join('\n')}
                </div>
              )}</Show>
            </li>
          )}</For>
        </ul>
        <Show when={failed()}><p role="alert" class="mt-2 text-destructive">{props.copy.unavailableThread}</p></Show>
        <Show when={cursor() && props.read}><button type="button" class="mt-2 text-xs underline" disabled={!!busy()} onClick={() => void load()}>{props.copy.events.more}</button></Show>
      </section>
    </Show>
  );
}
