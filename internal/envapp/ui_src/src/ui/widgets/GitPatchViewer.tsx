import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn, useLayout, useNotification } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitDiffFileContent } from '../protocol/redeven_v1';
import {
  GIT_PATCH_PREVIEW_LINES,
  formatGitPatchLineNumber,
  getGitPatchRenderSnapshot,
  gitPatchPreviewLineClass,
  gitPatchRenderedLineClass,
} from '../utils/gitPatch';
import { hasMeaningfulGitPatchText } from '../utils/gitPatchText';
import { changeDisplayPath, changeMetricsText } from '../utils/gitWorkbench';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { gitToneActionButtonClass } from './GitChrome';
import { GitChangeStatusPill, GitMetaPill } from './GitWorkbenchPrimitives';

export type GitPatchRenderable = GitDiffFileContent;

export interface GitPatchViewerProps {
  item: GitPatchRenderable | null | undefined;
  emptyMessage: string;
  unavailableMessage?: string | ((item: GitPatchRenderable) => string | undefined);
  class?: string;
  showCopyButton?: boolean;
  showMobileHint?: boolean;
  desktopPatchViewportClass?: string;
  mobilePatchViewportClass?: string;
}

export function GitPatchViewer(props: GitPatchViewerProps) {
  const layout = useLayout();
  const notification = useNotification();
  const [patchExpanded, setPatchExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const patchText = createMemo(() => String(props.item?.patchText ?? ''));
  const patchTruncated = createMemo(() => Boolean(props.item?.patchTruncated));
  const patchSnapshot = createMemo(() => getGitPatchRenderSnapshot(patchText()));
  const renderedPatchLines = createMemo(() => patchSnapshot().renderedLines);
  const visiblePatchLines = createMemo(() => patchExpanded() ? renderedPatchLines() : renderedPatchLines().slice(0, GIT_PATCH_PREVIEW_LINES));
  const hasMorePatchLines = createMemo(() => renderedPatchLines().length > GIT_PATCH_PREVIEW_LINES);
  const canCopyPatch = createMemo(() => hasMeaningfulGitPatchText(patchText()));
  const showCopyButton = createMemo(() => props.showCopyButton !== false);
  const showMobileHint = createMemo(() => props.showMobileHint !== false);
  const desktopPatchViewportClass = createMemo(() => props.desktopPatchViewportClass ?? 'max-h-[28rem]');
  const mobilePatchViewportClass = createMemo(() => props.mobilePatchViewportClass ?? 'flex-1 max-h-none');
  const unavailableMessage = createMemo(() => {
    const item = props.item;
    if (!item) return '';
    if (typeof props.unavailableMessage === 'function') return String(props.unavailableMessage(item) ?? '');
    return String(props.unavailableMessage ?? '');
  });

  createEffect(() => {
    void props.item?.path;
    void props.item?.oldPath;
    void props.item?.newPath;
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
    <div class={cn('min-h-0', props.class)}>
      <Show when={props.item} fallback={<div class={cn('rounded-md border px-3 py-2 text-xs leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>{props.emptyMessage}</div>}>
        {(fileAccessor) => {
          const file = fileAccessor();
          return (
            <div class={cn('flex h-full min-h-0 flex-col gap-3 rounded-md border p-3', redevenSurfaceRoleClass('panelStrong'))}>
              <div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <GitChangeStatusPill change={file.changeType} />
                    <GitMetaPill tone="neutral">{changeMetricsText(file)}</GitMetaPill>
                    <span class="min-w-0 max-w-full truncate font-mono text-[11px] text-foreground/90" title={changeDisplayPath(file)}>
                      {changeDisplayPath(file)}
                    </span>
                    <Show when={file.isBinary}>
                      <GitMetaPill tone="warning">Binary</GitMetaPill>
                    </Show>
                  </div>
                </div>

                <Show when={showCopyButton()}>
                  <Button size="xs" variant="ghost" class={cn('self-start', gitToneActionButtonClass())} onClick={() => void handleCopyPatch()} disabled={!canCopyPatch()}>
                    {copied() ? 'Copied' : 'Copy Patch'}
                  </Button>
                </Show>
              </div>

              <Show when={file.oldPath && file.newPath && file.oldPath !== file.newPath}>
                <div class={cn('flex min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground', redevenSurfaceRoleClass('inset'))}>
                  <span class="min-w-0 truncate font-mono" title={file.oldPath}>{file.oldPath}</span>
                  <span aria-hidden="true" class="text-muted-foreground/60">→</span>
                  <span class="min-w-0 truncate font-mono" title={file.newPath}>{file.newPath}</span>
                </div>
              </Show>

              <Show when={layout.isMobile() && showMobileHint()}>
                <div class="text-[11px] leading-5 text-muted-foreground">Swipe horizontally to inspect long diff lines.</div>
              </Show>

              <Show
                when={!file.isBinary && !unavailableMessage()}
                fallback={<div class={cn('rounded-md border px-3 py-2 text-[11px] leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>{unavailableMessage() || 'Binary file changed. Inline text diff is not available.'}</div>}
              >
                <Show when={visiblePatchLines().length > 0} fallback={<div class={cn('rounded-md border px-3 py-2 text-[11px] leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>No inline diff lines available for this file.</div>}>
                  <div
                    {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
                    class={cn(
                      'min-h-0 overflow-auto rounded-md border bg-background p-1 [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y_pinch-zoom]',
                      redevenSurfaceRoleClass('control'),
                      layout.isMobile() ? mobilePatchViewportClass() : desktopPatchViewportClass()
                    )}
                  >
                    <div class="inline-block min-w-full bg-muted/[0.20] p-px align-top">
                      <For each={visiblePatchLines()}>
                        {(line) => (
                          <div class={cn('grid w-max min-w-full grid-cols-[2.25rem_2.25rem_minmax(max-content,1fr)] items-stretch sm:grid-cols-[2.5rem_2.5rem_minmax(max-content,1fr)]', gitPatchRenderedLineClass(line))}>
                            <span class="px-1.5 text-right font-mono text-[10.5px] leading-[1.6] text-muted-foreground/60">{formatGitPatchLineNumber(line.oldLine)}</span>
                            <span class={cn('border-r px-1.5 text-right font-mono text-[10.5px] leading-[1.6] text-muted-foreground/60', redevenDividerRoleClass())}>{formatGitPatchLineNumber(line.newLine)}</span>
                            <span class={cn('block px-2 pr-3 text-[10.5px] leading-[1.6] whitespace-pre font-mono sm:px-2.5 sm:pr-4 sm:text-[11px]', gitPatchPreviewLineClass(line.text))}>{line.text}</span>
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
                      class={cn('cursor-pointer rounded-md border px-2.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1 sm:py-1', redevenSurfaceRoleClass('controlMuted'))}
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
