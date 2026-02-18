import { Show, createMemo } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
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
        if (toolName === SUBAGENTS_TOOL_NAME && toolStatus === 'success') {
          const action = String((args as any).action ?? (result as any).action ?? '').trim().toLowerCase();
          if (action === 'create') {
            mergeCandidate(
              mapSubagentPayloadSnakeToCamel({
                ...(result as any),
                status: (result as any).subagent_status ?? (result as any).subagentStatus ?? (result as any).status,
                agent_type: (result as any).agent_type ?? (args as any).agent_type,
                trigger_reason: (result as any).trigger_reason ?? (args as any).trigger_reason,
              }),
              messageTimestamp,
            );
          } else if (action === 'wait') {
            const statusPayload = asRecord((result as any).snapshots);
            for (const value of Object.values(statusPayload ?? {})) {
              mergeCandidate(mapSubagentPayloadSnakeToCamel(value), messageTimestamp);
            }
          } else if (action === 'inspect') {
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

export const SubagentBlock: Component<SubagentBlockProps> = (props) => {
  const ctx = useChatContext();

  const blockView = createMemo(() => {
    const seed = subagentBlockToView(props.block);
    const latest = resolveLatestSubagentView(ctx.messages(), props.block.subagentId, seed);
    return subagentViewToBlock(latest);
  });
  const statusText = createMemo(() => subagentStatusLabel(blockView().status));
  const durationText = createMemo(() => formatDuration(blockView().stats.elapsedMs));
  const triggerReasonText = createMemo(() => {
    const value = String(blockView().triggerReason ?? '').trim();
    if (value) return summarizeText(value, 120);
    return 'No trigger reason provided.';
  });
  const outcomeText = createMemo(() => {
    const value = String(blockView().stats.outcome ?? '').trim();
    if (value) return value;
    return subagentStatusLabel(blockView().status);
  });

  return (
    <div class={cn('chat-subagent-block', props.class)} data-status={blockView().status}>
      <div class="chat-subagent-header chat-subagent-header-static">
        <span class="chat-subagent-header-main">
          <span class={subagentStatusClass(blockView().status)}>
            {statusText()}
          </span>
          <span class="chat-subagent-meta chat-subagent-agent">{blockView().agentType || 'subagent'}</span>
        </span>
        <span class="chat-subagent-header-right">
          <span class="chat-subagent-meta chat-subagent-duration">{durationText()}</span>
          <span class="chat-subagent-id" title={blockView().subagentId}>{blockView().subagentId}</span>
        </span>
      </div>

      <div class="chat-subagent-compact-body">
        <div class="chat-subagent-compact-line">
          <span class="chat-subagent-compact-label">Trigger</span>
          <span class="chat-subagent-compact-value">{triggerReasonText()}</span>
        </div>
        <div class="chat-subagent-kpi-grid">
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">Steps</span>
            <span class="chat-subagent-kpi-value">{formatIntegerMetric(blockView().stats.steps)}</span>
          </div>
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">Tools</span>
            <span class="chat-subagent-kpi-value">{formatIntegerMetric(blockView().stats.toolCalls)}</span>
          </div>
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">Tokens</span>
            <span class="chat-subagent-kpi-value">{formatIntegerMetric(blockView().stats.tokens)}</span>
          </div>
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">Outcome</span>
            <span class="chat-subagent-kpi-value">{outcomeText()}</span>
          </div>
        </div>
        <Show when={blockView().error}>
          <div class="chat-subagent-error">Error: {blockView().error}</div>
        </Show>
        <Show when={!blockView().error && blockView().status === 'running'}>
          <div class="chat-subagent-compact-hint">
            The subagent is running in the background. Progress updates appear automatically.
          </div>
        </Show>
      </div>
    </div>
  );
};
