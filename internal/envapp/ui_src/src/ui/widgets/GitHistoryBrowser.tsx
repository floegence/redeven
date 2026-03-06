import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Sidebar, SidebarContent, SidebarItem, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type GitCommitDetail, type GitCommitFileSummary, type GitCommitSummary, type GitResolveRepoResponse } from '../protocol/redeven_v1';
import { GIT_PATCH_PREVIEW_LINES, formatGitPatchLineNumber, gitChangeClass, gitChangeDotClass, gitChangeLabel, gitFileDisplayName, gitPatchPreviewLineClass, gitPatchRenderedLineClass, parseGitPatchRenderedLines } from '../utils/gitPatch';
import { readGitPatchTextOnce } from '../utils/gitPatchStreamReader';

const COMMIT_PAGE_SIZE = 50;
const PATCH_MAX_BYTES = 2 * 1024 * 1024;
const COMMIT_SIDEBAR_WIDTH = 320;
const FILES_SIDEBAR_WIDTH = 280;

export interface GitHistoryBrowserProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  currentPath: string;
  onRefreshRepoInfo?: () => void | Promise<void>;
  class?: string;
}

function formatRelativeTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return new Date(ms).toLocaleDateString();
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 5) return `${seconds}s ago`;
  return 'now';
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
  if (file.changeType === 'renamed' && file.oldPath && file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  if (file.changeType === 'copied' && file.oldPath && file.newPath) {
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

  const [commits, setCommits] = createSignal<GitCommitSummary[]>([]);
  const [listLoading, setListLoading] = createSignal(false);
  const [listLoadingMore, setListLoadingMore] = createSignal(false);
  const [listError, setListError] = createSignal('');
  const [hasMore, setHasMore] = createSignal(false);
  const [nextOffset, setNextOffset] = createSignal(0);
  const [selectedCommitHash, setSelectedCommitHash] = createSignal('');

  const [commitDetail, setCommitDetail] = createSignal<GitCommitDetail | null>(null);
  const [commitFiles, setCommitFiles] = createSignal<GitCommitFileSummary[]>([]);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal('');

  const [selectedFileKey, setSelectedFileKey] = createSignal('');
  const [patchText, setPatchText] = createSignal('');
  const [patchTruncated, setPatchTruncated] = createSignal(false);
  const [patchLoading, setPatchLoading] = createSignal(false);
  const [patchError, setPatchError] = createSignal('');
  const [patchExpanded, setPatchExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  let lastRepoKey = '';
  let listReqSeq = 0;
  let detailReqSeq = 0;
  let patchReqSeq = 0;
  let activePatchAbort: AbortController | null = null;

  const repoAvailable = createMemo(() => Boolean(props.repoInfo?.available && props.repoInfo?.repoRootPath));
  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return commitFiles().find((file) => selectedFileIdentity(file) === key) ?? null;
  });
  const renderedPatchLines = createMemo(() => parseGitPatchRenderedLines(patchText()));
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

  const loadCommits = async (reset: boolean) => {
    const repoRootPath = String(props.repoInfo?.repoRootPath ?? '').trim();
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++listReqSeq;
    setListError('');
    if (reset) {
      setListLoading(true);
    } else {
      setListLoadingMore(true);
    }
    try {
      const resp = await rpc.git.listCommits({
        repoRootPath,
        offset: reset ? 0 : nextOffset(),
        limit: COMMIT_PAGE_SIZE,
      });
      if (seq !== listReqSeq) return;
      const nextItems = Array.isArray(resp?.commits) ? resp.commits : [];
      if (reset) {
        setCommits(nextItems);
      } else {
        const seen = new Set(commits().map((item) => item.hash));
        setCommits([...commits(), ...nextItems.filter((item) => !seen.has(item.hash))]);
      }
      setHasMore(Boolean(resp?.hasMore));
      setNextOffset(Number(resp?.nextOffset ?? 0));
      const allItems = reset ? nextItems : commits();
      const current = selectedCommitHash();
      if ((reset || !allItems.some((item) => item.hash === current)) && nextItems.length > 0) {
        setSelectedCommitHash(nextItems[0]!.hash);
      }
      if (reset && nextItems.length === 0) {
        setSelectedCommitHash('');
        setCommitDetail(null);
        setCommitFiles([]);
        setSelectedFileKey('');
        resetPatchState();
      }
    } catch (err) {
      if (seq !== listReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load commits');
      setListError(message);
    } finally {
      if (seq === listReqSeq) {
        setListLoading(false);
        setListLoadingMore(false);
      }
    }
  };

  const loadCommitDetail = async (commitHash: string) => {
    const repoRootPath = String(props.repoInfo?.repoRootPath ?? '').trim();
    if (!repoRootPath || !commitHash || !protocol.client()) return;
    const seq = ++detailReqSeq;
    setDetailLoading(true);
    setDetailError('');
    try {
      const resp = await rpc.git.getCommitDetail({ repoRootPath, commit: commitHash });
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
    const commitHash = selectedCommitHash();
    const patchPath = String(file.patchPath || file.path || file.newPath || file.oldPath || '').trim();
    if (!repoRootPath || !commitHash || !patchPath || !protocol.client()) return;

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
        commit: commitHash,
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
    const info = props.repoInfo;
    const repoKey = info?.available ? `${info.repoRootPath ?? ''}|${info.headCommit ?? ''}` : '';
    if (!repoKey) {
      lastRepoKey = '';
      setCommits([]);
      setHasMore(false);
      setNextOffset(0);
      setListError('');
      setSelectedCommitHash('');
      setCommitDetail(null);
      setCommitFiles([]);
      setSelectedFileKey('');
      resetPatchState();
      return;
    }
    if (repoKey === lastRepoKey) {
      return;
    }
    lastRepoKey = repoKey;
    void loadCommits(true);
  });

  createEffect(() => {
    const commitHash = selectedCommitHash();
    if (!commitHash) {
      setCommitDetail(null);
      setCommitFiles([]);
      setSelectedFileKey('');
      resetPatchState();
      return;
    }
    void loadCommitDetail(commitHash);
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

  const handleRefresh = async () => {
    try {
      await props.onRefreshRepoInfo?.();
    } finally {
      if (repoAvailable()) {
        void loadCommits(true);
      }
    }
  };

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

  return (
    <div class={cn('h-full min-h-0 flex flex-col bg-background', props.class)}>
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
        <>
          <div class="shrink-0 border-b border-border/70 px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span class="font-medium text-foreground truncate">{props.repoInfo?.repoRootPath}</span>
                  <Show when={props.repoInfo?.headRef}>
                    <span class="rounded-full border border-border/70 px-2 py-0.5">{props.repoInfo?.headRef}</span>
                  </Show>
                  <Show when={props.repoInfo?.headCommit}>
                    <span class="rounded-full border border-border/70 px-2 py-0.5 font-mono">{String(props.repoInfo?.headCommit ?? '').slice(0, 7)}</span>
                  </Show>
                  <Show when={props.repoInfo?.dirty}>
                    <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">Dirty</span>
                  </Show>
                </div>
                <div class="text-[11px] text-muted-foreground truncate">Current path: {props.currentPath || '/'}</div>
              </div>
              <Button size="xs" variant="outline" onClick={() => void handleRefresh()} disabled={listLoading() || detailLoading() || patchLoading()}>
                Refresh
              </Button>
            </div>
          </div>

          <div class="flex-1 min-h-0 flex overflow-hidden">
            <Sidebar width={COMMIT_SIDEBAR_WIDTH} class="h-full">
              <SidebarContent class="h-full min-h-0 flex flex-col">
                <div class="px-1 pb-1 text-[11px] text-muted-foreground">
                  Browse repository history with commit navigation in the standard sidebar.
                </div>
                <SidebarSection
                  title="Commits"
                  actions={<span class="text-[11px] text-muted-foreground/80">{commits().length}</span>}
                  class="min-h-0 flex-1"
                >
                  <div class="h-full min-h-0 flex flex-col">
                    <Show
                      when={!listLoading()}
                      fallback={
                        <div class="px-2.5 py-3 text-xs text-muted-foreground flex items-center gap-2">
                          <SnakeLoader size="sm" />
                          <span>Loading commits...</span>
                        </div>
                      }
                    >
                      <Show when={!listError()} fallback={<div class="px-2.5 py-3 text-xs text-error break-words">{listError()}</div>}>
                        <Show when={commits().length > 0} fallback={<div class="px-2.5 py-3 text-xs text-muted-foreground">This repository has no commits yet.</div>}>
                          <div class="h-full min-h-0 overflow-auto">
                            <SidebarItemList>
                              <For each={commits()}>
                                {(commit) => (
                                  <SidebarItem
                                    active={selectedCommitHash() === commit.hash}
                                    class="items-start py-2"
                                    icon={<span class="mt-1 inline-block size-2 rounded-full bg-current" />}
                                    onClick={() => setSelectedCommitHash(commit.hash)}
                                  >
                                    <div class="min-w-0 flex-1">
                                      <div class="flex items-start justify-between gap-2">
                                        <span class="min-w-0 flex-1 truncate text-[12px] leading-5 text-current">{commit.subject || '(no subject)'}</span>
                                        <span class="shrink-0 text-[10px] text-muted-foreground/80">{formatRelativeTime(commit.authorTimeMs)}</span>
                                      </div>
                                      <div class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/80">
                                        <span class="font-mono">{commit.shortHash}</span>
                                        <span class="truncate">{commit.authorName || '-'}</span>
                                      </div>
                                      <Show when={commit.bodyPreview}>
                                        <div class="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground/80">{commit.bodyPreview}</div>
                                      </Show>
                                    </div>
                                  </SidebarItem>
                                )}
                              </For>
                            </SidebarItemList>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>
                </SidebarSection>

                <Show when={hasMore()}>
                  <div class="pt-1">
                    <Button size="sm" variant="outline" class="w-full" onClick={() => void loadCommits(false)} loading={listLoadingMore()} disabled={listLoadingMore()}>
                      Load More
                    </Button>
                  </div>
                </Show>
              </SidebarContent>
            </Sidebar>

            <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
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
                        <div class="shrink-0 border-b border-border/70 px-4 py-3 space-y-2.5">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium text-foreground">{detail().subject || '(no subject)'}</span>
                            <span class="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">{detail().shortHash}</span>
                          </div>
                          <div class="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>{detail().authorName || '-'}</span>
                            <span>{formatDetailTime(detail().authorTimeMs)}</span>
                            <Show when={detail().parents.length > 0}>
                              <span class="font-mono">Parents: {detail().parents.map((item) => item.slice(0, 7)).join(', ')}</span>
                            </Show>
                          </div>
                          <Show when={detail().body}>
                            <pre class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-[12px] leading-5 whitespace-pre-wrap break-words text-foreground overflow-auto">{detail().body}</pre>
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
                                            class="items-start py-2"
                                            icon={<span class={cn('mt-1 inline-block size-2 rounded-full', gitChangeDotClass(file.changeType))} />}
                                            onClick={() => {
                                              setSelectedFileKey(selectedFileIdentity(file));
                                              setPatchExpanded(false);
                                            }}
                                          >
                                            <div class="min-w-0 flex-1">
                                              <div class="flex items-start justify-between gap-2">
                                                <span class="min-w-0 flex-1 truncate text-[12px] leading-5 text-current">{gitFileDisplayName(fileDisplayPath(file))}</span>
                                                <span class="shrink-0 text-[10px] text-muted-foreground/80">{fileMetricsText(file)}</span>
                                              </div>
                                              <div class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/80">
                                                <span class={cn('chat-tool-apply-patch-change', gitChangeClass(file.changeType))}>{gitChangeLabel(file.changeType)}</span>
                                                <Show when={file.isBinary}>
                                                  <span>Binary</span>
                                                </Show>
                                              </div>
                                              <div class="mt-1 truncate text-[10px] leading-4 text-muted-foreground/80" title={fileSecondaryPath(file)}>
                                                {fileSecondaryPath(file)}
                                              </div>
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
            </div>
          </div>
        </>
      </Show>
    </div>
  );
}
