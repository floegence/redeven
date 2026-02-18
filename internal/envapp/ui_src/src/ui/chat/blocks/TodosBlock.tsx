// TodosBlock — Todos view for write_todos snapshots.

import { For, Match, Show, Switch } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';

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

function statusLabel(status: TodosBlockProps['todos'][number]['status']): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
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
  const doneCount = () => props.todos.filter((item) => isDone(item.status)).length;

  return (
    <div class={cn('chat-todos-block', props.class)}>
      <div class="chat-todos-header">
        <div class="chat-todos-title-row">
          <span class="chat-todos-title">Todos</span>
          <span class="chat-todos-progress">
            {doneCount()}/{props.todos.length || 0} done
          </span>
        </div>
        <div class="chat-todos-meta">
          <Show when={props.version > 0}>
            <span>Version {props.version}</span>
          </Show>
          <Show when={props.updatedAtUnixMs > 0}>
            <span>Updated {formatTime(props.updatedAtUnixMs)}</span>
          </Show>
        </div>
      </div>

      <Show
        when={props.todos.length > 0}
        fallback={
          <div class="chat-todos-empty-row">
            <span class="chat-todos-empty">No tasks tracked yet.</span>
          </div>
        }
      >
        <div class="chat-todos-table" role="table" aria-label="Todos table">
          <div class="chat-todos-table-header" role="row">
            <span class="chat-todos-table-head-cell">Status</span>
            <span class="chat-todos-table-head-cell">Task</span>
            <span class="chat-todos-table-head-cell">Note</span>
          </div>
          <For each={props.todos}>
            {(item) => (
              <div class="chat-todos-row" role="row">
                <div class="chat-todos-cell chat-todos-cell-status" role="cell">
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
                      <Match when={item.status === 'cancelled'}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M5 12h14" />
                        </svg>
                      </Match>
                      <Match when={item.status === 'in_progress'}>
                        <span class="chat-todos-check-loader" aria-hidden="true">
                          <SnakeLoader size="sm" class="chat-inline-snake-loader-todo" />
                        </span>
                      </Match>
                    </Switch>
                  </span>
                  <span class={cn('chat-todos-status', statusClass(item.status))}>
                    {statusLabel(item.status)}
                  </span>
                </div>

                <div
                  class={cn(
                    'chat-todos-cell chat-todos-content',
                    isDone(item.status) && 'chat-todos-content-done',
                  )}
                  role="cell"
                >
                  {item.content}
                </div>

                <div class="chat-todos-cell chat-todos-note" role="cell">
                  <Show when={item.note} fallback={<span class="chat-todos-note-empty">—</span>}>
                    {item.note}
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
