import type { FlowerTurnLauncherContextItem, FlowerTurnLauncherIntent } from '../../../../../flower_ui/src';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherIntent } from '../contextActions/askFlower';
import type {
  GitBranchSummary,
  GitCommitDetail,
  GitCommitFileSummary,
  GitCommitSummary,
  GitRepoSummaryResponse,
  GitStashSummary,
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import { dirnameAbsolute, isWithinAbsolutePath, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';
import {
  branchDisplayName,
  changeDisplayPath,
  isGitWorkspaceDirectoryEntry,
  repoDisplayName,
  type GitSeededCommitFileSummary,
  type GitSeededWorkspaceChange,
  type GitWorkspaceViewSection,
  workspaceDirectoryPath,
  workspaceViewSectionLabel,
} from './gitWorkbench';

const MAX_GIT_SNAPSHOT_FILES = 40;
const MAX_GIT_SNAPSHOT_CONTENT_CODE_POINTS = 12_000;
const MAX_GIT_SNAPSHOT_TITLE_CODE_POINTS = 160;
const MAX_GIT_SNAPSHOT_DETAIL_CODE_POINTS = 480;
const GIT_SNAPSHOT_TRUNCATION_MARKER = '\n... [Git context truncated]';

type TextSnapshotContextItem = Extract<FlowerTurnLauncherContextItem, { kind: 'text_snapshot' }>;
type GitCommitLike = GitCommitDetail | GitCommitSummary;

export type GitDirectoryShortcutRequest = Readonly<{
  path: string;
  preferredName?: string;
  title?: string;
  homePath?: string;
}>;

export type BuildGitDirectoryShortcutRequestParams = Readonly<{
  rootPath: string;
  directoryPath?: string;
  preferredName?: string;
  title?: string;
  homePath?: string;
}>;

export type GitFileShortcutTarget = Readonly<{
  absolutePath: string;
  parentDirectoryPath: string;
  relativePath: string;
  canPreviewCurrentFile: boolean;
}>;

export type BuildGitFileShortcutTargetParams = Readonly<{
  rootPath: string;
  item: GitWorkspaceChange | GitCommitFileSummary;
}>;

export type GitAskFlowerRequest =
  | Readonly<{
      kind: 'repository';
      repoRootPath: string;
      worktreePath?: string;
      headRef?: string;
      headCommit?: string;
      summary?: GitRepoSummaryResponse;
    }>
  | Readonly<{
      kind: 'workspace_section';
      repoRootPath: string;
      headRef?: string;
      section: GitWorkspaceViewSection;
      items: GitWorkspaceChange[];
    }>
  | Readonly<{
      kind: 'workspace_item';
      repoRootPath: string;
      headRef?: string;
      section: GitWorkspaceViewSection;
      item: GitWorkspaceChange;
    }>
  | Readonly<{
      kind: 'branch';
      repoRootPath: string;
      branch: GitBranchSummary;
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
      kind: 'branch_status_item';
      repoRootPath: string;
      worktreePath?: string;
      branch: GitBranchSummary;
      section: GitWorkspaceViewSection;
      item: GitWorkspaceChange;
    }>
  | Readonly<{
      kind: 'commit';
      repoRootPath: string;
      location: 'graph' | 'branch_history';
      branchName?: string;
      commit: GitCommitLike;
      files: GitCommitFileSummary[];
    }>
  | Readonly<{
      kind: 'stash';
      repoRootPath: string;
      stash: GitStashSummary;
      files?: GitCommitFileSummary[];
    }>
  | Readonly<{
      kind: 'stash_file';
      repoRootPath: string;
      stash: GitStashSummary;
      file: GitCommitFileSummary;
    }>
  | Readonly<{
      kind: 'compare_file';
      repoRootPath: string;
      baseRef: string;
      targetRef: string;
      file: GitCommitFileSummary;
    }>;

export type BuildGitFlowerTurnLauncherIntentResult = Readonly<{
  intent: FlowerTurnLauncherIntent | null;
  error?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function truncateCodePoints(value: unknown, maxCodePoints: number, marker = ''): string {
  const text = compact(value);
  if (!text || maxCodePoints <= 0) return '';
  const markerLength = Array.from(marker).length;
  const contentLimit = Math.max(0, maxCodePoints - markerLength);
  let result = '';
  let count = 0;
  for (const character of text) {
    if (count >= contentLimit) return `${result}${marker}`;
    result += character;
    count += 1;
  }
  return result;
}

function normalizeGitRelativePath(value: unknown, allowEmpty: boolean): string | null {
  const raw = compact(value).replace(/\\/g, '/');
  if (!raw || raw === '.') return allowEmpty ? '' : null;
  if (raw.startsWith('/')) return null;

  const parts = raw
    .replace(/\/+$/, '')
    .split('/')
    .filter((part) => part && part !== '.');

  if (parts.length === 0) return allowEmpty ? '' : null;
  if (parts.some((part) => part === '..' || part.includes('\0'))) return null;
  return parts.join('/');
}

function normalizeGitRootPath(value: unknown): string | null {
  const rootPath = normalizeAbsolutePath(compact(value));
  if (!rootPath) return null;
  const parts = rootPath.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) return null;
  return rootPath;
}

function resolveGitPath(rootPathValue: unknown, gitPathValue: unknown, allowEmpty = false): {
  rootPath: string;
  relativePath: string;
  absolutePath: string;
} | null {
  const rootPath = normalizeGitRootPath(rootPathValue);
  if (!rootPath) return null;
  const relativePath = normalizeGitRelativePath(gitPathValue, allowEmpty);
  if (relativePath === null) return null;
  const absolutePath = relativePath
    ? normalizeAbsolutePath(`${rootPath === '/' ? '' : rootPath}/${relativePath}`)
    : rootPath;
  if (!absolutePath || !isWithinAbsolutePath(absolutePath, rootPath)) return null;
  return { rootPath, relativePath, absolutePath };
}

function currentGitItemPath(item: GitWorkspaceChange | GitCommitFileSummary): string {
  const changeType = compact(item.changeType).toLowerCase();
  if (changeType === 'renamed' || changeType === 'copied') {
    return compact(item.newPath) || compact(item.path);
  }
  return compact(item.path) || compact(item.newPath) || compact(item.oldPath);
}

export function buildGitFileShortcutTarget(
  params: BuildGitFileShortcutTargetParams,
): GitFileShortcutTarget | null {
  const resolved = resolveGitPath(params.rootPath, currentGitItemPath(params.item));
  if (!resolved) return null;
  const entryKind = compact((params.item as GitWorkspaceChange).entryKind).toLowerCase();
  return {
    absolutePath: resolved.absolutePath,
    parentDirectoryPath: dirnameAbsolute(resolved.absolutePath),
    relativePath: resolved.relativePath,
    canPreviewCurrentFile:
      compact(params.item.changeType).toLowerCase() !== 'deleted' && entryKind !== 'directory',
  };
}

export function buildGitDirectoryShortcutRequest(
  params: BuildGitDirectoryShortcutRequestParams,
): GitDirectoryShortcutRequest | null {
  const directoryPath = compact(params.directoryPath) === '/' ? '' : params.directoryPath;
  const resolved = resolveGitPath(params.rootPath, directoryPath, true);
  if (!resolved) return null;
  const path = resolved.absolutePath;

  const preferredName = compact(params.preferredName) || repoDisplayName(path);
  const title = compact(params.title);
  const homePath = normalizeAbsolutePath(params.homePath ?? '');

  return {
    path,
    preferredName,
    ...(title ? { title } : {}),
    ...(homePath ? { homePath } : {}),
  };
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
    title: truncateCodePoints(params.title, MAX_GIT_SNAPSHOT_TITLE_CODE_POINTS) || 'Snapshot',
    detail: truncateCodePoints(params.detail, MAX_GIT_SNAPSHOT_DETAIL_CODE_POINTS) || undefined,
    content: truncateCodePoints(
      params.content,
      MAX_GIT_SNAPSHOT_CONTENT_CODE_POINTS,
      GIT_SNAPSHOT_TRUNCATION_MARKER,
    ),
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

function buildRepositorySnapshot(request: Extract<GitAskFlowerRequest, { kind: 'repository' }>): TextSnapshotContextItem {
  const summary = request.summary;
  const headRef = compact(request.headRef) || compact(summary?.headRef);
  const headCommit = compact(request.headCommit) || compact(summary?.headCommit);
  const worktreePath = compact(request.worktreePath) || compact(summary?.worktreePath);
  const workspaceSummary = summary?.workspaceSummary;
  const lines = [
    'Context: Git repository',
    `Repository root: ${request.repoRootPath}`,
    worktreePath ? `Worktree path: ${worktreePath}` : '',
    headRef ? `HEAD: ${headRef}` : '',
    headCommit ? `HEAD commit: ${headCommit}` : '',
    summary?.detached ? 'State: Detached HEAD' : '',
    compact(summary?.upstreamRef) ? `Upstream: ${compact(summary?.upstreamRef)}` : '',
    typeof summary?.aheadCount === 'number' ? `Ahead: ${Math.max(0, Math.trunc(summary.aheadCount))}` : '',
    typeof summary?.behindCount === 'number' ? `Behind: ${Math.max(0, Math.trunc(summary.behindCount))}` : '',
    typeof summary?.stashCount === 'number' ? `Stashes: ${Math.max(0, Math.trunc(summary.stashCount))}` : '',
    workspaceSummary ? `Workspace: ${Math.max(0, Math.trunc(workspaceSummary.stagedCount ?? 0))} staged, ${Math.max(0, Math.trunc(workspaceSummary.unstagedCount ?? 0))} unstaged, ${Math.max(0, Math.trunc(workspaceSummary.untrackedCount ?? 0))} untracked, ${Math.max(0, Math.trunc(workspaceSummary.conflictedCount ?? 0))} conflicted` : '',
  ].filter(Boolean);

  return buildTextSnapshotContextItem({
    title: 'Git repository',
    detail: headRef || repoDisplayName(request.repoRootPath),
    content: lines.join('\n'),
  });
}

function buildChangedItemSnapshot(params: {
  context: string;
  title: string;
  detail?: string;
  repoRootPath: string;
  lines?: string[];
  item: GitWorkspaceChange | GitCommitFileSummary;
}): TextSnapshotContextItem {
  const workspaceItem = params.item as GitWorkspaceChange;
  const directory = isGitWorkspaceDirectoryEntry(workspaceItem);
  const itemLabel = directory ? 'Directory' : 'File';
  const pathLabel = directory
    ? workspaceDirectoryPath(workspaceItem) || formatPathLabel(params.item)
    : formatPathLabel(params.item);
  const directorySummary = directory
    ? [
        typeof workspaceItem.descendantFileCount === 'number'
          ? `Descendant files: ${Math.max(0, Math.trunc(workspaceItem.descendantFileCount))}`
          : '',
        workspaceItem.containsUnstaged ? 'Contains unstaged changes: Yes' : '',
        workspaceItem.containsUntracked ? 'Contains untracked files: Yes' : '',
        workspaceItem.section === 'conflicted' ? 'Contains conflicts: Yes' : '',
      ].filter(Boolean)
    : [];
  return buildTextSnapshotContextItem({
    title: params.title,
    detail: params.detail || pathLabel,
    content: [
      `Context: ${params.context}`,
      `Repository root: ${params.repoRootPath}`,
      ...(params.lines ?? []),
      `${itemLabel}: ${formatChangeType(params.item.changeType)} ${pathLabel}${formatMetrics(params.item)}`,
      ...directorySummary,
    ].filter(Boolean).join('\n'),
  });
}

function buildWorkspaceItemSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'workspace_item' }>): TextSnapshotContextItem {
  const directory = isGitWorkspaceDirectoryEntry(request.item);
  return buildChangedItemSnapshot({
    context: 'Git workspace item',
    title: directory ? 'Workspace directory' : 'Workspace file',
    repoRootPath: request.repoRootPath,
    lines: [
      request.headRef ? `HEAD: ${request.headRef}` : '',
      `Section: ${workspaceViewSectionLabel(request.section)}`,
    ],
    item: request.item,
  });
}

function buildBranchSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'branch' }>): TextSnapshotContextItem {
  const branch = request.branch;
  const displayName = branchDisplayName(branch);
  const lines = [
    'Context: Git branch',
    `Repository root: ${request.repoRootPath}`,
    `Branch: ${displayName}`,
    compact(branch.kind) ? `Kind: ${compact(branch.kind)}` : '',
    branch.current ? 'State: Current branch' : '',
    compact(branch.worktreePath) ? `Worktree path: ${compact(branch.worktreePath)}` : '',
    compact(branch.headCommit) ? `HEAD commit: ${compact(branch.headCommit)}` : '',
    compact(branch.subject) ? `Latest subject: ${compact(branch.subject)}` : '',
    compact(branch.authorName) ? `Latest author: ${compact(branch.authorName)}` : '',
    formatDetailTime(branch.authorTimeMs) ? `Latest author time: ${formatDetailTime(branch.authorTimeMs)}` : '',
    compact(branch.upstreamRef) ? `Upstream: ${compact(branch.upstreamRef)}` : '',
    typeof branch.aheadCount === 'number' ? `Ahead: ${Math.max(0, Math.trunc(branch.aheadCount))}` : '',
    typeof branch.behindCount === 'number' ? `Behind: ${Math.max(0, Math.trunc(branch.behindCount))}` : '',
    branch.upstreamGone ? 'Upstream state: Gone' : '',
  ].filter(Boolean);

  return buildTextSnapshotContextItem({
    title: 'Git branch',
    detail: displayName,
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

function buildBranchStatusItemSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'branch_status_item' }>): TextSnapshotContextItem {
  const directory = isGitWorkspaceDirectoryEntry(request.item);
  return buildChangedItemSnapshot({
    context: 'Git branch status item',
    title: directory ? 'Branch status directory' : 'Branch status file',
    repoRootPath: request.repoRootPath,
    lines: [
      request.worktreePath ? `Worktree path: ${request.worktreePath}` : '',
      `Branch: ${branchDisplayName(request.branch)}`,
      `Section: ${workspaceViewSectionLabel(request.section)}`,
    ],
    item: request.item,
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

function stashDisplayName(stash: GitStashSummary): string {
  return compact(stash.ref) || compact(stash.id) || 'Selected stash';
}

function stashDetailLines(stash: GitStashSummary): string[] {
  return [
    `Stash: ${stashDisplayName(stash)}`,
    compact(stash.message) ? `Message: ${compact(stash.message)}` : '',
    compact(stash.branchName) ? `Branch: ${compact(stash.branchName)}` : '',
    compact(stash.headCommit) ? `HEAD commit: ${compact(stash.headCommit)}` : '',
    formatDetailTime(stash.createdAtUnixMs) ? `Created: ${formatDetailTime(stash.createdAtUnixMs)}` : '',
    stash.hasUntracked ? 'Includes untracked files: Yes' : '',
  ].filter(Boolean);
}

function buildStashSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'stash' }>): TextSnapshotContextItem {
  const files = request.files ?? [];
  const lines = [
    'Context: Git stash',
    `Repository root: ${request.repoRootPath}`,
    ...stashDetailLines(request.stash),
    `Changed files: ${pluralize(files.length, 'file')}`,
  ];
  const fileLines = summarizeChangedFiles(files);
  if (fileLines.length > 0) lines.push('', 'Files:', ...fileLines);
  return buildTextSnapshotContextItem({
    title: 'Git stash',
    detail: stashDisplayName(request.stash),
    content: lines.join('\n'),
  });
}

function buildStashFileSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'stash_file' }>): TextSnapshotContextItem {
  return buildChangedItemSnapshot({
    context: 'Git stash file',
    title: 'Stash file',
    repoRootPath: request.repoRootPath,
    lines: stashDetailLines(request.stash),
    item: request.file,
  });
}

