import type {
  CodexEvent,
  CodexItem,
  CodexPendingRequest,
  CodexThreadTokenUsage,
  CodexThread,
  CodexThreadDetail,
  CodexThreadSession,
  CodexTranscriptItem,
} from './types';
import { isWorkingStatus } from './presentation';

type MutableCodexThreadSession = {
  thread: CodexThread;
  runtime_config: CodexThreadSession['runtime_config'];
  items_by_id: Record<string, CodexTranscriptItem>;
  item_order: string[];
  pending_requests: Record<string, CodexPendingRequest>;
  token_usage?: CodexThreadTokenUsage | null;
  last_applied_seq: number;
  active_status: string;
  active_status_flags: string[];
};

function cloneTokenUsage(usage: CodexThreadTokenUsage | null | undefined): CodexThreadTokenUsage | null | undefined {
  if (!usage) return usage ?? null;
  return {
    ...usage,
    total: { ...usage.total },
    last: { ...usage.last },
  };
}

function cloneSession(session: CodexThreadSession): MutableCodexThreadSession {
  return {
    ...session,
    thread: { ...session.thread },
    runtime_config: { ...session.runtime_config },
    items_by_id: { ...session.items_by_id },
    item_order: [...session.item_order],
    pending_requests: { ...session.pending_requests },
    token_usage: cloneTokenUsage(session.token_usage),
    active_status_flags: [...session.active_status_flags],
  };
}

function addOrUpdateItem(session: CodexThreadSession, item: CodexItem, orderHint: number): CodexThreadSession {
  const next = cloneSession(session);
  const existing = next.items_by_id[item.id];
  if (!existing) {
    next.items_by_id[item.id] = {
      ...item,
      order: orderHint,
    };
    next.item_order.push(item.id);
    return next;
  }
  next.items_by_id[item.id] = {
    ...existing,
    ...item,
    text: String(item.text ?? '').trim() ? item.text : existing.text,
    status: String(item.status ?? '').trim() || existing.status,
    changes: item.changes && item.changes.length > 0 ? item.changes : existing.changes,
    inputs: item.inputs && item.inputs.length > 0 ? item.inputs : existing.inputs,
    summary: item.summary && item.summary.length > 0 ? item.summary : existing.summary,
    content: item.content && item.content.length > 0 ? item.content : existing.content,
    order: existing.order,
  };
  return next;
}

function ensureLiveItem(session: CodexThreadSession, itemID: string, fallback: CodexItem): CodexThreadSession {
  if (session.items_by_id[itemID]) return cloneSession(session);
  return addOrUpdateItem(session, { ...fallback, id: itemID }, session.item_order.length);
}

function ensureStringPart(values: readonly string[] | null | undefined, index: number): string[] {
  const next = [...(values ?? [])];
  while (next.length <= index) {
    next.push('');
  }
  return next;
}

function appendItemText(
  session: CodexThreadSession,
  itemID: string,
  fallback: CodexItem,
  delta: string,
): CodexThreadSession {
  let next = ensureLiveItem(session, itemID, fallback);
  const existing = next.items_by_id[itemID];
  next.items_by_id[itemID] = {
    ...existing,
    status: String(existing.status ?? '').trim() || String(fallback.status ?? '').trim() || 'inProgress',
    text: `${existing.text ?? ''}${delta}`,
  };
  return next;
}

function appendItemSummary(
  session: CodexThreadSession,
  itemID: string,
  fallback: CodexItem,
  summaryIndex: number,
  delta: string,
): CodexThreadSession {
  let next = ensureLiveItem(session, itemID, fallback);
  const existing = next.items_by_id[itemID];
  const summary = ensureStringPart(existing.summary, Math.max(0, summaryIndex));
  summary[Math.max(0, summaryIndex)] = `${summary[Math.max(0, summaryIndex)] ?? ''}${delta}`;
  next.items_by_id[itemID] = {
    ...existing,
    status: String(existing.status ?? '').trim() || String(fallback.status ?? '').trim() || 'inProgress',
    summary,
  };
  return next;
}

function appendItemContent(
  session: CodexThreadSession,
  itemID: string,
  fallback: CodexItem,
  contentIndex: number,
  delta: string,
): CodexThreadSession {
  let next = ensureLiveItem(session, itemID, fallback);
  const existing = next.items_by_id[itemID];
  const normalizedIndex = Math.max(0, contentIndex);
  const content = ensureStringPart(existing.content, normalizedIndex);
  content[normalizedIndex] = `${content[normalizedIndex] ?? ''}${delta}`;
  next.items_by_id[itemID] = {
    ...existing,
    status: String(existing.status ?? '').trim() || String(fallback.status ?? '').trim() || 'inProgress',
    content,
    text: content.join('\n\n'),
  };
  return next;
}

