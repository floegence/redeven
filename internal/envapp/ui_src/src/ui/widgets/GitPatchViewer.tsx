import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useNotification } from '@floegence/floe-webapp-core';
import type { GitCommitFileSummary, GitWorkspaceChange } from '../protocol/redeven_v1';
import {
  GIT_PATCH_PREVIEW_LINES,
  formatGitPatchLineNumber,
  gitChangeClass,
  gitChangeLabel,
  gitPatchPreviewLineClass,
  gitPatchRenderedLineClass,
  parseGitPatchRenderedLines,
} from '../utils/gitPatch';
import { changeDisplayPath, changeMetricsText } from '../utils/gitWorkbench';
import { hasMeaningfulGitPatchText } from '../utils/gitPatchText';

export type GitPatchRenderable = GitCommitFileSummary | GitWorkspaceChange;

export interface GitPatchViewerProps<T extends GitPatchRenderable> {
  item: T | null | undefined;
  emptyMessage: string;
  loadPatch: (item: T, signal: AbortSignal) => Promise<{ text: string; truncated?: boolean }>;
  unavailableMessage?: string | ((item: T) => string | undefined);
  class?: string;
}

function itemIdentity(item: GitPatchRenderable | null | undefined): string {
  if (!item) return '';
  return String(item.patchPath || item.path || item.newPath || item.oldPath || '').trim();
}

export function GitPatchViewer<T extends GitPatchRenderable>(props: GitPatchViewerProps<T>) {
  const notification = useNotification();
  const [patchText, setPatchText] = createSignal('');
  const [patchTruncated, setPatchTruncated] = createSignal(false);
  const [patchLoading, setPatchLoading] = createSignal(false);
  const [patchError, setPatchError] = createSignal('');
  const [patchExpanded, setPatchExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  let patchReqSeq = 0;
  let activeAbort: AbortController | null = null;

  const renderedPatchLines = createMemo(() => parseGitPatchRenderedLines(patchText()));
  const visiblePatchLines = createMemo(() => patchExpanded() ? renderedPatchLines() : renderedPatchLines().slice(0, GIT_PATCH_PREVIEW_LINES));
  const hasMorePatchLines = createMemo(() => renderedPatchLines().length > GIT_PATCH_PREVIEW_LINES);
  const canCopyPatch = createMemo(() => hasMeaningfulGitPatchText(patchText()) && !patchLoading() && !patchError());
  const unavailableMessage = createMemo(() => {
    const item = props.item;
    if (!item) return '';
    if (typeof props.unavailableMessage === 'function') return String(props.unavailableMessage(item) ?? '');
    return String(props.unavailableMessage ?? '');
  });

  const resetPatchState = () => {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
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

  createEffect(() => {
    itemIdentity(props.item);
    const item = props.item;
    if (!item) {
      resetPatchState();
      return;
    }
    if (item.isBinary || unavailableMessage()) {
      resetPatchState();
      return;
    }
    resetPatchState();
    const controller = new AbortController();
    activeAbort = controller;
    const seq = ++patchReqSeq;
    setPatchLoading(true);
    setPatchError('');
    void (async () => {
      try {
        const resp = await props.loadPatch(item, controller.signal);
        if (seq !== patchReqSeq) return;
        setPatchText(resp.text);
        setPatchTruncated(Boolean(resp.truncated));
      } catch (err) {
        if (controller.signal.aborted || seq !== patchReqSeq) return;
        setPatchError(err instanceof Error ? err.message : String(err ?? 'Failed to load patch'));
      } finally {
        if (seq === patchReqSeq) {
          setPatchLoading(false);
        }
        if (activeAbort === controller) {
          activeAbort = null;
        }
      }
    })();
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

  return (
    <div class={props.class}>
      <Show when={props.item} fallback={<div class="chat-tool-apply-patch-detail-empty">{props.emptyMessage}</div>}>
        {(fileAccessor) => {
          const file = fileAccessor();
          return (
            <div class="chat-tool-apply-patch-detail-panel">
              <div class="chat-tool-apply-patch-detail-head">
                <div class="chat-tool-apply-patch-detail-main">
                  <span class={`chat-tool-apply-patch-change ${gitChangeClass(file.changeType)}`}>
                    {gitChangeLabel(file.changeType)}
                  </span>
                  <span class="chat-tool-apply-patch-detail-path" title={changeDisplayPath(file)}>
                    {changeDisplayPath(file)}
                  </span>
                  <span class="chat-tool-apply-patch-detail-metrics">
                    {changeMetricsText(file)}
                    <Show when={file.isBinary}>
                      <> · Binary</>
                    </Show>
                  </span>
                </div>
                <Button size="xs" variant="ghost" onClick={() => void handleCopyPatch()} disabled={!canCopyPatch()}>
                  {copied() ? 'Copied' : 'Copy Patch'}
                </Button>
              </div>

              <Show when={file.oldPath && file.newPath && file.oldPath !== file.newPath}>
                <div class="chat-tool-apply-patch-rename-row">
                  <span class="chat-tool-apply-patch-rename-path" title={file.oldPath}>{file.oldPath}</span>
                  <span class="chat-tool-apply-patch-rename-arrow">→</span>
                  <span class="chat-tool-apply-patch-rename-path" title={file.newPath}>{file.newPath}</span>
                </div>
              </Show>

              <Show when={!file.isBinary && !unavailableMessage()} fallback={<div class="chat-tool-apply-patch-detail-empty">{unavailableMessage() || 'Binary file changed. Inline text diff is not available.'}</div>}>
                <Show when={!patchLoading()} fallback={<div class="chat-tool-apply-patch-detail-empty flex items-center gap-2"><SnakeLoader size="sm" /><span>Loading patch...</span></div>}>
                  <Show when={!patchError()} fallback={<div class="chat-tool-apply-patch-error">{patchError()}</div>}>
                    <Show when={visiblePatchLines().length > 0} fallback={<div class="chat-tool-apply-patch-detail-empty">No inline diff lines available for this file.</div>}>
                      <div class="chat-tool-apply-patch-detail-code">
                        <For each={visiblePatchLines()}>
                          {(line) => (
                            <div class={`chat-tool-apply-patch-detail-line ${gitPatchRenderedLineClass(line)}`}>
                              <span class="chat-tool-apply-patch-detail-line-num">{formatGitPatchLineNumber(line.oldLine)}</span>
                              <span class="chat-tool-apply-patch-detail-line-num">{formatGitPatchLineNumber(line.newLine)}</span>
                              <span class={`chat-tool-apply-patch-detail-line-text ${gitPatchPreviewLineClass(line.text)}`}>{line.text}</span>
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
                        <button type="button" class="chat-tool-apply-patch-toggle-btn cursor-pointer" onClick={() => setPatchExpanded((value) => !value)}>
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
  );
}
