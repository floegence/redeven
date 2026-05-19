import { buildCodexAdaptedFileChange } from './fileChangeDiff';
import type { CodexFileChange, CodexTranscriptItem } from './types';

export type CodexTranscriptDisplayNode =
  | CodexTranscriptMessageNode
  | CodexTranscriptActivityGroupNode
  | CodexTranscriptAttentionNode;

export type CodexTranscriptMessageNode = Readonly<{
  kind: 'message';
  id: string;
  item: CodexTranscriptItem;
}>;

export type CodexTranscriptAttentionReason =
  | 'error'
  | 'approval'
  | 'user_input'
  | 'empty_response'
  | 'stream_desync';

export type CodexTranscriptAttentionNode = Readonly<{
  kind: 'attention';
  id: string;
  item: CodexTranscriptItem;
  reason: CodexTranscriptAttentionReason;
}>;

export type CodexActivityGroupStatus = 'running' | 'completed' | 'failed';

export type CodexActivityGroupExpandLevel = 'collapsed' | 'semi';

export type CodexTranscriptActivityGroupNode = Readonly<{
  kind: 'activity_group';
  id: string;
  turnID: string;
  status: CodexActivityGroupStatus;
  summary: CodexActivityGroupSummary;
  items: readonly CodexActivityItem[];
  defaultExpandLevel: CodexActivityGroupExpandLevel;
}>;

export type CodexActivityItem =
  | CodexActivityReadItem
  | CodexActivitySearchItem
  | CodexActivityCommandItem
  | CodexActivityFileChangeItem
  | CodexActivityReasoningItem
  | CodexActivityPlanItem
  | CodexActivityGenericItem;

export type CodexActivityItemKind =
  | 'read'
  | 'search'
  | 'command'
  | 'file_change'
  | 'reasoning'
  | 'plan'
  | 'generic';

export type CodexActivityDetailRef =
  | { type: 'none' }
  | { type: 'file_preview'; path: string; sourceItemID: string }
  | { type: 'file_diff'; sourceItemID: string; changeIndex: number }
  | { type: 'command_output'; sourceItemID: string }
  | { type: 'web_search'; sourceItemID: string }
  | { type: 'reasoning'; sourceItemID: string }
  | { type: 'plan'; sourceItemID: string }
  | { type: 'raw_item'; sourceItemID: string };

export type CodexActivityItemBase = Readonly<{
  id: string;
  kind: CodexActivityItemKind;
  sourceItemID: string;
  order: number;
  status: CodexActivityGroupStatus;
  label: string;
  detail: CodexActivityDetailRef;
}>;

export type CodexActivityReadItem = CodexActivityItemBase & Readonly<{
  kind: 'read';
  path: string;
}>;

export type CodexActivitySearchItem = CodexActivityItemBase & Readonly<{
  kind: 'search';
  query: string;
  scope?: string;
  resultCount?: number;
}>;

export type CodexActivityCommandItem = CodexActivityItemBase & Readonly<{
  kind: 'command';
  commandPreview: string;
  cwd?: string;
  durationMs?: number;
  exitCode?: number;
}>;

export type CodexActivityFileChangeAction =
  | 'created'
  | 'edited'
  | 'deleted'
  | 'renamed';

export type CodexActivityFileChangeItem = CodexActivityItemBase & Readonly<{
  kind: 'file_change';
  action: CodexActivityFileChangeAction;
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  changeIndex: number;
}>;

export type CodexActivityReasoningItem = CodexActivityItemBase & Readonly<{
  kind: 'reasoning';
}>;

export type CodexActivityPlanItem = CodexActivityItemBase & Readonly<{
  kind: 'plan';
}>;

export type CodexActivityGenericItem = CodexActivityItemBase & Readonly<{
  kind: 'generic';
  sourceType: string;
}>;

export type CodexActivityGroupSummary = Readonly<{
  exploredFiles: number;
  searches: number;
  commands: number;
  failedCommands: number;
  createdFiles: number;
  editedFiles: number;
  deletedFiles: number;
  renamedFiles: number;
  additions: number;
  deletions: number;
  hasReasoning: boolean;
  hasPlan: boolean;
  headline: string;
}>;

export type CodexTranscriptDisplayModelOptions = Readonly<{
  activeItemIDs?: ReadonlySet<string>;
}>;

type MutableActivityGroup = {
  id: string;
  turnID: string;
  items: CodexActivityItem[];
};

function itemTurnID(item: CodexTranscriptItem): string {
  const value = (item as { turn_id?: unknown }).turn_id;
  const normalized = String(value ?? '').trim();
  return normalized || 'turn:unknown';
}

function isWorkingStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (
    normalized === 'active' ||
    normalized === 'working' ||
    normalized === 'running' ||
    normalized === 'accepted' ||
    normalized === 'recovering' ||
    normalized === 'finalizing' ||
    normalized === 'inprogress' ||
    normalized === 'in_progress' ||
    normalized === 'in progress'
  );
}

function compactPathLabel(value: string | null | undefined, fallback = ''): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return normalized;
  if (normalized.length <= 24) return normalized;
  if (parts.length === 1) return parts[0] ?? fallback;
  return `…/${parts.slice(-2).join('/')}`;
}

function itemText(item: CodexTranscriptItem): string {
  if (String(item.text ?? '').trim()) return String(item.text);
  if ((item.content?.length ?? 0) > 0) return (item.content ?? []).join('\n');
  if (String(item.query ?? '').trim()) return String(item.query);
  return '';
}

function activityItemStatus(item: CodexTranscriptItem): CodexActivityGroupStatus {
  const status = String(item.status ?? '').trim().toLowerCase();
  if (status.includes('error') || status.includes('fail')) return 'failed';
  if (typeof item.exit_code === 'number' && item.exit_code !== 0) return 'failed';
  if (isWorkingStatus(status)) return 'running';
  return 'completed';
}

function normalizeChangeAction(kind: string | null | undefined): CodexActivityFileChangeAction {
  const normalized = String(kind ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
    case 'new':
    case 'newfile':
    case 'new_file':
    case 'new file':
      return 'created';
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'deleted';
    case 'rename':
    case 'renamed':
    case 'move':
    case 'moved':
      return 'renamed';
    default:
      return 'edited';
  }
}

function fileChangeVerb(action: CodexActivityFileChangeAction): string {
  switch (action) {
    case 'created':
      return 'Created';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'edited':
    default:
      return 'Edited';
  }
}

function commandPreview(command: string | null | undefined): string {
  const normalized = String(command ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'command';
  return normalized.length > 72 ? `${normalized.slice(0, 69).trim()}...` : normalized;
}

function formatDuration(ms: number | null | undefined): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds >= 10 ? Math.round(seconds) : Number(seconds.toFixed(1))}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function webSearchQuery(item: CodexTranscriptItem): string {
  const query = String(item.query ?? '').trim();
  if (query) return query;
  const action = item.action;
  const actionType = String(action?.type ?? '').trim();
  if (Array.isArray(action?.queries)) {
    const queries = action.queries.map((entry) => String(entry ?? '').trim()).filter(Boolean);
    if (queries.length > 0) return queries.join(', ');
  }
  if (actionType === 'findInPage') {
    return String(action?.pattern ?? action?.query ?? action?.url ?? itemText(item) ?? '').trim();
  }
  if (actionType === 'openPage') {
    return String(action?.url ?? action?.query ?? action?.pattern ?? itemText(item) ?? '').trim();
  }
  return String(action?.query ?? action?.pattern ?? action?.url ?? itemText(item) ?? '').trim();
}

function webSearchLabel(item: CodexTranscriptItem): string {
  const actionType = String(item.action?.type ?? '').trim();
  const query = webSearchQuery(item);
  if (actionType === 'openPage') {
    return query ? `Opened ${query}` : 'Opened page';
  }
  if (actionType === 'findInPage') {
    return query ? `Searched page for "${query}"` : 'Searched page';
  }
  return query ? `Searched for "${query}"` : 'Searched web';
}

function reasoningContent(item: CodexTranscriptItem): string {
  const summary = (item.summary ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean);
  if (summary.length > 0) return summary.join('\n');
  if ((item.content?.length ?? 0) > 0) return (item.content ?? []).join('\n');
  return String(item.text ?? '').trim();
}

function buildFileChangeActivityItems(item: CodexTranscriptItem): CodexActivityFileChangeItem[] {
  const changes = item.changes ?? [];
  return changes.map((change: CodexFileChange, changeIndex) => {
    const action = normalizeChangeAction(change.kind);
    const adapted = buildCodexAdaptedFileChange(change).file;
    const path = String(adapted.displayPath ?? adapted.newPath ?? adapted.path ?? change.path ?? '').trim() || 'Untitled change';
    const oldPath = String(adapted.oldPath ?? '').trim() || undefined;
    const additions = Number(adapted.additions ?? 0);
    const deletions = Number(adapted.deletions ?? 0);
    const delta = `+${Math.max(0, additions)} -${Math.max(0, deletions)}`;
    return {
      id: `${item.id}:change:${changeIndex}`,
      kind: 'file_change',
      sourceItemID: item.id,
      order: item.order + changeIndex / 1000,
      status: activityItemStatus(item),
      label: `${fileChangeVerb(action)} ${compactPathLabel(path, path)} ${delta}`,
      detail: { type: 'file_diff', sourceItemID: item.id, changeIndex },
      action,
      path,
      oldPath,
      additions: Math.max(0, additions),
      deletions: Math.max(0, deletions),
      changeIndex,
    };
  });
}

