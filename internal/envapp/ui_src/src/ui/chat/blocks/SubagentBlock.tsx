import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
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

const integerFormatter = new Intl.NumberFormat('en-US');

function formatIntegerMetric(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return integerFormatter.format(Math.round(value));
}

export const SubagentBlock: Component<SubagentBlockProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(false);
  const statusText = createMemo(() => subagentStatusLabel(props.block.status));
  const durationText = createMemo(() => formatDuration(props.block.stats.elapsedMs));
  const statItems = createMemo(() => [
    { label: 'Steps', value: formatIntegerMetric(props.block.stats.steps) },
    { label: 'Tool calls', value: formatIntegerMetric(props.block.stats.toolCalls) },
    { label: 'Tokens', value: formatIntegerMetric(props.block.stats.tokens) },
    { label: 'Elapsed', value: durationText() },
    { label: 'Outcome', value: props.block.stats.outcome || props.block.status },
  ]);

  return (
    <div class={cn('chat-subagent-block', props.class)} data-status={props.block.status}>
      <button
        type="button"
        class="chat-subagent-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed()}
      >
        <span class="chat-subagent-header-main">
          <span class={subagentStatusClass(props.block.status)}>
            <Show when={props.block.status === 'running'}>
              <span class="chat-subagent-status-loader" aria-hidden="true">
                <SnakeLoader size="sm" class="chat-inline-snake-loader-subagent" />
              </span>
            </Show>
            {statusText()}
          </span>
          <span class="chat-subagent-meta chat-subagent-agent">{props.block.agentType || 'subagent'}</span>
        </span>
        <span class="chat-subagent-header-right">
          <span class="chat-subagent-meta chat-subagent-duration">{durationText()}</span>
          <span class="chat-subagent-id" title={props.block.subagentId}>{props.block.subagentId}</span>
          <span
            class={cn('chat-subagent-chevron', collapsed() ? 'chat-subagent-chevron-collapsed' : '')}
            aria-hidden="true"
          >
            ▲
          </span>
        </span>
      </button>

      <Show when={!collapsed()}>
        <div class="chat-subagent-body">
          <Show
            when={props.block.summary}
            fallback={
              <Show when={props.block.status === 'running'}>
                <div class="chat-subagent-section">
                  <div class="chat-subagent-section-label">Progress</div>
                  <div class="chat-subagent-text">The subagent is executing its delegated objective.</div>
                </div>
              </Show>
            }
          >
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Summary</div>
              <div class="chat-subagent-text">{props.block.summary}</div>
            </div>
          </Show>

          <Show when={props.block.triggerReason}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Trigger reason</div>
              <div class="chat-subagent-text">{props.block.triggerReason}</div>
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
              <For each={statItems()}>
                {(item) => (
                  <div class="chat-subagent-stat-card">
                    <div class="chat-subagent-stat-label">{item.label}</div>
                    <div class="chat-subagent-stat-value">{item.value}</div>
                  </div>
                )}
              </For>
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
