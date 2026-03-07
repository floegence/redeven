import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type GitCommitDetail, type GitCommitFileSummary, type GitResolveRepoResponse } from '../protocol/redeven_v1';
import { GitPatchViewer } from './GitPatchViewer';
import { readGitPatchTextOnce } from '../utils/gitPatchStreamReader';
import { changeMetricsText, changeSecondaryPath } from '../utils/gitWorkbench';
import { gitChangeTone, gitToneBadgeClass, gitToneSelectableCardClass, gitToneSurfaceClass } from './GitChrome';

const COMMIT_BODY_PREVIEW_LINES = 5;

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

function pickDefaultFile(files: GitCommitFileSummary[]): GitCommitFileSummary | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  return files.find((file) => !file.isBinary) ?? files[0] ?? null;
}

function selectedFileIdentity(file: GitCommitFileSummary | null | undefined): string {
  return String(file?.patchPath || file?.path || file?.newPath || file?.oldPath || '').trim();
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

  let detailReqSeq = 0;

  const repoAvailable = createMemo(() => Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath));
  const commitHash = createMemo(() => String(props.selectedCommitHash ?? '').trim());
  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return commitFiles().find((file) => selectedFileIdentity(file) === key) ?? null;
  });
  const commitBodyText = createMemo(() => String(commitDetail()?.body ?? '').trim());
  const hasExpandableCommitBody = createMemo(() => {
    const body = commitBodyText();
    if (!body) return false;
    const logicalLines = body.split(/\r?\n/);
    return logicalLines.length > COMMIT_BODY_PREVIEW_LINES || body.length > 360;
  });

  const resetDetailState = () => {
    setCommitDetail(null);
    setCommitFiles([]);
    setSelectedFileKey('');
    setDetailError('');
    setDetailLoading(false);
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
      const nextDefault = pickDefaultFile(files);
      setSelectedFileKey(selectedFileIdentity(nextDefault));
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
  });

  return (
    <div class={cn('relative flex h-full min-h-0 flex-col bg-background', props.class)}>
      <Show
        when={repoAvailable()}
        fallback={
          <div class="flex h-full items-center justify-center border border-dashed border-border/70 bg-muted/15 px-6 text-center">
            <div class="max-w-md space-y-2">
              <div class="text-sm font-medium text-foreground">Git history is unavailable</div>
              <div class="text-xs text-muted-foreground">
                {props.repoInfoLoading
                  ? 'Checking whether the current directory belongs to a Git repository...'
                  : `Current path ${props.currentPath || '/'} is not inside a Git repository.`}
              </div>
            </div>
          </div>
        }
      >
        <Show when={commitHash()} fallback={<div class="flex-1 px-4 py-5 text-xs text-muted-foreground">Select a commit from the Git sidebar to inspect its details.</div>}>
          <Show
            when={!detailLoading()}
            fallback={
              <div class="flex flex-1 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
                <SnakeLoader size="sm" />
                <span>Loading commit details...</span>
              </div>
            }
          >
            <Show when={!detailError()} fallback={<div class="flex-1 px-4 py-5 text-xs break-words text-error">{detailError()}</div>}>
              <Show when={commitDetail()} fallback={<div class="flex-1 px-4 py-5 text-xs text-muted-foreground">Commit detail is unavailable.</div>}>
                {(detailAccessor) => {
                  const detail = detailAccessor();
                  return (
                    <div class="flex-1 min-h-0 overflow-auto px-4 py-3">
                      <div class="space-y-4">
                        <section class={cn('rounded-2xl border p-4 shadow-sm', gitToneSurfaceClass('brand'))}>
                          <div class="flex flex-wrap items-start justify-between gap-3">
                            <div class="min-w-0 flex-1">
                              <div class="text-base font-semibold text-foreground">{detail.subject || '(no subject)'}</div>
                              <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('brand'))}>{detail.shortHash}</span>
                                <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('neutral'))}>{detail.authorName || '-'}</span>
                                <Show when={detail.authorEmail}>
                                  <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('neutral'))}>{detail.authorEmail}</span>
                                </Show>
                                <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('neutral'))}>{formatDetailTime(detail.authorTimeMs)}</span>
                                <Show when={detail.parents.length > 0}>
                                  <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('violet'))} title={detail.parents.map((item) => item.slice(0, 7)).join(', ')}>
                                    Parents {detail.parents.map((item) => item.slice(0, 7)).join(', ')}
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </div>

                          <Show when={commitBodyText()}>
                            <div class="mt-4 space-y-1">
                              <div
                                class="rounded-xl border border-border/60 bg-background/75 px-3 py-2 text-[11px] leading-5 whitespace-pre-wrap break-words text-foreground"
                                style={commitBodyExpanded() ? undefined : {
                                  display: '-webkit-box',
                                  '-webkit-box-orient': 'vertical',
                                  '-webkit-line-clamp': String(COMMIT_BODY_PREVIEW_LINES),
                                  overflow: 'hidden',
                                }}
                              >{commitBodyText()}</div>
                              <Show when={hasExpandableCommitBody()}>
                                <div class="flex justify-end">
                                  <button
                                    type="button"
                                    class="text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                                    onClick={() => setCommitBodyExpanded((value) => !value)}
                                  >
                                    {commitBodyExpanded() ? 'Show less' : 'Show more'}
                                  </button>
                                </div>
                              </Show>
                            </div>
                          </Show>
                        </section>

                        <section class={cn('rounded-2xl border p-4 shadow-sm', gitToneSurfaceClass('info'))}>
                          <div class="flex items-center justify-between gap-3">
                            <div>
                              <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Changed Files</div>
                              <div class="mt-1 text-xs text-muted-foreground">Select a changed file to inspect its patch below.</div>
                            </div>
                            <div class={cn('rounded-full border px-2.5 py-1 text-[10px] font-medium', gitToneBadgeClass('info'))}>{commitFiles().length}</div>
                          </div>
                          <Show when={commitFiles().length > 0} fallback={<div class="mt-4 text-xs text-muted-foreground">No changed files in this commit.</div>}>
                            <div class="mt-4 max-h-[38vh] space-y-2 overflow-auto pr-1 sm:max-h-72">
                              <For each={commitFiles()}>
                                {(file) => {
                                  const active = () => selectedFileKey() === selectedFileIdentity(file);
                                  const tone = () => gitChangeTone(file.changeType);
                                  return (
                                    <button
                                      type="button"
                                      class={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-150', gitToneSelectableCardClass(tone(), active()))}
                                      onClick={() => setSelectedFileKey(selectedFileIdentity(file))}
                                    >
                                      <div class="min-w-0">
                                        <div class="truncate text-[12px] font-medium text-current" title={changeSecondaryPath(file)}>{changeSecondaryPath(file)}</div>
                                        <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                          <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(tone()))}>{file.changeType || 'modified'}</span>
                                          <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(file.isBinary ? 'warning' : 'neutral'))}>
                                            {file.isBinary ? `Binary · ${changeMetricsText(file)}` : changeMetricsText(file)}
                                          </span>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </section>

                        <section class="space-y-3">
                          <div>
                            <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Patch</div>
                            <div class="mt-1 text-xs text-muted-foreground">The selected file patch stays in the main detail surface for easier reading.</div>
                          </div>
                          <GitPatchViewer
                            item={selectedFile()}
                            emptyMessage="Select a changed file to inspect its patch."
                            loadPatch={async (item, signal) => {
                              const client = protocol.client();
                              const repoRootPath = String(props.repoInfo?.repoRootPath ?? '').trim();
                              const hash = commitHash();
                              const patchPath = String(item.patchPath || item.path || item.newPath || item.oldPath || '').trim();
                              if (!client || !repoRootPath || !hash || !patchPath) {
                                return { text: '', truncated: false };
                              }
                              const resp = await readGitPatchTextOnce({
                                client,
                                repoRootPath,
                                commit: hash,
                                filePath: patchPath,
                                maxBytes: 2 * 1024 * 1024,
                                signal,
                              });
                              return { text: resp.text, truncated: resp.meta.truncated };
                            }}
                          />
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
    </div>
  );
}
