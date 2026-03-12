import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { useRedevenRpc, type GitBranchSummary, type GitCommitFileSummary, type GitCommitSummary, type GitGetBranchCompareResponse, type GitListBranchesResponse, type GitListWorkspaceChangesResponse, type GitRepoSummaryResponse, type GitWorkspaceChange, type GitWorkspaceSection } from '../protocol/redeven_v1';
import {
  allGitBranches,
  branchContextSummary,
  branchDisplayName,
  branchIdentity,
  branchStatusSummary,
  branchSubviewLabel,
  changeSecondaryPath,
  gitDiffEntryIdentity,
  pickDefaultWorkspaceSection,
  summarizeWorkspaceCount,
  syncStatusLabel,
  workspaceHealthLabel,
  workspaceSectionItems,
  workspaceSectionLabel,
  type GitBranchSubview,
} from '../utils/gitWorkbench';
import { gitBranchTone, gitChangePathClass, gitCompareTone, gitToneActionButtonClass, gitToneBadgeClass, gitToneSelectableCardClass, workspaceSectionTone } from './GitChrome';
import { GitDiffDialog } from './GitDiffDialog';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEAD_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitLabelBlock,
  GitMetaPill,
  GitPrimaryTitle,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  repoSummary?: GitRepoSummaryResponse | null;
  workspace?: GitListWorkspaceChangesResponse | null;
  workspaceLoading?: boolean;
  workspaceError?: string;
  selectedBranch?: GitBranchSummary | null;
  selectedBranchSubview?: GitBranchSubview;
  onSelectBranchSubview?: (view: GitBranchSubview) => void;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  checkoutBusy?: boolean;
  onCheckoutBranch?: (branch: GitBranchSummary) => void;
}

function formatAbsoluteTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function compareFilePath(item: GitCommitFileSummary): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function worktreeFilePath(item: GitWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function compareOptionLabel(branch: GitBranchSummary): string {
  const name = branchDisplayName(branch);
  if (branch.kind === 'remote') return `${name} · remote`;
  if (branch.current) return `${name} · current`;
  return name;
}

function defaultCompareTarget(branches: GitListBranchesResponse | null | undefined, sourceRef: string): string {
  const items = allGitBranches(branches);
  const names = items.map((branch) => String(branch.name ?? '').trim()).filter(Boolean);
  const exactMain = names.find((name) => name === 'main');
  if (exactMain) return exactMain;
  const remoteMain = names.find((name) => name.endsWith('/main'));
  if (remoteMain) return remoteMain;
  const current = (branches?.local ?? []).find((branch) => branch.current && String(branch.name ?? '').trim() !== sourceRef);
  if (current?.name) return current.name;
  const firstDifferent = names.find((name) => name !== sourceRef);
  if (firstDifferent) return firstDifferent;
  return names[0] ?? 'main';
}

function compactBranchContext(branch: GitBranchSummary | null | undefined): string {
  if (!branch) return '';
  if (branch.current) return 'Using the current workspace status.';
  if (branch.worktreePath) return 'Using the linked worktree status.';
  if (branch.kind === 'remote') return 'Status is unavailable until this branch is checked out locally.';
  return 'Status is unavailable until this branch is checked out.';
}

function branchStatusEmptyState(branch: GitBranchSummary | null | undefined): {
  title: string;
  detail: string;
  hint?: string;
  tone: 'neutral' | 'info' | 'violet' | 'success';
} {
  if (!branch) {
    return {
      title: 'No branch selected',
      detail: 'Choose a branch from the sidebar to inspect its status or history.',
      tone: 'neutral',
    };
  }
  if (branch.current) {
    return {
      title: 'Current workspace is clean',
      detail: 'There are no staged or pending changes in this workspace.',
      tone: 'success',
    };
  }
  if (branch.worktreePath) {
    return {
      title: 'Linked worktree is clean',
      detail: 'There are no staged or pending changes to review.',
      tone: 'success',
    };
  }
  if (branch.kind === 'remote') {
    return {
      title: 'Remote branch is not checked out',
      detail: 'Status is only available for checked-out local worktrees.',
      hint: 'Use Compare to inspect file diffs, or check out this branch locally to review workspace changes.',
      tone: 'violet',
    };
  }
  return {
    title: 'Branch is not checked out',
    detail: 'Status is only available for checked-out local worktrees.',
    hint: 'Use Compare to inspect file diffs, or open this branch in a worktree to review workspace changes.',
    tone: 'info',
  };
}

interface BranchCompareFilesTableProps {
  items: GitCommitFileSummary[];
  selectedKey?: string;
  onOpenDiff?: (item: GitCommitFileSummary) => void;
}

function BranchCompareFilesTable(props: BranchCompareFilesTableProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/65 bg-card">
      <Show
        when={props.items.length > 0}
        fallback={(
          <div class="px-4 py-8">
            <GitSubtleNote>No changed files were found in this comparison.</GitSubtleNote>
          </div>
        )}
      >
        <div class="min-h-0 flex-1 overflow-auto">
          <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[46rem] md:min-w-0`}>
            <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
              <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.items}>
                {(item) => {
                  const active = () => props.selectedKey === gitDiffEntryIdentity(item);
                  return (
                    <tr
                      aria-selected={active()}
                      class={gitChangedFilesRowClass(active())}
                    >
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <div class="min-w-0">
                          <button
                            type="button"
                            class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                            title={changeSecondaryPath(item)}
                            onClick={() => props.onOpenDiff?.(item)}
                          >
                            {compareFilePath(item)}
                          </button>
                          <Show when={changeSecondaryPath(item) !== compareFilePath(item)}>
                            <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                          </Show>
                        </div>
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <GitChangeStatusPill change={item.changeType} />
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                      <td class={gitChangedFilesStickyCellClass(active())}>
                        <GitChangedFilesActionButton onClick={() => props.onOpenDiff?.(item)}>View Diff</GitChangedFilesActionButton>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}

interface BranchStatusTableProps {
  items: GitWorkspaceChange[];
  selectedKey?: string;
  onOpenDiff?: (item: GitWorkspaceChange) => void;
}

function BranchStatusTable(props: BranchStatusTableProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/65 bg-card">
      <Show
        when={props.items.length > 0}
        fallback={(
          <div class="px-4 py-8">
            <GitSubtleNote>No files are available in this section.</GitSubtleNote>
          </div>
        )}
      >
        <div class="min-h-0 flex-1 overflow-auto">
          <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[52rem] md:min-w-0`}>
            <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
              <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Section</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.items}>
                {(item) => {
                  const active = () => props.selectedKey === gitDiffEntryIdentity(item);
                  return (
                    <tr
                      aria-selected={active()}
                      class={gitChangedFilesRowClass(active())}
                    >
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <div class="min-w-0">
                          <button
                            type="button"
                            class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                            title={changeSecondaryPath(item)}
                            onClick={() => props.onOpenDiff?.(item)}
                          >
                            {worktreeFilePath(item)}
                          </button>
                          <Show when={changeSecondaryPath(item) !== worktreeFilePath(item)}>
                            <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                          </Show>
                        </div>
                      </td>
                      <td class={`${GIT_CHANGED_FILES_CELL_CLASS} text-muted-foreground`}>{workspaceSectionLabel((item.section as GitWorkspaceSection | undefined) ?? 'unstaged')}</td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                        <GitChangeStatusPill change={item.changeType} />
                      </td>
                      <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                      <td class={gitChangedFilesStickyCellClass(active())}>
                        <GitChangedFilesActionButton onClick={() => props.onOpenDiff?.(item)}>View Diff</GitChangedFilesActionButton>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}

type BranchHistoryCommitDetailState = {
  files: GitCommitFileSummary[];
  loading: boolean;
  error: string;
  loaded: boolean;
};

function summarizeCommitFileChanges(files: GitCommitFileSummary[]): { additions: number; deletions: number } {
  return files.reduce<{ additions: number; deletions: number }>((acc, file) => ({
    additions: acc.additions + Number(file.additions ?? 0),
    deletions: acc.deletions + Number(file.deletions ?? 0),
  }), { additions: 0, deletions: 0 });
}

function HistoryList(props: Pick<
  GitBranchesPanelProps,
  'repoRootPath' | 'selectedBranch' | 'commits' | 'listLoading' | 'listLoadingMore' | 'listError' | 'hasMore' | 'selectedCommitHash' | 'onSelectCommit' | 'onLoadMore'
>) {
  const rpc = useRedevenRpc();

  const [commitDetails, setCommitDetails] = createSignal<Record<string, BranchHistoryCommitDetailState>>({});
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitCommitFileSummary | null>(null);

  const expandedCommitHash = createMemo(() => String(props.selectedCommitHash ?? '').trim());
  const repoRootPath = createMemo(() => String(props.repoRootPath ?? '').trim());
  const selectedDiffKey = () => gitDiffEntryIdentity(diffDialogItem());

  const toggleCommit = (hash: string) => {
    props.onSelectCommit?.(expandedCommitHash() === hash ? '' : hash);
  };

  createEffect(() => {
    repoRootPath();
    props.selectedBranch?.fullName;
    setCommitDetails({});
    setDiffDialogItem(null);
    setDiffDialogOpen(false);
  });

  createEffect(() => {
    const repo = repoRootPath();
    const hash = expandedCommitHash();
    if (!repo || !hash) return;
    const existing = commitDetails()[hash];
    if (existing?.loading || existing?.loaded) return;

    setCommitDetails((prev) => ({
      ...prev,
      [hash]: { files: [], loading: true, error: '', loaded: false },
    }));

    void rpc.git.getCommitDetail({ repoRootPath: repo, commit: hash }).then((resp) => {
      const files = Array.isArray(resp?.files) ? resp.files : [];
      setCommitDetails((prev) => ({
        ...prev,
        [hash]: { files, loading: false, error: '', loaded: true },
      }));
    }).catch((err) => {
      setCommitDetails((prev) => ({
        ...prev,
        [hash]: {
          files: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err ?? 'Failed to load commit detail'),
          loaded: true,
        },
      }));
    });
  });

  return (
    <>
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <Show
              when={!props.listLoading}
              fallback={(
                <div class="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
                  <SnakeLoader size="sm" />
                  <span>Loading commit history...</span>
                </div>
              )}
            >
              <Show when={!props.listError} fallback={<div class="px-1 py-3 text-xs break-words text-error">{props.listError}</div>}>
                <div class="flex min-h-0 flex-1 overflow-hidden">
                  <Show
                    when={(props.commits?.length ?? 0) > 0}
                    fallback={<GitSubtleNote>No commit history is available for this branch.</GitSubtleNote>}
                  >
                    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/65 bg-card">
                      <div class="min-h-0 flex-1 overflow-auto">
                        <table class="w-full min-w-[42rem] text-xs md:min-w-0">
                          <thead class="sticky top-0 z-10 bg-muted/30 backdrop-blur">
                            <tr class="border-b border-border/60 text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                              <th class="px-3 py-2.5 font-medium">Commit</th>
                              <th class="px-3 py-2.5 font-medium">Author</th>
                              <th class="px-3 py-2.5 font-medium">When</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={props.commits ?? []}>
                              {(commit) => {
                                const expanded = () => expandedCommitHash() === commit.hash;
                                const detail = () => commitDetails()[commit.hash];
                                const files = () => detail()?.files ?? [];
                                const fileTotals = createMemo(() => summarizeCommitFileChanges(files()));
                                return (
                                  <>
                                    <tr
                                      class={cn(
                                        'cursor-pointer border-b border-border/45',
                                        expanded() ? 'bg-muted/30' : 'hover:bg-muted/25'
                                      )}
                                      onClick={() => toggleCommit(commit.hash)}
                                    >
                                      <td class="px-3 py-2.5 align-top">
                                        <div class="flex min-w-0 items-start gap-2">
                                          <button
                                            type="button"
                                            aria-label={expanded() ? 'Collapse commit' : 'Expand commit'}
                                            aria-expanded={expanded()}
                                            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/40 bg-background/80 text-muted-foreground transition-colors duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              toggleCommit(commit.hash);
                                            }}
                                          >
                                            <ChevronRight class={cn('h-3 w-3 transition-transform duration-150', expanded() && 'rotate-90')} />
                                          </button>
                                          <div class="min-w-0">
                                            <div class="truncate text-xs font-medium text-foreground">{commit.subject || '(no subject)'}</div>
                                            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                              <GitMetaPill tone="neutral">{commit.shortHash}</GitMetaPill>
                                              <Show when={(commit.parents?.length ?? 0) > 1}>
                                                <GitMetaPill tone="violet">Merge x{commit.parents?.length}</GitMetaPill>
                                              </Show>
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                      <td class="px-3 py-2.5 align-top text-muted-foreground">{commit.authorName || 'Unknown author'}</td>
                                      <td class="px-3 py-2.5 align-top text-muted-foreground">{formatAbsoluteTime(commit.authorTimeMs)}</td>
                                    </tr>

                                    <Show when={expanded()}>
                                      <tr class="border-b border-border/45 bg-background/70 last:border-b-0">
                                        <td colSpan={3} class="px-3 pb-3 pt-0">
                                          <div class="ml-7 mt-2 space-y-2 rounded-md border border-border/45 bg-background/88 p-2.5">
                                            <Show
                                              when={!detail()?.loading}
                                              fallback={(
                                                <div class="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                                                  <SnakeLoader size="sm" />
                                                  <span>Loading changed files...</span>
                                                </div>
                                              )}
                                            >
                                              <Show when={!detail()?.error} fallback={<div class="px-1 py-2 text-xs text-error">{detail()?.error}</div>}>
                                                <Show
                                                  when={files().length > 0}
                                                  fallback={<GitSubtleNote>No changed files are available for this commit.</GitSubtleNote>}
                                                >
                                                  <div class="space-y-2">
                                                    <div class="flex flex-wrap items-center justify-between gap-2">
                                                      <div class="flex flex-wrap items-center gap-2">
                                                        <div class="text-xs font-medium text-foreground">Files in Commit</div>
                                                        <GitMetaPill tone="neutral">{files().length} file{files().length === 1 ? '' : 's'}</GitMetaPill>
                                                        <div class="text-[11px] text-muted-foreground">
                                                          <GitChangeMetrics additions={fileTotals().additions} deletions={fileTotals().deletions} />
                                                        </div>
                                                      </div>
                                                      <div class="text-[11px] text-muted-foreground">Select a file to inspect the diff.</div>
                                                    </div>

                                                    <BranchCompareFilesTable
                                                      items={files()}
                                                      selectedKey={selectedDiffKey()}
                                                      onOpenDiff={(item) => {
                                                        setDiffDialogItem(item);
                                                        setDiffDialogOpen(true);
                                                      }}
                                                    />
                                                  </div>
                                                </Show>
                                              </Show>
                                            </Show>
                                          </div>
                                        </td>
                                      </tr>
                                    </Show>
                                  </>
                                );
                              }}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </Show>
                </div>

                <Show when={props.hasMore}>
                  <div class="pt-1">
                    <Button size="sm" variant="ghost" class={cn('w-full', gitToneActionButtonClass())} onClick={props.onLoadMore} loading={props.listLoadingMore} disabled={props.listLoadingMore}>
                      Load More
                    </Button>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        title="Commit Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected file diff.'}
        emptyMessage="Select a changed file to inspect its diff."
      />
    </>
  );
}

