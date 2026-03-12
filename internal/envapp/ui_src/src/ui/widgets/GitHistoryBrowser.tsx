import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type GitCommitDetail, type GitCommitFileSummary, type GitResolveRepoResponse } from '../protocol/redeven_v1';
import { changeSecondaryPath, gitDiffEntryIdentity } from '../utils/gitWorkbench';
import { gitChangePathClass } from './GitChrome';
import { GitDiffDialog } from './GitDiffDialog';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEAD_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
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

const COMMIT_BODY_PREVIEW_LINES = 2;
const COMMIT_BODY_PREVIEW_CHARS = 160;

export interface GitHistoryBrowserProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  currentPath: string;
  selectedCommitHash?: string;
  class?: string;
}

function formatDetailTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  return new Date(ms).toLocaleString();
}

function selectedFileIdentity(file: GitCommitFileSummary | null | undefined): string {
  return gitDiffEntryIdentity(file);
}

function normalizeCommitBody(detail: GitCommitDetail | null | undefined): string {
  const body = String(detail?.body ?? '').trim();
  if (!body) return '';
  const subject = String(detail?.subject ?? '').trim();
  if (!subject) return body;
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== subject) return body;
  return lines.slice(1).join('\n').trim();
}

export function GitHistoryBrowser(props: GitHistoryBrowserProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();

  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [commitFiles, setCommitFiles] = createSignal<GitCommitFileSummary[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal('');
  const [commitBodyExpanded, setCommitBodyExpanded] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitCommitFileSummary | null>(null);

  let detailReqSeq = 0;

  const repoAvailable = createMemo(() => Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath));
  const commitHash = createMemo(() => String(props.selectedCommitHash ?? '').trim());
  const commitBodyText = createMemo(() => normalizeCommitBody(commitDetail()));
  const hasExpandableCommitBody = createMemo(() => {
    const body = commitBodyText();
    if (!body) return false;
    const logicalLines = body.split(/\r?\n/);
    return logicalLines.length > COMMIT_BODY_PREVIEW_LINES || body.length > COMMIT_BODY_PREVIEW_CHARS;
  });

  const resetDetailState = () => {
    setCommitDetail(null);
    setCommitFiles([]);
    setDetailError('');
    setDetailLoading(false);
    setDiffDialogItem(null);
    setDiffDialogOpen(false);
  };

  const loadCommitDetail = async (hash: string) => {
    const repoRootPath = String(props.repoInfo?.repoRootPath ?? '').trim();
    if (!repoRootPath || !hash || !protocol.client()) return;
    const seq = ++detailReqSeq;
    setDetailLoading(true);
    setDetailError('');
    try {
      const resp = await rpc.git.getCommitDetail({ repoRootPath, commit: hash });
      if (seq !== detailReqSeq) return;
      const files = Array.isArray(resp?.files) ? resp.files : [];
      setCommitDetail(resp?.commit ?? null);
      setCommitFiles(files);
    } catch (err) {
      if (seq !== detailReqSeq) return;
      setDetailError(err instanceof Error ? err.message : String(err ?? 'Failed to load commit detail'));
      setCommitDetail(null);
      setCommitFiles([]);
    } finally {
      if (seq === detailReqSeq) setDetailLoading(false);
    }
  };

  createEffect(() => {
    if (!repoAvailable()) {
      resetDetailState();
      return;
    }
    const hash = commitHash();
    if (!hash) {
      resetDetailState();
      return;
    }
    void loadCommitDetail(hash);
  });

  createEffect(() => {
    commitHash();
    setCommitBodyExpanded(false);
    setDiffDialogItem(null);
    setDiffDialogOpen(false);
  });

  createEffect(() => {
    if (!diffDialogOpen()) return;
    if (diffDialogItem()) return;
    setDiffDialogOpen(false);
  });

  return (
    <div class={cn('relative flex h-full min-h-0 flex-col', props.class)}>
      <Show
        when={repoAvailable()}
        fallback={
          <div class="flex h-full items-center justify-center rounded-lg bg-muted/[0.18] px-6 text-center">
            <div class="max-w-md space-y-2">
              <div class="text-sm font-medium text-foreground">Git history is unavailable</div>
              <div class="text-xs text-muted-foreground">
                {props.repoInfoLoading
                  ? 'Checking repository context for the current path...'
                  : `Current path ${props.currentPath || '/'} is outside a Git repository.`}
              </div>
            </div>
          </div>
        }
      >
        <Show when={commitHash()} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a commit from the left rail to load its details.</div>}>
          <Show
            when={!detailLoading()}
            fallback={
              <div class="flex flex-1 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
                <SnakeLoader size="sm" />
                <span>Loading commit details...</span>
              </div>
            }
          >
            <Show when={!detailError()} fallback={<div class="flex-1 px-3 py-4 text-xs break-words text-error">{detailError()}</div>}>
              <Show when={commitDetail()} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Commit details are unavailable.</div>}>
                {(detailAccessor) => {
                  const detail = detailAccessor();
                  return (
                    <div class="flex-1 min-h-0 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
                      <div class="space-y-3">
                        <section class="rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                          <div class="flex flex-wrap items-start justify-between gap-3">
                            <GitLabelBlock
                              class="min-w-0 flex-1"
                              label="Commit Overview"
                              tone="brand"
                              meta={<GitMetaPill tone="neutral">{detail.shortHash}</GitMetaPill>}
                            >
                              <GitPrimaryTitle class="max-w-3xl">
                                {detail.subject || '(no subject)'}
                              </GitPrimaryTitle>
                              <div class="flex flex-wrap items-center gap-1 pt-0.5">
                                <GitMetaPill tone="info">{detail.authorName || 'Unknown author'}</GitMetaPill>
                                <GitMetaPill tone="neutral">{formatDetailTime(detail.authorTimeMs)}</GitMetaPill>
                                <GitMetaPill tone="neutral">{commitFiles().length} file{commitFiles().length === 1 ? '' : 's'}</GitMetaPill>
                                <GitMetaPill tone="neutral">{detail.parents.length > 0 ? `${detail.parents.length} parent${detail.parents.length === 1 ? '' : 's'}` : 'Root commit'}</GitMetaPill>
                              </div>
                              <Show when={commitBodyText()}>
                                <div class="space-y-1 pt-0.5">
                                  <GitSubtleNote>
                                    <div
                                      class="whitespace-pre-wrap break-words text-foreground"
                                      style={commitBodyExpanded()
                                        ? undefined
                                        : {
                                            display: '-webkit-box',
                                            '-webkit-box-orient': 'vertical',
                                            '-webkit-line-clamp': String(COMMIT_BODY_PREVIEW_LINES),
                                            overflow: 'hidden',
                                          }}
                                    >
                                      {commitBodyText()}
                                    </div>
                                  </GitSubtleNote>
                                  <Show when={hasExpandableCommitBody()}>
                                    <div class="flex justify-end">
                                      <button
                                        type="button"
                                        aria-expanded={commitBodyExpanded()}
                                        class="cursor-pointer text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                                        onClick={() => setCommitBodyExpanded((value) => !value)}
                                      >
                                        {commitBodyExpanded() ? 'Show less' : 'Show more'}
                                      </button>
                                    </div>
                                  </Show>
                                </div>
                              </Show>
                            </GitLabelBlock>
                          </div>
                        </section>

                        <section class="rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                          <GitLabelBlock class="min-w-0" label="Files in Commit" tone="info" meta={<GitMetaPill tone="neutral">{String(commitFiles().length)}</GitMetaPill>}>
                            <div class="text-xs leading-relaxed text-muted-foreground">Click a file to inspect its diff in a dialog.</div>
                          </GitLabelBlock>
                          <Show when={commitFiles().length > 0} fallback={<GitSubtleNote>No changed files are available for this commit.</GitSubtleNote>}>
                            <div class="mt-2.5 overflow-hidden rounded-md border border-border/65 bg-card">
                              <div class="min-h-0 overflow-auto">
                                <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[42rem] md:min-w-0`}>
                                  <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
                                    <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                                      <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                                      <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                                      <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                                      <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <For each={commitFiles()}>
                                      {(file) => {
                                        const active = () => selectedFileIdentity(diffDialogItem()) === selectedFileIdentity(file) && diffDialogOpen();
                                        return (
                                          <tr
                                            aria-selected={active()}
                                            class={gitChangedFilesRowClass(active())}
                                          >
                                            <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                              <div class="min-w-0">
                                                <button
                                                  type="button"
                                                  class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(file.changeType)}`}
                                                  title={changeSecondaryPath(file)}
                                                  onClick={() => {
                                                    setDiffDialogItem(file);
                                                    setDiffDialogOpen(true);
                                                  }}
                                                >
                                                  {changeSecondaryPath(file)}
                                                </button>
                                              </div>
                                            </td>
                                            <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeStatusPill change={file.changeType} /></td>
                                            <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={file.additions} deletions={file.deletions} /></td>
                                            <td class={gitChangedFilesStickyCellClass(active())}>
                                              <GitChangedFilesActionButton
                                                onClick={() => {
                                                  setDiffDialogItem(file);
                                                  setDiffDialogOpen(true);
                                                }}
                                              >
                                                View Diff
                                              </GitChangedFilesActionButton>
                                            </td>
                                          </tr>
                                        );
                                      }}
                                    </For>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </Show>
                        </section>
                      </div>
                    </div>
                  );
                }}
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>

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
        unavailableMessage={(file) => (file.isBinary ? 'Binary file changed. Inline text diff is not available.' : undefined)}
      />
    </div>
  );
}
