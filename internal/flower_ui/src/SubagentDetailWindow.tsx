import { FeedbackIndicator, Button, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, ChevronDown, Clock, Refresh } from '@floegence/floe-webapp-core/icons';

import type { FlowerSubagentsCopy } from './copy';
import { SubagentAvatar } from './SubagentAvatar';
import { FlowerThreadWave } from './FlowerThreadWave';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerSubagentPanelStatus } from './flowerSubagentProjection';

export type SubagentDetailWindowProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadID: string;
  title: string;
  status: FlowerSubagentPanelStatus;
  statusLabel: string;
  statusIndicator: JSX.Element;
  agentSwitcher?: JSX.Element;
  syncNotice?: JSX.Element;
  progressDock?: JSX.Element;
  elapsedLabel: string;
  description: string;
  loading: boolean;
  preparing?: boolean;
  preparationNotice?: JSX.Element;
  error: string;
  detailAvailable: boolean;
  entries: readonly FlowerTimelineEntry[];
  inputControls?: JSX.Element;
  contextIndicator?: JSX.Element;
  renderTimeline: () => JSX.Element;
  bindScroll: (node: HTMLDivElement) => void;
  onScroll: () => void;
  onWheel: (event: WheelEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  latestPointerBlocked?: boolean;
  showScrollToLatest: boolean;
  onScrollToLatest: () => void;
  onRetryLoad: () => void;
  viewportLeftInset: number;
  zIndex: number;
  threadLoadingLabel: string;
  scrollToLatestLabel: string;
  copy: FlowerSubagentsCopy;
}>;

export function SubagentDetailWindow(props: SubagentDetailWindowProps): JSX.Element {
  let overview: HTMLElement | undefined;
  return (
    <FloatingWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={[props.title, props.description].filter(Boolean).join(' · ')}
      titleIcon={<SubagentAvatar threadID={props.threadID} class="flower-subagent-detail-avatar" />}
      class="flower-subagent-detail-window"
      defaultSize={{ width: 820, height: 680 }}
      minSize={{ width: 480, height: 360 }}
      viewportInsets={{ top: 56, right: 12, bottom: 12, left: props.viewportLeftInset }}
      resizable
      draggable
      zIndex={props.zIndex}
    >
      <div
        class="flower-subagent-detail-surface"
        data-flower-subagent-detail="open"
        data-flower-subagent-status={props.status}
      >
        <header ref={overview} tabIndex={-1} class="flower-subagent-detail-overview">
          {props.agentSwitcher}
          <div class="flower-subagent-detail-overview-meta">
            <div class="flower-subagent-detail-context">{props.contextIndicator}</div>
            <FeedbackIndicator label={props.title} closeLabel={props.copy.feedbackClose} restoreFocus={() => overview} entries={props.detailAvailable && props.error ? [{ id: 'detail', severity: 'error', summary: props.error, actions: <Button size="sm" variant="outline" disabled={props.loading} onClick={props.onRetryLoad}>{props.copy.detailRetry}</Button> }] : []} />
            <span class={cn('flower-subagent-status-label', `flower-subagent-status-label-${props.status}`)}>
              {props.statusIndicator}
              <span class="flower-subagent-status-text">
                {props.statusLabel}
              </span>
            </span>
            <Show when={props.elapsedLabel}>
              <span class="flower-subagent-detail-elapsed">
                <Clock class="h-3 w-3" aria-hidden="true" />
                <span>{props.elapsedLabel}</span>
              </span>
            </Show>
          </div>
        </header>
        <div class="flower-subagent-detail-transcript-region">
          <div class="flower-chat-notices">
            {props.syncNotice}
            <Show when={props.preparationNotice}>{props.preparationNotice}</Show>
            <Show when={!props.error && (props.loading && !props.detailAvailable || props.preparing && !props.preparationNotice)}>
              <div class="flower-subagent-detail-loading flower-chat-notice" role="status" aria-live="polite" aria-label={props.threadLoadingLabel}>
                <FlowerThreadWave /><span>{props.threadLoadingLabel}</span>
              </div>
            </Show>

            <Show when={props.error && !props.detailAvailable}>
              <div class="flower-subagent-detail-state flower-subagent-detail-state-error flower-chat-notice" role="alert">
                <AlertTriangle class="h-4 w-4" />
                <div class="flower-subagent-detail-state-copy">
                  <span>{props.error}</span>
                  <button type="button" class="flower-subagent-detail-retry" onClick={props.onRetryLoad}>
                    <Refresh class="h-3.5 w-3.5" />
                    <span>{props.copy.detailRetry}</span>
                  </button>
                </div>
              </div>
            </Show>
          </div>
        <Show when={props.detailAvailable}>
          <div
            ref={props.bindScroll}
            class="flower-subagent-detail-transcript"
            data-flower-tail-preparing={props.preparing ? 'true' : undefined}
            aria-busy={props.preparing ? 'true' : undefined}
            role="list"
            aria-label={props.copy.detailTimelineLabel}
            onScroll={props.onScroll}
            onWheel={props.onWheel}
            onPointerDown={props.onPointerDown}
            onTouchMove={props.onTouchMove}
            onKeyDown={props.onKeyDown}
            tabIndex={0}
          >
            <div class="flower-subagent-detail-timeline" inert={props.preparing}>
              <Show
                when={props.entries.length > 0}
                fallback={<div class="flower-subagent-detail-empty">{props.copy.emptyDescription}</div>}
              >
                {props.renderTimeline()}
              </Show>
              {props.inputControls}
            </div>
            <Show when={props.showScrollToLatest}>
              <div class="flower-subagent-detail-scroll-to-latest">
                <button
                  type="button"
                  class="flower-scroll-to-latest-button"
                  data-flower-scroll-to-latest
                  data-pointer-blocked={props.latestPointerBlocked ? 'true' : undefined}
                  aria-label={props.scrollToLatestLabel}
                  title={props.scrollToLatestLabel}
                  onClick={props.onScrollToLatest}
                >
                  <ChevronDown class="h-4 w-4" />
                </button>
              </div>
            </Show>
          </div>
        </Show>

        </div>
        <Show when={props.progressDock}>
          <div class="flower-subagent-detail-progress-dock">
            {props.progressDock}
          </div>
        </Show>
      </div>
    </FloatingWindow>
  );
}