interface BranchCompareDialogProps {
  open: boolean;
  repoRootPath?: string;
  branches?: GitListBranchesResponse | null;
  selectedBranch?: GitBranchSummary | null;
  onClose: () => void;
}

function BranchCompareDialog(props: BranchCompareDialogProps) {
  const layout = useLayout();
  const rpc = useRedevenRpc();

  const [sourceRef, setSourceRef] = createSignal('');
  const [targetRef, setTargetRef] = createSignal('');
  const [compare, setCompare] = createSignal<GitGetBranchCompareResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitCommitFileSummary | null>(null);

  let compareReqSeq = 0;

  const branchOptions = createMemo(() => {
    const seen = new Set<string>();
    const result: GitBranchSummary[] = [];
    for (const branch of allGitBranches(props.branches)) {
      const key = branchIdentity(branch);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(branch);
    }
    return result;
  });

  createEffect(() => {
    const source = String(props.selectedBranch?.name ?? '').trim();
    setSourceRef(source);
    setTargetRef(defaultCompareTarget(props.branches, source));
  });

  createEffect(() => {
    if (!props.open) {
      compareReqSeq += 1;
      setLoading(false);
      setError('');
      setCompare(null);
      return;
    }

    const repoRootPath = String(props.repoRootPath ?? '').trim();
    const nextSource = String(sourceRef()).trim();
    const nextTarget = String(targetRef()).trim();
    if (!repoRootPath || !nextSource || !nextTarget) {
      setCompare(null);
      setError('');
      setLoading(false);
      return;
    }

    const seq = ++compareReqSeq;
    setLoading(true);
    setError('');
    void rpc.git.getBranchCompare({
      repoRootPath,
      baseRef: nextTarget,
      targetRef: nextSource,
      limit: 30,
    }).then((resp) => {
      if (seq !== compareReqSeq) return;
      setCompare(resp);
    }).catch((err) => {
      if (seq !== compareReqSeq) return;
      setCompare(null);
      setError(err instanceof Error ? err.message : String(err ?? 'Failed to load branch compare'));
    }).finally(() => {
      if (seq === compareReqSeq) setLoading(false);
    });
  });

  const compareFiles = () => compare()?.files ?? [];
  const selectedKey = () => gitDiffEntryIdentity(diffDialogItem());

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title="Compare branches"
        description="Pick the source and target branches, then review the changed files."
        class={cn(
          'flex max-w-none flex-col overflow-hidden rounded-md p-0',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          '[&>div:first-child>button]:bg-transparent [&>div:first-child>button]:text-muted-foreground',
          '[&>div:first-child>button:hover]:bg-muted/80 [&>div:first-child>button:hover]:text-foreground',
          '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
          layout.isMobile() ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none' : 'max-h-[88vh] w-[min(1100px,94vw)]',
        )}
      >
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex shrink-0 flex-col gap-2 px-4 pb-1">
            <div class="grid gap-3 md:grid-cols-2">
              <label class="space-y-1">
                <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">Source</div>
                <select
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/70"
                  value={sourceRef()}
                  onInput={(event) => setSourceRef(event.currentTarget.value)}
                >
                  <For each={branchOptions()}>
                    {(branch) => (
                      <option value={String(branch.name ?? '').trim()}>{compareOptionLabel(branch)}</option>
                    )}
                  </For>
                </select>
              </label>

              <label class="space-y-1">
                <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">Target</div>
                <select
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/70"
                  value={targetRef()}
                  onInput={(event) => setTargetRef(event.currentTarget.value)}
                >
                  <For each={branchOptions()}>
                    {(branch) => (
                      <option value={String(branch.name ?? '').trim()}>{compareOptionLabel(branch)}</option>
                    )}
                  </For>
                </select>
              </label>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
            <Show
              when={!loading()}
              fallback={<div class="flex min-h-0 flex-1 items-center gap-2 text-xs text-muted-foreground"><SnakeLoader size="sm" /><span>Loading branch compare...</span></div>}
            >
              <Show when={!error()} fallback={<div class="flex min-h-0 flex-1 items-center text-xs text-error">{error()}</div>}>
                <Show when={compare()} fallback={<div class="flex min-h-0 flex-1 items-center text-xs text-muted-foreground">Choose two branches to inspect file changes.</div>}>
                  {(compareAccessor) => (
                    <div class="flex min-h-0 flex-1 flex-col gap-3">
                      <div class="flex min-h-0 flex-1 flex-col gap-2">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div class="flex flex-wrap items-center gap-2">
                            <div class="text-xs font-medium text-foreground">Changed Files</div>
                            <GitMetaPill tone="neutral">{compareAccessor().targetRef}</GitMetaPill>
                            <GitMetaPill tone="neutral">vs {compareAccessor().baseRef}</GitMetaPill>
                            <GitMetaPill tone="warning">{compareFiles().length} file{compareFiles().length === 1 ? '' : 's'}</GitMetaPill>
                          </div>
                          <div class="text-[11px] text-muted-foreground">Open any file to inspect the diff.</div>
                        </div>

                        <div class="flex min-h-0 flex-1 overflow-hidden">
                          <BranchCompareFilesTable
                            items={compareFiles()}
                            selectedKey={selectedKey()}
                            onOpenDiff={(item) => {
                              setDiffDialogItem(item);
                              setDiffDialogOpen(true);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </Dialog>

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        title="Branch Compare Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected compare diff.'}
        emptyMessage="Select a compared file to inspect its diff."
      />
    </>
  );
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const rpc = useRedevenRpc();

  const [statusWorkspace, setStatusWorkspace] = createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [statusLoading, setStatusLoading] = createSignal(false);
  const [statusError, setStatusError] = createSignal('');
  const [selectedStatusSection, setSelectedStatusSection] = createSignal<GitWorkspaceSection>('unstaged');
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitWorkspaceChange | null>(null);
  const [compareDialogOpen, setCompareDialogOpen] = createSignal(false);

  let statusReqSeq = 0;

  const branchSubview = () => props.selectedBranchSubview ?? 'status';
  const compareRepoRootPath = () => String(props.repoRootPath || props.repoSummary?.repoRootPath || '').trim();
  const currentWorkspaceStatus = () => Boolean(props.selectedBranch?.current);
  const visibleStatusWorkspace = () => (currentWorkspaceStatus() ? props.workspace ?? null : statusWorkspace());
  const visibleStatusLoading = () => (currentWorkspaceStatus() ? Boolean(props.workspaceLoading) : statusLoading());
  const visibleStatusError = () => (currentWorkspaceStatus() ? String(props.workspaceError ?? '') : statusError());
  const visibleStatusItems = () => workspaceSectionItems(visibleStatusWorkspace(), selectedStatusSection());
  const visibleStatusKey = () => gitDiffEntryIdentity(diffDialogItem());
  const visibleStatusCount = () => summarizeWorkspaceCount(visibleStatusWorkspace()?.summary);
  const statusEmptyState = () => branchStatusEmptyState(props.selectedBranch);
  const checkoutDisabled = () => Boolean(
    !props.selectedBranch
    || props.checkoutBusy
    || props.selectedBranch.current
    || (props.selectedBranch.kind === 'local' && props.selectedBranch.worktreePath)
  );
  const checkoutLabel = () => (props.checkoutBusy ? 'Checking Out...' : 'Checkout');

  createEffect(() => {
    const branch = props.selectedBranch;
    const subview = branchSubview();
    if (!branch) {
      statusReqSeq += 1;
      setStatusWorkspace(null);
      setStatusLoading(false);
      setStatusError('');
      return;
    }
    if (branch.current) {
      statusReqSeq += 1;
      setStatusWorkspace(null);
      setStatusLoading(false);
      setStatusError('');
      return;
    }
    if (subview !== 'status') return;
    const worktreePath = String(branch.worktreePath ?? '').trim();
    if (!worktreePath) {
      statusReqSeq += 1;
      setStatusWorkspace(null);
      setStatusLoading(false);
      setStatusError('');
      return;
    }

    const seq = ++statusReqSeq;
    setStatusLoading(true);
    setStatusError('');
    void rpc.git.listWorkspaceChanges({ repoRootPath: worktreePath }).then((resp) => {
      if (seq !== statusReqSeq) return;
      setStatusWorkspace(resp);
    }).catch((err) => {
      if (seq !== statusReqSeq) return;
      setStatusWorkspace(null);
      setStatusError(err instanceof Error ? err.message : String(err ?? 'Failed to load branch status'));
    }).finally(() => {
      if (seq === statusReqSeq) setStatusLoading(false);
    });
  });

  createEffect(() => {
    const nextWorkspace = visibleStatusWorkspace();
    setSelectedStatusSection(pickDefaultWorkspaceSection(nextWorkspace));
  });

  createEffect(() => {
    if (!diffDialogOpen()) return;
    if (diffDialogItem()) return;
    setDiffDialogOpen(false);
  });

  const renderStatus = () => {
    const branch = props.selectedBranch;
    if (!branch) {
      return <div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a branch from the sidebar to inspect its status or history.</div>;
    }

    return (
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <section class="rounded-md border border-border/65 bg-card px-3 py-2.5">
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5">
                <GitLabelBlock class="min-w-0" label="Status" tone="neutral" />

                <div class="flex min-w-fit items-start justify-end">
                  <Button size="sm" variant="outline" class="rounded-md bg-background/80" onClick={() => setCompareDialogOpen(true)}>
                    Compare
                  </Button>
                </div>
              </div>

              <div class="mt-2.5 pl-4">
                <Show
                  when={!visibleStatusLoading()}
                  fallback={(
                    <div class="flex items-center gap-2 rounded-md border border-border/45 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground">
                      <SnakeLoader size="sm" />
                      <span>Loading branch status...</span>
                    </div>
                  )}
                >
                  <Show when={!visibleStatusError()} fallback={<div class="rounded-md border border-error/20 bg-error/5 px-2.5 py-2 text-xs break-words text-error">{visibleStatusError()}</div>}>
                    <Show
                      when={visibleStatusWorkspace()}
                      fallback={(
                        <div class="rounded-md border border-border/45 bg-background/72 px-2.5 py-2.5">
                          <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="text-xs font-medium text-foreground">{statusEmptyState().title}</div>
                              <div class="mt-1 text-[11px] leading-relaxed text-muted-foreground">{statusEmptyState().detail}</div>
                            </div>
                            <GitMetaPill tone={statusEmptyState().tone}>Status unavailable</GitMetaPill>
                          </div>
                          <Show when={statusEmptyState().hint}>
                            <div class="mt-2 text-[11px] leading-relaxed text-muted-foreground">{statusEmptyState().hint}</div>
                          </Show>
                        </div>
                      )}
                    >
                      {(workspaceAccessor) => (
                        <div class="grid gap-1 rounded-md bg-background/40 p-1 text-[11px] grid-cols-2 xl:grid-cols-4">
                          <For each={(['unstaged', 'untracked', 'conflicted', 'staged'] as GitWorkspaceSection[])}>
                            {(section) => {
                              const active = () => selectedStatusSection() === section;
                              const count = () => workspaceSectionItems(workspaceAccessor(), section).length;
                              return (
                                <button
                                  type="button"
                                  class={cn(
                                    'w-full rounded-md border border-border/45 bg-background/88 px-2.5 py-1.5 text-left text-xs transition-[background-color,border-color,box-shadow,color] duration-150 hover:shadow-sm',
                                    gitToneSelectableCardClass(workspaceSectionTone(section), active())
                                  )}
                                  onClick={() => setSelectedStatusSection(section)}
                                >
                                  <div class="flex min-h-[3.6rem] flex-col justify-between gap-1">
                                    <div class="flex items-center justify-between gap-2">
                                      <div class={cn('min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.14em]', active() ? 'text-sidebar-accent-foreground/80' : 'text-muted-foreground/80')}>
                                        {workspaceSectionLabel(section)}
                                      </div>
                                      <div
                                        class={cn(
                                          'shrink-0 text-sm font-semibold tabular-nums',
                                          active() ? 'text-sidebar-accent-foreground' : 'text-foreground'
                                        )}
                                      >
                                        {count()}
                                      </div>
                                    </div>

                                    <div class={cn('text-[10px] leading-relaxed', active() ? 'text-sidebar-accent-foreground/70' : 'text-muted-foreground')}>
                                        {count() === 0 ? 'No files to review.' : `${count()} file${count() === 1 ? '' : 's'} ready.`}
                                    </div>
                                  </div>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </Show>
                  </Show>
                </Show>
              </div>
            </section>

            <Show when={visibleStatusWorkspace()}>
              <div class="flex min-h-0 flex-1 overflow-hidden">
                <BranchStatusTable
                  items={visibleStatusItems()}
                  selectedKey={visibleStatusKey()}
                  onOpenDiff={(item) => {
                    setDiffDialogItem(item);
                    setDiffDialogOpen(true);
                  }}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={!props.branchesLoading} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Loading branches...</div>}>
        <Show when={!props.branchesError} fallback={<div class="flex-1 px-3 py-4 text-xs break-words text-error">{props.branchesError}</div>}>
          <Show when={props.selectedBranch} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a branch from the sidebar to inspect its status or history.</div>}>
            <div class="flex h-full min-h-0 flex-col overflow-hidden">
              <div class="shrink-0 px-3 py-3 sm:px-4 sm:py-4">
                <div class="rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <GitLabelBlock
                      class="min-w-0 flex-1"
                      label="Branch"
                      tone={gitBranchTone(props.selectedBranch)}
                      meta={
                        <div class="flex min-h-5 items-center gap-1.5">
                          <Show when={props.selectedBranch?.current}>
                            <GitMetaPill tone="success">Current</GitMetaPill>
                          </Show>
                          <Show when={props.selectedBranch?.kind === 'remote'}>
                            <GitMetaPill tone="violet">Remote</GitMetaPill>
                          </Show>
                        </div>
                      }
                    >
                      <GitPrimaryTitle>{branchDisplayName(props.selectedBranch)}</GitPrimaryTitle>
                      <div class="min-h-[2rem] text-[11px] leading-relaxed line-clamp-2 text-muted-foreground" title={branchStatusSummary(props.selectedBranch)}>
                        {branchContextSummary(props.selectedBranch)}
                      </div>
                    </GitLabelBlock>

                    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <Show when={props.onCheckoutBranch}>
                        <Button
                          size="sm"
                          variant="outline"
                          class="rounded-md bg-background/80"
                          disabled={checkoutDisabled()}
                          onClick={() => props.selectedBranch && props.onCheckoutBranch?.(props.selectedBranch)}
                        >
                          {checkoutLabel()}
                        </Button>
                      </Show>

                      <div class="inline-flex rounded-md border border-border/65 bg-muted/[0.14] p-0.5" role="tablist" aria-label="Branch detail tabs">
                        <For each={(['status', 'history'] as GitBranchSubview[])}>
                          {(view) => {
                            const active = () => branchSubview() === view;
                            return (
                              <button
                                type="button"
                                role="tab"
                                aria-selected={active()}
                                class={cn(
                                  'rounded px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                                  active() ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
                                )}
                                onClick={() => props.onSelectBranchSubview?.(view)}
                              >
                                {branchSubviewLabel(view)}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <Show when={branchSubview() === 'history'} fallback={renderStatus()}>
                <HistoryList
                  repoRootPath={compareRepoRootPath()}
                  selectedBranch={props.selectedBranch}
                  commits={props.commits}
                  listLoading={props.listLoading}
                  listLoadingMore={props.listLoadingMore}
                  listError={props.listError}
                  hasMore={props.hasMore}
                  selectedCommitHash={props.selectedCommitHash}
                  onSelectCommit={props.onSelectCommit}
                  onLoadMore={props.onLoadMore}
                />
              </Show>
            </div>
          </Show>
        </Show>
      </Show>

      <BranchCompareDialog
        open={compareDialogOpen()}
        repoRootPath={compareRepoRootPath()}
        branches={props.branches}
        selectedBranch={props.selectedBranch}
        onClose={() => setCompareDialogOpen(false)}
      />

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        title="Branch Status Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected branch status diff.'}
        emptyMessage="Select a branch status file to inspect its diff."
      />
    </div>
  );
}