function appendFileChangeDiff(
  session: CodexThreadSession,
  itemID: string,
  delta: string,
): CodexThreadSession {
  let next = ensureLiveItem(session, itemID, { id: itemID, type: 'fileChange', changes: [], status: 'inProgress' });
  const existing = next.items_by_id[itemID];
  const changes = [...(existing.changes ?? [])];
  if (changes.length === 0) {
    changes.push({
      path: 'Pending diff',
      kind: 'stream',
      diff: delta,
    });
  } else {
    const lastIndex = changes.length - 1;
    changes[lastIndex] = {
      ...changes[lastIndex],
      diff: `${changes[lastIndex]?.diff ?? ''}${delta}`,
    };
  }
  next.items_by_id[itemID] = {
    ...existing,
    status: String(existing.status ?? '').trim() || 'inProgress',
    changes,
  };
  return next;
}

function inferItemStatus(itemStatus: string | null | undefined, turnStatus: string | null | undefined): string {
  const normalizedItemStatus = String(itemStatus ?? '').trim();
  if (normalizedItemStatus) return normalizedItemStatus;

  const normalizedTurnStatus = String(turnStatus ?? '').trim();
  if (!normalizedTurnStatus) return '';
  if (isWorkingStatus(normalizedTurnStatus)) return 'inProgress';
  if (normalizedTurnStatus === 'notLoaded') return '';
  return normalizedTurnStatus;
}

function itemTextOrContent(item: CodexItem | null | undefined): string {
  const directText = String(item?.text ?? '').trim();
  if (directText) return directText;
  if (String(item?.type ?? '').trim() !== 'reasoning' && (item?.content?.length ?? 0) > 0) {
    return (item?.content ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean).join('\n\n');
  }
  const query = String(item?.query ?? '').trim();
  if (query) return query;
  const actionType = String(item?.action?.type ?? '').trim();
  if (actionType === 'search') {
    const actionQuery = String(item?.action?.query ?? '').trim();
    if (actionQuery) return actionQuery;
    const queries = Array.isArray(item?.action?.queries)
      ? item.action?.queries?.map((entry) => String(entry ?? '').trim()).filter(Boolean) ?? []
      : [];
    if (queries.length > 0) return queries[0] ?? '';
  }
  if (actionType === 'openPage') {
    const url = String(item?.action?.url ?? '').trim();
    if (url) return url;
  }
  if (actionType === 'findInPage') {
    const pattern = String(item?.action?.pattern ?? '').trim();
    if (pattern) return pattern;
    const url = String(item?.action?.url ?? '').trim();
    if (url) return url;
  }
  const content = Array.isArray(item?.inputs)
    ? item!.inputs
        .map((entry) => {
          if (String(entry.type ?? '').trim() === 'image') return '';
          return String(entry.text ?? entry.path ?? entry.name ?? '').trim();
        })
        .filter(Boolean)
        .join('\n\n')
    : '';
  return content;
}

export function buildCodexThreadSession(detail: CodexThreadDetail): CodexThreadSession {
  const items_by_id: Record<string, CodexTranscriptItem> = {};
  const item_order: string[] = [];

  let order = 0;
  for (const turn of Array.isArray(detail.thread.turns) ? detail.thread.turns : []) {
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      const normalized: CodexItem = {
        ...item,
        status: inferItemStatus(item.status, turn.status),
        text: itemTextOrContent(item),
      };
      items_by_id[item.id] = {
        ...normalized,
        order,
      };
      item_order.push(item.id);
      order += 1;
    }
  }

  const pending_requests: Record<string, CodexPendingRequest> = {};
  for (const request of Array.isArray(detail.pending_requests) ? detail.pending_requests : []) {
    pending_requests[request.id] = request;
  }

  return {
    thread: detail.thread,
    runtime_config: detail.runtime_config ?? {},
    items_by_id,
    item_order,
    pending_requests,
    token_usage: cloneTokenUsage(detail.token_usage),
    last_applied_seq: Number(detail.last_applied_seq ?? 0) || 0,
    active_status: String(detail.active_status ?? detail.thread.status ?? '').trim(),
    active_status_flags: Array.isArray(detail.active_status_flags) ? [...detail.active_status_flags] : [...(detail.thread.active_flags ?? [])],
  };
}

export function buildEmptyCodexThreadSession(args: {
  thread: CodexThread;
  runtime_config?: CodexThreadSession['runtime_config'] | null | undefined;
  active_status?: string | null | undefined;
  active_status_flags?: readonly string[] | null | undefined;
}): CodexThreadSession {
  return {
    thread: { ...args.thread, turns: [...(args.thread.turns ?? [])] },
    runtime_config: { ...(args.runtime_config ?? {}) },
    items_by_id: {},
    item_order: [],
    pending_requests: {},
    token_usage: null,
    last_applied_seq: 0,
    active_status: String(args.active_status ?? args.thread.status ?? '').trim(),
    active_status_flags: [...(args.active_status_flags ?? args.thread.active_flags ?? [])],
  };
}

