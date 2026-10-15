import type { FlowerActivityItem, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { retainEqualValue } from './presentationIdentity';

// Authorized detail reads may enrich immutable historical file facts. Keep that
// enrichment in the existing thread cache when an otherwise equal live item
// arrives, without querying canonical history on every streaming update.
export function retainFileActivityTargets(previous: FlowerActivityItem | undefined, incoming: FlowerActivityItem): FlowerActivityItem {
  if (!previous || previous.status !== 'success' || incoming.status !== 'success') return incoming;
  if (!['read_file', 'file.read', 'read_files', 'file.edit', 'file.write', 'apply_patch', 'image.read'].includes(incoming.tool_name ?? '')) return incoming;
  const hasTargets = (activity: FlowerActivityItem) =>
    activity.target_refs?.some(ref => !!ref.path)
    || ['rows', 'mutations'].some(field => Array.isArray(activity.payload?.[field])
      && (activity.payload[field] as readonly Record<string, unknown>[]).some(row => !!row.target));
  if (!hasTargets(previous) || hasTargets(incoming)) return incoming;
  const isFileTarget = (ref: NonNullable<FlowerActivityItem['target_refs']>[number]) =>
    ((ref.kind === 'file' || ref.kind === 'directory') && !!ref.path) || ref.kind.startsWith('file_action:');
  const rows = (activity: FlowerActivityItem, field: string): readonly Record<string, unknown>[] =>
    Array.isArray(activity.payload?.[field]) ? activity.payload[field] as readonly Record<string, unknown>[] : [];
  const withoutTargets = (activity: FlowerActivityItem): FlowerActivityItem => ({
    ...activity,
    target_refs: (activity.target_refs ?? []).filter(ref => !isFileTarget(ref)),
    ...(activity.payload ? { payload: {
      ...activity.payload,
      ...Object.fromEntries(['rows', 'mutations'].filter(field => Array.isArray(activity.payload?.[field])).map(field =>
        [field, rows(activity, field).map(row => { const facts = { ...row }; delete facts.target; return facts; })])),
    } } : {}),
  });
  const before = withoutTargets(previous);
  if (retainEqualValue(before, withoutTargets(incoming)) !== before) return incoming;
  const existing = (incoming.target_refs ?? []).filter(ref => !ref.kind.startsWith('file_action:'));
  const targets = existing.some(ref => !!ref.path) ? existing
    : [...existing, ...(previous.target_refs ?? []).filter(ref => !!ref.path)];
  return {
    ...incoming,
    ...(targets.length ? { target_refs: targets } : {}),
    ...(incoming.payload ? { payload: {
      ...incoming.payload,
      ...Object.fromEntries(['rows', 'mutations'].filter(field => Array.isArray(incoming.payload?.[field])).map(field =>
        [field, rows(incoming, field).map((row, index) => row.target || !rows(previous, field)[index]?.target
          ? row : { ...row, target: rows(previous, field)[index].target })])),
    } } : {}),
  };
}

type ThreadPresentation = Pick<FlowerThreadSnapshot, 'thread_id' | 'messages'>;

export function retainThreadFileActivityTargets<T extends ThreadPresentation>(source: ThreadPresentation | undefined, incoming: T): T {
  if (!source || source.thread_id !== incoming.thread_id) return incoming;
  const messageKey = (message: FlowerThreadSnapshot['messages'][number]) => JSON.stringify([message.id, message.turn_id, message.run_id]);
  const previous = new Map(source.messages.map(message => [messageKey(message), message]));
  let changed = false;
  const messages = incoming.messages.map(message => {
    const before = previous.get(messageKey(message));
    if (!before) return message;
    const activities = new Map((before.blocks ?? []).flatMap(block => block.type === 'activity-timeline'
      ? block.items.map(item => [JSON.stringify([item.item_id, item.tool_id]), item] as const) : []));
    const blocks = message.blocks?.map(block => block.type !== 'activity-timeline' ? block : {
      ...block, items: block.items.map(item => retainFileActivityTargets(activities.get(JSON.stringify([item.item_id, item.tool_id])), item)),
    });
    const retained = retainEqualValue(message, { ...message, ...(blocks ? { blocks } : {}) });
    changed ||= retained !== message;
    return retained;
  });
  return changed ? { ...incoming, messages } : incoming;
}

export function threadNeedsFileActivityTargets(thread: ThreadPresentation): boolean {
  return thread.messages.some(message => message.blocks?.some(block => block.type === 'activity-timeline'
    && block.items.some(item => item.status === 'success' && item.target_refs?.some(ref => ref.kind.startsWith('file_action:')))));
}
