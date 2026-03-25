import type { JSX } from 'solid-js';
import { Code, FileText, Terminal } from '@floegence/floe-webapp-core/icons';
import type { TagProps } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import type { CodexItem, CodexTranscriptItem } from './types';

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
  if ((item.content?.length ?? 0) > 0) return (item.content ?? []).join('\n');
  return 'No content.';
}

export function displayStatus(value: string | null | undefined, fallback = 'Idle'): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  return normalized.replaceAll('_', ' ');
}

export function statusTagVariant(status: string | null | undefined): TagProps['variant'] {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) return 'neutral';
  if (normalized === 'idle' || normalized === 'ready' || normalized === 'archived') return 'neutral';
  if (normalized === 'completed' || normalized === 'success') return 'success';
  if (
    normalized === 'running' ||
    normalized === 'accepted' ||
    normalized === 'recovering' ||
    normalized === 'finalizing'
  ) {
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
