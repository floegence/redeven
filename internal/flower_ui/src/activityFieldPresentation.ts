import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { FlowerActivityField, FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import type { createActivityFieldReader } from './activityFieldReader';
import { mapFlowerActivityItem } from './flowerLiveMapper';
import { retainEqualValue } from './presentationIdentity';
import { replaceTerminalOutputSnapshot } from './flowerTerminalOutput';

// One in-flight read completes even while this activity changes. The next
// read coalesces those changes; unrelated thread updates never cancel it.
export function createActivityFieldPresentation(options: {
  reader: ReturnType<typeof createActivityFieldReader>;
  item: () => FlowerActivityItem;
  threadID: () => string;
  itemID: () => string;
  active: () => boolean;
  connection: () => unknown;
  execution?: () => readonly [string, string];
}) {
  const [loaded, setLoaded] = createSignal<{ owner: string; value: FlowerActivityItem; fields: readonly FlowerActivityField[] }>();
  const [failed, setFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const owner = () => JSON.stringify([options.threadID(), options.itemID(), options.item().tool_id, options.item().renderer, options.execution?.()]);
  let scope = new AbortController();
  let retainedOwner = '';
  let lifetime = '';
  let disposed = false;
  let busy = false;
  let accepted = '';
  let rejected = '';
  let requested: { key: string; owner: string; thread: string; id: string; item: FlowerActivityItem } | undefined;
  const read = async () => {
    if (busy || !requested || disposed || accepted === requested.key || rejected) return;
    const request = requested;
    const item = request.item;
    const summary = item.field_summary!;
    const signal = scope.signal;
    busy = true; setLoading(true); setFailed(false);
    try {
      const fields = summary.fields.filter(field => field.path.startsWith('/payload/') && field.kind !== 'array'
        && field.path !== '/payload/goal' && (field.kind !== 'string' || (field.bytes ?? 0) <= (64 << 10)))
        .map(field => field.path.slice('/payload/'.length));
      const deferred = item.renderer === 'terminal' && summary.fields.some(field => field.path === '/payload/output'
        && field.kind === 'string' && (field.bytes ?? 0) > (64 << 10)) ? ['output'] : [];
      const snapshot = fields.length || deferred.length
        ? await options.reader.snapshot(request.thread, request.id, '/payload', signal, 256 << 10, 128, fields.length ? fields : ['status'], deferred.length ? deferred : undefined) : undefined;
      signal.throwIfAborted();
      const execution = options.execution?.();
      if (snapshot && execution && (snapshot.run_id !== execution[0] || snapshot.turn_id !== execution[1])) {
        throw Object.assign(new Error('Activity detail execution changed.'), { code: 'flower_activity_identity_error' });
      }
      const payload = { ...(snapshot?.value ?? {}) as Record<string, unknown> };
      const goal = summary.fields.some(field => field.path === '/payload/goal' && field.kind === 'object')
        ? await options.reader.snapshot(request.thread, request.id, '/payload/goal', signal, 4096, 16,
          ['operation', 'applied', 'version', 'outcome'], ['text', 'evidence']) : undefined;
      if (goal) {
        if (execution && (goal.run_id !== execution[0] || goal.turn_id !== execution[1])) throw new Error('Activity detail execution changed.');
        payload.goal = goal.value;
      }
      if (item.renderer === 'terminal' && payload.operation !== 'write') {
        const source = snapshot?.text_fields?.find(field => field.path === '/payload/output');
        const first = Number(payload.first_seq ?? 0), last = Number(payload.last_seq ?? 0);
        if (source) {
          if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || last < 0
            || (source.bytes ? (first !== 0 || last !== 0) && (first < 1 || last < first) : first !== 0)) throw new Error('Invalid deferred terminal range.');
        } else {
          replaceTerminalOutputSnapshot(undefined, { output: String(payload.output ?? ''), first_seq: first, last_seq: last });
        }
      }
      signal.throwIfAborted();
      const mapped = mapFlowerActivityItem({ ...item, label: undefined, description: undefined, renderer: undefined, chips: undefined, target_refs: undefined, payload: undefined,
        presentation: { label: item.label, description: item.description, renderer: item.renderer, chips: item.chips, target_refs: item.target_refs, payload } });
      if (!mapped) throw new Error('Activity detail has no owner.');
      const value = { ...mapped, field_summary: summary };
      setLoaded(previous => ({ owner: request.owner, value: retainEqualValue(previous?.owner === request.owner ? previous.value : undefined, value),
        fields: [...(snapshot?.text_fields ?? []), ...(goal?.text_fields ?? [])] }));
      accepted = request.key;
      rejected = '';
    } catch {
      if (!signal.aborted) { rejected = request.key; setFailed(true); }
    } finally {
      if (signal === scope.signal) { busy = false; setLoading(false); void read(); }
    }
  };
  createEffect(() => {
    const item = options.item();
    const connection = options.connection();
    const key = owner();
    if (key !== retainedOwner) {
      retainedOwner = key; accepted = ''; setLoaded(undefined);
    }
    const active = Boolean(item.field_summary && options.active());
    const nextLifetime = JSON.stringify([key, active, connection]);
    if (nextLifetime !== lifetime) {
      scope.abort(); scope = new AbortController(); lifetime = nextLifetime;
      busy = false; requested = undefined; rejected = '';
      setLoading(false); setFailed(false);
    }
    if (!active) return;
    const token = item.field_summary?.version ?? JSON.stringify(item.field_summary);
    requested = { key: JSON.stringify([key, token, connection]), owner: key, thread: options.threadID(), id: options.itemID(), item };
    void read();
  });
  onCleanup(() => { disposed = true; scope.abort(); });
  const presented = createMemo(() => {
    const current = options.item();
    const accepted = loaded();
    if (accepted?.owner !== owner() || !current.field_summary) return current;
    // Terminal bytes, sequence range, process identity and deferred sources
    // belong to one atomic read. A newer summary is only a progress hint.
    return { ...accepted.value, ...current, payload: current.renderer === 'terminal'
      ? accepted.value.payload : { ...accepted.value.payload, ...current.payload } };
  });
  return {
    item: presented,
    sourcePayload: () => loaded()?.owner === owner() ? loaded()?.value.payload : undefined,
    field: (path: string) => loaded()?.owner === owner() ? loaded()?.fields.find(field => field.path === path) : undefined,
    failed, loading,
    retry: () => { if (!disposed && options.active()) { rejected = ''; accepted = ''; void read(); } },
  };
}
