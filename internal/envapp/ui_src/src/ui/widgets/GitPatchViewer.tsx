import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
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
import { hasMeaningfulGitPatchText } from '../utils/gitPatchText';
import { changeDisplayPath, changeMetricsText } from '../utils/gitWorkbench';
import { gitToneActionButtonClass } from './GitChrome';

export type GitPatchRenderable = GitCommitFileSummary | GitWorkspaceChange;

export interface GitPatchViewerProps<T extends GitPatchRenderable> {
  item: T | null | undefined;
  emptyMessage: string;
  unavailableMessage?: string | ((item: T) => string | undefined);
  class?: string;
}

export function GitPatchViewer<T extends GitPatchRenderable>(props: GitPatchViewerProps<T>) {
  const notification = useNotification();
  const [patchExpanded, setPatchExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const patchText = createMemo(() => String(props.item?.patchText ?? ''));
  const patchTruncated = createMemo(() => Boolean(props.item?.patchTruncated));
  const renderedPatchLines = createMemo(() => parseGitPatchRenderedLines(patchText()));
  const visiblePatchLines = createMemo(() => patchExpanded() ? renderedPatchLines() : renderedPatchLines().slice(0, GIT_PATCH_PREVIEW_LINES));
  const hasMorePatchLines = createMemo(() => renderedPatchLines().length > GIT_PATCH_PREVIEW_LINES);
  const canCopyPatch = createMemo(() => hasMeaningfulGitPatchText(patchText()));
  const unavailableMessage = createMemo(() => {
    const item = props.item;
    if (!item) return '';
    if (typeof props.unavailableMessage === 'function') return String(props.unavailableMessage(item) ?? '');
    return String(props.unavailableMessage ?? '');
  });

  createEffect(() => {
    props.item?.path;
    props.item?.oldPath;
    props.item?.newPath;
    setPatchExpanded(false);
    setCopied(false);
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
      <Show when={props.item} fallback={<div class="rounded-md bg-background/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">{props.emptyMessage}</div>}>
        {(fileAccessor) => {
          const file = fileAccessor();
          return (
            <div class="space-y-2 rounded-md bg-muted/[0.16] p-2 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span class={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', gitChangeClass(file.changeType))}>
                      {gitChangeLabel(file.changeType)}
                    </span>
                    <span class="min-w-0 max-w-full truncate font-mono text-[11px] text-foreground/90" title={changeDisplayPath(file)}>
                      {changeDisplayPath(file)}
                    </span>
                    <span class="text-[10px] text-muted-foreground">
                      {changeMetricsText(file)}
                      <Show when={file.isBinary}>
                        <> · Binary</>
                      </Show>
                    </span>
                  </div>
                </div>

                <Button size="xs" variant="ghost" class={gitToneActionButtonClass()} onClick={() => void handleCopyPatch()} disabled={!canCopyPatch()}>
                  {copied() ? 'Copied' : 'Copy Patch'}
                </Button>
              </div>

              <Show when={file.oldPath && file.newPath && file.oldPath !== file.newPath}>
                <div class="flex min-w-0 items-center gap-1.5 rounded-md bg-background/70 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
                  <span class="min-w-0 truncate font-mono" title={file.oldPath}>{file.oldPath}</span>
                  <span aria-hidden="true" class="text-muted-foreground/60">→</span>
                  <span class="min-w-0 truncate font-mono" title={file.newPath}>{file.newPath}</span>
                </div>
              </Show>

              <Show
                when={!file.isBinary && !unavailableMessage()}
                fallback={<div class="rounded-md bg-background/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">{unavailableMessage() || 'Binary file changed. Inline text diff is not available.'}</div>}
              >
                <Show when={visiblePatchLines().length > 0} fallback={<div class="rounded-md bg-background/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">No inline diff lines available for this file.</div>}>
                  <div class="max-h-[60vh] overflow-auto rounded-md bg-background/78 p-0.5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:max-h-[28rem]">
                    <div class="bg-muted/[0.20] p-px">
                      <For each={visiblePatchLines()}>
                        {(line) => (
                          <div class={cn('grid grid-cols-[2.5rem_2.5rem_minmax(0,1fr)] items-stretch overflow-hidden', gitPatchRenderedLineClass(line))}>
                            <span class="px-1.5 text-right font-mono text-[10.5px] leading-[1.6] text-muted-foreground/60">{formatGitPatchLineNumber(line.oldLine)}</span>
                            <span class="border-r border-border/20 px-1.5 text-right font-mono text-[10.5px] leading-[1.6] text-muted-foreground/60">{formatGitPatchLineNumber(line.newLine)}</span>
                            <span class={cn('block min-w-0 px-2.5 font-mono text-[11px] leading-[1.6] whitespace-pre', gitPatchPreviewLineClass(line.text))}>{line.text}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={patchTruncated()}>
                  <div class="text-[11px] text-muted-foreground">Patch preview is truncated.</div>
                </Show>

                <Show when={hasMorePatchLines()}>
                  <div class="flex justify-center pt-0.5">
                    <button
                      type="button"
                      class="cursor-pointer rounded-md bg-background/78 px-2.5 py-2 text-[11px] font-medium text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-colors duration-150 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1 sm:py-1"
                      onClick={() => setPatchExpanded((value) => !value)}
                    >
                      {patchExpanded() ? 'Show less' : `Show all ${renderedPatchLines().length} lines`}
                    </button>
                  </div>
                </Show>
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
