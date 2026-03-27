import type { JSX } from 'solid-js';
import { Code, FileText, Terminal } from '@floegence/floe-webapp-core/icons';
import type { TagProps } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import type { CodexItem, CodexThread, CodexTranscriptItem } from './types';

export type CodexReviewArtifact = Readonly<{
  path: string;
  kind: string;
  movePath?: string;
  diff?: string;
}>;

export type CodexReviewSnapshot = Readonly<{
  artifactCount: number;
  commandCount: number;
  responseCount: number;
  reasoningCount: number;
}>;

export type CodexThreadGroup = Readonly<{
  group: 'Today' | 'Yesterday' | 'This Week' | 'Older';
  threads: CodexThread[];
}>;

export function itemTitle(item: CodexItem): string {
  switch (item.type) {
    case 'userMessage':
      return 'Requested review';
    case 'agentMessage':
      return 'Codex review';
    case 'commandExecution':
      return 'Command evidence';
    case 'fileChange':
      return 'Artifact changes';
    case 'webSearch':
      return 'Web search';
    case 'reasoning':
      return 'Reasoning note';
    case 'plan':
      return 'Execution plan';
    default:
      return item.type || 'Event';
  }
}

export function itemText(item: CodexTranscriptItem): string {
  if (String(item.text ?? '').trim()) return String(item.text);
  if (item.type === 'webSearch') {
    const query = String(item.query ?? '').trim();
    const actionType = String(item.action?.type ?? '').trim();
    const queries = Array.isArray(item.action?.queries)
      ? item.action?.queries?.map((entry) => String(entry ?? '').trim()).filter(Boolean) ?? []
      : [];
    const url = String(item.action?.url ?? '').trim();
    const pattern = String(item.action?.pattern ?? '').trim();

    if (actionType === 'search') {
      const lines = [
        query ? `Query: ${query}` : '',
        queries.length > 0 ? `Queries:\n${queries.map((entry) => `- ${entry}`).join('\n')}` : '',
      ].filter(Boolean);
      return lines.join('\n\n');
    }
    if (actionType === 'openPage') {
      return [query ? `Query: ${query}` : '', url ? `Opened page: ${url}` : ''].filter(Boolean).join('\n\n');
    }
    if (actionType === 'findInPage') {
      return [
        query ? `Query: ${query}` : '',
        pattern ? `Pattern: ${pattern}` : '',
        url ? `Page: ${url}` : '',
      ].filter(Boolean).join('\n\n');
    }
    if (query) return query;
  }
  if ((item.content?.length ?? 0) > 0) return (item.content ?? []).join('\n');
  if ((item.inputs?.length ?? 0) > 0) {
    return (item.inputs ?? [])
      .map((entry) => String(entry.text ?? entry.path ?? entry.name ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  }
  if (String(item.query ?? '').trim()) return String(item.query);
  return '';
}

export function displayStatus(value: string | null | undefined, fallback = 'Idle'): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  return normalized
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .toLowerCase();
}

export function isWorkingStatus(value: string | null | undefined): boolean {
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

export function compactPathLabel(value: string | null | undefined, fallback = ''): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return normalized;
  if (normalized.length <= 24) return normalized;
  if (parts.length === 1) return parts[0] ?? fallback;
  return `…/${parts.slice(-2).join('/')}`;
}

export function statusTagVariant(status: string | null | undefined): TagProps['variant'] {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return 'neutral';
  if (
    normalized === 'idle' ||
    normalized === 'ready' ||
    normalized === 'archived' ||
    normalized === 'notloaded' ||
    normalized === 'not_loaded' ||
    normalized === 'not loaded'
  ) {
    return 'neutral';
  }
  if (normalized === 'completed' || normalized === 'success') return 'success';
  if (isWorkingStatus(normalized)) {
    return 'info';
  }
  if (normalized.includes('approval') || normalized.includes('waiting') || normalized.includes('input')) {
    return 'warning';
  }
  if (normalized.includes('error') || normalized.includes('fail') || normalized.includes('decline')) {
    return 'error';
  }
  return 'neutral';
}

export function requestTagVariant(type: string): TagProps['variant'] {
  const normalized = String(type ?? '').trim().toLowerCase();
  if (normalized === 'user_input') return 'info';
  if (normalized.includes('approval') || normalized === 'permissions') return 'warning';
  return 'neutral';
}

export function formatUpdatedAt(unixSeconds: number): string {
  const value = Number(unixSeconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value * 1000).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatRelativeThreadTime(unixSeconds: number): string {
  const value = Number(unixSeconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    const now = Date.now();
    const diff = now - value * 1000;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 7) {
      const date = new Date(value * 1000);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return 'now';
  } catch {
    return '';
  }
}

export function threadStatusDotClass(status: string | null | undefined): string {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (isWorkingStatus(normalized)) {
    return 'bg-primary';
  }
  if (normalized.includes('approval') || normalized.includes('waiting') || normalized.includes('input')) {
    return 'bg-amber-500';
  }
  if (normalized === 'completed' || normalized === 'success') {
    return 'bg-emerald-500';
  }
  if (normalized.includes('error') || normalized.includes('fail') || normalized.includes('decline')) {
    return 'bg-error';
  }
  return 'bg-muted-foreground/35';
}

export function threadPreview(thread: CodexThread): string {
  const preview = String(thread.preview ?? '').trim();
  if (preview) return preview;
  const path = String(thread.path ?? thread.cwd ?? '').trim();
  if (path) return path;
  return 'No conversation preview yet.';
}

function threadSortTime(thread: CodexThread): number {
  const updated = Number(thread.updated_at_unix_s ?? 0);
  if (updated > 0) return updated * 1000;
  const created = Number(thread.created_at_unix_s ?? 0);
  if (created > 0) return created * 1000;
  return 0;
}

export function groupThreadsByDate(threads: readonly CodexThread[]): CodexThreadGroup[] {
  if (threads.length === 0) return [];
  if (threads.length < 5) {
    return [{ group: 'Today', threads: [...threads] }];
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const dayOfWeek = now.getDay();
  const weekStart = todayStart - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * 86_400_000);

  const groups: Record<CodexThreadGroup['group'], CodexThread[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Older: [],
  };

  for (const thread of threads) {
    const timestamp = threadSortTime(thread);
    if (timestamp >= todayStart) {
      groups.Today.push(thread);
    } else if (timestamp >= yesterdayStart) {
      groups.Yesterday.push(thread);
    } else if (timestamp >= weekStart) {
      groups['This Week'].push(thread);
    } else {
      groups.Older.push(thread);
    }
  }

  return (['Today', 'Yesterday', 'This Week', 'Older'] as const)
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ group, threads: groups[group] }));
}

