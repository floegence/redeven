import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export type ActivityStatus = 'pending' | 'running' | 'success' | 'error' | 'info';

export interface ActivityStatusIconProps {
  status: ActivityStatus;
  class?: string;
}

export interface ActivityLineProps {
  status: ActivityStatus;
  title: string;
  meta?: string;
  detail?: string;
  expanded?: boolean;
  expandable?: boolean;
  controls?: string;
  onToggle?: () => void;
  children?: JSX.Element;
  class?: string;
}

export function formatActivityDuration(durationMs: number | undefined): string | undefined {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export const ActivityStatusIcon: Component<ActivityStatusIconProps> = (props) => (
  <span
    class={cn(
      'chat-activity-status-icon',
      `chat-activity-status-icon-${props.status}`,
      props.class,
    )}
    aria-hidden="true"
  >
    <Show
      when={props.status !== 'running'}
      fallback={<span class="chat-activity-running-dot" />}
    >
      <Show
        when={props.status === 'success'}
        fallback={
          <Show
            when={props.status === 'error'}
            fallback={
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="3" />
              </svg>
            }
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" />
            </svg>
          </Show>
        }
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.75 8.25 6.6 11 12.25 5" />
        </svg>
      </Show>
    </Show>
  </span>
);

export const ActivityLine: Component<ActivityLineProps> = (props) => {
  const isExpandable = () => props.expandable === true && typeof props.onToggle === 'function';
  const content = (
    <>
      <ActivityStatusIcon status={props.status} />
      <span class="chat-activity-text">
        <span class="chat-activity-title">{props.title}</span>
        <Show when={props.meta}>
          {(meta) => <span class="chat-activity-meta">{meta()}</span>}
        </Show>
        <Show when={props.detail}>
          {(detail) => <span class="chat-activity-detail">{detail()}</span>}
        </Show>
      </span>
      <Show when={isExpandable()}>
        <span class={cn('chat-activity-chevron', props.expanded && 'chat-activity-chevron-open')} aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M5.5 3.75 9.75 8 5.5 12.25" />
          </svg>
        </span>
      </Show>
    </>
  );

  return (
    <div class={cn('chat-activity-line-wrap', props.class)} data-status={props.status}>
      <Show
        when={isExpandable()}
        fallback={<div class="chat-activity-line">{content}</div>}
      >
        <button
          type="button"
          class="chat-activity-line chat-activity-line-button"
          aria-expanded={props.expanded === true}
          aria-controls={props.controls}
          onClick={props.onToggle}
        >
          {content}
        </button>
      </Show>
      <Show when={props.expanded && props.children}>
        <div class="chat-activity-body">
          {props.children}
        </div>
      </Show>
    </div>
  );
};
