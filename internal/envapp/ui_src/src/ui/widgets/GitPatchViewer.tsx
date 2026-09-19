import { writeTextToClipboard } from '../utils/clipboard';
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { cn, useLayout, useNotification } from '@floegence/floe-webapp-core';
import { Button, LOCAL_INTERACTION_SURFACE_ATTR } from '@floegence/floe-webapp-core/ui';
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
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { gitToneActionButtonClass } from './GitChrome';
import { GitChangeMetrics, GitChangeStatusPill, GitMetaPill } from './GitWorkbenchPrimitives';
import { useI18n } from '../i18n';

export type GitPatchRenderable = GitDiffFileContent;

export interface GitPatchViewerProps {
  item: GitPatchRenderable | null | undefined;
  emptyMessage: string;
  unavailableMessage?: string | ((item: GitPatchRenderable) => string | undefined);
  class?: string;
  fillViewport?: boolean;
  showCopyButton?: boolean;
  showMobileHint?: boolean;
  desktopPatchViewportClass?: string;
  mobilePatchViewportClass?: string;
}

type PatchScrollMetrics = {
  clientWidth: number;
  trackWidth: number;
  scrollLeft: number;
  scrollWidth: number;
};

const EMPTY_PATCH_SCROLL_METRICS: PatchScrollMetrics = {
  clientWidth: 0,
  trackWidth: 0,
  scrollLeft: 0,
  scrollWidth: 0,
};

