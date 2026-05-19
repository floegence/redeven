import type {
  CodexEvent,
  CodexItem,
  CodexPendingRequest,
  CodexThreadStreamState,
  CodexTurnError,
  CodexTurn,
  CodexThreadTokenUsage,
  CodexThread,
  CodexThreadDetail,
  CodexThreadSession,
  CodexTranscriptItem,
} from './types';
import { codexUserInputTextSummary, isWorkingStatus } from './presentation';

type MutableCodexThreadSession = {
  thread: CodexThread;
  runtime_config: CodexThreadSession['runtime_config'];
  items_by_id: Record<string, CodexTranscriptItem>;
  item_order: string[];
  pending_requests: Record<string, CodexPendingRequest>;
  token_usage?: CodexThreadTokenUsage | null;
  last_applied_seq: number;
  stream: CodexThreadStreamState;
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
    stream: { ...session.stream },
    active_status_flags: [...session.active_status_flags],
  };
}

function normalizeStreamState(
  stream: CodexThreadStreamState | null | undefined,
  fallbackLastAppliedSeq = 0,
): CodexThreadStreamState {
  const lastAppliedSeq = Math.max(
    0,
    Number(stream?.last_applied_seq ?? 0) || 0,
    Math.max(0, Number(fallbackLastAppliedSeq ?? 0) || 0),
  );
  const oldestRetainedSeq = Math.max(
    0,
    Number(stream?.oldest_retained_seq ?? (lastAppliedSeq > 0 ? lastAppliedSeq + 1 : 0)) || 0,
  );
  return {
    last_applied_seq: lastAppliedSeq,
    oldest_retained_seq: oldestRetainedSeq,
    stream_epoch: Math.max(0, Number(stream?.stream_epoch ?? 0) || 0),
    last_event_at_unix_ms: Math.max(0, Number(stream?.last_event_at_unix_ms ?? 0) || 0),
  };
}

function cloneTurn(turn: CodexTurn): CodexTurn {
  return {
    ...turn,
    items: [...(turn.items ?? [])],
  };
}

function cloneTurnList(turns: readonly CodexTurn[] | null | undefined): CodexTurn[] {
  return [...(turns ?? [])].map(cloneTurn);
}

function mergeTurn(existing: CodexTurn | null | undefined, incoming: CodexTurn): CodexTurn {
  return {
    ...(existing ?? {}),
    ...incoming,
    items: Array.isArray(incoming.items)
      ? [...incoming.items]
      : [...(existing?.items ?? [])],
  };
}

function upsertThreadTurn(thread: CodexThread, incoming: CodexTurn): CodexThread {
  const turns = cloneTurnList(thread.turns);
  const index = turns.findIndex((turn) => String(turn.id ?? '').trim() === String(incoming.id ?? '').trim());
  if (index >= 0) {
    turns[index] = mergeTurn(turns[index], incoming);
  } else {
    turns.push(mergeTurn(null, incoming));
  }
  return {
    ...thread,
    turns,
  };
}

function addOrUpdateItem(
  session: CodexThreadSession,
  item: CodexItem,
  orderHint: number,
  options?: { replaceEmptyText?: boolean },
): CodexThreadSession {
  const next = cloneSession(session);
  const incomingTurnID = itemTurnID(item);
  if (incomingTurnID && isAssistantOwnedTurnItem(item)) {
    const emptyDiagnosticID = turnDiagnosticID(incomingTurnID, 'empty_response');
    if (next.items_by_id[emptyDiagnosticID]) {
      delete next.items_by_id[emptyDiagnosticID];
      next.item_order = next.item_order.filter((itemID) => itemID !== emptyDiagnosticID);
    }
  }
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
    text: (options?.replaceEmptyText || String(item.text ?? '').trim()) ? item.text : existing.text,
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
  return '';
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
    ? codexUserInputTextSummary(item!.inputs)
    : '';
  return content;
}

function itemTurnID(item: CodexItem | null | undefined): string {
  return String(item?.turn_id ?? '').trim();
}

function isAssistantOwnedTurnItem(item: CodexItem | null | undefined): boolean {
  const itemType = String(item?.type ?? '').trim();
  return Boolean(itemType && itemType !== 'userMessage' && itemType !== 'turnDiagnostic');
}

function turnHasAssistantOwnedItem(turn: CodexTurn | null | undefined): boolean {
  return (turn?.items ?? []).some(isAssistantOwnedTurnItem);
}

