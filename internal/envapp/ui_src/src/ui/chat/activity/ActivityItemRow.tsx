import { For, Show, createMemo } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import {
  normalizeAskUserQuestions,
  type AskUserQuestion,
} from '../askUserContract';
import { useChatContext } from '../ChatProvider';
import { ActivityStatusIcon, type ActivityStatus } from '../status/ActivityLine';
import type { ActivityItem } from '../types';
import { useI18n } from '../../i18n';
import { ActivityDetailPanel } from './ActivityDetailPanel';
import type { ActivityDetailLoadState } from './activityDetailTypes';

export const ActivityChipList: Component<{ chips?: ActivityItem['chips'] }> = (props) => (
  <Show when={Array.isArray(props.chips) && props.chips.length > 0}>
    <span class="chat-activity-timeline-chips">
      <For each={props.chips}>
        {(chip) => (
          <span class={cn('chat-activity-timeline-chip', chip.tone && `chat-activity-timeline-chip-${chip.tone}`)}>
            {chip.label}
            <Show when={chip.value}>
              {(value) => <span class="chat-activity-timeline-chip-value">{value()}</span>}
            </Show>
          </span>
        )}
      </For>
    </span>
  </Show>
);

const stopLocalEvent: JSX.EventHandlerUnion<HTMLElement, Event> = (event) => {
  event.stopPropagation();
};

const ActivityApprovalActions: Component<{ messageId: string; item: ActivityItem }> = (props) => {
  const ctx = useChatContext();
  const i18n = useI18n();
  const canApprove = createMemo(() => props.item.requires_approval === true && props.item.approval_state === 'requested');

  return (
    <Show when={canApprove()}>
      <span class="chat-activity-approval-actions" onClick={stopLocalEvent}>
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-approve"
          onClick={(event) => {
            event.stopPropagation();
            ctx.approveToolCall(props.messageId, String(props.item.tool_id ?? ''), true);
          }}
        >
          {i18n.t('chatActivity.allow')}
        </button>
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-reject"
          onClick={(event) => {
            event.stopPropagation();
            ctx.approveToolCall(props.messageId, String(props.item.tool_id ?? ''), false);
          }}
        >
          {i18n.t('chatActivity.deny')}
        </button>
      </span>
    </Show>
  );
};

const ActivityAskUserItem: Component<{ item: ActivityItem }> = (props) => {
  const questions = createMemo(() => {
    const payload = props.item.payload;
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    return normalizeAskUserQuestions(record.questions);
  });
  const writeLabel = (question: AskUserQuestion) => String(question.writeLabel ?? '').trim();

  return (
    <Show when={questions().length > 0}>
      <div class="chat-activity-user-input-audit" onClick={stopLocalEvent} onKeyDown={stopLocalEvent}>
      <For each={questions()}>
        {(question: AskUserQuestion) => {
          return (
            <div class="chat-activity-user-input-question">
              <div class="chat-activity-user-input-question-text">{question.question}</div>
              <Show when={question.choices.length > 0 || writeLabel(question)}>
                <div class="chat-activity-user-input-choices">
                  <For each={question.choices}>
                    {(choice) => (
                      <span class="chat-activity-user-input-choice">
                        <span class="chat-activity-user-input-choice-label">{choice.label}</span>
                          <Show when={choice.description}>
                          {(description) => <span class="chat-activity-user-input-choice-description">{description()}</span>}
                          </Show>
                      </span>
                    )}
                  </For>
                  <Show when={writeLabel(question)}>
                    {(label) => <span class="chat-activity-user-input-choice">{label()}</span>}
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      </div>
    </Show>
  );
};

function hasTextSelection(): boolean {
  const selection = window.getSelection?.();
  return Boolean(selection && selection.toString().trim());
}

export const ActivityItemRow: Component<{
  item: ActivityItem;
  item_id: string;
  label: string;
  panelId: string;
  status: ActivityStatus;
  targetLabel: string;
  blocking: boolean;
  messageId: string;
  expanded: boolean;
  detailState: ActivityDetailLoadState;
  onToggle: () => void;
  onRetry: () => void;
}> = (props) => {
  const hasDetail = createMemo(() => Array.isArray(props.item.detail_refs) && props.item.detail_refs.length > 0);
  const toggleFromRow = () => {
    if (!hasDetail() || hasTextSelection()) return;
    props.onToggle();
  };
  const onKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (!hasDetail()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onToggle();
  };

  return (
    <div
      class={cn('chat-activity-item-shell', props.expanded && 'chat-activity-item-shell-expanded')}
      data-item-id={props.item_id}
      data-has-detail={hasDetail() ? 'true' : 'false'}
    >
      <div
        class={cn(
          'chat-activity-item',
          hasDetail() && 'chat-activity-item-clickable',
          props.blocking && 'chat-activity-item-blocking',
        )}
        role={hasDetail() ? 'button' : undefined}
        tabIndex={hasDetail() ? 0 : undefined}
        aria-expanded={hasDetail() ? props.expanded : undefined}
        aria-controls={hasDetail() ? props.panelId : undefined}
        onClick={toggleFromRow}
        onKeyDown={onKeyDown}
      >
        <Show when={hasDetail()} fallback={<span class="chat-activity-item-chevron-placeholder" aria-hidden="true" />}>
          <span class={cn('chat-activity-item-chevron', props.expanded && 'chat-activity-item-chevron-open')} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
          </span>
        </Show>
        <ActivityStatusIcon status={props.status} class="chat-activity-item-status" />
        <div class="chat-activity-item-main">
          <div class="chat-activity-item-line">
            <span class="chat-activity-item-label">{props.label}</span>
            <Show when={props.targetLabel}>
              {(target) => <span class="chat-activity-item-target">{target()}</span>}
            </Show>
            <ActivityChipList chips={props.item.chips} />
          </div>
          <Show when={props.item.description && !props.targetLabel}>
            {(description) => <div class="chat-activity-item-description">{description()}</div>}
          </Show>
          <Show when={props.item.renderer === 'blocking_prompt' || props.item.tool_name === 'ask_user'}>
            <ActivityAskUserItem item={props.item} />
          </Show>
        </div>
        <div class="chat-activity-item-actions" onClick={stopLocalEvent} onKeyDown={stopLocalEvent}>
          <ActivityApprovalActions messageId={props.messageId} item={props.item} />
        </div>
      </div>
      <Show when={hasDetail() && props.expanded}>
        <ActivityDetailPanel state={props.detailState} panelId={props.panelId} onRetry={props.onRetry} />
      </Show>
    </div>
  );
};