function buildCommandActivityItem(item: CodexTranscriptItem): CodexActivityCommandItem {
  const preview = commandPreview(item.command);
  const status = activityItemStatus(item);
  const duration = formatDuration(item.duration_ms);
  const failed = status === 'failed';
  const exit = failed && typeof item.exit_code === 'number' ? `exit ${item.exit_code}` : '';
  const suffix = [failed ? 'failed' : '', exit, duration].filter(Boolean).join(' · ');
  return {
    id: `${item.id}:command`,
    kind: 'command',
    sourceItemID: item.id,
    order: item.order,
    status,
    label: suffix ? `Ran ${preview} · ${suffix}` : `Ran ${preview}`,
    detail: { type: 'command_output', sourceItemID: item.id },
    commandPreview: preview,
    cwd: item.cwd,
    durationMs: item.duration_ms,
    exitCode: item.exit_code,
  };
}

function buildSearchActivityItem(item: CodexTranscriptItem): CodexActivitySearchItem {
  const query = webSearchQuery(item);
  return {
    id: `${item.id}:web-search`,
    kind: 'search',
    sourceItemID: item.id,
    order: item.order,
    status: activityItemStatus(item),
    label: webSearchLabel(item),
    detail: { type: 'web_search', sourceItemID: item.id },
    query,
  };
}

function buildReasoningActivityItem(item: CodexTranscriptItem): CodexActivityReasoningItem | null {
  if (!reasoningContent(item)) return null;
  return {
    id: `${item.id}:reasoning`,
    kind: 'reasoning',
    sourceItemID: item.id,
    order: item.order,
    status: activityItemStatus(item),
    label: item.type === 'plan' ? 'Planned next steps' : 'Thought through the approach',
    detail: { type: 'reasoning', sourceItemID: item.id },
  };
}

function buildPlanActivityItem(item: CodexTranscriptItem): CodexActivityPlanItem | null {
  if (!reasoningContent(item)) return null;
  return {
    id: `${item.id}:plan`,
    kind: 'plan',
    sourceItemID: item.id,
    order: item.order,
    status: activityItemStatus(item),
    label: 'Planned next steps',
    detail: { type: 'plan', sourceItemID: item.id },
  };
}

function buildGenericActivityItem(item: CodexTranscriptItem): CodexActivityGenericItem | null {
  const text = itemText(item);
  if (!text) return null;
  const label = text.length > 96 ? `${text.slice(0, 93).trim()}...` : text;
  return {
    id: `${item.id}:generic`,
    kind: 'generic',
    sourceItemID: item.id,
    order: item.order,
    status: activityItemStatus(item),
    label,
    detail: { type: 'raw_item', sourceItemID: item.id },
    sourceType: item.type,
  };
}

function buildActivityItems(item: CodexTranscriptItem): CodexActivityItem[] {
  switch (item.type) {
    case 'fileChange':
      return buildFileChangeActivityItems(item);
    case 'commandExecution':
      return [buildCommandActivityItem(item)];
    case 'webSearch':
      return [buildSearchActivityItem(item)];
    case 'reasoning': {
      const activity = buildReasoningActivityItem(item);
      return activity ? [activity] : [];
    }
    case 'plan': {
      const activity = buildPlanActivityItem(item);
      return activity ? [activity] : [];
    }
    default: {
      const activity = buildGenericActivityItem(item);
      return activity ? [activity] : [];
    }
  }
}

function isMessageItem(item: CodexTranscriptItem): boolean {
  return item.type === 'userMessage' || item.type === 'agentMessage';
}

function isActivityItem(item: CodexTranscriptItem): boolean {
  return (
    item.type === 'commandExecution' ||
    item.type === 'fileChange' ||
    item.type === 'webSearch' ||
    item.type === 'reasoning' ||
    item.type === 'plan'
  );
}

function attentionReason(item: CodexTranscriptItem): CodexTranscriptAttentionReason | null {
  if (item.type === 'turnDiagnostic' && item.diagnostic_kind === 'empty_response') return 'empty_response';
  const status = String(item.status ?? '').trim().toLowerCase();
  if (status === 'desynced' || status.includes('desync')) return 'stream_desync';
  if (status.includes('approval') || status.includes('waiting')) return 'approval';
  if (status.includes('input')) return 'user_input';
  if (status.includes('error') || status.includes('fail')) return 'error';
  return null;
}