export function itemGlyph(item: CodexItem): JSX.Element {
  switch (item.type) {
    case 'agentMessage':
      return <CodexIcon class="h-4 w-4" />;
    case 'commandExecution':
      return <Terminal class="h-4 w-4" />;
    case 'reasoning':
    case 'plan':
      return <Code class="h-4 w-4" />;
    default:
      return <FileText class="h-4 w-4" />;
  }
}

export function buildTranscriptSnapshot(items: readonly CodexTranscriptItem[]): CodexReviewSnapshot {
  let artifactCount = 0;
  let commandCount = 0;
  let responseCount = 0;
  let reasoningCount = 0;

  for (const item of items) {
    if (item.type === 'fileChange') {
      artifactCount += item.changes?.length ?? 0;
      continue;
    }
    if (item.type === 'commandExecution') {
      commandCount += 1;
      continue;
    }
    if (item.type === 'agentMessage') {
      responseCount += 1;
      continue;
    }
    if (item.type === 'reasoning' || item.type === 'plan') {
      reasoningCount += 1;
    }
  }

  return {
    artifactCount,
    commandCount,
    responseCount,
    reasoningCount,
  };
}

export function collectRecentArtifacts(
  items: readonly CodexTranscriptItem[],
  limit = 4,
): CodexReviewArtifact[] {
  const artifacts: CodexReviewArtifact[] = [];

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type !== 'fileChange') continue;
    for (const change of item.changes ?? []) {
      artifacts.push({
        path: change.path,
        kind: change.kind,
        movePath: change.move_path,
        diff: change.diff,
      });
      if (artifacts.length >= limit) {
        return artifacts;
      }
    }
  }

  return artifacts;
}
