import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { ChevronRight, Folder, Sparkles, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { useRedevenRpc, type GitBranchSummary, type GitCommitFileSummary, type GitCommitSummary, type GitGetBranchCompareResponse, type GitListBranchesResponse, type GitListWorkspaceChangesResponse, type GitPreviewDeleteBranchResponse, type GitPreviewMergeBranchResponse, type GitRepoSummaryResponse, type GitWorkspaceChange, type GitWorkspaceSection } from '../protocol/redeven_v1';
import {
  WORKSPACE_VIEW_SECTIONS,
  allGitBranches,
  branchContextSummary,
  branchDisplayName,
  branchIdentity,
  branchStatusSummary,
  branchSubviewLabel,
  changeSecondaryPath,
  gitDiffEntryIdentity,
  pickDefaultWorkspaceViewSection,
  repoDisplayName,
  workspaceEntryKey,
  workspaceSectionLabel,
  workspaceViewSectionCount,
  workspaceViewSectionItems,
  workspaceViewSectionLabel,
  resolveGitBranchWorktreePath,
  type GitBranchSubview,
  type GitWorkspaceViewSection,
} from '../utils/gitWorkbench';
import { resolveRovingTabTargetId } from '../utils/tabNavigation';
import type { GitAskFlowerRequest, GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';
import { gitBranchTone, gitChangePathClass, gitToneActionButtonClass, gitToneSelectableCardClass, workspaceSectionTone } from './GitChrome';
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
  GitStatePane,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import { GitDeleteBranchConfirmDialog } from './GitDeleteBranchConfirmDialog';
import { GitDeleteBranchDialog, type GitDeleteBranchDialogConfirmOptions, type GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import { GitMergeBranchDialog, type GitMergeBranchDialogConfirmOptions, type GitMergeBranchDialogState } from './GitMergeBranchDialog';

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  repoSummary?: GitRepoSummaryResponse | null;
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
  mergeBusy?: boolean;
  deleteBusy?: boolean;
  mergeReviewOpen?: boolean;
  mergeReviewBranch?: GitBranchSummary | null;
  mergePreview?: GitPreviewMergeBranchResponse | null;
  mergePreviewError?: string;
  mergeActionError?: string;
  mergeDialogState?: GitMergeBranchDialogState;
  deleteReviewOpen?: boolean;
  deleteReviewBranch?: GitBranchSummary | null;
  deletePreview?: GitPreviewDeleteBranchResponse | null;
  deletePreviewError?: string;
  deleteActionError?: string;
  deleteDialogState?: GitDeleteBranchDialogState;
  onCheckoutBranch?: (branch: GitBranchSummary) => void;
  onMergeBranch?: (branch: GitBranchSummary) => void;
  onDeleteBranch?: (branch: GitBranchSummary) => void;
  onCloseMergeReview?: () => void;
  onRetryMergePreview?: (branch: GitBranchSummary) => void;
  onConfirmMergeBranch?: (branch: GitBranchSummary, options: GitMergeBranchDialogConfirmOptions) => void;
  onCloseDeleteReview?: () => void;
  onRetryDeletePreview?: (branch: GitBranchSummary) => void;
  onConfirmDeleteBranch?: (branch: GitBranchSummary, options: GitDeleteBranchDialogConfirmOptions) => void;
  onAskFlower?: (request: Extract<GitAskFlowerRequest, { kind: 'branch_status' | 'commit' }>) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
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

const GIT_BRANCH_SUBVIEW_IDS = ['status', 'history'] as const satisfies readonly GitBranchSubview[];

function gitBranchSubviewTabId(view: GitBranchSubview): string {
  return `git-branch-subview-tab-${view}`;
}

function gitBranchSubviewPanelId(view: GitBranchSubview): string {
  return `git-branch-subview-panel-${view}`;
}

function branchStatusEmptyState(branch: GitBranchSummary | null | undefined, statusRepoRootPath: string): {
  title: string;
  detail: string;
  hint?: string;
  tone: 'neutral' | 'info' | 'violet';
} {
  if (!branch) {
    return {
      title: 'No branch selected',
      detail: 'Choose a branch from the sidebar to inspect its status or history.',
      tone: 'neutral',
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
  if (statusRepoRootPath) {
    return {
      title: 'Branch status is unavailable',
      detail: 'The checked-out workspace for this branch could not be resolved right now.',
      hint: 'Refresh the repository view or reopen the worktree to load the latest workspace status.',
      tone: 'info',
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
                  const active = () => props.selectedKey === workspaceEntryKey(item);
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
  'repoRootPath' | 'selectedBranch' | 'commits' | 'listLoading' | 'listLoadingMore' | 'listError' | 'hasMore' | 'selectedCommitHash' | 'onSelectCommit' | 'onLoadMore' | 'onAskFlower'
>) {
  const rpc = useRedevenRpc();

  const [commitDetails, setCommitDetails] = createSignal<Record<string, BranchHistoryCommitDetailState>>({});
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitCommitFileSummary | null>(null);
  const [diffDialogCommitHash, setDiffDialogCommitHash] = createSignal('');

  const expandedCommitHash = createMemo(() => String(props.selectedCommitHash ?? '').trim());
  const repoRootPath = createMemo(() => String(props.repoRootPath ?? '').trim());
  const selectedDiffKey = () => gitDiffEntryIdentity(diffDialogItem());

  const toggleCommit = (hash: string) => {
    props.onSelectCommit?.(expandedCommitHash() === hash ? '' : hash);
  };

  createEffect(() => {
    void repoRootPath();
    void props.selectedBranch?.fullName;
    setCommitDetails({});
    setDiffDialogItem(null);
    setDiffDialogCommitHash('');
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
              fallback={<GitStatePane loading message="Loading commit history..." class="px-1" />}
            >
              <Show when={!props.listError} fallback={<GitStatePane tone="error" message={props.listError} class="px-1" />}>
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
                                              fallback={<GitStatePane loading message="Loading changed files..." surface class="min-h-[5rem] px-1 py-2" />}
                                            >
                                              <Show when={!detail()?.error} fallback={<GitStatePane tone="error" message={detail()?.error} surface class="min-h-[5rem] px-1 py-2" />}>
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
                                                      <div class="flex items-center gap-2">
                                                        <Show when={props.onAskFlower}>
                                                          <Button
                                                            size="sm"
                                                            variant="outline"
                                                            icon={Sparkles}
                                                            class="rounded-md bg-background/80"
                                                            onClick={() => props.onAskFlower?.({
                                                              kind: 'commit',
                                                              repoRootPath: repoRootPath(),
                                                              location: 'branch_history',
                                                              branchName: props.selectedBranch ? branchDisplayName(props.selectedBranch) : undefined,
                                                              commit,
                                                              files: files(),
                                                            })}
                                                          >
                                                            Ask Flower
                                                          </Button>
                                                        </Show>
                                                        <div class="text-[11px] text-muted-foreground">Select a file to inspect the diff.</div>
                                                      </div>
                                                    </div>

                                                    <BranchCompareFilesTable
                                                      items={files()}
                                                      selectedKey={selectedDiffKey()}
                                                      onOpenDiff={(item) => {
                                                        setDiffDialogItem(item);
                                                        setDiffDialogCommitHash(commit.hash);
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
          if (!open) {
            setDiffDialogItem(null);
            setDiffDialogCommitHash('');
          }
        }}
        item={diffDialogItem()}
        source={diffDialogItem() ? {
          kind: 'commit',
          repoRootPath: repoRootPath(),
          commit: diffDialogCommitHash(),
        } : null}
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
              fallback={<GitStatePane loading message="Loading branch compare..." />}
            >
              <Show when={!error()} fallback={<GitStatePane tone="error" message={error()} />}>
                <Show when={compare()} fallback={<GitStatePane message="Choose two branches to inspect file changes." />}>
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
        source={diffDialogItem() && compare() ? {
          kind: 'compare',
          repoRootPath: String(compare()?.repoRootPath ?? props.repoRootPath ?? '').trim(),
          baseRef: String(compare()?.baseRef ?? targetRef()).trim(),
          targetRef: String(compare()?.targetRef ?? sourceRef()).trim(),
        } : null}
        title="Branch Compare Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected compare diff.'}
        emptyMessage="Select a compared file to inspect its diff."
      />
    </>
  );
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const rpc = useRedevenRpc();
  const branchSubviewTabRefs = new Map<GitBranchSubview, HTMLButtonElement>();

  const [statusWorkspace, setStatusWorkspace] = createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [statusLoading, setStatusLoading] = createSignal(false);
  const [statusError, setStatusError] = createSignal('');
  const [selectedStatusSection, setSelectedStatusSection] = createSignal<GitWorkspaceViewSection>('changes');
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitWorkspaceChange | null>(null);
  const [compareDialogOpen, setCompareDialogOpen] = createSignal(false);

  let statusReqSeq = 0;

  const branchSubview = () => props.selectedBranchSubview ?? 'status';
  const activeRepoRootPath = () => String(props.repoRootPath || props.repoSummary?.repoRootPath || '').trim();
  const statusRepoRootPath = () => resolveGitBranchWorktreePath(props.selectedBranch, activeRepoRootPath());
  const branchDirectoryRequest = (): GitDirectoryShortcutRequest | null => {
    const path = statusRepoRootPath();
    if (!path) return null;
    return {
      path,
      preferredName: repoDisplayName(path),
    };
  };
  const visibleStatusWorkspace = () => statusWorkspace();
  const visibleStatusLoading = () => statusLoading();
  const visibleStatusError = () => statusError();
  const visibleStatusItems = () => workspaceViewSectionItems(visibleStatusWorkspace(), selectedStatusSection());
  const visibleStatusKey = () => workspaceEntryKey(diffDialogItem());
  const statusEmptyState = () => branchStatusEmptyState(props.selectedBranch, statusRepoRootPath());
  const mergeReviewBranch = () => props.mergeReviewBranch ?? props.selectedBranch ?? null;
  const mergePreview = () => props.mergePreview ?? null;
  const mergeReviewState = () => props.mergeDialogState ?? 'idle';
  const deleteReviewBranch = () => props.deleteReviewBranch ?? props.selectedBranch ?? null;
  const deletePreview = () => props.deletePreview ?? null;
  const deleteReviewState = () => props.deleteDialogState ?? 'idle';
  const mergeAvailable = () => Boolean(props.onMergeBranch && (props.selectedBranch?.kind === 'local' || props.selectedBranch?.kind === 'remote'));
  const mergeDisabled = () => Boolean(
    !mergeAvailable()
    || props.mergeBusy
    || props.selectedBranch?.current
  );
  const mergeLabel = () => (props.mergeBusy ? 'Merging...' : 'Merge');
  const linkedWorktreeDeleteDialog = () => {
    const branch = deleteReviewBranch();
    if (!props.deleteReviewOpen || !branch) return false;
    if (deletePreview()?.requiresWorktreeRemoval) return true;
    return String(branch.worktreePath ?? '').trim() !== '';
  };
  const plainDeleteDialog = () => Boolean(props.deleteReviewOpen && deleteReviewBranch() && !linkedWorktreeDeleteDialog());
  const checkoutDisabled = () => Boolean(
    !props.selectedBranch
    || props.checkoutBusy
    || props.selectedBranch.current
    || (props.selectedBranch.kind === 'local' && props.selectedBranch.worktreePath)
  );
  const checkoutLabel = () => (props.checkoutBusy ? 'Checking Out...' : 'Checkout');
  const deleteAvailable = () => Boolean(props.onDeleteBranch && props.selectedBranch?.kind === 'local');
  const deleteDisabled = () => Boolean(
    !deleteAvailable()
    || props.deleteBusy
    || props.selectedBranch?.current
  );
  const deleteLabel = () => (props.deleteBusy ? 'Deleting...' : 'Delete');
  const canAskFlowerStatus = () => Boolean(props.onAskFlower && props.selectedBranch && statusRepoRootPath() && visibleStatusItems().length > 0);
  const canOpenInTerminal = () => Boolean(props.onOpenInTerminal && branchDirectoryRequest());
  const canBrowseFiles = () => Boolean(props.onBrowseFiles && branchDirectoryRequest());
  const showWorkspaceHelpers = () => Boolean(props.onOpenInTerminal || props.onBrowseFiles);
  const workspaceHelperGridClass = () => (
    (Number(Boolean(props.onOpenInTerminal)) + Number(Boolean(props.onBrowseFiles))) > 1
      ? 'grid-cols-2'
      : 'grid-cols-1'
  );
  const branchActionCount = () => Number(Boolean(props.onCheckoutBranch))
    + Number(mergeAvailable())
    + Number(deleteAvailable());
  const branchActionGridClass = () => (
    branchActionCount() >= 3
      ? 'grid-cols-3'
      : branchActionCount() === 2
        ? 'grid-cols-2'
        : 'grid-cols-1'
  );
  const headerActionDeckClass = 'space-y-1.5 rounded-lg border border-border/60 bg-muted/[0.14] p-1.5 shadow-sm shadow-black/5';
  const headerActionDeckLabelClass = 'px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60';
  const headerActionButtonClass = 'w-full rounded-md bg-background/88 shadow-sm shadow-black/5';
  const handleBranchSubviewKeyDown = (event: KeyboardEvent, currentView: GitBranchSubview) => {
    const nextView = resolveRovingTabTargetId(GIT_BRANCH_SUBVIEW_IDS, currentView, event.key, 'horizontal');
    if (!nextView || nextView === currentView) return;
    event.preventDefault();
    props.onSelectBranchSubview?.(nextView);
    queueMicrotask(() => branchSubviewTabRefs.get(nextView)?.focus());
  };

  createEffect(() => {
    const branch = props.selectedBranch;
    const subview = branchSubview();
    const repoRootPath = statusRepoRootPath();
    if (!branch) {
      statusReqSeq += 1;
      setStatusWorkspace(null);
      setStatusLoading(false);
      setStatusError('');
      return;
    }
    if (subview !== 'status') return;
    if (!repoRootPath) {
      statusReqSeq += 1;
      setStatusWorkspace(null);
      setStatusLoading(false);
      setStatusError('');
      return;
    }

    const seq = ++statusReqSeq;
    setStatusLoading(true);
    setStatusError('');
    void rpc.git.listWorkspaceChanges({ repoRootPath }).then((resp) => {
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
    setSelectedStatusSection(pickDefaultWorkspaceViewSection(nextWorkspace));
  });

  createEffect(() => {
    if (!diffDialogOpen()) return;
    if (diffDialogItem()) return;
    setDiffDialogOpen(false);
  });

  const renderStatus = () => {
    const branch = props.selectedBranch;
    if (!branch) {
      return (
        <div
          class="flex-1 px-3 py-4 text-xs text-muted-foreground"
          role="tabpanel"
          id={gitBranchSubviewPanelId('status')}
          aria-labelledby={gitBranchSubviewTabId('status')}
          tabIndex={0}
        >
          Choose a branch from the sidebar to inspect its status or history.
        </div>
      );
    }

    return (
      <div
        class="flex h-full min-h-0 flex-col overflow-hidden"
        role="tabpanel"
        id={gitBranchSubviewPanelId('status')}
        aria-labelledby={gitBranchSubviewTabId('status')}
        tabIndex={0}
      >
        <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <section class="rounded-md border border-border/65 bg-card px-3 py-2.5">
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5">
                <GitLabelBlock class="min-w-0" label="Status" tone="neutral" />

                <div class="flex min-w-fit items-start justify-end gap-2">
                  <Show when={props.onAskFlower}>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={Sparkles}
                      class="rounded-md bg-background/80"
                      disabled={!canAskFlowerStatus()}
                      onClick={() => {
                        if (!props.selectedBranch || !canAskFlowerStatus()) return;
                        props.onAskFlower?.({
                          kind: 'branch_status',
                          repoRootPath: activeRepoRootPath(),
                          worktreePath: statusRepoRootPath(),
                          branch: props.selectedBranch,
                          section: selectedStatusSection(),
                          items: visibleStatusItems(),
                        });
                      }}
                    >
                      Ask Flower
                    </Button>
                  </Show>
                  <Button size="sm" variant="outline" class="rounded-md bg-background/80" onClick={() => setCompareDialogOpen(true)}>
                    Compare
                  </Button>
                </div>
              </div>

              <div class="mt-1.5 pl-3">
                <Show
                  when={!visibleStatusLoading()}
                  fallback={<GitStatePane loading message="Loading branch status..." surface class="py-2" />}
                >
                  <Show when={!visibleStatusError()} fallback={<GitStatePane tone="error" message={visibleStatusError()} surface class="py-2" />}>
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
                        <div class="grid grid-cols-1 gap-0.5 rounded-md bg-background/40 p-0.5 text-[11px] sm:grid-cols-3">
                          <For each={WORKSPACE_VIEW_SECTIONS}>
                            {(section) => {
                              const active = () => selectedStatusSection() === section;
                              const count = () => workspaceViewSectionCount(workspaceAccessor().summary, section);
                              return (
                                <button
                                  type="button"
                                  class={cn(
                                    'w-full rounded-md border border-border/45 bg-background/88 px-2 py-1 text-left text-xs transition-[background-color,border-color,box-shadow,color] duration-150 hover:shadow-sm',
                                    gitToneSelectableCardClass(workspaceSectionTone(section), active())
                                  )}
                                  onClick={() => setSelectedStatusSection(section)}
                                >
                                  <div class="flex min-h-[1.85rem] flex-col justify-center gap-0.5">
                                    <div class="flex items-center justify-between gap-1.5">
                                      <div class={cn('min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.14em]', active() ? 'text-current opacity-80' : 'text-muted-foreground/80')}>
                                        {workspaceViewSectionLabel(section)}
                                      </div>
                                      <div
                                        class={cn(
                                          'shrink-0 text-[12px] font-semibold tabular-nums leading-none',
                                          active() ? 'text-current' : 'text-foreground'
                                        )}
                                      >
                                        {count()}
                                      </div>
                                    </div>

                                    <div class={cn('truncate text-[10px] leading-tight', active() ? 'text-current opacity-70' : 'text-muted-foreground')}>
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
      <Show when={!props.branchesLoading} fallback={<GitStatePane loading message="Loading branches..." class="px-3 py-4" />}>
        <Show when={!props.branchesError} fallback={<GitStatePane tone="error" message={props.branchesError} class="px-3 py-4" />}>
          <Show when={props.selectedBranch} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a branch from the sidebar to inspect its status or history.</div>}>
            <div class="flex h-full min-h-0 flex-col overflow-hidden">
              <div class="shrink-0 px-3 py-3 sm:px-4 sm:py-4">
                <div class="rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                  <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
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

                    <div class="flex w-full min-w-0 flex-col gap-2 lg:flex-[0_1_20rem] lg:max-w-[min(50%,22rem)] lg:items-stretch">
                      <Show when={showWorkspaceHelpers()}>
                        <div class={headerActionDeckClass}>
                          <div class={headerActionDeckLabelClass}>Workspace</div>
                          <div class={cn('grid gap-1.5', workspaceHelperGridClass())}>
                            <Show when={props.onOpenInTerminal}>
                              <Button
                                size="sm"
                                variant="outline"
                                icon={Terminal}
                                class={headerActionButtonClass}
                                disabled={!canOpenInTerminal()}
                                onClick={() => {
                                  const request = branchDirectoryRequest();
                                  if (!request) return;
                                  props.onOpenInTerminal?.(request);
                                }}
                              >
                                Terminal
                              </Button>
                            </Show>

                            <Show when={props.onBrowseFiles}>
                              <Button
                                size="sm"
                                variant="outline"
                                icon={Folder}
                                class={headerActionButtonClass}
                                disabled={!canBrowseFiles()}
                                onClick={() => {
                                  const request = branchDirectoryRequest();
                                  if (!request) return;
                                  void props.onBrowseFiles?.(request);
                                }}
                              >
                                Files
                              </Button>
                            </Show>
                          </div>
                        </div>
                      </Show>

                      <div class={headerActionDeckClass}>
                        <div class={headerActionDeckLabelClass}>Actions</div>
                        <div class={cn('grid gap-1.5', branchActionGridClass())}>
                          <Show when={props.onCheckoutBranch}>
                            <Button
                              size="sm"
                              variant="outline"
                              class={headerActionButtonClass}
                              disabled={checkoutDisabled()}
                              onClick={() => props.selectedBranch && props.onCheckoutBranch?.(props.selectedBranch)}
                            >
                              {checkoutLabel()}
                            </Button>
                          </Show>

                          <Show when={mergeAvailable()}>
                            <Button
                              size="sm"
                              variant="outline"
                              class={headerActionButtonClass}
                              disabled={mergeDisabled()}
                              onClick={() => props.selectedBranch && props.onMergeBranch?.(props.selectedBranch)}
                            >
                              {mergeLabel()}
                            </Button>
                          </Show>

                          <Show when={deleteAvailable()}>
                            <Button
                              size="sm"
                              variant="outline"
                              class={cn(headerActionButtonClass, 'text-destructive hover:text-destructive')}
                              disabled={deleteDisabled()}
                              onClick={() => props.selectedBranch && props.onDeleteBranch?.(props.selectedBranch)}
                            >
                              {deleteLabel()}
                            </Button>
                          </Show>
                        </div>
                      </div>

                      <div class={headerActionDeckClass}>
                        <div class={headerActionDeckLabelClass}>View</div>
                        <div
                          class="grid w-full grid-cols-2 rounded-md border border-border/65 bg-background/72 p-0.5"
                          role="tablist"
                          aria-label="Branch detail tabs"
                          aria-orientation="horizontal"
                        >
                          <For each={GIT_BRANCH_SUBVIEW_IDS}>
                            {(view) => {
                              const active = () => branchSubview() === view;
                              return (
                                <button
                                  ref={(el) => {
                                    branchSubviewTabRefs.set(view, el);
                                  }}
                                  type="button"
                                  role="tab"
                                  id={gitBranchSubviewTabId(view)}
                                  aria-selected={active()}
                                  aria-controls={gitBranchSubviewPanelId(view)}
                                  tabIndex={active() ? 0 : -1}
                                  class={cn(
                                    'rounded px-3 py-1.5 text-center text-xs font-medium transition-colors duration-150',
                                    active() ? 'git-browser-selection-chip' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
                                  )}
                                  onClick={() => props.onSelectBranchSubview?.(view)}
                                  onKeyDown={(event) => handleBranchSubviewKeyDown(event, view)}
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
              </div>

              <Show when={branchSubview() === 'history'} fallback={renderStatus()}>
                <div
                  role="tabpanel"
                  id={gitBranchSubviewPanelId('history')}
                  aria-labelledby={gitBranchSubviewTabId('history')}
                  tabIndex={0}
                  class="flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <HistoryList
                    repoRootPath={activeRepoRootPath()}
                    selectedBranch={props.selectedBranch}
                    commits={props.commits}
                    listLoading={props.listLoading}
                    listLoadingMore={props.listLoadingMore}
                    listError={props.listError}
                    hasMore={props.hasMore}
                    selectedCommitHash={props.selectedCommitHash}
                    onSelectCommit={props.onSelectCommit}
                    onLoadMore={props.onLoadMore}
                    onAskFlower={props.onAskFlower}
                  />
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>

      <BranchCompareDialog
        open={compareDialogOpen()}
        repoRootPath={activeRepoRootPath()}
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
        source={diffDialogItem() ? {
          kind: 'workspace',
          repoRootPath: statusRepoRootPath(),
          workspaceSection: String(diffDialogItem()?.section ?? '').trim(),
        } : null}
        title="Branch Status Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected branch status diff.'}
        emptyMessage="Select a branch status file to inspect its diff."
      />

      <GitMergeBranchDialog
        open={Boolean(props.mergeReviewOpen && mergeReviewBranch())}
        branch={mergeReviewBranch()}
        preview={mergePreview()}
        previewError={props.mergePreviewError}
        actionError={props.mergeActionError}
        state={mergeReviewState()}
        onClose={() => props.onCloseMergeReview?.()}
        onRetryPreview={(branch) => props.onRetryMergePreview?.(branch)}
        onConfirm={(branch, options) => props.onConfirmMergeBranch?.(branch, options)}
      />

      <GitDeleteBranchConfirmDialog
        open={plainDeleteDialog()}
        branch={deleteReviewBranch()}
        preview={deletePreview()}
        previewError={props.deletePreviewError}
        actionError={props.deleteActionError}
        state={deleteReviewState()}
        onClose={() => props.onCloseDeleteReview?.()}
        onRetryPreview={(branch) => props.onRetryDeletePreview?.(branch)}
        onConfirm={(branch, options) => props.onConfirmDeleteBranch?.(branch, options)}
      />

      <GitDeleteBranchDialog
        open={linkedWorktreeDeleteDialog()}
        branch={deleteReviewBranch()}
        preview={deletePreview()}
        previewError={props.deletePreviewError}
        actionError={props.deleteActionError}
        state={deleteReviewState()}
        onClose={() => props.onCloseDeleteReview?.()}
        onRetryPreview={(branch) => props.onRetryDeletePreview?.(branch)}
        onConfirm={(branch, options) => props.onConfirmDeleteBranch?.(branch, options)}
      />
    </div>
  );
}
