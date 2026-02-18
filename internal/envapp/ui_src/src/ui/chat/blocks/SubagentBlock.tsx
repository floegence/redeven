import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import type { Message, SubagentBlock as SubagentBlockType } from '../types';
import { useChatContext } from '../ChatProvider';
import {
  mapSubagentPayloadSnakeToCamel,
  mergeSubagentEventsByTimestamp,
  normalizeSubagentStatus,
  type SubagentView,
} from '../../pages/aiDataNormalizers';

export interface SubagentBlockProps {
  block: SubagentBlockType;
  class?: string;
}

const DELEGATE_TASK_TOOL_NAME = 'delegate_task';
const WAIT_SUBAGENTS_TOOL_NAME = 'wait_subagents';
const SUBAGENTS_TOOL_NAME = 'subagents';

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

function summarizeText(value: string, maxLength = 160): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function historyRoleLabel(role: string): string {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'user') return 'User';
  if (normalized === 'assistant') return 'Subagent';
  if (normalized === 'system') return 'System';
  return 'Message';
}

function historyRoleClass(role: string): string {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'user') return 'chat-subagent-history-item-user';
  if (normalized === 'assistant') return 'chat-subagent-history-item-assistant';
  if (normalized === 'system') return 'chat-subagent-history-item-system';
  return 'chat-subagent-history-item-generic';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeHistory(raw: unknown): Array<{ role: 'user' | 'assistant' | 'system'; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const roleRaw = String(rec.role ?? '').trim().toLowerCase();
    const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system'
      ? roleRaw
      : '';
    const text = String(rec.text ?? '').trim();
    if (!role || !text) continue;
    out.push({
      role,
      text,
    });
  }
  return out;
}

function subagentBlockToView(block: SubagentBlockType): SubagentView {
  return {
    subagentId: String(block.subagentId ?? '').trim(),
    taskId: String(block.taskId ?? '').trim(),
    agentType: String(block.agentType ?? '').trim(),
    triggerReason: String(block.triggerReason ?? '').trim(),
    status: normalizeSubagentStatus(block.status),
    summary: String(block.summary ?? '').trim(),
    evidenceRefs: Array.isArray(block.evidenceRefs) ? block.evidenceRefs : [],
    keyFiles: Array.isArray(block.keyFiles) ? block.keyFiles : [],
    openRisks: Array.isArray(block.openRisks) ? block.openRisks : [],
    nextActions: Array.isArray(block.nextActions) ? block.nextActions : [],
    history: normalizeHistory(block.history),
    stats: {
      steps: Math.max(0, Number(block.stats?.steps ?? 0) || 0),
      toolCalls: Math.max(0, Number(block.stats?.toolCalls ?? 0) || 0),
      tokens: Math.max(0, Number(block.stats?.tokens ?? 0) || 0),
      elapsedMs: Math.max(0, Number(block.stats?.elapsedMs ?? 0) || 0),
      outcome: String(block.stats?.outcome ?? '').trim(),
    },
    updatedAtUnixMs: Math.max(0, Number(block.updatedAtUnixMs ?? 0) || 0),
    error: String(block.error ?? '').trim() || undefined,
  };
}

function subagentViewToBlock(view: SubagentView): SubagentBlockType {
  return {
    type: 'subagent',
    subagentId: view.subagentId,
    taskId: view.taskId,
    agentType: view.agentType,
    triggerReason: view.triggerReason,
    status: normalizeSubagentStatus(view.status),
    summary: view.summary,
    evidenceRefs: view.evidenceRefs,
    keyFiles: view.keyFiles,
    openRisks: view.openRisks,
    nextActions: view.nextActions,
    history: view.history,
    stats: {
      steps: view.stats.steps,
      toolCalls: view.stats.toolCalls,
      tokens: view.stats.tokens,
      elapsedMs: view.stats.elapsedMs,
      outcome: view.stats.outcome,
    },
    updatedAtUnixMs: view.updatedAtUnixMs,
    error: view.error,
  };
}