export function GitPatchViewer(props: GitPatchViewerProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const notification = useNotification();
  const [patchExpanded, setPatchExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [patchScrollMetrics, setPatchScrollMetrics] = createSignal<PatchScrollMetrics>(EMPTY_PATCH_SCROLL_METRICS);
  const viewportId = createUniqueId();
  let patchViewport: HTMLDivElement | undefined;
  let patchScrollbarTrack: HTMLDivElement | undefined;
  let patchResizeObserver: ResizeObserver | undefined;
  let patchMetricsFrame: number | undefined;

  const patchText = createMemo(() => String(props.item?.patchText ?? ''));
  const patchTruncated = createMemo(() => Boolean(props.item?.patchTruncated));
  const patchSnapshot = createMemo(() => getGitPatchRenderSnapshot(patchText()));
  const renderedPatchLines = createMemo(() => patchSnapshot().renderedLines);
  const visiblePatchLines = createMemo(() => patchExpanded() ? renderedPatchLines() : renderedPatchLines().slice(0, GIT_PATCH_PREVIEW_LINES));
  const hasMorePatchLines = createMemo(() => renderedPatchLines().length > GIT_PATCH_PREVIEW_LINES);
  const canCopyPatch = createMemo(() => hasMeaningfulGitPatchText(patchText()));
  const showCopyButton = createMemo(() => props.showCopyButton !== false);
  const showMobileHint = createMemo(() => props.showMobileHint !== false);
  const desktopPatchViewportClass = createMemo(() => props.desktopPatchViewportClass ?? (props.fillViewport ? 'flex-1 max-h-none' : 'max-h-[28rem]'));
  const mobilePatchViewportClass = createMemo(() => props.mobilePatchViewportClass ?? 'flex-1 max-h-none');
  const unavailableMessage = createMemo(() => {
    const item = props.item;
    if (!item) return '';
    if (typeof props.unavailableMessage === 'function') return String(props.unavailableMessage(item) ?? '');
    return String(props.unavailableMessage ?? '');
  });
  const patchUnavailableMessage = createMemo(() => (
    props.item?.isBinary ? i18n.t('git.patchViewer.binaryDiffUnavailable') : unavailableMessage()
  ));

  const syncPatchScrollMetrics = () => {
    const viewport = patchViewport;
    if (!viewport) {
      setPatchScrollMetrics(EMPTY_PATCH_SCROLL_METRICS);
      return;
    }
    setPatchScrollMetrics({
      clientWidth: viewport.clientWidth,
      trackWidth: patchScrollbarTrack?.clientWidth ?? viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth,
    });
  };

  const schedulePatchScrollMetrics = () => {
    if (patchMetricsFrame !== undefined) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      syncPatchScrollMetrics();
      return;
    }
    patchMetricsFrame = window.requestAnimationFrame(() => {
      patchMetricsFrame = undefined;
      syncPatchScrollMetrics();
    });
  };

  const setPatchScrollLeft = (nextScrollLeft: number) => {
    const viewport = patchViewport;
    if (!viewport) return;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = Math.max(0, Math.min(maximum, nextScrollLeft));
    syncPatchScrollMetrics();
  };

  const horizontalScrollMaximum = createMemo(() => {
    const metrics = patchScrollMetrics();
    return Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  });
  const horizontalScrollbarVisible = createMemo(() => horizontalScrollMaximum() > 1);
  const horizontalThumbSize = createMemo(() => {
    const metrics = patchScrollMetrics();
    if (metrics.scrollWidth <= 0) return 100;
    return Math.min(100, Math.max(28 / Math.max(1, metrics.trackWidth), metrics.clientWidth / metrics.scrollWidth) * 100);
  });
  const horizontalThumbStart = createMemo(() => {
    const maximum = horizontalScrollMaximum();
    if (maximum <= 0) return 0;
    return Math.max(0, Math.min(1, patchScrollMetrics().scrollLeft / maximum)) * (100 - horizontalThumbSize());
  });

  const handlePatchScrollbarTrackPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !patchScrollbarTrack) return;
    event.preventDefault();
    patchScrollbarTrack.focus({ preventScroll: true });
    const trackBounds = patchScrollbarTrack.getBoundingClientRect();
    const thumb = patchScrollbarTrack.querySelector<HTMLElement>('[data-git-horizontal-scrollbar-thumb]');
    const thumbWidth = thumb?.getBoundingClientRect().width
      ?? (trackBounds.width * (horizontalThumbSize() / 100));
    const trackTravel = Math.max(1, trackBounds.width - thumbWidth);
    const target = Math.max(0, Math.min(trackTravel, event.clientX - trackBounds.left - (thumbWidth / 2)));
    setPatchScrollLeft((target / trackTravel) * horizontalScrollMaximum());
  };

  let thumbDragStartX = 0;
  let thumbDragStartScrollLeft = 0;

  const handlePatchScrollbarThumbPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !patchScrollbarTrack) return;
    const thumb = event.currentTarget as HTMLDivElement;
    patchScrollbarTrack.focus({ preventScroll: true });
    thumbDragStartX = event.clientX;
    thumbDragStartScrollLeft = patchScrollMetrics().scrollLeft;
    thumb.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePatchScrollbarThumbPointerMove = (event: PointerEvent) => {
    const thumb = event.currentTarget as HTMLDivElement;
    if (!thumb.hasPointerCapture(event.pointerId) || !patchScrollbarTrack) return;
    const trackTravel = Math.max(1, patchScrollbarTrack.getBoundingClientRect().width - thumb.getBoundingClientRect().width);
    const scrollDelta = ((event.clientX - thumbDragStartX) / trackTravel) * horizontalScrollMaximum();
    setPatchScrollLeft(thumbDragStartScrollLeft + scrollDelta);
  };

  const handlePatchScrollbarThumbPointerUp = (event: PointerEvent) => {
    const thumb = event.currentTarget as HTMLDivElement;
    if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
  };

  const handlePatchScrollbarKeyDown = (event: KeyboardEvent) => {
    const metrics = patchScrollMetrics();
    const step = 48;
    let nextScrollLeft: number | undefined;
    switch (event.key) {
      case 'ArrowLeft':
        nextScrollLeft = metrics.scrollLeft - step;
        break;
      case 'ArrowRight':
        nextScrollLeft = metrics.scrollLeft + step;
        break;
      case 'Home':
        nextScrollLeft = 0;
        break;
      case 'End':
        nextScrollLeft = horizontalScrollMaximum();
        break;
      case 'PageUp':
        nextScrollLeft = metrics.scrollLeft - metrics.clientWidth;
        break;
      case 'PageDown':
        nextScrollLeft = metrics.scrollLeft + metrics.clientWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPatchScrollLeft(nextScrollLeft);
  };

  const setPatchViewportRef = (node: HTMLDivElement) => {
    patchViewport = node;
    schedulePatchScrollMetrics();
  };

  createEffect(() => {
    // Content can widen after loading Full Context, expanding lines, or font loading.
    void visiblePatchLines();
    patchResizeObserver?.disconnect();
    if (patchViewport && typeof ResizeObserver !== 'undefined') {
      patchResizeObserver = new ResizeObserver(schedulePatchScrollMetrics);
      patchResizeObserver.observe(patchViewport);
      if (patchViewport.firstElementChild) patchResizeObserver.observe(patchViewport.firstElementChild);
      if (patchScrollbarTrack) patchResizeObserver.observe(patchScrollbarTrack);
    }
    schedulePatchScrollMetrics();
  });

  createEffect(() => {
    void props.item?.path;
    void props.item?.oldPath;
    void props.item?.newPath;
    setPatchExpanded(false);
    setCopied(false);
    if (patchViewport) {
      patchViewport.scrollTop = 0;
      patchViewport.scrollLeft = 0;
    }
    schedulePatchScrollMetrics();
  });

  onCleanup(() => {
    patchResizeObserver?.disconnect();
    if (patchMetricsFrame !== undefined && typeof window !== 'undefined') {
      window.cancelAnimationFrame(patchMetricsFrame);
    }
  });

  const handleCopyPatch = async () => {
    const text = patchText();
    if (!text || !navigator?.clipboard?.writeText) return;
    try {
      await writeTextToClipboard(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      notification.error(i18n.t('git.patchViewer.copyFailedTitle'), i18n.t('git.patchViewer.copyPatchFailed'));
    }
  };

  return (
    <div class={cn('min-h-0', props.class)}>
      <Show when={props.item} fallback={<div class={cn('rounded-md border px-3 py-2 text-xs leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>{props.emptyMessage}</div>}>
        {(fileAccessor) => {
          const file = fileAccessor;
          return (
            <div class={cn("flex h-full min-h-0 flex-col gap-3 rounded-md bg-muted/[0.08] p-3", props.fillViewport && "git-patch-viewer--embedded")}>
              <div class="git-patch-viewer__toolbar flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <GitChangeStatusPill change={file().changeType} />
                    <Show when={props.fillViewport} fallback={<GitMetaPill tone="neutral">{changeMetricsText(file())}</GitMetaPill>}>
                      <GitChangeMetrics compact additions={file().additions} deletions={file().deletions} />
                    </Show>
                    <Show when={!props.fillViewport}>
                      <span class="min-w-0 max-w-full truncate font-mono text-[11px] text-foreground/90" title={changeDisplayPath(file())}>
                        {changeDisplayPath(file())}
                      </span>
                    </Show>
                    <Show when={file().isBinary}>
                      <GitMetaPill tone="warning">{i18n.t('git.patchViewer.binaryBadge')}</GitMetaPill>
                    </Show>
                  </div>
                </div>

                <Show when={showCopyButton()}>
                  <Button size="xs" variant="ghost" class={cn('self-start', gitToneActionButtonClass())} onClick={() => void handleCopyPatch()} disabled={!canCopyPatch()}>
                    {copied() ? i18n.t('common.actions.copied') : i18n.t('git.patchViewer.copyPatch')}
                  </Button>
                </Show>
              </div>

              <Show when={file().oldPath && file().newPath && file().oldPath !== file().newPath}>
                <div class={cn('flex min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground', redevenSurfaceRoleClass('inset'))}>
                  <span class="min-w-0 truncate font-mono" title={file().oldPath}>{file().oldPath}</span>
                  <span aria-hidden="true" class="text-muted-foreground/60">→</span>
                  <span class="min-w-0 truncate font-mono" title={file().newPath}>{file().newPath}</span>
                </div>
              </Show>

              <Show when={layout.isMobile() && showMobileHint()}>
                <div class="text-[11px] leading-5 text-muted-foreground">{i18n.t('git.patchViewer.mobileHorizontalHint')}</div>
              </Show>

              <Show
                when={!file().isBinary && !patchUnavailableMessage()}
                fallback={<div class={cn('rounded-md border px-3 py-2 text-[11px] leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>{patchUnavailableMessage()}</div>}
              >
                <Show when={visiblePatchLines().length > 0} fallback={<div class={cn('rounded-md border px-3 py-2 text-[11px] leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>{i18n.t('git.patchViewer.noInlineDiffLines')}</div>}>
                  <div
                    id={viewportId}
                    ref={setPatchViewportRef}
                    {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
                    onScroll={syncPatchScrollMetrics}
                    class={cn(
                      'git-patch-viewer__viewport min-h-0 overflow-auto rounded-md border bg-background p-1 [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y_pinch-zoom]',
                      redevenSurfaceRoleClass('control'),
                      layout.isMobile() ? mobilePatchViewportClass() : desktopPatchViewportClass()
                    )}
                  >
                    <div class="inline-block min-w-full bg-muted/[0.20] p-px align-top">
                      <For each={visiblePatchLines()}>
                        {(line) => (
                          <div class={cn('grid w-max min-w-full grid-cols-[2.25rem_2.25rem_minmax(max-content,1fr)] items-stretch sm:grid-cols-[2.5rem_2.5rem_minmax(max-content,1fr)]', gitPatchRenderedLineClass(line))}>
                            <span class={cn("px-1.5 text-right font-mono text-muted-foreground/60", props.fillViewport ? "text-[11px] leading-5" : "text-[10.5px] leading-[1.6]")}>{formatGitPatchLineNumber(line.oldLine)}</span>
                            <span class={cn('border-r px-1.5 text-right font-mono text-muted-foreground/60', props.fillViewport ? 'text-[11px] leading-5' : 'text-[10.5px] leading-[1.6]', redevenDividerRoleClass())}>{formatGitPatchLineNumber(line.newLine)}</span>
                            <span class={cn('block px-2 pr-3 whitespace-pre font-mono sm:px-2.5 sm:pr-4', props.fillViewport ? 'text-xs leading-5' : 'text-[10.5px] leading-[1.6] sm:text-[11px]', gitPatchPreviewLineClass(line.text))}>{line.text}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                  <Show when={horizontalScrollbarVisible()}>
                    <div
                      ref={(node) => {
                        patchScrollbarTrack = node;
                        patchResizeObserver?.observe(node);
                        schedulePatchScrollMetrics();
                      }}
                      {...{ [LOCAL_INTERACTION_SURFACE_ATTR]: 'true' }}
                      {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
                      aria-controls={viewportId}
                      aria-label={i18n.t('git.patchViewer.horizontalScrollbar')}
                      aria-orientation="horizontal"
                      aria-valuemax={Math.round(horizontalScrollMaximum())}
                      aria-valuemin="0"
                      aria-valuenow={Math.round(patchScrollMetrics().scrollLeft)}
                      data-git-horizontal-scrollbar="true"
                      role="scrollbar"
                      tabIndex={0}
                      class="git-patch-viewer__horizontal-scrollbar"
                      onKeyDown={handlePatchScrollbarKeyDown}
                      onPointerDown={handlePatchScrollbarTrackPointerDown}
                    >
                      <div
                        aria-hidden="true"
                        data-git-horizontal-scrollbar-thumb="true"
                        class="git-patch-viewer__horizontal-scrollbar-thumb"
                        onPointerDown={handlePatchScrollbarThumbPointerDown}
                        onPointerMove={handlePatchScrollbarThumbPointerMove}
                        onPointerUp={handlePatchScrollbarThumbPointerUp}
                        onPointerCancel={handlePatchScrollbarThumbPointerUp}
                        style={{
                          left: `${horizontalThumbStart()}%`,
                          width: `${horizontalThumbSize()}%`,
                        }}
                      />
                    </div>
                  </Show>
                </Show>

                <Show when={patchTruncated()}>
                  <div class="text-[11px] text-muted-foreground">{i18n.t('git.patchViewer.patchPreviewTruncated')}</div>
                </Show>

                <Show when={hasMorePatchLines()}>
                  <div class="flex justify-center pt-0.5">
                    <button
                      type="button"
                      class={cn('cursor-pointer rounded-md border px-2.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1 sm:py-1', redevenSurfaceRoleClass('controlMuted'))}
                      onClick={() => setPatchExpanded((value) => !value)}
                    >
                      {patchExpanded() ? i18n.t('git.patchViewer.showLess') : i18n.tn('git.patchViewer.showAllLines', renderedPatchLines().length)}
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
