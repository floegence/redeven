import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { FlowerActivityField, FlowerActivityItem } from './contracts/flowerSurfaceContracts';
import type { createActivityFieldReader } from './activityFieldReader';
import { mapFlowerActivityItem } from './flowerLiveMapper';
import { retainEqualValue } from './presentationIdentity';

// One in-flight read completes even while this activity changes. The next
// read coalesces those changes; unrelated thread updates never cancel it.
export function createActivityFieldPresentation(options: {
  reader: ReturnType<typeof createActivityFieldReader>;
  item: () => FlowerActivityItem;
  threadID: () => string;
  itemID: () => string;
  active: () => boolean;
  connection: () => unknown;
}) {
  const [loaded, setLoaded] = createSignal<{ owner: string; value: FlowerActivityItem; fields: readonly FlowerActivityField[] }>();
  const [failed, setFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const owner = () => JSON.stringify([options.threadID(), options.itemID(), options.item().tool_id, options.item().renderer]);
  let scope = new AbortController();
  let retainedOwner = '';
  let lifetime = '';
  let disposed = false;
  let busy = false;
  let accepted = '';
  let rejected = '';
  let requested: { key: string; owner: string; thread: string; id: string; item: FlowerActivityItem } | undefined;
  const read = async () => {
    if (busy || !requested || disposed || accepted === requested.key || rejected === requested.key) return;
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
      const snapshot = deferred.length
        ? await options.reader.snapshot(request.thread, request.id, '/payload', signal, 256 << 10, 128, fields.length ? fields : ['status'], deferred)
        : undefined;
      const payload = { ...(snapshot?.value ?? (fields.length ? await options.reader.value(request.thread, request.id, '/payload', signal, 256 << 10, 128, fields) : {})) as Record<string, unknown> };
      const goal = summary.fields.some(field => field.path === '/payload/goal' && field.kind === 'object')
        ? await options.reader.snapshot(request.thread, request.id, '/payload/goal', signal, 4096, 16,
          ['operation', 'applied', 'version', 'outcome'], ['text', 'evidence']) : undefined;
      if (goal) payload.goal = goal.value;
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
  return {
    item: () => loaded()?.owner === owner() && options.item().field_summary ? { ...loaded()!.value, ...options.item(),
      payload: { ...loaded()!.value.payload, ...options.item().payload } } : options.item(),
    sourcePayload: () => loaded()?.owner === owner() ? loaded()?.value.payload : undefined,
    field: (path: string) => loaded()?.owner === owner() ? loaded()?.fields.find(field => field.path === path) : undefined,
    failed, loading,
  };
}