function resolveLatestSubagentView(messages: Message[], subagentId: string, seed: SubagentView): SubagentView {
  const targetID = String(subagentId ?? '').trim();
  if (!targetID) return seed;
  let merged: SubagentView | null = seed;

  const mergeCandidate = (candidate: SubagentView | null, messageTimestamp: number): void => {
    if (!candidate || String(candidate.subagentId ?? '').trim() !== targetID) return;
    const normalized: SubagentView = candidate.updatedAtUnixMs > 0
      ? candidate
      : {
        ...candidate,
        updatedAtUnixMs: Math.max(0, Number(messageTimestamp || 0)),
      };
    merged = mergeSubagentEventsByTimestamp(merged, normalized);
  };

  const walkBlocks = (blocks: unknown[], messageTimestamp: number): void => {
    for (const block of blocks) {
      const rec = asRecord(block);
      if (!rec) continue;
      const blockType = String(rec.type ?? '').trim().toLowerCase();
      if (blockType === 'subagent') {
        mergeCandidate(subagentBlockToView(rec as unknown as SubagentBlockType), messageTimestamp);
      } else if (blockType === 'tool-call') {
        const toolName = String(rec.toolName ?? '').trim();
        const toolStatus = String(rec.status ?? '').trim().toLowerCase();
        const args = asRecord(rec.args) ?? {};
        const result = asRecord(rec.result) ?? {};
        if (toolName === DELEGATE_TASK_TOOL_NAME) {
          mergeCandidate(
            mapSubagentPayloadSnakeToCamel({
              ...result,
              agent_type: (result as any).agent_type ?? (args as any).agent_type,
              trigger_reason: (result as any).trigger_reason ?? (args as any).trigger_reason,
            }),
            messageTimestamp,
          );
        } else if (toolName === WAIT_SUBAGENTS_TOOL_NAME && toolStatus === 'success') {
          const statusPayload = asRecord(result.status);
          for (const value of Object.values(statusPayload ?? {})) {
            mergeCandidate(mapSubagentPayloadSnakeToCamel(value), messageTimestamp);
          }
        } else if (toolName === SUBAGENTS_TOOL_NAME && toolStatus === 'success') {
          const action = String((args as any).action ?? (result as any).action ?? '').trim().toLowerCase();
          if (action === 'inspect') {
            mergeCandidate(mapSubagentPayloadSnakeToCamel((result as any).item), messageTimestamp);
          } else if (action === 'steer' || action === 'terminate') {
            mergeCandidate(mapSubagentPayloadSnakeToCamel((result as any).snapshot), messageTimestamp);
          }
        }
      }
      const children = Array.isArray((rec as any).children) ? ((rec as any).children as unknown[]) : [];
      if (children.length > 0) walkBlocks(children, messageTimestamp);
    }
  };

  for (const message of messages) {
    const messageTimestamp = Math.max(0, Number((message as any)?.timestamp ?? 0) || 0);
    const blocks = Array.isArray((message as any)?.blocks) ? ((message as any).blocks as unknown[]) : [];
    walkBlocks(blocks, messageTimestamp);
  }
  return merged ?? seed;
}

function resolveFinalMessage(block: SubagentBlockType): string {
  for (let i = block.history.length - 1; i >= 0; i -= 1) {
    const entry = block.history[i];
    if (entry.role === 'assistant' && String(entry.text ?? '').trim()) {
      return String(entry.text).trim();
    }
  }
  return String(block.summary ?? '').trim();
}

