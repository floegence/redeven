import type {
  CodexEvent,
  CodexItem,
  CodexPendingRequest,
  CodexThread,
  CodexThreadDetail,
  CodexThreadSession,
  CodexTranscriptItem,
} from './types';

type MutableCodexThreadSession = {
  thread: CodexThread;
  runtime_config: CodexThreadSession['runtime_config'];
  items_by_id: Record<string, CodexTranscriptItem>;
  item_order: string[];
  pending_requests: Record<string, CodexPendingRequest>;
  last_event_seq: number;
  active_status: string;
  active_status_flags: string[];
};

function cloneSession(session: CodexThreadSession): MutableCodexThreadSession {
  return {
    ...session,
    thread: { ...session.thread },
    runtime_config: { ...session.runtime_config },
    items_by_id: { ...session.items_by_id },
    item_order: [...session.item_order],
    pending_requests: { ...session.pending_requests },
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

function itemTextOrContent(item: CodexItem | null | undefined): string {
  const directText = String(item?.text ?? '').trim();
  if (directText) return directText;
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
    last_event_seq: Number(detail.last_event_seq ?? 0) || 0,
    active_status: String(detail.active_status ?? detail.thread.status ?? '').trim(),
    active_status_flags: Array.isArray(detail.active_status_flags) ? [...detail.active_status_flags] : [...(detail.thread.active_flags ?? [])],
  };
}

export function applyCodexEvent(session: CodexThreadSession | null, event: CodexEvent): CodexThreadSession | null {
  if (!session) return session;
  if (String(event.thread_id ?? '').trim() !== String(session.thread.id ?? '').trim()) return session;

  let next = cloneSession(session);
  next.last_event_seq = Math.max(Number(next.last_event_seq ?? 0), Number(event.seq ?? 0));

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
    case 'turn_started':
    case 'turn_completed':
      if (event.turn) {
        next.active_status = String(event.turn.status ?? next.active_status).trim();
      }
      return next;
    case 'item_started':
    case 'item_completed':
      if (!event.item?.id) return next;
      return addOrUpdateItem(next, { ...event.item, text: itemTextOrContent(event.item) }, next.item_order.length);
    case 'agent_message_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      next = ensureLiveItem(next, itemID, { id: itemID, type: 'agentMessage', text: '', status: 'inProgress' });
      const existing = next.items_by_id[itemID];
      next.items_by_id[itemID] = {
        ...existing,
        text: `${existing.text ?? ''}${String(event.delta ?? '')}`,
      };
      return next;
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
    case 'reasoning_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      next = ensureLiveItem(next, itemID, { id: itemID, type: 'reasoning', text: '', status: 'inProgress' });
      const existing = next.items_by_id[itemID];
      next.items_by_id[itemID] = {
        ...existing,
        text: `${existing.text ?? ''}${String(event.delta ?? '')}`,
      };
      return next;
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
      next.thread = { ...next.thread, status: 'archived' };
      return next;
    default:
      return next;
  }
}
