import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Menu } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type GitCommitDetail, type GitCommitFileSummary, type GitResolveRepoResponse } from '../protocol/redeven_v1';
import { GIT_PATCH_PREVIEW_LINES, formatGitPatchLineNumber, gitChangeClass, gitChangeDotClass, gitChangeLabel, gitPatchPreviewLineClass, gitPatchRenderedLineClass, parseGitPatchRenderedLines } from '../utils/gitPatch';
import { readGitPatchTextOnce } from '../utils/gitPatchStreamReader';

const PATCH_MAX_BYTES = 2 * 1024 * 1024;
const FILES_SIDEBAR_WIDTH = 280;
const COMMIT_BODY_PREVIEW_LINES = 5;

export interface GitHistoryBrowserProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  currentPath: string;
  selectedCommitHash?: string;
  showSidebarToggle?: boolean;
  onOpenSidebar?: () => void;
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
  if (!file) return '';
  return String(file.patchPath || file.path || file.newPath || file.oldPath || '').trim();
}

function fileDisplayPath(file: GitCommitFileSummary | null | undefined): string {
  if (!file) return '(unknown path)';
  return String(file.path || file.newPath || file.oldPath || '').trim() || '(unknown path)';
}

function fileSecondaryPath(file: GitCommitFileSummary | null | undefined): string {
  if (!file) return '';
  if ((file.changeType === 'renamed' || file.changeType === 'copied') && file.oldPath && file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return fileDisplayPath(file);
}

function fileMetricsText(file: GitCommitFileSummary | null | undefined): string {
  return `+${file?.additions ?? 0} / −${file?.deletions ?? 0}`;
}

export function GitHistoryBrowser(props: GitHistoryBrowserProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notification = useNotification();

  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [commitFiles, setCommitFiles] = createSignal<GitCommitFileSummary[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal('');

  const [selectedFileKey, setSelectedFileKey] = createSignal('');
  const [patchText, setPatchText] = createSignal('');
  const [commitBodyExpanded, setCommitBodyExpanded] = createSignal(false);
  const [patchTruncated, setPatchTruncated] = createSignal(false);
  const [patchLoading, setPatchLoading] = createSignal(false);
  const [patchError, setPatchError] = createSignal('');
  const [patchExpanded, setPatchExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  let detailReqSeq = 0;
  let patchReqSeq = 0;
  let activePatchAbort: AbortController | null = null;

  const repoAvailable = createMemo(() => Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath));
  const commitHash = createMemo(() => String(props.selectedCommitHash ?? '').trim());
  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return commitFiles().find((file) => selectedFileIdentity(file) === key) ?? null;
  });
  const renderedPatchLines = createMemo(() => parseGitPatchRenderedLines(patchText()));
  const commitBodyText = createMemo(() => String(commitDetail()?.body ?? '').trim());
  const hasExpandableCommitBody = createMemo(() => {
    const body = commitBodyText();
    if (!body) return false;
    const logicalLines = body.split(/\r?\n/);
    return logicalLines.length > COMMIT_BODY_PREVIEW_LINES || body.length > 360;
  });
  const visiblePatchLines = createMemo(() => patchExpanded() ? renderedPatchLines() : renderedPatchLines().slice(0, GIT_PATCH_PREVIEW_LINES));
  const hasMorePatchLines = createMemo(() => renderedPatchLines().length > GIT_PATCH_PREVIEW_LINES);

  const resetPatchState = () => {
    if (activePatchAbort) {
      activePatchAbort.abort();
      activePatchAbort = null;
    }
    patchReqSeq += 1;
    setPatchText('');
    setPatchTruncated(false);
    setPatchLoading(false);
    setPatchError('');
    setPatchExpanded(false);
    setCopied(false);
  };

  onCleanup(() => {
    resetPatchState();
  });

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
      resetPatchState();
    } catch (err) {
      if (seq !== detailReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load commit detail');
      setDetailError(message);
      setCommitDetail(null);
      setCommitFiles([]);
      setSelectedFileKey('');
      resetPatchState();
    } finally {
      if (seq === detailReqSeq) {
        setDetailLoading(false);
      }
    }
  };

  const loadPatch = async (file: GitCommitFileSummary) => {
    const repoRootPath = String(props.repoInfo?.repoRootPath ?? '').trim();
    const hash = commitHash();
    const patchPath = String(file.patchPath || file.path || file.newPath || file.oldPath || '').trim();
    if (!repoRootPath || !hash || !patchPath || !protocol.client()) return;

    resetPatchState();
    const controller = new AbortController();
    activePatchAbort = controller;
    const seq = ++patchReqSeq;
    setPatchLoading(true);
    setPatchError('');
    try {
      const resp = await readGitPatchTextOnce({
        client: protocol.client()!,
        repoRootPath,
        commit: hash,
        filePath: patchPath,
        maxBytes: PATCH_MAX_BYTES,
        signal: controller.signal,
      });
      if (seq !== patchReqSeq) return;
      setPatchText(resp.text);
      setPatchTruncated(Boolean(resp.meta.truncated));
    } catch (err) {
      if (controller.signal.aborted || seq !== patchReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load patch');
      setPatchError(message);
    } finally {
      if (seq === patchReqSeq) {
        setPatchLoading(false);
      }
      if (activePatchAbort === controller) {
        activePatchAbort = null;
      }
    }
  };

  createEffect(() => {
    if (!repoAvailable()) {
      setCommitDetail(null);
      setCommitFiles([]);
      setSelectedFileKey('');
      setDetailError('');
      setDetailLoading(false);
      resetPatchState();
      return;
    }
    const hash = commitHash();
    if (!hash) {
      setCommitDetail(null);
      setCommitFiles([]);
      setSelectedFileKey('');
      setDetailError('');
      setDetailLoading(false);
      resetPatchState();
      return;
    }
    void loadCommitDetail(hash);
  });

  createEffect(() => {
    commitHash();
    setCommitBodyExpanded(false);
  });

  createEffect(() => {
    const file = selectedFile();
    if (!file) {
      resetPatchState();
      return;
    }
    if (file.isBinary) {
      resetPatchState();
      return;
    }
    void loadPatch(file);
  });

  const handleCopyPatch = async () => {
    const text = patchText();
    if (!text || !navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      notification.error('Copy failed', 'Failed to copy patch to clipboard.');
    }
  };

  const showSidebarToggle = () => Boolean(props.showSidebarToggle && props.onOpenSidebar);

  return (
    <div class={cn('relative h-full min-h-0 flex flex-col bg-background', props.class)}>
      <Show when={showSidebarToggle()}>
        <Button
          size="xs"
          variant="outline"
          icon={Menu}
          class="absolute left-3 top-3 z-10 h-7 w-7 px-0 shadow-sm bg-background/95 backdrop-blur-sm"
          aria-label="Open commits sidebar"
          title="Open commits sidebar"
          onClick={props.onOpenSidebar}
        />
      </Show>
      <Show
        when={repoAvailable()}
        fallback={
          <div class="h-full flex items-center justify-center border border-dashed border-border/70 bg-muted/15 px-6 text-center">
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
        <Show
          when={!detailLoading()}
          fallback={
            <div class="flex-1 flex items-center justify-center px-4 text-xs text-muted-foreground gap-2">
              <SnakeLoader size="sm" />
              <span>Loading commit details...</span>
            </div>
          }
        >
          <Show when={!detailError()} fallback={<div class="flex-1 px-4 py-5 text-xs text-error break-words">{detailError()}</div>}>
            <Show when={commitDetail()} fallback={<div class="flex-1 px-4 py-5 text-xs text-muted-foreground">Select a commit from the sidebar to inspect details.</div>}>
              {(detail) => (
                <>
                  <div class={cn('shrink-0 border-b border-border/70 px-4 py-2.5 space-y-1.5', showSidebarToggle() && 'pl-14')}>
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{detail().subject || '(no subject)'}</span>
                      <span class="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{detail().shortHash}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">{detail().authorName || '-'}</span>
                      <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">{formatDetailTime(detail().authorTimeMs)}</span>
                      <Show when={detail().parents.length > 0}>
                        <span class="max-w-full truncate rounded-full border border-border/60 bg-muted/20 px-2 py-0.5 font-mono" title={detail().parents.map((item) => item.slice(0, 7)).join(', ')}>
                          Parents {detail().parents.map((item) => item.slice(0, 7)).join(', ')}
                        </span>
                      </Show>
                    </div>
                    <Show when={commitBodyText()}>
                      <div class="space-y-1">
                        <div
                          class={cn(
                            'rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-[11px] leading-4.5 whitespace-pre-wrap break-words text-foreground',
                            commitBodyExpanded() ? 'overflow-auto' : 'overflow-hidden'
                          )}
                          style={commitBodyExpanded() ? undefined : {
                            display: '-webkit-box',
                            '-webkit-box-orient': 'vertical',
                            '-webkit-line-clamp': String(COMMIT_BODY_PREVIEW_LINES),
                          }}
                        >{commitBodyText()}</div>
                        <Show when={hasExpandableCommitBody()}>
                          <div class="flex justify-end">
                            <Button size="xs" variant="ghost" class="h-5 px-1.5 text-[10px]" onClick={() => setCommitBodyExpanded((value) => !value)}>
                              {commitBodyExpanded() ? 'Show less' : 'Show more'}
                            </Button>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>

                  <div class="flex-1 min-h-0 flex overflow-hidden">
                    <Sidebar width={FILES_SIDEBAR_WIDTH} class="h-full">
                      <SidebarContent class="h-full min-h-0 flex flex-col">
                        <SidebarSection
                          title="Changed Files"
                          actions={<span class="text-[11px] text-muted-foreground/80">{commitFiles().length}</span>}
                          class="min-h-0 flex-1"
                        >
                          <Show when={commitFiles().length > 0} fallback={<div class="px-2.5 py-3 text-xs text-muted-foreground">No changed files in this commit.</div>}>
                            <div class="h-full min-h-0 overflow-auto">
                              <SidebarItemList>
                                <For each={commitFiles()}>
                                  {(file) => (
                                    <SidebarItem
                                      active={selectedFileKey() === selectedFileIdentity(file)}
                                      class="py-0.5"
                                      icon={<span class={cn('inline-block size-2 rounded-full', gitChangeDotClass(file.changeType))} />}
                                      onClick={() => {
                                        setSelectedFileKey(selectedFileIdentity(file));
                                        setPatchExpanded(false);
                                      }}
                                    >
                                      <div class="flex min-w-0 items-center gap-2 text-left">
                                        <span class="min-w-0 flex-1 truncate text-[11px] leading-4 text-current" title={fileSecondaryPath(file)}>{fileSecondaryPath(file)}</span>
                                        <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">{file.isBinary ? `Binary · ${fileMetricsText(file)}` : fileMetricsText(file)}</span>
                                      </div>
                                    </SidebarItem>
                                  )}
                                </For>
                              </SidebarItemList>
                            </div>
                          </Show>
                        </SidebarSection>
                      </SidebarContent>
                    </Sidebar>

                    <div class="flex-1 min-w-0 min-h-0 overflow-auto px-4 py-3">
                      <Show when={selectedFile()} fallback={<div class="chat-tool-apply-patch-detail-empty">Select a changed file to inspect its patch.</div>}>
                        {(fileAccessor) => {
                          const file = fileAccessor();
                          return (
                            <div class="chat-tool-apply-patch-detail-panel">
                              <div class="chat-tool-apply-patch-detail-head">
                                <div class="chat-tool-apply-patch-detail-main">
                                  <span class={cn('chat-tool-apply-patch-change', gitChangeClass(file.changeType))}>
                                    {gitChangeLabel(file.changeType)}
                                  </span>
                                  <span class="chat-tool-apply-patch-detail-path" title={fileDisplayPath(file)}>
                                    {fileDisplayPath(file)}
                                  </span>
                                  <span class="chat-tool-apply-patch-detail-metrics">
                                    {fileMetricsText(file)}
                                    <Show when={file.isBinary}>
                                      <> · Binary</>
                                    </Show>
                                  </span>
                                </div>
                                <Button size="xs" variant="ghost" onClick={() => void handleCopyPatch()} disabled={!patchText() || patchLoading() || !!patchError()}>
                                  {copied() ? 'Copied' : 'Copy Patch'}
                                </Button>
                              </div>

                              <Show when={(file.changeType === 'renamed' || file.changeType === 'copied') && file.oldPath && file.newPath}>
                                <div class="chat-tool-apply-patch-rename-row">
                                  <span class="chat-tool-apply-patch-rename-path" title={file.oldPath}>{file.oldPath}</span>
                                  <span class="chat-tool-apply-patch-rename-arrow">→</span>
                                  <span class="chat-tool-apply-patch-rename-path" title={file.newPath}>{file.newPath}</span>
                                </div>
                              </Show>

                              <Show when={!file.isBinary} fallback={<div class="chat-tool-apply-patch-detail-empty">Binary file changed. Inline text diff is not available.</div>}>
                                <Show when={!patchLoading()} fallback={<div class="chat-tool-apply-patch-detail-empty flex items-center gap-2"><SnakeLoader size="sm" /><span>Loading patch...</span></div>}>
                                  <Show when={!patchError()} fallback={<div class="chat-tool-apply-patch-error">{patchError()}</div>}>
                                    <Show when={visiblePatchLines().length > 0} fallback={<div class="chat-tool-apply-patch-detail-empty">No inline diff lines available for this file.</div>}>
                                      <div class="chat-tool-apply-patch-detail-code">
                                        <For each={visiblePatchLines()}>
                                          {(line) => (
                                            <div class={cn('chat-tool-apply-patch-detail-line', gitPatchRenderedLineClass(line))}>
                                              <span class="chat-tool-apply-patch-detail-line-num">{formatGitPatchLineNumber(line.oldLine)}</span>
                                              <span class="chat-tool-apply-patch-detail-line-num">{formatGitPatchLineNumber(line.newLine)}</span>
                                              <span class={cn('chat-tool-apply-patch-detail-line-text', gitPatchPreviewLineClass(line.text))}>{line.text}</span>
                                            </div>
                                          )}
                                        </For>
                                      </div>
                                    </Show>

                                    <Show when={patchTruncated()}>
                                      <div class="mt-2 text-[11px] text-muted-foreground">Patch preview is truncated.</div>
                                    </Show>

                                    <Show when={hasMorePatchLines()}>
                                      <div class="chat-tool-apply-patch-toggle-row">
                                        <button type="button" class="chat-tool-apply-patch-toggle-btn" onClick={() => setPatchExpanded((value) => !value)}>
                                          {patchExpanded() ? 'Show less' : `Show all ${renderedPatchLines().length} lines`}
                                        </button>
                                      </div>
                                    </Show>
                                  </Show>
                                </Show>
                              </Show>
                            </div>
                          );
                        }}
                      </Show>
                    </div>
                  </div>
                </>
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