function sessionHasAssistantOwnedTurnItem(session: CodexThreadSession, turnID: string): boolean {
  return session.item_order.some((itemID) => {
    const item = session.items_by_id[itemID];
    return itemTurnID(item) === turnID && isAssistantOwnedTurnItem(item);
  });
}

function formatTurnErrorDetails(error: CodexTurnError | null | undefined): string {
  if (!error) return '';
  const message = String(error.message ?? '').trim();
  const details = String(error.additional_details ?? '').trim();
  const code = String(error.codex_error_code ?? '').trim();
  return [
    message,
    details,
    code ? `Codex error code: ${code}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

function turnDiagnosticID(turnID: string, kind: 'turn_error' | 'empty_response'): string {
  return `turn:${turnID}:diagnostic:${kind}`;
}

function buildTurnDiagnosticItem(args: {
  turnID: string;
  kind: 'turn_error' | 'empty_response';
  status: string;
  text: string;
  turnError?: CodexTurnError | null;
}): CodexItem {
  return {
    id: turnDiagnosticID(args.turnID, args.kind),
    type: 'turnDiagnostic',
    turn_id: args.turnID,
    diagnostic_kind: args.kind,
    status: args.status,
    text: args.text,
    turn_error: args.turnError ?? null,
  };
}

function applyTurnDiagnosticItem(
  session: CodexThreadSession,
  turnID: string,
  item: CodexItem,
): CodexThreadSession {
  const afterTurnItems = session.item_order.filter((itemID) => itemTurnID(session.items_by_id[itemID]) === turnID);
  const orderHint = afterTurnItems.length > 0
    ? Math.max(...afterTurnItems.map((itemID) => Number(session.items_by_id[itemID]?.order ?? 0) || 0)) + 1
    : session.item_order.length;
  return addOrUpdateItem(session, item, orderHint, { replaceEmptyText: true });
}

function reconcileTurnDiagnostics(
  session: CodexThreadSession,
  turn: CodexTurn | null | undefined,
  incomingError?: CodexTurnError | null,
): CodexThreadSession {
  const turnID = String(turn?.id ?? '').trim();
  if (!turnID) return session;
  const status = String(turn?.status ?? '').trim().toLowerCase();
  const turnError = incomingError ?? turn?.error ?? null;
  if (status === 'failed' || turnError) {
    const text = formatTurnErrorDetails(turnError) || 'Codex reported that this turn failed, but did not provide error details.';
    return applyTurnDiagnosticItem(session, turnID, buildTurnDiagnosticItem({
      turnID,
      kind: 'turn_error',
      status: 'failed',
      text,
      turnError,
    }));
  }
  if (status === 'completed' && !turnHasAssistantOwnedItem(turn) && !sessionHasAssistantOwnedTurnItem(session, turnID)) {
    return applyTurnDiagnosticItem(session, turnID, buildTurnDiagnosticItem({
      turnID,
      kind: 'empty_response',
      status: 'empty_response',
      text: 'Codex completed this turn without a visible response.\n\nThe app-server reported completion, but no assistant message or activity item was materialized for this turn.',
    }));
  }
  return session;
}

export function buildCodexThreadSession(detail: CodexThreadDetail): CodexThreadSession {
  const items_by_id: Record<string, CodexTranscriptItem> = {};
  const item_order: string[] = [];

  let order = 0;
  for (const turn of Array.isArray(detail.thread.turns) ? detail.thread.turns : []) {
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      const normalized: CodexItem = {
        ...item,
        turn_id: String(item.turn_id ?? turn.id ?? '').trim() || undefined,
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

  let session: CodexThreadSession = {
    thread: detail.thread,
    runtime_config: detail.runtime_config ?? {},
    items_by_id,
    item_order,
    pending_requests,
    token_usage: cloneTokenUsage(detail.token_usage),
    last_applied_seq: Number(detail.last_applied_seq ?? 0) || 0,
    stream: normalizeStreamState(detail.stream, detail.last_applied_seq),
    active_status: String(detail.active_status ?? detail.thread.status ?? '').trim(),
    active_status_flags: Array.isArray(detail.active_status_flags) ? [...detail.active_status_flags] : [...(detail.thread.active_flags ?? [])],
  };
  for (const turn of Array.isArray(detail.thread.turns) ? detail.thread.turns : []) {
    session = reconcileTurnDiagnostics(session, turn);
  }
  return session;
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
    stream: normalizeStreamState(null, 0),
    active_status: String(args.active_status ?? args.thread.status ?? '').trim(),
    active_status_flags: [...(args.active_status_flags ?? args.thread.active_flags ?? [])],
  };
}

export function applyCodexEvent(session: CodexThreadSession | null, event: CodexEvent): CodexThreadSession | null {
  if (!session) return session;
  if (String(event.thread_id ?? '').trim() !== String(session.thread.id ?? '').trim()) return session;

  let next = cloneSession(session);
  next.last_applied_seq = Math.max(Number(next.last_applied_seq ?? 0), Number(event.seq ?? 0));
  next.stream = event.stream
    ? normalizeStreamState(event.stream, next.last_applied_seq)
    : normalizeStreamState(next.stream, next.last_applied_seq);

  switch (event.type) {
    case 'thread_started':
      if (event.thread) {
        next.thread = {
          ...event.thread,
          read_status: event.thread.read_status ?? next.thread.read_status,
        };
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
        next.thread = upsertThreadTurn(next.thread, event.turn);
        next = reconcileTurnDiagnostics(next, event.turn);
      }
      return next;
    case 'item_started':
    case 'item_completed':
      if (!event.item?.id) return next;
      return addOrUpdateItem(
        next,
        {
          ...event.item,
          turn_id: String(event.item.turn_id ?? event.turn_id ?? '').trim() || undefined,
          status: inferItemStatus(
            event.item.status,
            event.type === 'item_completed' ? 'completed' : 'inProgress',
          ),
          text: itemTextOrContent(event.item),
        },
        next.item_order.length,
        { replaceEmptyText: event.type === 'item_completed' && String(event.item.type ?? '').trim() === 'agentMessage' },
      );
    case 'agent_message_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemText(next, itemID, {
        id: itemID,
        type: 'agentMessage',
        turn_id: String(event.turn_id ?? '').trim() || undefined,
        text: '',
        status: 'inProgress',
      }, String(event.delta ?? ''));
    }
    case 'command_output_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      next = ensureLiveItem(next, itemID, {
        id: itemID,
        type: 'commandExecution',
        turn_id: String(event.turn_id ?? '').trim() || undefined,
        aggregated_output: '',
        status: 'inProgress',
      });
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
      next = ensureLiveItem(next, itemID, {
        id: itemID,
        type: 'fileChange',
        turn_id: String(event.turn_id ?? '').trim() || undefined,
        changes: [],
        status: 'inProgress',
      });
      return appendFileChangeDiff(next, itemID, String(event.delta ?? ''));
    }
    case 'plan_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemText(next, itemID, {
        id: itemID,
        type: 'plan',
        turn_id: String(event.turn_id ?? '').trim() || undefined,
        text: '',
        status: 'inProgress',
      }, String(event.delta ?? ''));
    }
    case 'reasoning_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      const delta = String(event.delta ?? '');
      if (typeof event.content_index === 'number') {
        return appendItemContent(next, itemID, {
          id: itemID,
          type: 'reasoning',
          turn_id: String(event.turn_id ?? '').trim() || undefined,
          content: [],
          status: 'inProgress',
        }, event.content_index, delta);
      }
      return appendItemText(next, itemID, {
        id: itemID,
        type: 'reasoning',
        turn_id: String(event.turn_id ?? '').trim() || undefined,
        text: '',
        status: 'inProgress',
      }, delta);
    }
    case 'reasoning_summary_delta': {
      const itemID = String(event.item_id ?? '').trim();
      if (!itemID) return next;
      return appendItemSummary(
        next,
        itemID,
        {
          id: itemID,
          type: 'reasoning',
          turn_id: String(event.turn_id ?? '').trim() || undefined,
          summary: [],
          status: 'inProgress',
        },
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
        {
          id: itemID,
          type: 'reasoning',
          turn_id: String(event.turn_id ?? '').trim() || undefined,
          summary: [],
          status: 'inProgress',
        },
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
    case 'request_evicted':
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
      if (event.turn_id) {
        const turnID = String(event.turn_id).trim();
        const turn = next.thread.turns?.find((entry) => String(entry.id ?? '').trim() === turnID) ?? {
          id: turnID,
          status: 'failed',
          error: event.turn_error ?? {
            message: String(event.error ?? '').trim() || 'Codex reported an error.',
          },
          items: [],
        };
        const fallbackTurnError = event.turn_error ?? turn.error ?? {
          message: String(event.error ?? '').trim() || 'Codex reported an error.',
        };
        next.thread = upsertThreadTurn(next.thread, {
          ...turn,
          status: 'failed',
          error: fallbackTurnError,
        });
        next = reconcileTurnDiagnostics(next, turn, fallbackTurnError);
      }
      return next;
    case 'stream_desynced':
      return next;
    default:
      return next;
  }
}