export const SubagentBlock: Component<SubagentBlockProps> = (props) => {
  const ctx = useChatContext();
  const [detailOpen, setDetailOpen] = createSignal(false);

  const blockView = createMemo(() => {
    const seed = subagentBlockToView(props.block);
    const latest = resolveLatestSubagentView(ctx.messages(), props.block.subagentId, seed);
    return subagentViewToBlock(latest);
  });
  const statusText = createMemo(() => subagentStatusLabel(blockView().status));
  const durationText = createMemo(() => formatDuration(blockView().stats.elapsedMs));
  const summaryText = createMemo(() => {
    if (blockView().summary) return blockView().summary;
    if (blockView().status === 'running') {
      return 'The subagent is executing its delegated objective.';
    }
    return 'No summary available yet.';
  });
  const statSummary = createMemo(() =>
    [
      `Steps ${formatIntegerMetric(blockView().stats.steps)}`,
      `Tools ${formatIntegerMetric(blockView().stats.toolCalls)}`,
      `Tokens ${formatIntegerMetric(blockView().stats.tokens)}`,
      `Elapsed ${durationText()}`,
      `Outcome ${blockView().stats.outcome || blockView().status}`,
    ].join(' · '),
  );
  const finalMessage = createMemo(() => resolveFinalMessage(blockView()));

  return (
    <div class={cn('chat-subagent-block', props.class)} data-status={blockView().status}>
      <button
        type="button"
        class="chat-subagent-header"
        onClick={() => setDetailOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={detailOpen()}
      >
        <span class="chat-subagent-header-main">
          <span class={subagentStatusClass(blockView().status)}>
            <Show when={blockView().status === 'running'}>
              <span class="chat-subagent-status-loader" aria-hidden="true">
                <SnakeLoader size="sm" class="chat-inline-snake-loader-subagent" />
              </span>
            </Show>
            {statusText()}
          </span>
          <span class="chat-subagent-meta chat-subagent-agent">{blockView().agentType || 'subagent'}</span>
        </span>
        <span class="chat-subagent-header-right">
          <span class="chat-subagent-meta chat-subagent-duration">{durationText()}</span>
          <span class="chat-subagent-id" title={blockView().subagentId}>{blockView().subagentId}</span>
        </span>
      </button>

      <div class="chat-subagent-compact-body">
        <div class="chat-subagent-text">{summarizeText(summaryText(), 180)}</div>
        <div class="chat-subagent-compact-metrics">{statSummary()}</div>
        <button
          type="button"
          class="chat-subagent-open-details-btn"
          onClick={() => setDetailOpen(true)}
        >
          View details
        </button>
      </div>

      <Dialog
        open={detailOpen()}
        onOpenChange={(open) => setDetailOpen(open)}
        title="Subagent details"
      >
        <div class="chat-subagent-dialog-content">
          <div class="chat-subagent-dialog-head">
            <span class={subagentStatusClass(blockView().status)}>
              <Show when={blockView().status === 'running'}>
                <span class="chat-subagent-status-loader" aria-hidden="true">
                  <SnakeLoader size="sm" class="chat-inline-snake-loader-subagent" />
                </span>
              </Show>
              {statusText()}
            </span>
            <span class="chat-subagent-meta chat-subagent-agent">{blockView().agentType || 'subagent'}</span>
            <span class="chat-subagent-id" title={blockView().subagentId}>{blockView().subagentId}</span>
          </div>

          <div class="chat-subagent-section">
            <div class="chat-subagent-section-label">Summary</div>
            <div class="chat-subagent-text">{summaryText()}</div>
          </div>

          <Show when={finalMessage()}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Final message</div>
              <div class="chat-subagent-text">{finalMessage()}</div>
            </div>
          </Show>

          <div class="chat-subagent-section">
            <div class="chat-subagent-section-label">Message timeline</div>
            <Show
              when={blockView().history.length > 0}
              fallback={<div class="chat-subagent-text chat-subagent-muted">No detailed messages yet.</div>}
            >
              <div class="chat-subagent-history-list">
                <For each={blockView().history}>
                  {(entry) => (
                    <div class={cn('chat-subagent-history-item', historyRoleClass(entry.role))}>
                      <div class="chat-subagent-history-role">{historyRoleLabel(entry.role)}</div>
                      <div class="chat-subagent-history-text">{entry.text}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={blockView().triggerReason}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Trigger reason</div>
              <div class="chat-subagent-text">{blockView().triggerReason}</div>
            </div>
          </Show>

          <Show when={blockView().evidenceRefs.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Evidence refs</div>
              <div class="chat-subagent-tags">
                <For each={blockView().evidenceRefs}>
                  {(ref) => <span class="chat-subagent-tag">{ref}</span>}
                </For>
              </div>
            </div>
          </Show>

          <Show when={blockView().keyFiles.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Key files</div>
              <div class="chat-subagent-list">
                <For each={blockView().keyFiles}>
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

          <Show when={blockView().openRisks.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Open risks</div>
              <ul class="chat-subagent-bullets">
                <For each={blockView().openRisks}>{(risk) => <li>{risk}</li>}</For>
              </ul>
            </div>
          </Show>

          <Show when={blockView().nextActions.length > 0}>
            <div class="chat-subagent-section">
              <div class="chat-subagent-section-label">Next actions</div>
              <ul class="chat-subagent-bullets">
                <For each={blockView().nextActions}>{(action) => <li>{action}</li>}</For>
              </ul>
            </div>
          </Show>

          <div class="chat-subagent-section">
            <div class="chat-subagent-section-label">Stats</div>
            <div class="chat-subagent-stats-grid">
              <div class="chat-subagent-stat-card">
                <div class="chat-subagent-stat-label">Steps</div>
                <div class="chat-subagent-stat-value">{formatIntegerMetric(blockView().stats.steps)}</div>
              </div>
              <div class="chat-subagent-stat-card">
                <div class="chat-subagent-stat-label">Tool calls</div>
                <div class="chat-subagent-stat-value">{formatIntegerMetric(blockView().stats.toolCalls)}</div>
              </div>
              <div class="chat-subagent-stat-card">
                <div class="chat-subagent-stat-label">Tokens</div>
                <div class="chat-subagent-stat-value">{formatIntegerMetric(blockView().stats.tokens)}</div>
              </div>
              <div class="chat-subagent-stat-card">
                <div class="chat-subagent-stat-label">Elapsed</div>
                <div class="chat-subagent-stat-value">{durationText()}</div>
              </div>
              <div class="chat-subagent-stat-card">
                <div class="chat-subagent-stat-label">Outcome</div>
                <div class="chat-subagent-stat-value">{blockView().stats.outcome || blockView().status}</div>
              </div>
            </div>
          </div>

          <Show when={blockView().error}>
            <div class="chat-subagent-error">Error: {blockView().error}</div>
          </Show>
        </div>
      </Dialog>
    </div>
  );
};