function summarizeActivityGroup(items: readonly CodexActivityItem[]): CodexActivityGroupSummary {
  let exploredFiles = 0;
  let searches = 0;
  let commands = 0;
  let failedCommands = 0;
  let createdFiles = 0;
  let editedFiles = 0;
  let deletedFiles = 0;
  let renamedFiles = 0;
  let additions = 0;
  let deletions = 0;
  let hasReasoning = false;
  let hasPlan = false;

  for (const item of items) {
    switch (item.kind) {
      case 'read':
        exploredFiles += 1;
        break;
      case 'search':
        searches += 1;
        break;
      case 'command':
        commands += 1;
        if (item.status === 'failed') failedCommands += 1;
        break;
      case 'file_change':
        additions += item.additions;
        deletions += item.deletions;
        if (item.action === 'created') createdFiles += 1;
        else if (item.action === 'deleted') deletedFiles += 1;
        else if (item.action === 'renamed') renamedFiles += 1;
        else editedFiles += 1;
        break;
      case 'reasoning':
        hasReasoning = true;
        break;
      case 'plan':
        hasPlan = true;
        break;
      default:
        break;
    }
  }

  const parts: string[] = [];
  if (createdFiles > 0) parts.push(`created ${createdFiles} ${createdFiles === 1 ? 'file' : 'files'}`);
  if (editedFiles > 0) parts.push(`edited ${editedFiles} ${editedFiles === 1 ? 'file' : 'files'}`);
  if (deletedFiles > 0) parts.push(`deleted ${deletedFiles} ${deletedFiles === 1 ? 'file' : 'files'}`);
  if (renamedFiles > 0) parts.push(`renamed ${renamedFiles} ${renamedFiles === 1 ? 'file' : 'files'}`);
  if (exploredFiles > 0) parts.push(`explored ${exploredFiles} ${exploredFiles === 1 ? 'file' : 'files'}`);
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`);
  if (commands > 0) {
    parts.push(failedCommands > 0 ? `${commands} commands, ${failedCommands} failed` : `${commands} ${commands === 1 ? 'command' : 'commands'}`);
  }
  if (hasPlan) parts.push('planned');
  if (hasReasoning) parts.push('reasoned');

  return {
    exploredFiles,
    searches,
    commands,
    failedCommands,
    createdFiles,
    editedFiles,
    deletedFiles,
    renamedFiles,
    additions,
    deletions,
    hasReasoning,
    hasPlan,
    headline: parts.length > 0 ? parts.join(', ') : 'worked',
  };
}

function finalizeGroup(group: MutableActivityGroup): CodexTranscriptActivityGroupNode {
  const status = group.items.some((item) => item.status === 'failed')
    ? 'failed'
    : group.items.some((item) => item.status === 'running')
      ? 'running'
      : 'completed';
  return {
    kind: 'activity_group',
    id: group.id,
    turnID: group.turnID,
    status,
    summary: summarizeActivityGroup(group.items),
    items: [...group.items],
    defaultExpandLevel: 'semi',
  };
}

export function buildCodexTranscriptDisplayNodes(
  items: readonly CodexTranscriptItem[],
  _options: CodexTranscriptDisplayModelOptions = {},
): CodexTranscriptDisplayNode[] {
  const nodes: CodexTranscriptDisplayNode[] = [];
  let activeGroup: MutableActivityGroup | null = null;

  const flushGroup = () => {
    if (!activeGroup) return;
    if (activeGroup.items.length > 0) {
      nodes.push(finalizeGroup(activeGroup));
    }
    activeGroup = null;
  };

  for (const item of items) {
    if (isMessageItem(item)) {
      flushGroup();
      nodes.push({ kind: 'message', id: item.id, item });
      continue;
    }

    if (isActivityItem(item)) {
      const activities = buildActivityItems(item);
      if (activities.length === 0) continue;
      const turnID = itemTurnID(item);
      if (!activeGroup || activeGroup.turnID !== turnID) {
        flushGroup();
        activeGroup = { id: `activity:${turnID}:${item.id}`, turnID, items: [] };
      }
      activeGroup.items.push(...activities);
      continue;
    }

    const reason = attentionReason(item);
    if (reason) {
      flushGroup();
      nodes.push({ kind: 'attention', id: item.id, item, reason });
      continue;
    }

    const activities = buildActivityItems(item);
    if (activities.length === 0) continue;
    const turnID = itemTurnID(item);
    if (!activeGroup || activeGroup.turnID !== turnID) {
      flushGroup();
      activeGroup = { id: `activity:${turnID}:${item.id}`, turnID, items: [] };
    }
    activeGroup.items.push(...activities);
  }

  flushGroup();
  return nodes;
}

export function findCodexActivitySourceItem(
  items: readonly CodexTranscriptItem[],
  sourceItemID: string,
): CodexTranscriptItem | null {
  const target = String(sourceItemID ?? '').trim();
  if (!target) return null;
  return items.find((item) => item.id === target) ?? null;
}
