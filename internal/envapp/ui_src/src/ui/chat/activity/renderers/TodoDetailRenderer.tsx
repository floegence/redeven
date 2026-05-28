import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { TodoDetailSection, TodoDetailStatus } from '../activityDetailTypes';
import { useI18n, type I18nHelpers } from '../../../i18n';
import { localizedActivityText } from '../activityDetailI18n';

function statusLabel(i18n: I18nHelpers, status: TodoDetailStatus): string {
  switch (status) {
    case 'completed':
      return i18n.t('chatActivity.todoStatus.completed');
    case 'in_progress':
      return i18n.t('chatActivity.todoStatus.inProgress');
    case 'cancelled':
      return i18n.t('chatActivity.todoStatus.cancelled');
    default:
      return i18n.t('chatActivity.todoStatus.pending');
  }
}

function statusMark(i18n: I18nHelpers, status: TodoDetailStatus): string {
  switch (status) {
    case 'completed':
      return i18n.t('chatActivity.todoMark.completed');
    case 'in_progress':
      return i18n.t('chatActivity.todoMark.inProgress');
    case 'cancelled':
      return i18n.t('chatActivity.todoMark.cancelled');
    default:
      return i18n.t('chatActivity.todoMark.pending');
  }
}

export const TodoDetailRenderer: Component<{ section: TodoDetailSection }> = (props) => {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{localizedActivityText(i18n, props.section)}</div>
        <div class="chat-activity-detail-section-meta">{i18n.tn('chatActivity.todoItems', props.section.items.length)}</div>
      </div>
      <div class="chat-activity-todo-list">
        <For each={props.section.items}>
          {(todo) => (
            <div class="chat-activity-todo-item" data-status={todo.afterStatus}>
                <span class="chat-activity-todo-status">{statusMark(i18n, todo.afterStatus)}</span>
                <div class="chat-activity-todo-copy">
                <div class="chat-activity-todo-content">{localizedActivityText(i18n, {
                  label: todo.content,
                  labelKey: todo.contentKey,
                })}</div>
                <div class="chat-activity-todo-meta">
                  <Show
                    when={todo.beforeStatus && todo.beforeStatus !== todo.afterStatus}
                    fallback={<span>{statusLabel(i18n, todo.afterStatus)}</span>}
                  >
                    <span>{statusLabel(i18n, todo.beforeStatus!)}{' -> '}{statusLabel(i18n, todo.afterStatus)}</span>
                  </Show>
                  <Show when={todo.note}>
                    {(note) => <span>{note()}</span>}
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
};
