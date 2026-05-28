import { Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import type { Message, SubagentBlock as SubagentBlockType } from '../types';
import { useChatContext } from '../ChatProvider';
import { ActivityStatusIcon, type ActivityStatus } from '../status/ActivityLine';
import {
  mergeSubagentEventsByTimestamp,
  normalizeSubagentStatus,
  type SubagentView,
} from '../../pages/aiDataNormalizers';
import { useI18n, type I18nHelpers } from '../../i18n';

export interface SubagentBlockProps {
  block: SubagentBlockType;
  class?: string;
}

function subagentStatusLabel(i18n: I18nHelpers, status: SubagentBlockType['status']): string {
  switch (status) {
    case 'queued':
      return i18n.t('flowerChat.subagents.status.queued');
    case 'running':
      return i18n.t('flowerChat.subagents.status.running');
    case 'waiting_input':
      return i18n.t('flowerChat.subagents.status.waitingInput');
    case 'completed':
      return i18n.t('flowerChat.subagents.status.completed');
    case 'failed':
      return i18n.t('flowerChat.subagents.status.failed');
    case 'canceled':
      return i18n.t('flowerChat.subagents.status.canceled');
    case 'timed_out':
      return i18n.t('flowerChat.subagents.status.timedOut');
    default:
      return i18n.t('flowerChat.subagents.status.unknown');
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

function subagentActivityStatus(status: SubagentBlockType['status']): ActivityStatus {
  switch (status) {
    case 'queued':
      return 'pending';
    case 'running':
    case 'waiting_input':
      return 'running';
    case 'completed':
      return 'success';
    case 'failed':
    case 'timed_out':
      return 'error';
    default:
      return 'info';
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
    specId: String(block.specId ?? '').trim() || undefined,
    title: String(block.title ?? '').trim() || undefined,
    objective: String(block.objective ?? '').trim() || undefined,
    contextMode: String(block.contextMode ?? '').trim() || undefined,
    promptHash: String(block.promptHash ?? '').trim() || undefined,
    delegationPromptMarkdown: String(block.delegationPromptMarkdown ?? '').trim() || undefined,
    deliverables: Array.isArray(block.deliverables) ? block.deliverables : [],
    definitionOfDone: Array.isArray(block.definitionOfDone) ? block.definitionOfDone : [],
    outputSchema: block.outputSchema && typeof block.outputSchema === 'object' && !Array.isArray(block.outputSchema)
      ? (block.outputSchema as Record<string, unknown>)
      : {},
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
    specId: String(view.specId ?? '').trim() || undefined,
    title: String(view.title ?? '').trim() || undefined,
    objective: String(view.objective ?? '').trim() || undefined,
    contextMode: String(view.contextMode ?? '').trim() || undefined,
    promptHash: String(view.promptHash ?? '').trim() || undefined,
    delegationPromptMarkdown: String(view.delegationPromptMarkdown ?? '').trim() || undefined,
    deliverables: Array.isArray(view.deliverables) ? view.deliverables : [],
    definitionOfDone: Array.isArray(view.definitionOfDone) ? view.definitionOfDone : [],
    outputSchema: view.outputSchema ?? {},
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
      }
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
  const i18n = useI18n();
  const [promptDialogOpen, setPromptDialogOpen] = createSignal(false);

  const blockView = createMemo(() => {
    const seed = subagentBlockToView(props.block);
    const latest = resolveLatestSubagentView(ctx.messages(), props.block.subagentId, seed);
    return subagentViewToBlock(latest);
  });
  const statusText = createMemo(() => subagentStatusLabel(i18n, blockView().status));
  const durationText = createMemo(() => formatDuration(blockView().stats.elapsedMs));
  const triggerReasonText = createMemo(() => {
    const value = String(blockView().triggerReason ?? '').trim();
    if (value) return summarizeText(value, 120);
    return i18n.t('flowerChat.subagents.noTriggerReason');
  });
  const titleText = createMemo(() => {
    const title = String(blockView().title ?? '').trim();
    if (title) return summarizeText(title, 120);
    const objective = String(blockView().objective ?? '').trim();
    if (objective) return summarizeText(objective, 120);
    return triggerReasonText();
  });
  const promptPreview = createMemo(() => {
    const prompt = String(blockView().delegationPromptMarkdown ?? '').trim();
    if (!prompt) return '';
    return summarizeText(prompt.replace(/\s+/g, ' '), 200);
  });
  const promptDialogTitle = createMemo(() => {
    const title = String(blockView().title ?? '').trim();
    if (title) return i18n.t('flowerChat.subagents.promptDialogTitleWithName', { name: title });
    return i18n.t('flowerChat.subagents.promptDialogTitleWithName', { name: blockView().subagentId });
  });
  const outcomeText = createMemo(() => {
    const value = String(blockView().stats.outcome ?? '').trim();
    if (value) return value;
    return subagentStatusLabel(i18n, blockView().status);
  });

  return (
    <div class={cn('chat-subagent-block', props.class)} data-status={blockView().status}>
      <div class="chat-subagent-header chat-subagent-header-static">
        <span class="chat-subagent-header-main">
          <span class={subagentStatusClass(blockView().status)}>
            <ActivityStatusIcon status={subagentActivityStatus(blockView().status)} class="chat-subagent-status-icon" />
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
            <span class="chat-subagent-compact-label">{i18n.t('flowerChat.subagents.titleLabel')}</span>
          <span class="chat-subagent-compact-value">{titleText()}</span>
        </div>
        <div class="chat-subagent-compact-line">
          <span class="chat-subagent-compact-label">{i18n.t('flowerChat.subagents.trigger')}</span>
          <span class="chat-subagent-compact-value">{triggerReasonText()}</span>
        </div>
        <Show when={promptPreview()}>
          <div class="chat-subagent-compact-line">
            <div class="chat-subagent-compact-line-head">
              <span class="chat-subagent-compact-label">{i18n.t('flowerChat.subagents.promptLabel')}</span>
              <button
                type="button"
                class="chat-subagent-detail-link"
                onClick={() => setPromptDialogOpen(true)}
              >
                {i18n.t('flowerChat.subagents.viewPrompt')}
              </button>
            </div>
            <span class="chat-subagent-compact-value">{promptPreview()}</span>
          </div>
        </Show>
        <div class="chat-subagent-kpi-grid">
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">{i18n.t('flowerChat.subagents.steps')}</span>
            <span class="chat-subagent-kpi-value">{formatIntegerMetric(blockView().stats.steps)}</span>
          </div>
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">{i18n.t('flowerChat.subagents.tools')}</span>
            <span class="chat-subagent-kpi-value">{formatIntegerMetric(blockView().stats.toolCalls)}</span>
          </div>
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">{i18n.t('flowerChat.subagents.tokens')}</span>
            <span class="chat-subagent-kpi-value">{formatIntegerMetric(blockView().stats.tokens)}</span>
          </div>
          <div class="chat-subagent-kpi-chip">
            <span class="chat-subagent-kpi-label">{i18n.t('flowerChat.subagents.outcomeLabel')}</span>
            <span class="chat-subagent-kpi-value">{outcomeText()}</span>
          </div>
        </div>
        <Show when={blockView().error}>
          <div class="chat-subagent-error">{i18n.t('chatActivity.error')}: {blockView().error}</div>
        </Show>
        <Show when={!blockView().error && blockView().status === 'running'}>
          <div class="chat-subagent-compact-hint">
            {i18n.t('flowerChat.subagents.runningHint')}
          </div>
        </Show>
      </div>

      <Dialog
        open={promptDialogOpen()}
        onOpenChange={(open) => setPromptDialogOpen(open)}
        title={promptDialogTitle()}
      >
        <div class="chat-subagent-detail-dialog">
          <div class="chat-subagent-detail-meta-grid">
            <div class="chat-subagent-detail-meta-card">
              <div class="chat-subagent-detail-meta-label">{i18n.t('flowerChat.subagents.subagentLabel')}</div>
              <div class="chat-subagent-detail-meta-value chat-subagent-detail-meta-value-mono">{blockView().subagentId}</div>
            </div>
            <div class="chat-subagent-detail-meta-card">
              <div class="chat-subagent-detail-meta-label">{i18n.t('flowerChat.subagents.statusLabel')}</div>
              <div class="chat-subagent-detail-meta-value">{statusText()}</div>
            </div>
            <div class="chat-subagent-detail-meta-card">
              <div class="chat-subagent-detail-meta-label">{i18n.t('flowerChat.subagents.typeLabel')}</div>
              <div class="chat-subagent-detail-meta-value">{blockView().agentType || 'subagent'}</div>
            </div>
            <div class="chat-subagent-detail-meta-card">
              <div class="chat-subagent-detail-meta-label">{i18n.t('chatActivity.chip.duration')}</div>
              <div class="chat-subagent-detail-meta-value">{durationText()}</div>
            </div>
          </div>

          <Show when={blockView().objective}>
            <div class="chat-subagent-detail-section">
              <div class="chat-subagent-detail-label">{i18n.t('flowerChat.subagents.objectiveLabel')}</div>
              <div class="chat-subagent-detail-text">{blockView().objective}</div>
            </div>
          </Show>

          <Show when={blockView().triggerReason}>
            <div class="chat-subagent-detail-section">
              <div class="chat-subagent-detail-label">{i18n.t('flowerChat.subagents.triggerReasonLabel')}</div>
              <div class="chat-subagent-detail-text">{blockView().triggerReason}</div>
            </div>
          </Show>

          <div class="chat-subagent-detail-section">
            <div class="chat-subagent-detail-label">{i18n.t('flowerChat.subagents.delegationPromptLabel')}</div>
            <pre class="chat-subagent-detail-prompt">
              {String(blockView().delegationPromptMarkdown ?? '').trim()}
            </pre>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
