import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type GitCommitDetail, type GitCommitFileSummary, type GitResolveRepoResponse } from '../protocol/redeven_v1';
import { changeMetricsText, changeSecondaryPath, gitDiffEntryIdentity } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { gitChangeTone, gitToneSelectableCardClass } from './GitChrome';
import { GitSection, GitSubtleNote } from './GitWorkbenchPrimitives';

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
  const [selectedFileKey, setSelectedFileKey] = createSignal('');
  const [commitBodyExpanded, setCommitBodyExpanded] = createSignal(false);
  const [diffOpen, setDiffOpen] = createSignal(false);

  let detailReqSeq = 0;

  const repoAvailable = createMemo(() => Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath));
  const commitHash = createMemo(() => String(props.selectedCommitHash ?? '').trim());
  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return commitFiles().find((file) => selectedFileIdentity(file) === key) ?? null;
  });
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
    setSelectedFileKey('');
    setDetailError('');
    setDetailLoading(false);
    setDiffOpen(false);
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
      setSelectedFileKey('');
    } catch (err) {
      if (seq !== detailReqSeq) return;
      setDetailError(err instanceof Error ? err.message : String(err ?? 'Failed to load commit detail'));
      setCommitDetail(null);
      setCommitFiles([]);
      setSelectedFileKey('');
    } finally {
      if (seq === detailReqSeq) {
        setDetailLoading(false);
      }
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
    setDiffOpen(false);
  });

  const openFileDiff = (file: GitCommitFileSummary) => {
    setSelectedFileKey(selectedFileIdentity(file));
    setDiffOpen(true);
  };

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
        <Show when={commitHash()} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a commit from the sidebar to load its details.</div>}>
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
                    <>
                      <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
                        <div class="space-y-1.5 sm:space-y-2">
                          <GitSection label="Commit Summary" tone="brand">
                            <div class="text-xs font-medium text-foreground">{detail.subject || '(no subject)'}</div>
                            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span class="font-mono text-foreground/80">{detail.shortHash}</span>
                              <span aria-hidden="true">·</span>
                              <span>{detail.authorName || '-'}</span>
                              <Show when={detail.authorEmail}>
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{detail.authorEmail}</span>
                                </>
                              </Show>
                              <span aria-hidden="true">·</span>
                              <span>{formatDetailTime(detail.authorTimeMs)}</span>
                            </div>
                            <Show when={detail.parents.length > 0}>
                              <div class="mt-0.5 text-[10px] text-muted-foreground" title={detail.parents.map((item) => item.slice(0, 7)).join(', ')}>
                                Parents {detail.parents.map((item) => item.slice(0, 7)).join(', ')}
                              </div>
                            </Show>

                            <Show when={commitBodyText()}>
                              <div class="mt-2 space-y-1.5">
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
                          </GitSection>

                          <GitSection label="Changed Files" description="Select a changed file to open its floating diff." aside={String(commitFiles().length)} tone="info">
                            <Show when={commitFiles().length > 0} fallback={<div class="text-xs text-muted-foreground">No changed files are available for this commit.</div>}>
                              <div class="grid grid-cols-1 gap-1 xl:grid-cols-2">
                                <For each={commitFiles()}>
                                  {(file) => {
                                    const active = () => selectedFileKey() === selectedFileIdentity(file);
                                    const tone = () => gitChangeTone(file.changeType);
                                    return (
                                      <button
                                        type="button"
                                        class={cn('w-full rounded-md px-2.5 py-2.5 text-left text-xs sm:py-1.5', gitToneSelectableCardClass(tone(), active()))}
                                        onClick={() => openFileDiff(file)}
                                      >
                                        <div class="flex flex-wrap items-start justify-between gap-2">
                                          <div class="min-w-0 flex-1">
                                            <div class="truncate font-medium text-current" title={changeSecondaryPath(file)}>{changeSecondaryPath(file)}</div>
                                            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                              <span class="capitalize">{file.changeType || 'modified'}</span>
                                              <span aria-hidden="true">·</span>
                                              <span>{file.isBinary ? `Binary · ${changeMetricsText(file)}` : changeMetricsText(file)}</span>
                                            </div>
                                          </div>
                                          <span class="text-[10px] font-medium text-muted-foreground">Open Diff</span>
                                        </div>
                                      </button>
                                    );
                                  }}
                                </For>
                              </div>
                            </Show>
                          </GitSection>
                        </div>
                      </div>

                      <GitDiffDialog
                        open={diffOpen()}
                        onOpenChange={setDiffOpen}
                        item={selectedFile()}
                        title="Commit Diff"
                        description={detail.shortHash}
                        emptyMessage="Open a changed file to inspect its diff."
                      />
                    </>
                  );
                }}
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
