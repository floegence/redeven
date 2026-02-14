// ShellBlock — terminal-style command display with output.

import { Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface ShellBlockProps {
  command: string;
  output?: string;
  exitCode?: number;
  status: 'running' | 'success' | 'error';
  class?: string;
}

/**
 * Renders a terminal-style block showing a shell command, its output,
 * and exit code. Displays a spinner while the command is running.
 */
export const ShellBlock: Component<ShellBlockProps> = (props) => {
  return (
    <div class={cn('chat-shell-block', props.class)}>
      {/* Command line */}
      <div class="chat-shell-command">
        <span class="chat-shell-prompt">$</span>
        <span class="chat-shell-command-text">{props.command}</span>
        <Show when={props.status === 'running'}>
          <span class="chat-shell-running" aria-label="Running">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="chat-shell-spinner"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </span>
        </Show>
      </div>

      {/* Command output */}
      <Show when={props.output}>
        <div
          class={cn(
            'chat-shell-output',
            props.status === 'error' && 'chat-shell-output-error',
          )}
        >
          <pre>{props.output}</pre>
        </div>
      </Show>

      {/* Exit code indicator */}
      <Show when={props.exitCode !== undefined}>
        <div
          class={cn(
            'chat-shell-exit-code',
            props.exitCode === 0
              ? 'chat-shell-exit-success'
              : 'chat-shell-exit-error',
          )}
        >
          exit {props.exitCode}
        </div>
      </Show>
    </div>
  );
};