function buildCompareFileSnapshot(request: Extract<GitAskFlowerRequest, { kind: 'compare_file' }>): TextSnapshotContextItem {
  return buildChangedItemSnapshot({
    context: 'Git branch comparison file',
    title: 'Compared file',
    repoRootPath: request.repoRootPath,
    lines: [
      `Base ref: ${compact(request.baseRef) || '(not specified)'}`,
      `Target ref: ${compact(request.targetRef) || '(not specified)'}`,
    ],
    item: request.file,
  });
}

export function buildGitFlowerTurnLauncherIntent(request: GitAskFlowerRequest): BuildGitFlowerTurnLauncherIntentResult {
  const repoRootPath = normalizeGitRootPath(request.repoRootPath);
  if (!repoRootPath) {
    return {
      intent: null,
      error: 'Failed to resolve the Git repository root.',
    };
  }

  const contextItem = (() => {
    switch (request.kind) {
      case 'repository':
        return buildRepositorySnapshot({
          ...request,
          repoRootPath,
          worktreePath: normalizeGitRootPath(request.worktreePath ?? request.summary?.worktreePath ?? '') || undefined,
        });
      case 'workspace_section':
        return buildWorkspaceSectionSnapshot({ ...request, repoRootPath });
      case 'workspace_item':
        return buildWorkspaceItemSnapshot({ ...request, repoRootPath });
      case 'branch':
        return buildBranchSnapshot({ ...request, repoRootPath });
      case 'branch_status':
        return buildBranchStatusSnapshot({
          ...request,
          repoRootPath,
          worktreePath: normalizeGitRootPath(request.worktreePath ?? '') || undefined,
        });
      case 'branch_status_item':
        return buildBranchStatusItemSnapshot({
          ...request,
          repoRootPath,
          worktreePath: normalizeGitRootPath(request.worktreePath ?? request.branch.worktreePath ?? '') || undefined,
        });
      case 'commit':
        return buildCommitSnapshot({ ...request, repoRootPath });
      case 'stash':
        return buildStashSnapshot({ ...request, repoRootPath });
      case 'stash_file':
        return buildStashFileSnapshot({ ...request, repoRootPath });
      case 'compare_file':
        return buildCompareFileSnapshot({ ...request, repoRootPath });
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

  const suggestedWorkingDirAbs = (() => {
    switch (request.kind) {
      case 'repository':
        return normalizeGitRootPath(request.worktreePath ?? request.summary?.worktreePath ?? '') || repoRootPath;
      case 'branch':
        return normalizeGitRootPath(request.branch.worktreePath ?? '') || repoRootPath;
      case 'branch_status':
      case 'branch_status_item':
        return normalizeGitRootPath(request.worktreePath ?? request.branch.worktreePath ?? '') || repoRootPath;
      default:
        return repoRootPath;
    }
  })();

  const intent: EnvFlowerTurnLauncherIntent = {
    id: createClientId('ask-flower'),
    source_surface: 'git_browser',
    suggested_working_dir: suggestedWorkingDirAbs,
    context_items: [contextItem],
    pending_attachments: [],
    notes: [],
  };

  return {
    intent: attachAskFlowerContextAction(intent),
  };
}