export function applyCodexEvent(session: CodexThreadSession | null, event: CodexEvent): CodexThreadSession | null {
  if (!session) return session;
  if (String(event.thread_id ?? '').trim() !== String(session.thread.id ?? '').trim()) return session;

  let next = cloneSession(session);
  next.last_applied_seq = Math.max(Number(next.last_applied_seq ?? 0), Number(event.seq ?? 0));

  switch (event.type) {
    case 'thread_started':
      if (event.thread) {
        next.thread = { ...event.thread };
        next.active_status = String(event.thread.status ?? '').trim();
        next.active_status_flags = [...(event.thread.active_flags ?? [])];
      }
      return next;
    case 'thread_status_changed':
      next.active_status = String(event.status ?? '').trim();
      next.active_status_flags = [...(event.flags ?? [])];
      next.thread = {
        ...next.thread,
        status: next.active_status || next.thread.status,
        active_flags: [...next.active_status_flags],
      };
      return next;
    case 'thread_name_updated':
      next.thread = {
        ...next.thread,
        name: String(event.thread_name ?? '').trim(),
      };
      return next;
    case 'thread_token_usage_updated':
      next.token_usage = cloneTokenUsage(event.token_usage);
      return next;
    case 'turn_started':
    case 'turn_completed':
      if (event.turn) {
        next.active_status = String(event.turn.status ?? next.active_status).trim();
      }
      return next;
    case 'item_started':
    case 'item_completed':
      if (!event.item?.id) return next;
      return addOrUpdateItem(
        next,
        {
          ...event.item,
          status: inferItemStatus(
            event.item.status,
            event.type === 'item_completed' ? 'completed' : 'inProgress',
          ),
          text: itemTextOrContent(event.item),
        },
        next.item_order.length,
      );
    case 'agent_message_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemText(next, itemID, { id: itemID, type: 'agentMessage', text: '', status: 'inProgress' }, String(event.delta ?? ''));
    }
    case 'command_output_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      next = ensureLiveItem(next, itemID, { id: itemID, type: 'commandExecution', aggregated_output: '', status: 'inProgress' });
      const existing = next.items_by_id[itemID];
      next.items_by_id[itemID] = {
        ...existing,
        aggregated_output: `${existing.aggregated_output ?? ''}${String(event.delta ?? '')}`,
      };
      return next;
    }
    case 'file_change_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendFileChangeDiff(next, itemID, String(event.delta ?? ''));
    }
    case 'plan_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemText(next, itemID, { id: itemID, type: 'plan', text: '', status: 'inProgress' }, String(event.delta ?? ''));
    }
    case 'reasoning_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      const delta = String(event.delta ?? '');
      if (typeof event.content_index === 'number') {
        return appendItemContent(next, itemID, { id: itemID, type: 'reasoning', content: [], status: 'inProgress' }, event.content_index, delta);
      }
      return appendItemText(next, itemID, { id: itemID, type: 'reasoning', text: '', status: 'inProgress' }, delta);
    }
    case 'reasoning_summary_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemSummary(
        next,
        itemID,
        { id: itemID, type: 'reasoning', summary: [], status: 'inProgress' },
        Math.max(0, Number(event.summary_index ?? 0) || 0),
        String(event.delta ?? ''),
      );
    }
    case 'reasoning_summary_part_added': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemSummary(
        next,
        itemID,
        { id: itemID, type: 'reasoning', summary: [], status: 'inProgress' },
        Math.max(0, Number(event.summary_index ?? 0) || 0),
        '',
      );
    }
    case 'request_created':
      if (event.request?.id) {
        next.pending_requests[event.request.id] = event.request;
      }
      return next;
    case 'request_resolved':
      if (event.request_id) {
        delete next.pending_requests[String(event.request_id)];
      }
      return next;
    case 'thread_archived':
      next.active_status = 'archived';
      next.thread = { ...next.thread, status: 'archived', active_flags: [] };
      return next;
    case 'thread_unarchived':
    case 'thread_closed':
      next.active_status = 'notLoaded';
      next.active_status_flags = [];
      next.thread = { ...next.thread, status: 'notLoaded', active_flags: [] };
      return next;
    case 'error':
      if (event.will_retry) {
        return next;
      }
      next.active_status = 'systemError';
      next.active_status_flags = [];
      next.thread = { ...next.thread, status: 'systemError', active_flags: [] };
      return next;
    default:
      return next;
  }
}
