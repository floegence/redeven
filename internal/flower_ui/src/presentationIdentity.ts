import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

/** Share equal JSON presentation values without ignoring any received fields. */
export function retainEqualValue<T>(previous: T | undefined, next: T): T {
  if (Object.is(previous, next)) return previous as T;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let equal = previous.length === next.length;
    let changed = false;
    const retained = next.map((value, index) => {
      const item = retainEqualValue(previous[index], value);
      equal &&= item === previous[index];
      changed ||= item !== value;
      return item;
    });
    return (equal ? previous : changed ? retained : next) as T;
  }
  if (Array.isArray(previous) || Object.getPrototypeOf(previous) !== Object.getPrototypeOf(next)) return next;
  if (Object.getPrototypeOf(next) !== Object.prototype && Object.getPrototypeOf(next) !== null) return next;
  const old = previous as Record<string, unknown>;
  const incoming = next as Record<string, unknown>;
  const keys = Object.keys(incoming);
  let equal = Object.keys(old).length === keys.length;
  let retained: Record<string, unknown> | undefined;
  for (const key of keys) {
    const value = retainEqualValue(old[key], incoming[key]);
    equal &&= Object.hasOwn(old, key) && Object.is(value, old[key]);
    if (!Object.is(value, incoming[key])) {
      retained ??= Object.create(Object.getPrototypeOf(next), Object.getOwnPropertyDescriptors(next));
      Object.defineProperty(retained!, key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return (equal ? previous : retained ?? next) as T;
}

/** Identity aligns members; full value comparison still decides whether to reuse them. */
export function retainKeyedItems<T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  identity: (item: T) => string,
): readonly T[] {
  if (previous === next || !previous) return next;
  const byID = new Map(previous.map((item) => [identity(item), item]));
  const retained = next.map((item) => retainEqualValue(byID.get(identity(item)), item));
  return previous.length === retained.length && retained.every((item, index) => item === previous[index])
    ? previous : retained.every((item, index) => item === next[index]) ? next : retained;
}

type ThreadPresentation = Pick<FlowerThreadSnapshot, 'thread_id' | 'messages'> & Partial<FlowerThreadSnapshot>;

export function retainThreadPresentation<T extends ThreadPresentation>(previous: T | undefined, next: T): T {
  if (!previous || previous.thread_id !== next.thread_id) return next;
  const aligned: T = {
    ...next,
    messages: retainKeyedItems(previous.messages, next.messages, (message) => JSON.stringify([message.id, message.turn_id, message.run_id, message.role])),
    ...(next.queued_turns ? { queued_turns: retainKeyedItems(previous.queued_turns, next.queued_turns, (turn) => turn.queue_id) } : {}),
    ...(next.approval_actions ? { approval_actions: retainKeyedItems(previous.approval_actions, next.approval_actions, (action) => JSON.stringify([action.action_id, action.turn_id, action.run_id])) } : {}),
    ...(next.subagents ? { subagents: retainKeyedItems(previous.subagents, next.subagents, (agent) => agent.thread_id) } : {}),
  };
  const keyedFields = new Set(['messages', 'queued_turns', 'approval_actions', 'subagents']);
  const keys = Object.keys(aligned) as (keyof T)[];
  for (const key of keys) {
    if (!keyedFields.has(String(key))) aligned[key] = retainEqualValue(previous[key], aligned[key]);
  }
  return Object.keys(previous).length === keys.length && keys.every((key) => Object.hasOwn(previous, key) && Object.is(previous[key], aligned[key]))
    ? previous : aligned;
}
