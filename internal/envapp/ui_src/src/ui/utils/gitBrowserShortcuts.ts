import type { AskFlowerContextItem, AskFlowerIntent } from '../pages/askFlowerIntent';
import type {
  GitBranchSummary,
  GitCommitDetail,
  GitCommitFileSummary,
  GitCommitSummary,
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import { normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';
import {
  branchDisplayName,
  changeDisplayPath,
  type GitSeededCommitFileSummary,
  type GitSeededWorkspaceChange,
  type GitWorkspaceViewSection,
  workspaceViewSectionLabel,
} from './gitWorkbench';

const MAX_GIT_SNAPSHOT_FILES = 40;

type TextSnapshotContextItem = Extract<AskFlowerContextItem, { kind: 'text_snapshot' }>;
type GitCommitLike = GitCommitDetail | GitCommitSummary;

export type GitDirectoryShortcutRequest = Readonly<{
  path: string;
  preferredName?: string;
  title?: string;
  homePath?: string;
}>;

export type GitAskFlowerRequest =
  | Readonly<{
      kind: 'workspace_section';
      repoRootPath: string;
      headRef?: string;
      section: GitWorkspaceViewSection;
      items: GitWorkspaceChange[];
    }>
  | Readonly<{
      kind: 'branch_status';
      repoRootPath: string;
      worktreePath?: string;
      branch: GitBranchSummary;
      section: GitWorkspaceViewSection;
      items: GitWorkspaceChange[];
    }>
  | Readonly<{
      kind: 'commit';
      repoRootPath: string;
      location: 'graph' | 'branch_history';
      branchName?: string;
      commit: GitCommitLike;
      files: GitCommitFileSummary[];
    }>;

export type BuildGitAskFlowerIntentResult = Readonly<{
  intent: AskFlowerIntent | null;
  error?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatChangeType(changeType: unknown): string {
  switch (compact(changeType).toLowerCase()) {
    case 'added':
      return 'added';
    case 'modified':
      return 'modified';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    case 'conflicted':
      return 'conflicted';
    default:
      return compact(changeType).toLowerCase() || 'changed';
  }
}

function formatPathLabel(item: GitWorkspaceChange | GitCommitFileSummary): string {
  const oldPath = compact(item.oldPath);
  const newPath = compact(item.newPath);
  if (oldPath && newPath && oldPath !== newPath) {
    return `${oldPath} -> ${newPath}`;
  }
  return changeDisplayPath(item);
}

function formatMetrics(item: GitSeededWorkspaceChange | GitSeededCommitFileSummary): string {
  const details: string[] = [];
  const hasAdditions = typeof item.additions === 'number' && Number.isFinite(item.additions);
  const hasDeletions = typeof item.deletions === 'number' && Number.isFinite(item.deletions);
  if (hasAdditions || hasDeletions) {
    const additions = hasAdditions ? Math.max(0, Math.trunc(Number(item.additions))) : 0;
    const deletions = hasDeletions ? Math.max(0, Math.trunc(Number(item.deletions))) : 0;
    details.push(`+${additions} -${deletions}`);
  }
  if (item.isBinary) details.push('binary');
  if (item.patchTruncated) details.push('patch truncated');
  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

function summarizeChangedFiles(items: Array<GitSeededWorkspaceChange | GitSeededCommitFileSummary>): string[] {
  const lines = items.map((item) => `- ${formatChangeType(item.changeType)} ${formatPathLabel(item)}${formatMetrics(item)}`);
  if (lines.length <= MAX_GIT_SNAPSHOT_FILES) {
    return lines;
  }
  const remaining = lines.length - MAX_GIT_SNAPSHOT_FILES;
  return [
    ...lines.slice(0, MAX_GIT_SNAPSHOT_FILES),
    `- ... ${pluralize(remaining, 'more file')} omitted`,
  ];
}

function normalizeCommitBody(commit: GitCommitLike): string {
  const body = compact((commit as GitCommitDetail).body ?? (commit as GitCommitSummary).bodyPreview ?? '');
  if (!body) return '';
  const subject = compact(commit.subject);
  if (!subject) return body;
  const lines = body.split(/\r?\n/);
  if (compact(lines[0]) !== subject) return body;
  return lines.slice(1).join('\n').trim();
}

function formatDetailTime(value: unknown): string {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toLocaleString();
}

function buildTextSnapshotContextItem(params: {
  title: string;
  detail?: string;
  content: string;
}): TextSnapshotContextItem {
  return {
    kind: 'text_snapshot',
    title: compact(params.title) || 'Snapshot',
    detail: compact(params.detail) || undefined,
    content: compact(params.content),
  };
}

function buildWorkspaceSectionSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'workspace_section' }>): TextSnapshotContextItem {
  const lines = [
    'Context: Git workspace changes',
    `Repository root: ${request.repoRootPath}`,
    request.headRef ? `HEAD: ${request.headRef}` : '',
    `Section: ${workspaceViewSectionLabel(request.section)}`,
    `Files in scope: ${pluralize(request.items.length, 'file')}`,
  ].filter(Boolean);

  const fileLines = summarizeChangedFiles(request.items);
  if (fileLines.length > 0) {
    lines.push('', 'Files:', ...fileLines);
  }

  return buildTextSnapshotContextItem({
    title: 'Workspace changes',
    detail: request.headRef
      ? `${request.headRef} · ${workspaceViewSectionLabel(request.section)}`
      : workspaceViewSectionLabel(request.section),
    content: lines.join('\n'),
  });
}

function buildBranchStatusSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'branch_status' }>): TextSnapshotContextItem {
  const lines = [
    'Context: Git branch status',
    `Repository root: ${request.repoRootPath}`,
    request.worktreePath ? `Worktree path: ${request.worktreePath}` : '',
    `Branch: ${branchDisplayName(request.branch)}`,
    `Section: ${workspaceViewSectionLabel(request.section)}`,
    `Files in scope: ${pluralize(request.items.length, 'file')}`,
  ].filter(Boolean);

  const fileLines = summarizeChangedFiles(request.items);
  if (fileLines.length > 0) {
    lines.push('', 'Files:', ...fileLines);
  }

  return buildTextSnapshotContextItem({
    title: 'Branch status',
    detail: `${branchDisplayName(request.branch)} · ${workspaceViewSectionLabel(request.section)}`,
    content: lines.join('\n'),
  });
}

function buildCommitSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'commit' }>): TextSnapshotContextItem {
  const commit = request.commit;
  const hash = compact(commit.hash);
  const shortHash = compact(commit.shortHash) || hash.slice(0, 8);
  const body = normalizeCommitBody(commit);
  const lines = [
    `Context: Git ${request.location === 'graph' ? 'commit detail' : 'branch history commit'}`,
    `Repository root: ${request.repoRootPath}`,
    `Commit: ${shortHash}${hash && hash !== shortHash ? ` (${hash})` : ''}`,
    `Subject: ${compact(commit.subject) || '(no subject)'}`,
    request.branchName ? `Branch context: ${request.branchName}` : '',
    compact(commit.authorName) ? `Author: ${compact(commit.authorName)}` : '',
    formatDetailTime(commit.authorTimeMs) ? `Author time: ${formatDetailTime(commit.authorTimeMs)}` : '',
    `Parents: ${commit.parents.length > 0 ? pluralize(commit.parents.length, 'parent') : 'Root commit'}`,
    `Changed files: ${pluralize(request.files.length, 'file')}`,
  ].filter(Boolean);

  if (body) {
    lines.push('', 'Message:', body);
  }

  const fileLines = summarizeChangedFiles(request.files);
  if (fileLines.length > 0) {
    lines.push('', 'Files:', ...fileLines);
  }

  return buildTextSnapshotContextItem({
    title: 'Commit summary',
    detail: shortHash || 'Selected commit',
    content: lines.join('\n'),
  });
}

export function buildGitAskFlowerIntent(request: GitAskFlowerRequest): BuildGitAskFlowerIntentResult {
  const repoRootPath = normalizeAbsolutePath(request.repoRootPath);
  if (!repoRootPath) {
    return {
      intent: null,
      error: 'Failed to resolve the Git repository root.',
    };
  }

  const contextItem = (() => {
    switch (request.kind) {
      case 'workspace_section':
        return buildWorkspaceSectionSnapshot({ ...request, repoRootPath });
      case 'branch_status':
        return buildBranchStatusSnapshot({
          ...request,
          repoRootPath,
          worktreePath: normalizeAbsolutePath(request.worktreePath ?? '') || undefined,
        });
      case 'commit':
        return buildCommitSnapshot({ ...request, repoRootPath });
      default:
        return null;
    }
  })();

  if (!contextItem) {
    return {
      intent: null,
      error: 'Failed to build Git context.',
    };
  }

  const suggestedWorkingDirAbs = request.kind === 'branch_status'
    ? normalizeAbsolutePath(request.worktreePath ?? '') || repoRootPath
    : repoRootPath;

  return {
    intent: {
      id: createClientId('ask-flower'),
      source: 'git_browser',
      mode: 'append',
      suggestedWorkingDirAbs,
      contextItems: [contextItem],
      pendingAttachments: [],
      notes: [],
    },
  };
}
