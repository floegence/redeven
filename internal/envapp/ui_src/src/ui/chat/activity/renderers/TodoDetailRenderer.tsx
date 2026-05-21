import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { TodoDetailSection, TodoDetailStatus } from '../activityDetailTypes';

function statusLabel(status: TodoDetailStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In progress';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

function statusMark(status: TodoDetailStatus): string {
  switch (status) {
    case 'completed':
      return 'Done';
    case 'in_progress':
      return 'Active';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

export const TodoDetailRenderer: Component<{ section: TodoDetailSection }> = (props) => (
  <section class="chat-activity-detail-section">
    <div class="chat-activity-detail-section-head">
      <div class="chat-activity-detail-section-title">{props.section.title}</div>
      <div class="chat-activity-detail-section-meta">{props.section.items.length} items</div>
    </div>
    <div class="chat-activity-todo-list">
      <For each={props.section.items}>
        {(todo) => (
          <div class="chat-activity-todo-item" data-status={todo.afterStatus}>
            <span class="chat-activity-todo-status">{statusMark(todo.afterStatus)}</span>
            <div class="chat-activity-todo-copy">
              <div class="chat-activity-todo-content">{todo.content}</div>
              <div class="chat-activity-todo-meta">
                <Show
                  when={todo.beforeStatus && todo.beforeStatus !== todo.afterStatus}
                  fallback={<span>{statusLabel(todo.afterStatus)}</span>}
                >
                  <span>{statusLabel(todo.beforeStatus!)}{' -> '}{statusLabel(todo.afterStatus)}</span>
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
