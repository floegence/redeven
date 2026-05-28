// TodosBlock — Todos view for write_todos snapshots.

import { For, Match, Show, Switch, createMemo } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useI18n, type I18nHelpers } from '../../i18n';

export interface TodosBlockProps {
  version: number;
  updatedAtUnixMs: number;
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    note?: string;
  }>;
  class?: string;
}

function formatTime(ms: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function isDone(status: TodosBlockProps['todos'][number]['status']): boolean {
  return status === 'completed' || status === 'cancelled';
}

function statusLabel(i18n: I18nHelpers, status: TodosBlockProps['todos'][number]['status']): string {
  switch (status) {
    case 'in_progress':
      return i18n.t('chatActivity.todoStatus.inProgress');
    case 'completed':
      return i18n.t('chatActivity.todoStatus.completed');
    case 'cancelled':
      return i18n.t('chatActivity.todoStatus.cancelled');
    default:
      return i18n.t('chatActivity.todoStatus.pending');
  }
}

function statusClass(status: TodosBlockProps['todos'][number]['status']): string {
  switch (status) {
    case 'in_progress':
      return 'chat-todos-status-progress';
    case 'completed':
      return 'chat-todos-status-completed';
    case 'cancelled':
      return 'chat-todos-status-cancelled';
    default:
      return 'chat-todos-status-pending';
  }
}

export const TodosBlock: Component<TodosBlockProps> = (props) => {
  const i18n = useI18n();
  const totalCount = createMemo(() => props.todos.length);
  const closedCount = createMemo(() => props.todos.filter((item) => isDone(item.status)).length);
  const completedCount = createMemo(() => props.todos.filter((item) => item.status === 'completed').length);
  const inProgressCount = createMemo(() => props.todos.filter((item) => item.status === 'in_progress').length);
  const pendingCount = createMemo(() => props.todos.filter((item) => item.status === 'pending').length);
  const cancelledCount = createMemo(() => props.todos.filter((item) => item.status === 'cancelled').length);
  const progressPercent = createMemo(() => (
    totalCount() > 0
      ? Math.max(0, Math.min(100, Math.round((closedCount() / totalCount()) * 100)))
      : 0
  ));
  const progressLabel = createMemo(() => (
    i18n.tn('chatActivity.todoTasks', totalCount(), { count: totalCount() })
  ));
  const summaryLabel = createMemo(() => {
    if (completedCount() > 0) {
      return i18n.tn('chatActivity.todoSummary.completed', completedCount(), { count: completedCount() });
    }
    if (inProgressCount() > 0) {
      return i18n.tn('chatActivity.todoSummary.inProgress', inProgressCount(), { count: inProgressCount() });
    }
    if (pendingCount() > 0) {
      return i18n.tn('chatActivity.todoSummary.pending', pendingCount(), { count: pendingCount() });
    }
    if (cancelledCount() > 0) {
      return i18n.tn('chatActivity.todoSummary.cancelled', cancelledCount(), { count: cancelledCount() });
    }
    return i18n.t('chatActivity.todoSummary.none');
  });
  const footerMeta = createMemo(() => {
    const items: string[] = [];
    if (props.version > 0) items.push(`v${props.version}`);
    const updated = formatTime(props.updatedAtUnixMs);
    if (updated) items.push(i18n.t('flowerChat.tasks.updatedAt', { time: updated }));
    return items;
  });

  return (
    <div class={cn('chat-todos-block', props.class)} role="group" aria-label={i18n.t('flowerChat.tasks.title')}>
      <div class="chat-todos-header">
        <div class="chat-todos-kicker-row">
          <span class="chat-todos-kicker">{i18n.t('chatActivity.updatedPlan')}</span>
          <Show when={inProgressCount() > 0}>
            <span class="chat-todos-live-pill">
              <span class="chat-todos-live-dot" aria-hidden="true" />
              {i18n.tn('chatActivity.activeSteps', inProgressCount(), { count: inProgressCount() })}
            </span>
          </Show>
        </div>
        <div class="chat-todos-title-row">
          <div class="chat-todos-title-group">
            <span class="chat-todos-title">{progressLabel()}</span>
            <span class="chat-todos-summary">{summaryLabel()}</span>
          </div>
          <span class="chat-todos-progress">
            {i18n.t('chatActivity.todoProgressClosed', { closed: closedCount(), total: totalCount() || 0 })}
          </span>
        </div>
        <div class="chat-todos-progress-track" aria-hidden="true">
          <div
            class="chat-todos-progress-fill"
            style={{ width: `${progressPercent()}%` }}
          />
        </div>
      </div>

      <Show
        when={totalCount() > 0}
        fallback={
          <div class="chat-todos-empty-row">
            <span class="chat-todos-empty">{i18n.t('chatActivity.noTasksTracked')}</span>
          </div>
        }
      >
        <div class="chat-todos-list" role="list" aria-label={i18n.t('chatActivity.planSteps')}>
          <For each={props.todos}>
            {(item) => (
              <div
                class="chat-todos-item"
                data-status={item.status}
                role="listitem"
              >
                <div class="chat-todos-marker-column">
                  <span
                    class={cn(
                      'chat-todos-check',
                      `chat-todos-check-${item.status}`,
                    )}
                    aria-hidden="true"
                  >
                    <Switch>
                      <Match when={item.status === 'completed'}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </Match>
                      <Match when={item.status === 'in_progress'}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 5v7l4 2" />
                          <circle cx="12" cy="12" r="8" />
                        </svg>
                      </Match>
                      <Match when={item.status === 'cancelled'}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M5 12h14" />
                        </svg>
                      </Match>
                    </Switch>
                  </span>
                </div>

                <div class="chat-todos-main">
                  <div class="chat-todos-main-row">
                    <div
                      class={cn(
                        'chat-todos-content',
                        isDone(item.status) && 'chat-todos-content-done',
                      )}
                    >
                      {item.content}
                    </div>
                    <span class={cn('chat-todos-status', statusClass(item.status))}>
                      {statusLabel(i18n, item.status)}
                    </span>
                  </div>
                  <Show when={item.note}>
                    <div class="chat-todos-note">
                      {item.note}
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={totalCount() > 0 || footerMeta().length > 0}>
        <div class="chat-todos-footer">
          <div class="chat-todos-footer-stats">
            <Show when={pendingCount() > 0}>
              <span class="chat-todos-footer-chip chat-todos-footer-chip-pending">
                {i18n.tn('chatActivity.todoSummary.pending', pendingCount(), { count: pendingCount() })}
              </span>
            </Show>
            <Show when={inProgressCount() > 0}>
              <span class="chat-todos-footer-chip chat-todos-footer-chip-active">
                {i18n.tn('chatActivity.todoSummary.active', inProgressCount(), { count: inProgressCount() })}
              </span>
            </Show>
            <Show when={completedCount() > 0}>
              <span class="chat-todos-footer-chip chat-todos-footer-chip-completed">
                {i18n.tn('chatActivity.todoSummary.completed', completedCount(), { count: completedCount() })}
              </span>
            </Show>
            <Show when={cancelledCount() > 0}>
              <span class="chat-todos-footer-chip chat-todos-footer-chip-cancelled">
                {i18n.tn('chatActivity.todoSummary.cancelled', cancelledCount(), { count: cancelledCount() })}
              </span>
            </Show>
          </div>
          <Show when={footerMeta().length > 0}>
            <div class="chat-todos-footer-meta">
              <For each={footerMeta()}>
                {(item) => <span>{item}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
