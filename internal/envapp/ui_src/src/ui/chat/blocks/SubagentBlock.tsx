import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { SubagentBlock as SubagentBlockType } from '../types';

export interface SubagentBlockProps {
  block: SubagentBlockType;
  class?: string;
}

function subagentStatusLabel(status: SubagentBlockType['status']): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'waiting_input':
      return 'Waiting input';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    case 'timed_out':
      return 'Timed out';
    default:
      return 'Unknown';
  }
}

function subagentStatusClass(status: SubagentBlockType['status']): string {
  switch (status) {
    case 'queued':
      return 'chat-subagent-status chat-subagent-status-queued';
    case 'running':
      return 'chat-subagent-status chat-subagent-status-running';
    case 'waiting_input':
      return 'chat-subagent-status chat-subagent-status-waiting';
    case 'completed':
      return 'chat-subagent-status chat-subagent-status-completed';
    case 'failed':
      return 'chat-subagent-status chat-subagent-status-failed';
    case 'canceled':
      return 'chat-subagent-status chat-subagent-status-canceled';
    case 'timed_out':
      return 'chat-subagent-status chat-subagent-status-timed-out';
    default:
      return 'chat-subagent-status';
  }
}

function formatDuration(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return '0s';
  const totalSec = Math.floor(elapsedMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

export const SubagentBlock: Component<SubagentBlockProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(false);
  const statusText = createMemo(() => subagentStatusLabel(props.block.status));
  const durationText = createMemo(() => formatDuration(props.block.stats.elapsedMs));

  return (
    <div class={cn('chat-subagent-block', props.class)}>
      <button
        type="button"
        class="chat-subagent-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed()}
      >
        <span class={subagentStatusClass(props.block.status)}>{statusText()}</span>
        <span class="chat-subagent-meta">{props.block.agentType || 'subagent'}</span>
        <span class="chat-subagent-meta">{durationText()}</span>
        <span class="chat-subagent-id">{props.block.subagentId}</span>
      </button>

      <Show when={!collapsed()}>
        <div class="chat-subagent-body">
          <Show when={props.block.summary}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Summary</div>
              <div class="chat-subagent-text">{props.block.summary}</div>
            </div>
          </Show>

          <Show when={props.block.evidenceRefs.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Evidence refs</div>
              <div class="chat-subagent-tags">
                <For each={props.block.evidenceRefs}>
                  {(ref) => <span class="chat-subagent-tag">{ref}</span>}
                </For>
              </div>
            </div>
          </Show>

          <Show when={props.block.keyFiles.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Key files</div>
              <div class="chat-subagent-list">
                <For each={props.block.keyFiles}>
                  {(file) => (
                    <div class="chat-subagent-list-item">
                      <span class="chat-subagent-file-path">
                        {file.path}
                        <Show when={file.line && file.line > 0}>:{file.line}</Show>
                      </span>
                      <Show when={file.purpose}>
                        <span class="chat-subagent-file-purpose">{file.purpose}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={props.block.openRisks.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Open risks</div>
              <ul class="chat-subagent-bullets">
                <For each={props.block.openRisks}>{(risk) => <li>{risk}</li>}</For>
              </ul>
            </div>
          </Show>

          <Show when={props.block.nextActions.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Next actions</div>
              <ul class="chat-subagent-bullets">
                <For each={props.block.nextActions}>{(action) => <li>{action}</li>}</For>
              </ul>
            </div>
          </Show>

          <div class="chat-subagent-section">
            <div class="chat-subagent-section-label">Stats</div>
            <div class="chat-subagent-stats-grid">
              <div>Steps: {props.block.stats.steps}</div>
              <div>Tool calls: {props.block.stats.toolCalls}</div>
              <div>Tokens: {props.block.stats.tokens}</div>
              <div>Cost: {props.block.stats.cost}</div>
              <div>Elapsed: {durationText()}</div>
              <div>Outcome: {props.block.stats.outcome || props.block.status}</div>
            </div>
          </div>

          <Show when={props.block.error}>
            <div class="chat-subagent-error">Error: {props.block.error}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

