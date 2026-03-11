import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type GitCommitDetail, type GitCommitFileSummary, type GitResolveRepoResponse } from '../protocol/redeven_v1';
import { changeSecondaryPath, gitDiffEntryIdentity } from '../utils/gitWorkbench';
import { gitChangeTone, gitToneDotClass } from './GitChrome';
import { GitDiffDialog } from './GitDiffDialog';
import { GitChangeMetrics, GitMetaPill, GitSection, GitSubtleNote } from './GitWorkbenchPrimitives';

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
                        <GitSection label="Commit Overview" aside={detail.shortHash} tone="brand">
                          <div class="space-y-2">
                            <div class="space-y-1">
                              <div class="text-sm font-medium leading-snug text-foreground">{detail.subject || '(no subject)'}</div>
                              <div class="flex flex-wrap items-center gap-1.5">
                                <GitMetaPill tone="info">{detail.authorName || 'Unknown author'}</GitMetaPill>
                                <GitMetaPill tone="neutral">{formatDetailTime(detail.authorTimeMs)}</GitMetaPill>
                                <GitMetaPill tone="neutral">{commitFiles().length} file{commitFiles().length === 1 ? '' : 's'}</GitMetaPill>
                                <GitMetaPill tone="neutral">{detail.parents.length > 0 ? `${detail.parents.length} parent${detail.parents.length === 1 ? '' : 's'}` : 'Root commit'}</GitMetaPill>
                              </div>
                            </div>
                            <Show when={commitBodyText()}>
                              <div class="space-y-1.5">
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
                          </div>
                        </GitSection>

                        <GitSection label="Files in Commit" description="Click a file to inspect its diff in a dialog." aside={String(commitFiles().length)} tone="info">
                          <Show when={commitFiles().length > 0} fallback={<GitSubtleNote>No changed files are available for this commit.</GitSubtleNote>}>
                            <div class="overflow-hidden rounded-md border border-border/65 bg-card">
                              <div class="min-h-0 overflow-auto">
                                <table class="w-full min-w-[42rem] text-xs md:min-w-0">
                                  <thead class="sticky top-0 z-10 bg-muted/30 backdrop-blur">
                                    <tr class="border-b border-border/60 text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                      <th class="px-3 py-2.5 font-medium">Path</th>
                                      <th class="px-3 py-2.5 font-medium">Status</th>
                                      <th class="px-3 py-2.5 font-medium">Changes</th>
                                      <th class="sticky right-0 z-20 border-l border-border/50 bg-muted/30 px-3 py-2.5 text-right font-medium">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <For each={commitFiles()}>
                                      {(file) => {
                                        const tone = () => gitChangeTone(file.changeType);
                                        const active = () => selectedFileIdentity(diffDialogItem()) === selectedFileIdentity(file) && diffDialogOpen();
                                        return (
                                          <tr
                                            aria-selected={active()}
                                            class={`group border-b border-border/45 last:border-b-0 ${active() ? 'bg-muted/45' : 'bg-transparent hover:bg-muted/25'}`}
                                          >
                                            <td class="px-3 py-2.5 align-top">
                                              <div class="min-w-0">
                                                <button
                                                  type="button"
                                                  class="block max-w-full cursor-pointer truncate text-left text-xs font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
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
                                            <td class="px-3 py-2.5 align-top">
                                              <div class="inline-flex items-center gap-1.5 text-xs text-foreground">
                                                <span class={cn('h-1.5 w-1.5 rounded-full', gitToneDotClass(tone()))} aria-hidden="true" />
                                                <GitMetaPill tone={tone()} class="capitalize">{file.changeType || 'modified'}</GitMetaPill>
                                              </div>
                                            </td>
                                            <td class="px-3 py-2.5 align-top">
                                              <GitChangeMetrics additions={file.additions} deletions={file.deletions} />
                                            </td>
                                            <td class={`sticky right-0 z-10 border-l border-border/45 px-3 py-2.5 text-right align-top shadow-[-1px_0_0_rgba(0,0,0,0.03)] ${active() ? 'bg-muted/45' : 'bg-card group-hover:bg-muted/25'}`}>
                                              <button
                                                type="button"
                                                class="inline-flex min-w-[5.5rem] items-center justify-center rounded-sm border border-input bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                                                onClick={() => {
                                                  setDiffDialogItem(file);
                                                  setDiffDialogOpen(true);
                                                }}
                                              >
                                                View Diff
                                              </button>
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
                        </GitSection>
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
