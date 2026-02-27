// ToolCallBlock — tool call display with approval workflow and ask_user interaction.

import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import { useChatContext } from '../ChatProvider';
import type { ToolCallBlock as ToolCallBlockType } from '../types';
import { BlockRenderer } from './BlockRenderer';
import { useAIChatContext } from '../../pages/AIChatContext';

const ASK_USER_TOOL_NAME = 'ask_user';
const SUBAGENTS_TOOL_NAME = 'subagents';
const APPLY_PATCH_TOOL_NAME = 'apply_patch';
const WEB_SEARCH_TOOL_NAME = 'web.search';
const KNOWLEDGE_SEARCH_TOOL_NAME = 'knowledge.search';
const KNOWLEDGE_TOOL_PREFIX = 'knowledge.';

export interface ToolCallBlockProps {
  block: ToolCallBlockType;
  messageId: string;
  blockIndex: number;
  class?: string;
}

type AskUserDisplay = {
  question: string;
  source: string;
  options: string[];
};

// Chevron icon for collapse toggle (rotatable)
const ChevronIcon: Component<{ collapsed: boolean }> = (props) => (
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
    style={{
      transform: props.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// Status icons for different tool call states
const StatusIcon: Component<{ status: ToolCallBlockType['status'] }> = (props) => {
  const iconStyle = { 'flex-shrink': '0' } as const;

  return (
    <>
      {props.status === 'pending' && (
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
          class="chat-tool-status-icon chat-tool-status-pending"
          style={iconStyle}
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )}
      {props.status === 'running' && (
        <span class="chat-tool-status-icon chat-tool-status-running" style={iconStyle}>
          <SnakeLoader size="sm" class="chat-tool-status-loader" />
        </span>
      )}
      {props.status === 'success' && (
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
          class="chat-tool-status-icon chat-tool-status-success"
          style={iconStyle}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {props.status === 'error' && (
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
          class="chat-tool-status-icon chat-tool-status-error"
          style={iconStyle}
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
    </>
  );
};

function summarizeArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args);
  if (text.length <= 50) return text;
  return text.slice(0, 47) + '...';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeAskUserOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of value) {
    const text = asTrimmedString(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(text);
    if (options.length >= 4) break;
  }
  return options;
}

function buildAskUserDisplay(block: ToolCallBlockType): AskUserDisplay | null {
  if (String(block.toolName ?? '').trim() !== ASK_USER_TOOL_NAME) {
    return null;
  }
  const args = asRecord(block.args);
  const result = asRecord(block.result);
  const question = asTrimmedString(args?.question) || asTrimmedString(result?.question);
  if (!question) {
    return null;
  }
  const optionsFromResult = normalizeAskUserOptions(result?.options);
  const optionsFromArgs = normalizeAskUserOptions(args?.options);
  const source = asTrimmedString(result?.source);
  return {
    question,
    source,
    options: optionsFromResult.length > 0 ? optionsFromResult : optionsFromArgs,
  };
}

function humanizeAskUserSource(source: string): string {
  const normalized = String(source ?? '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return normalized
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

type WaitSubagentStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'unknown';

type WaitSubagentItem = {
  subagentId: string;
  specId: string;
  title: string;
  objective: string;
  delegationPromptMarkdown: string;
  agentType: string;
  status: WaitSubagentStatus;
  triggerReason: string;
  steps: number;
  toolCalls: number;
  tokens: number;
  elapsedMs: number;
  outcome: string;
  error: string;
};

type WaitSubagentsDisplay = {
  action: 'create' | 'wait' | 'list' | 'inspect' | 'steer' | 'terminate' | 'terminate_all';
  ids: string[];
  requestedIds: string[];
  missingIds: string[];
  requestedCount: number;
  foundCount: number;
  target: string;
  scope: string;
  requestedAgentType: string;
  requestedTitle: string;
  requestedObjective: string;
  requestedTriggerReason: string;
  requestedMessage: string;
  interrupt: boolean;
  timeoutMs: number;
  timedOut: boolean;
  items: WaitSubagentItem[];
  counts: {
    queued: number;
    running: number;
    waiting: number;
    completed: number;
    failed: number;
    canceled: number;
  };
};

function readFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function normalizeWaitSubagentStatus(value: unknown): WaitSubagentStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'queued':
    case 'running':
    case 'waiting_input':
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return normalized;
    default:
      return 'unknown';
  }
}

function waitSubagentStatusLabel(status: WaitSubagentStatus): string {
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

function waitSubagentStatusClass(status: WaitSubagentStatus): string {
  switch (status) {
    case 'queued':
      return 'chat-subagent-status-queued';
    case 'running':
      return 'chat-subagent-status-running';
    case 'waiting_input':
      return 'chat-subagent-status-waiting';
    case 'completed':
      return 'chat-subagent-status-completed';
    case 'failed':
      return 'chat-subagent-status-failed';
    case 'timed_out':
      return 'chat-subagent-status-timed-out';
    case 'canceled':
      return 'chat-subagent-status-canceled';
    default:
      return '';
  }
}

function waitSubagentStatusRank(status: WaitSubagentStatus): number {
  switch (status) {
    case 'running':
      return 1;
    case 'waiting_input':
      return 2;
    case 'queued':
      return 3;
    case 'completed':
      return 4;
    case 'failed':
    case 'timed_out':
      return 5;
    case 'canceled':
      return 6;
    default:
      return 7;
  }
}

function formatSubagentDuration(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return '0s';
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

const waitSubagentIntegerFormatter = new Intl.NumberFormat('en-US');

function formatSubagentInteger(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return waitSubagentIntegerFormatter.format(Math.round(value));
}

function summarizeSubagentText(value: string, maxLength = 132): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function asSubagentsAction(
  value: string,
): WaitSubagentsDisplay['action'] | '' {
  const normalized = String(value ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'create':
    case 'wait':
    case 'list':
    case 'inspect':
    case 'steer':
    case 'terminate':
    case 'terminate_all':
      return normalized;
    default:
      return '';
  }
}

function buildWaitSubagentsDisplay(block: ToolCallBlockType): WaitSubagentsDisplay | null {
  if (String(block.toolName ?? '').trim() !== SUBAGENTS_TOOL_NAME) return null;

  const args = asRecord(block.args);
  const result = asRecord(block.result);
  const action = asSubagentsAction(asTrimmedString(args?.action ?? result?.action));
  if (!action) return null;

  const idPool: string[] = [];
  const appendIDs = (raw: unknown): void => {
    if (!Array.isArray(raw)) return;
    raw.forEach((value) => {
      const id = String(value ?? '').trim();
      if (id) idPool.push(id);
    });
  };
  appendIDs(args?.ids);
  appendIDs(result?.ids);
  appendIDs(result?.affected_ids ?? result?.affectedIds);

  const target = asTrimmedString(args?.target ?? result?.target);
  if (target) {
    idPool.push(target);
  }
  const ids = Array.from(new Set(idPool.filter(Boolean)));

  const scope = asTrimmedString(args?.scope ?? result?.scope);
  const requestedAgentType = asTrimmedString(args?.agent_type ?? args?.agentType);
  const requestedTitle = asTrimmedString(args?.title);
  const requestedObjective = asTrimmedString(args?.objective);
  const requestedTriggerReason = asTrimmedString(args?.trigger_reason ?? args?.triggerReason);
  const requestedMessage = asTrimmedString(args?.message);
  const interrupt = readBooleanFlag(args?.interrupt);
  const timeoutMs = Math.max(0, Math.floor(readFiniteNumber(result?.timeout_ms ?? result?.timeoutMs ?? args?.timeout_ms ?? args?.timeoutMs, 0)));
  const timedOut = readBooleanFlag(result?.timed_out ?? result?.timedOut);
  const rawMissingIDs = result?.missing_ids ?? result?.missingIds;
  const missingIDs = Array.isArray(rawMissingIDs)
    ? Array.from(
      new Set(
        (rawMissingIDs as unknown[])
          .map((value) => String(value ?? '').trim())
          .filter(Boolean),
      ),
    )
    : [];
  const items: WaitSubagentItem[] = [];
  const counts = {
    queued: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
  };

  const appendItem = (raw: unknown, fallbackID = ''): void => {
    const snapshot = asRecord(raw);
    if (!snapshot) return;
    const subagentId =
      asTrimmedString(snapshot.subagent_id ?? snapshot.subagentId ?? snapshot.id) ||
      asTrimmedString(fallbackID) ||
      'unknown';
    const status = normalizeWaitSubagentStatus(snapshot.status ?? snapshot.subagent_status ?? snapshot.subagentStatus);
    const stats = asRecord(snapshot.stats);
    const item: WaitSubagentItem = {
      subagentId,
      specId: asTrimmedString(snapshot.spec_id ?? snapshot.specId),
      title: asTrimmedString(snapshot.title),
      objective: asTrimmedString(snapshot.objective),
      delegationPromptMarkdown: asTrimmedString(snapshot.delegation_prompt_markdown ?? snapshot.delegationPromptMarkdown),
      agentType: asTrimmedString(snapshot.agent_type ?? snapshot.agentType) || 'subagent',
      status,
      triggerReason: asTrimmedString(snapshot.trigger_reason ?? snapshot.triggerReason),
      steps: Math.max(0, Math.floor(readFiniteNumber(stats?.steps, 0))),
      toolCalls: Math.max(0, Math.floor(readFiniteNumber(stats?.tool_calls ?? stats?.toolCalls, 0))),
      tokens: Math.max(0, Math.floor(readFiniteNumber(stats?.tokens, 0))),
      elapsedMs: Math.max(0, Math.floor(readFiniteNumber(stats?.elapsed_ms ?? stats?.elapsedMs, 0))),
      outcome: asTrimmedString(stats?.outcome),
      error: asTrimmedString(snapshot.error),
    };
    items.push(item);
    switch (item.status) {
      case 'queued':
        counts.queued += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      case 'waiting_input':
        counts.waiting += 1;
        break;
      case 'completed':
        counts.completed += 1;
        break;
      case 'failed':
      case 'timed_out':
        counts.failed += 1;
        break;
      case 'canceled':
        counts.canceled += 1;
        break;
      default:
        break;
    }
  };

  if (action === 'create') {
    appendItem({
      subagent_id: result?.subagent_id ?? result?.subagentId,
      title: result?.title ?? args?.title,
      objective: result?.objective ?? args?.objective,
      delegation_prompt_markdown: result?.delegation_prompt_markdown ?? result?.delegationPromptMarkdown,
      agent_type: result?.agent_type ?? args?.agent_type,
      trigger_reason: result?.trigger_reason ?? args?.trigger_reason,
      status: result?.subagent_status ?? result?.subagentStatus ?? result?.status,
    });
  } else if (action === 'wait') {
    const rawSnapshots = asRecord(result?.snapshots ?? result?.status);
    if (rawSnapshots) {
      for (const [fallbackID, raw] of Object.entries(rawSnapshots)) {
        appendItem(raw, fallbackID);
      }
    }
  } else if (action === 'list') {
    const rawItems = Array.isArray(result?.items) ? result.items : [];
    rawItems.forEach((raw) => appendItem(raw));
  } else if (action === 'inspect') {
    const rawItems = Array.isArray(result?.items) ? result.items : [];
    if (rawItems.length > 0) {
      rawItems.forEach((raw) => appendItem(raw));
    } else {
      appendItem(result?.item);
    }
  } else if (action === 'steer' || action === 'terminate') {
    appendItem(result?.snapshot);
  }

  items.sort((a, b) => {
    const rankDelta = waitSubagentStatusRank(a.status) - waitSubagentStatusRank(b.status);
    if (rankDelta !== 0) return rankDelta;
    return a.subagentId.localeCompare(b.subagentId);
  });

  const requestedIDs = (() => {
    const rawRequestedIDs = result?.requested_ids ?? result?.requestedIds;
    const fromResult = Array.isArray(rawRequestedIDs)
      ? (rawRequestedIDs as unknown[])
      : [];
    if (fromResult.length > 0) {
      return Array.from(new Set(fromResult.map((value) => String(value ?? '').trim()).filter(Boolean)));
    }
    return ids;
  })();
  const requestedCount = Math.max(0, Math.floor(readFiniteNumber(result?.requested_count ?? result?.requestedCount, requestedIDs.length)));
  const foundCount = Math.max(0, Math.floor(readFiniteNumber(result?.found_count ?? result?.foundCount, items.length)));

  return {
    action,
    ids,
    requestedIds: requestedIDs,
    missingIds: missingIDs,
    requestedCount,
    foundCount,
    target,
    scope,
    requestedAgentType,
    requestedTitle,
    requestedObjective,
    requestedTriggerReason,
    requestedMessage,
    interrupt,
    timeoutMs,
    timedOut,
    items,
    counts,
  };
}

interface WaitSubagentsToolCardProps {
  block: ToolCallBlockType;
  display: WaitSubagentsDisplay;
  class?: string;
}

const WaitSubagentsToolCard: Component<WaitSubagentsToolCardProps> = (props) => {
  const badgeLabel = createMemo(() => {
    switch (props.display.action) {
      case 'create':
        return 'Create subagent';
      case 'wait':
        return 'Wait subagents';
      case 'list':
        return 'List subagents';
      case 'inspect':
        return 'Inspect subagents';
      case 'steer':
        return 'Steer subagent';
      case 'terminate':
        return 'Terminate subagent';
      case 'terminate_all':
        return 'Terminate all';
      default:
        return 'Subagents';
    }
  });

  const headlineStateLabel = createMemo(() => {
    if (props.block.status === 'running') {
      switch (props.display.action) {
        case 'create':
          return 'Creating';
        case 'wait':
          return 'Waiting snapshots';
        case 'list':
          return 'Collecting snapshots';
        case 'inspect':
          return 'Inspecting';
        case 'steer':
          return 'Steering';
        case 'terminate':
          return 'Terminating';
        case 'terminate_all':
          return 'Terminating all';
        default:
          return 'Running';
      }
    }
    if (props.block.status === 'pending') return 'Queued';
    if (props.block.status === 'success') return props.display.timedOut ? 'Timed out' : 'Completed';
    return 'Failed';
  });

  const headlineStateClass = createMemo(() => {
    if (props.block.status === 'running' || props.block.status === 'pending') {
      return 'chat-tool-wait-subagents-state-running';
    }
    if (props.block.status === 'success') {
      return props.display.timedOut
        ? 'chat-tool-wait-subagents-state-error'
        : 'chat-tool-wait-subagents-state-success';
    }
    return 'chat-tool-wait-subagents-state-error';
  });

  const targetsCount = createMemo(() => {
    if (props.display.requestedCount > 0) return props.display.requestedCount;
    if (props.display.items.length > 0) return props.display.items.length;
    if (props.display.ids.length > 0) return props.display.ids.length;
    if (props.display.target) return 1;
    return 0;
  });
  const visibleItems = createMemo(() => props.display.items.slice(0, 4));
  const visibleIDChips = createMemo(() => {
    const ids = props.display.requestedIds.length > 0 ? props.display.requestedIds : props.display.ids;
    return ids.slice(0, 4);
  });
  const trackedIDsPreview = createMemo(() => {
    if (props.display.items.length > 0) {
      return props.display.items.slice(0, 3).map((item) => item.subagentId);
    }
    if (props.display.requestedIds.length > 0) {
      return props.display.requestedIds.slice(0, 3);
    }
    return props.display.ids.slice(0, 3);
  });

  return (
    <div class={cn('chat-tool-wait-subagents-block', props.class)}>
      <div class="chat-tool-wait-subagents-head">
        <div class="chat-tool-wait-subagents-head-main">
          <span class="chat-tool-wait-subagents-badge">{badgeLabel()}</span>
          <span class={cn('chat-tool-wait-subagents-state', headlineStateClass())}>
            {headlineStateLabel()}
          </span>
        </div>
        <div class="chat-tool-wait-subagents-head-meta">
          <Show when={props.display.action === 'wait' && props.display.timeoutMs > 0}>
            <span>Timeout {Math.max(1, Math.floor(props.display.timeoutMs / 1000))}s</span>
          </Show>
          <Show when={props.display.timedOut}>
            <span class="chat-tool-wait-subagents-timeout-flag">Timed out</span>
          </Show>
        </div>
      </div>

      <div class="chat-tool-wait-subagents-summary">
        <span>
          {targetsCount()} target{targetsCount() === 1 ? '' : 's'}
        </span>
        <Show when={props.display.action === 'inspect' && props.display.requestedCount > 0}>
          <span>
            Requested {formatSubagentInteger(props.display.requestedCount)} · Found {formatSubagentInteger(props.display.foundCount)} · Missing {formatSubagentInteger(props.display.missingIds.length)}
          </span>
        </Show>
        <Show when={props.display.items.length > 0}>
          <span>
            {props.display.counts.running} running · {props.display.counts.waiting} waiting · {props.display.counts.completed} completed · {props.display.counts.failed} failed
          </span>
        </Show>
      </div>

      <Show when={props.display.scope || props.display.requestedAgentType || props.display.target || props.display.requestedIds.length > 0 || props.display.ids.length > 0}>
        <div class="chat-tool-wait-subagents-params">
          <Show when={props.display.scope}>
            <span class="chat-tool-wait-subagents-param-pill">Scope: {props.display.scope}</span>
          </Show>
          <Show when={props.display.requestedAgentType}>
            <span class="chat-tool-wait-subagents-param-pill">Type: {props.display.requestedAgentType}</span>
          </Show>
          <Show when={props.display.target}>
            <span class="chat-tool-wait-subagents-param-pill" title={props.display.target}>
              Target: {summarizeSubagentText(props.display.target, 36)}
            </span>
          </Show>
          <Show when={visibleIDChips().length > 0}>
            <For each={visibleIDChips()}>
              {(id) => (
                <span class="chat-tool-wait-subagents-id-pill" title={id}>
                  {summarizeSubagentText(id, 26)}
                </span>
              )}
            </For>
            <Show when={(props.display.requestedIds.length > 0 ? props.display.requestedIds.length : props.display.ids.length) > visibleIDChips().length}>
              <span class="chat-tool-wait-subagents-param-pill">+{(props.display.requestedIds.length > 0 ? props.display.requestedIds.length : props.display.ids.length) - visibleIDChips().length} more</span>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={props.display.missingIds.length > 0}>
        <div class="chat-tool-wait-subagents-request">
          <div class="chat-tool-wait-subagents-item-trigger">
            Missing: {props.display.missingIds.slice(0, 3).join(', ')}
            <Show when={props.display.missingIds.length > 3}>
              {' '}+{props.display.missingIds.length - 3} more
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.display.requestedTitle || props.display.requestedObjective || props.display.requestedTriggerReason || props.display.requestedMessage}>
        <div class="chat-tool-wait-subagents-request">
          <Show when={props.display.requestedTitle || props.display.requestedObjective}>
            <div class="chat-tool-wait-subagents-item-trigger">
              Task: {summarizeSubagentText(props.display.requestedTitle || props.display.requestedObjective, 170)}
            </div>
          </Show>
          <Show when={props.display.requestedTriggerReason}>
            <div class="chat-tool-wait-subagents-item-trigger">
              Trigger: {summarizeSubagentText(props.display.requestedTriggerReason, 170)}
            </div>
          </Show>
          <Show when={props.display.requestedMessage}>
            <div class="chat-tool-wait-subagents-item-trigger">
              Message: {summarizeSubagentText(props.display.requestedMessage, 170)}
              <Show when={props.display.interrupt}>
                <span class="chat-tool-wait-subagents-inline-flag">interrupt=true</span>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.display.items.length === 0}>
        <div class="chat-tool-wait-subagents-empty">
          <Show
            when={trackedIDsPreview().length > 0}
            fallback={<span>No subagent snapshots returned.</span>}
          >
            <span>
              <Show when={props.display.action === 'wait'} fallback={<span>Subagent IDs: {trackedIDsPreview().join(', ')}</span>}>
                <span>Tracking IDs: {trackedIDsPreview().join(', ')}</span>
              </Show>
              <Show when={targetsCount() > trackedIDsPreview().length}> +{targetsCount() - trackedIDsPreview().length} more</Show>
            </span>
          </Show>
        </div>
      </Show>

      <Show when={visibleItems().length > 0}>
        <div class="chat-tool-wait-subagents-list-compact">
          <For each={visibleItems()}>
            {(item) => (
              <div class="chat-tool-wait-subagents-item">
                <div class="chat-tool-wait-subagents-item-head">
                  <span class={cn('chat-subagent-status', waitSubagentStatusClass(item.status))}>
                    {waitSubagentStatusLabel(item.status)}
                  </span>
                  <span class="chat-tool-wait-subagents-item-agent">{item.agentType || 'subagent'}</span>
                  <span class="chat-tool-wait-subagents-item-id" title={item.subagentId}>{item.subagentId}</span>
                </div>
                <Show when={item.title || item.objective}>
                  <div class="chat-tool-wait-subagents-item-trigger">
                    Title: {summarizeSubagentText(item.title || item.objective, 170)}
                  </div>
                </Show>

                <div class="chat-tool-wait-subagents-item-metrics">
                  <span>Steps {formatSubagentInteger(item.steps)}</span>
                  <span>Tools {formatSubagentInteger(item.toolCalls)}</span>
                  <span>Tokens {formatSubagentInteger(item.tokens)}</span>
                  <span>Elapsed {formatSubagentDuration(item.elapsedMs)}</span>
                  <span>Outcome {item.outcome || waitSubagentStatusLabel(item.status)}</span>
                </div>

                <Show when={item.triggerReason}>
                  <div class="chat-tool-wait-subagents-item-trigger">
                    Trigger: {summarizeSubagentText(item.triggerReason, 170)}
                  </div>
                </Show>

                <Show when={item.error}>
                  <div class="chat-tool-wait-subagents-item-error">{item.error}</div>
                </Show>
              </div>
            )}
          </For>
          <Show when={props.display.items.length > visibleItems().length}>
            <div class="chat-tool-wait-subagents-more">
              +{props.display.items.length - visibleItems().length} more subagents
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.block.error}>
        <div class="chat-tool-wait-subagents-error">Error: {props.block.error}</div>
      </Show>
    </div>
  );
};

type WebSearchItem = {
  title: string;
  url: string;
  snippet: string;
  domainKey: string;
  domainLabel: string;
};

type WebSearchDomainFilter = {
  id: string;
  label: string;
  count: number;
};

type WebSearchDisplay = {
  query: string;
  provider: string;
  requestedCount: number;
  timeoutMs: number;
  items: WebSearchItem[];
  domains: WebSearchDomainFilter[];
};

type KnowledgeSearchMatch = {
  cardId: string;
  title: string;
  summary: string;
  score: number;
  tags: string[];
  sourceRepos: string[];
};

type KnowledgeDisplayDetail = {
  label: string;
  value: string;
};

type KnowledgeToolDisplay = {
  toolName: string;
  operationLabel: string;
  isSearch: boolean;
  query: string;
  requestedMaxResults: number;
  requestedTags: string[];
  totalCards: number;
  matches: KnowledgeSearchMatch[];
  sourceRepos: string[];
  details: KnowledgeDisplayDetail[];
  resultNote: string;
};

type ApplyPatchChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

type ApplyPatchFileSummary = {
  path: string;
  oldPath: string;
  newPath: string;
  change: ApplyPatchChangeKind;
  hunks: number;
  additions: number;
  deletions: number;
};

type ApplyPatchFormat = 'begin_patch' | 'unified_diff' | 'unknown';
type ApplyPatchFileFilter = 'all' | ApplyPatchChangeKind;

type ApplyPatchFileSection = {
  oldPath: string;
  newPath: string;
  change: ApplyPatchChangeKind;
  lines: string[];
};

type ApplyPatchFileDetail = {
  id: string;
  summary: ApplyPatchFileSummary;
  lines: string[];
  sectionText: string;
};

type ApplyPatchLineKind = 'context' | 'add' | 'del' | 'meta';

type ApplyPatchRenderedLine = {
  key: string;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  kind: ApplyPatchLineKind;
};

type ApplyPatchDisplay = {
  patchText: string;
  inputFormat: ApplyPatchFormat;
  normalizedFormat: ApplyPatchFormat;
  files: ApplyPatchFileSummary[];
  details: ApplyPatchFileDetail[];
  filesChanged: number;
  hunks: number;
  additions: number;
  deletions: number;
};

const WEB_SEARCH_UNKNOWN_DOMAIN_KEY = 'domain:unknown';
const WEB_SEARCH_DEFAULT_DOMAIN_KEY = 'all';
const WEB_SEARCH_VISIBLE_RESULTS = 5;
const KNOWLEDGE_VISIBLE_MATCHES = 4;
const APPLY_PATCH_SECTION_PREVIEW_LINES = 220;
const APPLY_PATCH_RAW_PREVIEW_LINES = 40;
const webSearchIntegerFormatter = new Intl.NumberFormat('en-US');
const knowledgeIntegerFormatter = new Intl.NumberFormat('en-US');
const applyPatchIntegerFormatter = new Intl.NumberFormat('en-US');

function formatApplyPatchInteger(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return applyPatchIntegerFormatter.format(Math.round(value));
}

function normalizePatchTextForDisplay(value: string): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function trimDiffPathPrefix(path: string): string {
  let normalized = String(path ?? '').trim();
  if (normalized.startsWith('a/')) normalized = normalized.slice(2);
  if (normalized.startsWith('b/')) normalized = normalized.slice(2);
  return normalized;
}

function parseDiffPathFromHeader(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const first = value.split(/\s+/)[0] ?? '';
  return trimDiffPathPrefix(first);
}

function createApplyPatchFileSummary(change: ApplyPatchChangeKind, oldPath: string, newPath: string): ApplyPatchFileSummary {
  const oldClean = trimDiffPathPrefix(oldPath);
  const newClean = trimDiffPathPrefix(newPath);
  let path = newClean || oldClean;
  if (!path || path === '/dev/null') {
    path = oldClean === '/dev/null' ? newClean : oldClean;
  }
  if (path === '/dev/null') {
    path = '';
  }
  return {
    path,
    oldPath: oldClean,
    newPath: newClean,
    change,
    hunks: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseUnifiedPatchFiles(patchText: string): ApplyPatchFileSummary[] {
  const lines = normalizePatchTextForDisplay(patchText).split('\n');
  const files: ApplyPatchFileSummary[] = [];
  let current: ApplyPatchFileSummary | null = null;

  const pushCurrent = () => {
    if (!current) return;
    if (!current.path) {
      current.path = current.newPath || current.oldPath;
    }
    files.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git ')) {
      pushCurrent();
      const parts = rawLine.trim().split(/\s+/);
      const oldPath = parts[2] ?? '';
      const newPath = parts[3] ?? '';
      current = createApplyPatchFileSummary('modified', oldPath, newPath);
      continue;
    }
    if (!current) {
      continue;
    }
    if (rawLine.startsWith('new file mode ')) {
      current.change = 'added';
      continue;
    }
    if (rawLine.startsWith('deleted file mode ')) {
      current.change = 'deleted';
      continue;
    }
    if (rawLine.startsWith('rename from ')) {
      current.change = 'renamed';
      current.oldPath = parseDiffPathFromHeader(rawLine.slice('rename from '.length));
      if (!current.path) current.path = current.oldPath;
      continue;
    }
    if (rawLine.startsWith('rename to ')) {
      current.change = 'renamed';
      current.newPath = parseDiffPathFromHeader(rawLine.slice('rename to '.length));
      current.path = current.newPath || current.path;
      continue;
    }
    if (rawLine.startsWith('--- ')) {
      current.oldPath = parseDiffPathFromHeader(rawLine.slice(4));
      if (current.oldPath === '/dev/null') {
        current.change = 'added';
      }
      if (!current.path) current.path = current.oldPath;
      continue;
    }
    if (rawLine.startsWith('+++ ')) {
      current.newPath = parseDiffPathFromHeader(rawLine.slice(4));
      if (current.newPath === '/dev/null') {
        current.change = 'deleted';
      }
      current.path = current.newPath === '/dev/null' ? current.oldPath : current.newPath;
      continue;
    }
    if (rawLine.startsWith('@@')) {
      current.hunks += 1;
      continue;
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      current.additions += 1;
      continue;
    }
    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      current.deletions += 1;
    }
  }

  pushCurrent();
  return files;
}

function isCodexPatchTopLevelHeader(line: string): boolean {
  if (!line) return false;
  return (
    line.startsWith('*** Add File: ') ||
    line.startsWith('*** Delete File: ') ||
    line.startsWith('*** Update File: ') ||
    line === '*** End Patch'
  );
}

function parseCodexPatchFiles(patchText: string): ApplyPatchFileSummary[] {
  const lines = normalizePatchTextForDisplay(patchText).split('\n');
  const files: ApplyPatchFileSummary[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = String(lines[index] ?? '').trim();
    if (!line || line === '*** Begin Patch') {
      index += 1;
      continue;
    }
    if (line === '*** End Patch') {
      break;
    }
    if (line.startsWith('*** Add File: ')) {
      const newPath = line.slice('*** Add File: '.length).trim();
      const file = createApplyPatchFileSummary('added', '/dev/null', newPath);
      index += 1;
      while (index < lines.length) {
        const bodyLine = String(lines[index] ?? '');
        const bodyTrimmed = bodyLine.trim();
        if (isCodexPatchTopLevelHeader(bodyTrimmed)) break;
        if (bodyTrimmed === '*** End of File') {
          index += 1;
          continue;
        }
        if (bodyLine.startsWith('+')) {
          file.additions += 1;
        }
        index += 1;
      }
      if (file.additions > 0) {
        file.hunks = 1;
      }
      files.push(file);
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      const oldPath = line.slice('*** Delete File: '.length).trim();
      files.push(createApplyPatchFileSummary('deleted', oldPath, '/dev/null'));
      index += 1;
      continue;
    }
    if (line.startsWith('*** Update File: ')) {
      const oldPath = line.slice('*** Update File: '.length).trim();
      const file = createApplyPatchFileSummary('modified', oldPath, oldPath);
      index += 1;
      if (index < lines.length) {
        const maybeMove = String(lines[index] ?? '').trim();
        if (maybeMove.startsWith('*** Move to: ')) {
          file.change = 'renamed';
          file.newPath = maybeMove.slice('*** Move to: '.length).trim();
          file.path = file.newPath || file.path;
          index += 1;
        }
      }
      while (index < lines.length) {
        const bodyLine = String(lines[index] ?? '');
        const bodyTrimmed = bodyLine.trim();
        if (isCodexPatchTopLevelHeader(bodyTrimmed)) break;
        if (bodyTrimmed === '*** End of File') {
          index += 1;
          continue;
        }
        if (bodyLine.startsWith('@@')) {
          file.hunks += 1;
          index += 1;
          continue;
        }
        if (bodyLine.startsWith('+')) {
          file.additions += 1;
        } else if (bodyLine.startsWith('-')) {
          file.deletions += 1;
        }
        index += 1;
      }
      if ((file.additions > 0 || file.deletions > 0) && file.hunks === 0) {
        file.hunks = 1;
      }
      files.push(file);
      continue;
    }
    index += 1;
  }
  return files;
}

function readOptionalNonNegativeInt(value: unknown): number | null {
  const parsed = readFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return null;
  return Math.floor(parsed);
}

function readApplyPatchFormat(value: unknown): ApplyPatchFormat {
  const format = String(value ?? '').trim().toLowerCase();
  if (format === 'begin_patch') return 'begin_patch';
  if (format === 'unified_diff') return 'unified_diff';
  return 'unknown';
}

function parseApplyPatchFilesFromResult(value: unknown): ApplyPatchFileSummary[] {
  if (!Array.isArray(value)) return [];
  const files: ApplyPatchFileSummary[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) continue;
    const changeRaw = String(rec.change ?? '').trim().toLowerCase();
    const change: ApplyPatchChangeKind = (
      changeRaw === 'added' ||
      changeRaw === 'modified' ||
      changeRaw === 'deleted' ||
      changeRaw === 'renamed'
    ) ? changeRaw : 'modified';
    const oldPath = trimDiffPathPrefix(String(rec.old_path ?? rec.oldPath ?? ''));
    const newPath = trimDiffPathPrefix(String(rec.new_path ?? rec.newPath ?? ''));
    let path = trimDiffPathPrefix(String(rec.path ?? ''));
    if (!path || path === '/dev/null') {
      path = newPath && newPath !== '/dev/null' ? newPath : oldPath;
    }
    files.push({
      path: path === '/dev/null' ? '' : path,
      oldPath,
      newPath,
      change,
      hunks: readOptionalNonNegativeInt(rec.hunks) ?? 0,
      additions: readOptionalNonNegativeInt(rec.additions) ?? 0,
      deletions: readOptionalNonNegativeInt(rec.deletions) ?? 0,
    });
  }
  return files;
}

function normalizeApplyPatchChange(value: string): ApplyPatchChangeKind {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'added' || normalized === 'modified' || normalized === 'deleted' || normalized === 'renamed') {
    return normalized;
  }
  return 'modified';
}

function summarizeApplyPatchSectionLines(lines: string[]): { hunks: number; additions: number; deletions: number } {
  let hunks = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      hunks += 1;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }
  if ((additions > 0 || deletions > 0) && hunks === 0) {
    hunks = 1;
  }
  return { hunks, additions, deletions };
}

function createApplyPatchSummaryFromSection(section: ApplyPatchFileSection): ApplyPatchFileSummary {
  const summary = createApplyPatchFileSummary(section.change, section.oldPath, section.newPath);
  const metrics = summarizeApplyPatchSectionLines(section.lines);
  summary.hunks = metrics.hunks;
  summary.additions = metrics.additions;
  summary.deletions = metrics.deletions;
  return summary;
}

function parseUnifiedPatchSections(patchText: string): ApplyPatchFileSection[] {
  const lines = normalizePatchTextForDisplay(patchText).split('\n');
  const sections: ApplyPatchFileSection[] = [];
  let current: ApplyPatchFileSection | null = null;

  const pushCurrent = () => {
    if (!current) return;
    sections.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git ')) {
      pushCurrent();
      const parts = rawLine.trim().split(/\s+/);
      current = {
        oldPath: trimDiffPathPrefix(parts[2] ?? ''),
        newPath: trimDiffPathPrefix(parts[3] ?? ''),
        change: 'modified',
        lines: [rawLine],
      };
      continue;
    }
    if (!current) continue;
    current.lines.push(rawLine);
    if (rawLine.startsWith('new file mode ')) {
      current.change = 'added';
      continue;
    }
    if (rawLine.startsWith('deleted file mode ')) {
      current.change = 'deleted';
      continue;
    }
    if (rawLine.startsWith('rename from ')) {
      current.change = 'renamed';
      current.oldPath = parseDiffPathFromHeader(rawLine.slice('rename from '.length));
      continue;
    }
    if (rawLine.startsWith('rename to ')) {
      current.change = 'renamed';
      current.newPath = parseDiffPathFromHeader(rawLine.slice('rename to '.length));
      continue;
    }
    if (rawLine.startsWith('--- ')) {
      const oldPath = parseDiffPathFromHeader(rawLine.slice(4));
      if (oldPath) {
        current.oldPath = oldPath;
        if (oldPath === '/dev/null') {
          current.change = 'added';
        }
      }
      continue;
    }
    if (rawLine.startsWith('+++ ')) {
      const newPath = parseDiffPathFromHeader(rawLine.slice(4));
      if (newPath) {
        current.newPath = newPath;
        if (newPath === '/dev/null') {
          current.change = 'deleted';
        }
      }
    }
  }

  pushCurrent();
  return sections;
}

function parseBeginPatchSections(patchText: string): ApplyPatchFileSection[] {
  const lines = normalizePatchTextForDisplay(patchText).split('\n');
  const sections: ApplyPatchFileSection[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = String(lines[index] ?? '');
    const trimmed = line.trim();
    if (!trimmed || trimmed === '*** Begin Patch') {
      index += 1;
      continue;
    }
    if (trimmed === '*** End Patch') {
      break;
    }

    if (trimmed.startsWith('*** Add File: ')) {
      const newPath = trimmed.slice('*** Add File: '.length).trim();
      const section: ApplyPatchFileSection = {
        oldPath: '/dev/null',
        newPath,
        change: 'added',
        lines: [line],
      };
      index += 1;
      while (index < lines.length) {
        const bodyLine = String(lines[index] ?? '');
        const bodyTrimmed = bodyLine.trim();
        if (isCodexPatchTopLevelHeader(bodyTrimmed)) break;
        section.lines.push(bodyLine);
        index += 1;
      }
      sections.push(section);
      continue;
    }

    if (trimmed.startsWith('*** Delete File: ')) {
      const oldPath = trimmed.slice('*** Delete File: '.length).trim();
      sections.push({
        oldPath,
        newPath: '/dev/null',
        change: 'deleted',
        lines: [line],
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('*** Update File: ')) {
      const oldPath = trimmed.slice('*** Update File: '.length).trim();
      const section: ApplyPatchFileSection = {
        oldPath,
        newPath: oldPath,
        change: 'modified',
        lines: [line],
      };
      index += 1;
      if (index < lines.length) {
        const moveLine = String(lines[index] ?? '');
        const moveTrimmed = moveLine.trim();
        if (moveTrimmed.startsWith('*** Move to: ')) {
          section.change = 'renamed';
          section.newPath = moveTrimmed.slice('*** Move to: '.length).trim();
          section.lines.push(moveLine);
          index += 1;
        }
      }
      while (index < lines.length) {
        const bodyLine = String(lines[index] ?? '');
        const bodyTrimmed = bodyLine.trim();
        if (isCodexPatchTopLevelHeader(bodyTrimmed)) break;
        section.lines.push(bodyLine);
        index += 1;
      }
      sections.push(section);
      continue;
    }

    index += 1;
  }

  return sections;
}

function buildApplyPatchFileDetails(
  files: ApplyPatchFileSummary[],
  patchText: string,
  inputFormat: ApplyPatchFormat,
): ApplyPatchFileDetail[] {
  let sections: ApplyPatchFileSection[] = [];
  if (patchText) {
    if (inputFormat === 'begin_patch') {
      sections = parseBeginPatchSections(patchText);
    } else if (inputFormat === 'unified_diff') {
      sections = parseUnifiedPatchSections(patchText);
    }
  }

  const total = Math.max(files.length, sections.length);
  if (total === 0) return [];

  const details: ApplyPatchFileDetail[] = [];
  for (let index = 0; index < total; index += 1) {
    const section = sections[index] ?? null;
    const summary = files[index] ?? (section ? createApplyPatchSummaryFromSection(section) : null);
    if (!summary) continue;

    const mergedSummary: ApplyPatchFileSummary = {
      path: summary.path || section?.newPath || section?.oldPath || '',
      oldPath: summary.oldPath || section?.oldPath || '',
      newPath: summary.newPath || section?.newPath || '',
      change: normalizeApplyPatchChange(summary.change || section?.change || 'modified'),
      hunks: summary.hunks,
      additions: summary.additions,
      deletions: summary.deletions,
    };

    if (section && (mergedSummary.hunks === 0 && mergedSummary.additions === 0 && mergedSummary.deletions === 0)) {
      const fallback = summarizeApplyPatchSectionLines(section.lines);
      mergedSummary.hunks = fallback.hunks;
      mergedSummary.additions = fallback.additions;
      mergedSummary.deletions = fallback.deletions;
    }

    const lines = section?.lines ?? [];
    const identity = mergedSummary.path || mergedSummary.newPath || mergedSummary.oldPath || `file-${index + 1}`;
    details.push({
      id: String(index) + ':' + identity,
      summary: mergedSummary,
      lines,
      sectionText: lines.join('\n'),
    });
  }

  return details;
}

function parseApplyPatchRenderedLines(lines: string[]): ApplyPatchRenderedLine[] {
  const rendered: ApplyPatchRenderedLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  const hunkHeaderRE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] ?? '');

    if (line.startsWith('@@')) {
      const match = line.match(hunkHeaderRE);
      if (match) {
        oldLineNumber = Number(match[1]);
        newLineNumber = Number(match[2]);
      }
      rendered.push({
        key: String(index) + ':meta',
        text: line,
        oldLine: null,
        newLine: null,
        kind: 'meta',
      });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      rendered.push({
        key: String(index) + ':add',
        text: line,
        oldLine: null,
        newLine: newLineNumber,
        kind: 'add',
      });
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      rendered.push({
        key: String(index) + ':del',
        text: line,
        oldLine: oldLineNumber,
        newLine: null,
        kind: 'del',
      });
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      rendered.push({
        key: String(index) + ':ctx',
        text: line,
        oldLine: oldLineNumber,
        newLine: newLineNumber,
        kind: 'context',
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    rendered.push({
      key: String(index) + ':meta-fallback',
      text: line,
      oldLine: null,
      newLine: null,
      kind: 'meta',
    });
  }

  return rendered;
}

function formatApplyPatchLineNumber(value: number | null): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

function buildApplyPatchDisplay(block: ToolCallBlockType): ApplyPatchDisplay | null {
  if (String(block.toolName ?? '').trim() !== APPLY_PATCH_TOOL_NAME) {
    return null;
  }
  const args = asRecord(block.args);
  const result = asRecord(block.result);
  const rawPatchText = typeof args?.patch === 'string' ? args.patch : '';
  const patchText = normalizePatchTextForDisplay(rawPatchText).trim();

  let inferredInputFormat: ApplyPatchFormat = 'unknown';
  let files: ApplyPatchFileSummary[] = parseApplyPatchFilesFromResult(result?.files);
  if (patchText.startsWith('*** Begin Patch')) {
    inferredInputFormat = 'begin_patch';
    if (files.length === 0) {
      files = parseCodexPatchFiles(patchText);
    }
  } else if (patchText.includes('diff --git ')) {
    inferredInputFormat = 'unified_diff';
    if (files.length === 0) {
      files = parseUnifiedPatchFiles(patchText);
    }
  }

  const resultInputFormat = readApplyPatchFormat(result?.input_format ?? result?.inputFormat);
  const resultNormalizedFormat = readApplyPatchFormat(result?.normalized_format ?? result?.normalizedFormat);
  const inputFormat = resultInputFormat === 'unknown' ? inferredInputFormat : resultInputFormat;
  let normalizedFormat: ApplyPatchFormat = resultNormalizedFormat;
  if (normalizedFormat === 'unknown') {
    normalizedFormat = inputFormat === 'unknown' ? 'begin_patch' : inputFormat;
  }

  const details = buildApplyPatchFileDetails(files, patchText, inputFormat);
  if (files.length === 0 && details.length > 0) {
    files = details.map((detail) => detail.summary);
  }

  const derivedFilesChanged = files.length;
  const derivedHunks = files.reduce((sum, file) => sum + file.hunks, 0);
  const derivedAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const derivedDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  const filesChanged = readOptionalNonNegativeInt(result?.files_changed ?? result?.filesChanged) ?? derivedFilesChanged;
  const hunks = readOptionalNonNegativeInt(result?.hunks) ?? derivedHunks;
  const additions = readOptionalNonNegativeInt(result?.additions) ?? derivedAdditions;
  const deletions = readOptionalNonNegativeInt(result?.deletions) ?? derivedDeletions;

  return {
    patchText,
    inputFormat,
    normalizedFormat,
    files,
    details,
    filesChanged,
    hunks,
    additions,
    deletions,
  };
}

function applyPatchStateLabel(status: ToolCallBlockType['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Applying';
    case 'success':
      return 'Applied';
    case 'error':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

function applyPatchStateClass(status: ToolCallBlockType['status']): string {
  switch (status) {
    case 'pending':
    case 'running':
      return 'chat-tool-apply-patch-state-running';
    case 'success':
      return 'chat-tool-apply-patch-state-success';
    case 'error':
      return 'chat-tool-apply-patch-state-error';
    default:
      return '';
  }
}

function applyPatchChangeLabel(change: ApplyPatchChangeKind): string {
  switch (change) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'modified':
    default:
      return 'Updated';
  }
}

function applyPatchChangeClass(change: ApplyPatchChangeKind): string {
  switch (change) {
    case 'added':
      return 'chat-tool-apply-patch-change-added';
    case 'deleted':
      return 'chat-tool-apply-patch-change-deleted';
    case 'renamed':
      return 'chat-tool-apply-patch-change-renamed';
    case 'modified':
    default:
      return 'chat-tool-apply-patch-change-modified';
  }
}

function formatWebSearchInteger(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return webSearchIntegerFormatter.format(Math.round(value));
}

function normalizeWebSearchProvider(provider: string): string {
  const normalized = String(provider ?? '').trim().toLowerCase();
  if (!normalized) return 'Default';
  if (normalized === 'brave') return 'Brave';
  return normalized
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function normalizeWebSearchURL(rawURL: unknown): string {
  const value = asTrimmedString(rawURL);
  if (!value) return '';
  const lower = value.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return '';
  }
  return value;
}

function readWebSearchDomain(url: string): { key: string; label: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.trim().toLowerCase().replace(/^www\./, '');
    if (!host) return { key: WEB_SEARCH_UNKNOWN_DOMAIN_KEY, label: 'Unknown host' };
    return { key: `domain:${host}`, label: host };
  } catch {
    return { key: WEB_SEARCH_UNKNOWN_DOMAIN_KEY, label: 'Unknown host' };
  }
}

function normalizeWebSearchItems(rawItems: unknown): WebSearchItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  const seen = new Set<string>();
  const items: WebSearchItem[] = [];
  for (const raw of rawItems) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const url = normalizeWebSearchURL(rec.url ?? rec.link);
    if (!url) continue;
    const dedupeKey = url.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const title = asTrimmedString(rec.title) || url;
    const snippet = asTrimmedString(rec.snippet ?? rec.description).replace(/\s+/g, ' ').trim();
    const domain = readWebSearchDomain(url);
    items.push({
      title,
      url,
      snippet,
      domainKey: domain.key,
      domainLabel: domain.label,
    });
  }
  return items;
}

function buildWebSearchDisplay(block: ToolCallBlockType): WebSearchDisplay | null {
  if (String(block.toolName ?? '').trim() !== WEB_SEARCH_TOOL_NAME) {
    return null;
  }
  const args = asRecord(block.args);
  const result = asRecord(block.result);
  const query = asTrimmedString(result?.query) || asTrimmedString(args?.query);
  const provider = asTrimmedString(result?.provider) || asTrimmedString(args?.provider);
  const requestedCount = Math.max(0, Math.floor(readFiniteNumber(args?.count, 0)));
  const timeoutMs = Math.max(0, Math.floor(readFiniteNumber(args?.timeout_ms ?? args?.timeoutMs, 0)));

  const mergedItems: unknown[] = [];
  const resultItems = Array.isArray(result?.results) ? (result?.results as unknown[]) : [];
  if (resultItems.length > 0) mergedItems.push(...resultItems);
  const sourceItems = Array.isArray(result?.sources) ? (result?.sources as unknown[]) : [];
  if (sourceItems.length > 0) mergedItems.push(...sourceItems);

  const items = normalizeWebSearchItems(mergedItems);

  const domainStats = new Map<string, WebSearchDomainFilter>();
  for (const item of items) {
    const existing = domainStats.get(item.domainKey);
    if (existing) {
      existing.count += 1;
      continue;
    }
    domainStats.set(item.domainKey, {
      id: item.domainKey,
      label: item.domainLabel,
      count: 1,
    });
  }

  const domains = Array.from(domainStats.values()).sort((a, b) => {
    const countDelta = b.count - a.count;
    if (countDelta !== 0) return countDelta;
    return a.label.localeCompare(b.label);
  });

  return {
    query,
    provider,
    requestedCount,
    timeoutMs,
    items,
    domains,
  };
}

function formatKnowledgeInteger(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return knowledgeIntegerFormatter.format(Math.round(value));
}

function summarizeKnowledgeText(value: string, maxLength = 190): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeKnowledgeStringList(value: unknown, maxItems = 10): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value) {
    const text = summarizeKnowledgeText(asTrimmedString(raw), 88);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

function isKnowledgeToolName(toolName: string): boolean {
  return asTrimmedString(toolName).toLowerCase().startsWith(KNOWLEDGE_TOOL_PREFIX);
}

function normalizeKnowledgeOperationLabel(toolName: string): string {
  const normalizedToolName = asTrimmedString(toolName).toLowerCase();
  let operation = normalizedToolName;
  if (operation.startsWith(KNOWLEDGE_TOOL_PREFIX)) {
    operation = operation.slice(KNOWLEDGE_TOOL_PREFIX.length);
  }
  if (!operation) return 'Tool';
  const segments = operation
    .split('.')
    .flatMap((segment) => segment.split(/[^a-z0-9]+/i))
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return 'Tool';
  return segments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatKnowledgeScalar(value: unknown, maxLength = 170): string {
  if (typeof value === 'string') {
    return summarizeKnowledgeText(value, maxLength);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return formatKnowledgeInteger(value);
    }
    return summarizeKnowledgeText(String(value), maxLength);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (!Array.isArray(value)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const text = formatKnowledgeScalar(item, 64);
      if (!text) continue;
      parts.push(text);
    }
    if (parts.length >= 4) break;
  }
  if (parts.length === 0) return '';
  return summarizeKnowledgeText(parts.join(', '), maxLength);
}

function appendKnowledgeDetail(
  details: KnowledgeDisplayDetail[],
  label: string,
  value: unknown,
  maxLength = 170,
): void {
  const text = formatKnowledgeScalar(value, maxLength);
  if (!text) return;
  if (details.some((item) => item.label === label && item.value === text)) return;
  details.push({ label, value: text });
}

function normalizeKnowledgeMatches(rawMatches: unknown): KnowledgeSearchMatch[] {
  if (!Array.isArray(rawMatches)) {
    return [];
  }
  const seen = new Set<string>();
  const matches: KnowledgeSearchMatch[] = [];
  for (let index = 0; index < rawMatches.length; index += 1) {
    const rec = asRecord(rawMatches[index]);
    if (!rec) continue;
    const cardId = asTrimmedString(rec.card_id ?? rec.cardId);
    const title = summarizeKnowledgeText(asTrimmedString(rec.title), 128) || cardId || `Card ${index + 1}`;
    const summary = summarizeKnowledgeText(asTrimmedString(rec.summary), 320);
    const score = Math.max(0, Math.floor(readFiniteNumber(rec.score, 0)));
    const tags = normalizeKnowledgeStringList(rec.tags, 6);
    const sourceRepos = normalizeKnowledgeStringList(rec.source_repos ?? rec.sourceRepos, 5);
    const dedupeKey = `${cardId.toLowerCase()}\u001f${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    matches.push({
      cardId,
      title,
      summary,
      score,
      tags,
      sourceRepos,
    });
  }
  return matches;
}

function collectKnowledgeSourceRepos(matches: KnowledgeSearchMatch[]): string[] {
  if (matches.length === 0) return [];
  const seen = new Set<string>();
  const repos: string[] = [];
  for (const match of matches) {
    for (const rawRepo of match.sourceRepos) {
      const repo = asTrimmedString(rawRepo);
      if (!repo) continue;
      const key = repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(repo);
    }
  }
  repos.sort((a, b) => a.localeCompare(b));
  return repos;
}

function buildKnowledgeResultNote(
  result: Record<string, unknown> | null,
  rawResult: unknown,
): string {
  const candidates = [
    asTrimmedString(result?.message),
    asTrimmedString(result?.summary),
    asTrimmedString(result?.detail),
    asTrimmedString(result?.note),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    return summarizeKnowledgeText(candidate, 260);
  }
  if (!result) {
    return formatKnowledgeScalar(rawResult, 260);
  }
  return '';
}

function buildKnowledgeDetails(
  args: Record<string, unknown> | null,
  result: Record<string, unknown> | null,
  rawResult: unknown,
): KnowledgeDisplayDetail[] {
  const details: KnowledgeDisplayDetail[] = [];
  appendKnowledgeDetail(details, 'Action', args?.action, 76);
  appendKnowledgeDetail(details, 'Scope', result?.scope ?? args?.scope, 96);
  appendKnowledgeDetail(details, 'Knowledge ID', result?.knowledge_id ?? result?.knowledgeId, 96);
  appendKnowledgeDetail(details, 'Knowledge name', result?.knowledge_name ?? result?.knowledgeName, 112);
  appendKnowledgeDetail(details, 'Version', result?.version ?? result?.bundle_version ?? result?.bundleVersion, 76);
  appendKnowledgeDetail(details, 'Status', result?.status, 76);
  appendKnowledgeDetail(details, 'Updated', result?.updated_at ?? result?.updatedAt, 96);

  const resultItems = result?.items;
  if (Array.isArray(resultItems)) {
    appendKnowledgeDetail(details, 'Items', resultItems.length);
  }
  const resultWarnings = normalizeKnowledgeStringList(result?.warnings, 2);
  if (resultWarnings.length > 0) {
    appendKnowledgeDetail(details, 'Warnings', resultWarnings.join(' | '), 220);
  }

  if (details.length === 0 && !result) {
    appendKnowledgeDetail(details, 'Result', rawResult, 220);
  }
  if (details.length <= 6) return details;
  return details.slice(0, 6);
}

function buildKnowledgeToolDisplay(block: ToolCallBlockType): KnowledgeToolDisplay | null {
  const toolName = asTrimmedString(block.toolName);
  if (!isKnowledgeToolName(toolName)) {
    return null;
  }

  const normalizedToolName = toolName.toLowerCase();
  const args = asRecord(block.args);
  const result = asRecord(block.result);
  const query = asTrimmedString(result?.query) || asTrimmedString(args?.query);
  const requestedMaxResults = Math.max(
    0,
    Math.floor(readFiniteNumber(
      args?.max_results ?? args?.maxResults ?? result?.max_results ?? result?.maxResults,
      0,
    )),
  );
  const requestedTags = normalizeKnowledgeStringList(args?.tags ?? result?.tags, 8);
  const totalCards = Math.max(0, Math.floor(readFiniteNumber(result?.total_cards ?? result?.totalCards, 0)));
  const matches = normalizeKnowledgeMatches(result?.matches ?? result?.results ?? result?.cards);
  const sourceRepos = collectKnowledgeSourceRepos(matches);
  const details = buildKnowledgeDetails(args, result, block.result);
  const resultNote = buildKnowledgeResultNote(result, block.result);

  return {
    toolName,
    operationLabel: normalizeKnowledgeOperationLabel(toolName),
    isSearch: normalizedToolName === KNOWLEDGE_SEARCH_TOOL_NAME,
    query,
    requestedMaxResults,
    requestedTags,
    totalCards,
    matches,
    sourceRepos,
    details,
    resultNote,
  };
}

function knowledgeStateLabel(status: ToolCallBlockType['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'success':
      return 'Completed';
    case 'error':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

function knowledgeStateClass(status: ToolCallBlockType['status']): string {
  switch (status) {
    case 'pending':
    case 'running':
      return 'chat-tool-knowledge-state-running';
    case 'success':
      return 'chat-tool-knowledge-state-success';
    case 'error':
      return 'chat-tool-knowledge-state-error';
    default:
      return '';
  }
}

function webSearchStateLabel(status: ToolCallBlockType['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Searching';
    case 'success':
      return 'Completed';
    case 'error':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

function webSearchStateClass(status: ToolCallBlockType['status']): string {
  switch (status) {
    case 'pending':
    case 'running':
      return 'chat-tool-web-search-state-running';
    case 'success':
      return 'chat-tool-web-search-state-success';
    case 'error':
      return 'chat-tool-web-search-state-error';
    default:
      return '';
  }
}

function isLegacyWebSearchMarkdownChild(block: unknown): boolean {
  const rec = asRecord(block);
  if (!rec) return false;
  if (String(rec.type ?? '').trim().toLowerCase() !== 'markdown') {
    return false;
  }
  const content = asTrimmedString(rec.content).toLowerCase();
  return content.startsWith('top results:');
}

async function copyToolText(text: string): Promise<boolean> {
  const value = String(text ?? '').trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function applyPatchFormatLabel(format: ApplyPatchFormat): string {
  switch (format) {
    case 'begin_patch':
      return 'Begin Patch';
    case 'unified_diff':
      return 'Unified Diff';
    default:
      return 'Patch';
  }
}

function applyPatchPreviewLineClass(line: string): string {
  if (!line) return '';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'chat-tool-apply-patch-line-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'chat-tool-apply-patch-line-del';
  if (
    line.startsWith('@@') ||
    line.startsWith('*** ') ||
    line.startsWith('diff --git ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  ) {
    return 'chat-tool-apply-patch-line-meta';
  }
  return '';
}

function applyPatchRenderedLineClass(line: ApplyPatchRenderedLine): string {
  switch (line.kind) {
    case 'add':
      return 'chat-tool-apply-patch-detail-line-add';
    case 'del':
      return 'chat-tool-apply-patch-detail-line-del';
    case 'meta':
      return 'chat-tool-apply-patch-detail-line-meta';
    case 'context':
    default:
      return '';
  }
}

function applyPatchFilterLabel(filter: ApplyPatchFileFilter): string {
  switch (filter) {
    case 'added':
      return 'Added';
    case 'modified':
      return 'Updated';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'all':
    default:
      return 'All';
  }
}

function applyPatchFileName(summary: ApplyPatchFileSummary): string {
  const fullPath = summary.path || summary.newPath || summary.oldPath || '';
  if (!fullPath) return '(unknown)';
  const lastSlash = fullPath.lastIndexOf('/');
  return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
}

function applyPatchDotClass(change: ApplyPatchChangeKind): string {
  switch (change) {
    case 'added': return 'chat-tool-apply-patch-dot-added';
    case 'modified': return 'chat-tool-apply-patch-dot-modified';
    case 'deleted': return 'chat-tool-apply-patch-dot-deleted';
    case 'renamed': return 'chat-tool-apply-patch-dot-renamed';
    default: return '';
  }
}

interface ApplyPatchToolCardProps {
  block: ToolCallBlockType;
  messageId: string;
  blockIndex: number;
  display: ApplyPatchDisplay;
  class?: string;
}

const ApplyPatchToolCard: Component<ApplyPatchToolCardProps> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const [copiedDetailID, setCopiedDetailID] = createSignal('');
  const [activeFilter, setActiveFilter] = createSignal<ApplyPatchFileFilter>('all');
  const [selectedDetailID, setSelectedDetailID] = createSignal('');
  const [sectionExpanded, setSectionExpanded] = createSignal(false);

  const filterItems = createMemo(() => {
    const counts: Record<ApplyPatchChangeKind, number> = {
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
    };
    for (const detail of props.display.details) {
      counts[detail.summary.change] += 1;
    }
    const items: Array<{ filter: ApplyPatchFileFilter; count: number }> = [{
      filter: 'all',
      count: props.display.details.length,
    }];
    (['added', 'modified', 'deleted', 'renamed'] as const).forEach((filter) => {
      if (counts[filter] > 0) {
        items.push({ filter, count: counts[filter] });
      }
    });
    return items;
  });

  createEffect(() => {
    const available = filterItems();
    if (!available.some((item) => item.filter === activeFilter())) {
      setActiveFilter('all');
    }
  });

  const filteredDetails = createMemo(() => {
    const filter = activeFilter();
    if (filter === 'all') {
      return props.display.details;
    }
    return props.display.details.filter((detail) => detail.summary.change === filter);
  });

  createEffect(() => {
    const details = filteredDetails();
    if (details.length === 0) {
      setSelectedDetailID('');
      return;
    }
    if (!details.some((detail) => detail.id === selectedDetailID())) {
      setSelectedDetailID(details[0].id);
    }
  });

  createEffect(() => {
    selectedDetailID();
    setSectionExpanded(false);
  });

  const selectedDetail = createMemo<ApplyPatchFileDetail | null>(() => {
    const details = filteredDetails();
    if (details.length === 0) return null;
    const matched = details.find((detail) => detail.id === selectedDetailID());
    return matched ?? details[0];
  });

  const selectedRenderedLines = createMemo<ApplyPatchRenderedLine[]>(() => {
    const detail = selectedDetail();
    if (!detail || detail.lines.length === 0) return [];
    return parseApplyPatchRenderedLines(detail.lines);
  });

  const visibleRenderedLines = createMemo(() => {
    const lines = selectedRenderedLines();
    if (sectionExpanded()) {
      return lines;
    }
    return lines.slice(0, APPLY_PATCH_SECTION_PREVIEW_LINES);
  });

  const hasMoreSectionLines = createMemo(() => selectedRenderedLines().length > APPLY_PATCH_SECTION_PREVIEW_LINES);

  const handleCopyPatch = async () => {
    if (!props.display.patchText) return;
    const ok = await copyToolText(props.display.patchText);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const handleCopySelectedDetail = async () => {
    const detail = selectedDetail();
    if (!detail || !detail.sectionText) return;
    const ok = await copyToolText(detail.sectionText);
    if (!ok) return;
    setCopiedDetailID(detail.id);
    window.setTimeout(() => setCopiedDetailID(''), 1400);
  };

  return (
    <div class={cn('chat-tool-apply-patch-block', props.class)}>
      <div class="chat-tool-apply-patch-head">
        <div class="chat-tool-apply-patch-head-main">
          <span class="chat-tool-apply-patch-badge">Patch</span>
          <span class="chat-tool-apply-patch-head-stats">
            {formatApplyPatchInteger(props.display.filesChanged)} files
            {' \u00B7 '}
            <span class="chat-tool-apply-patch-head-add">+{formatApplyPatchInteger(props.display.additions)}</span>
            {' '}
            <span class="chat-tool-apply-patch-head-del">{'\u2212'}{formatApplyPatchInteger(props.display.deletions)}</span>
          </span>
          <span class={cn('chat-tool-apply-patch-state', applyPatchStateClass(props.block.status))}>
            <Show when={props.block.status === 'pending' || props.block.status === 'running'}>
              <span class="chat-tool-apply-patch-state-loader">
                <SnakeLoader size="sm" class="chat-tool-inline-snake-loader" />
              </span>
            </Show>
            {applyPatchStateLabel(props.block.status)}
          </span>
        </div>

        <button
          type="button"
          class="chat-tool-apply-patch-copy"
          onClick={() => void handleCopyPatch()}
          disabled={!props.display.patchText}
        >
          {copied() ? 'Copied' : 'Copy patch'}
        </button>
      </div>

      <Show when={props.display.details.length > 0}>
        <Show when={filterItems().length > 2}>
          <div class="chat-tool-apply-patch-filters">
            <For each={filterItems()}>
              {(item) => (
                <button
                  type="button"
                  class={cn(
                    'chat-tool-apply-patch-filter-btn',
                    activeFilter() === item.filter && 'chat-tool-apply-patch-filter-btn-active',
                  )}
                  onClick={() => setActiveFilter(item.filter)}
                >
                  {applyPatchFilterLabel(item.filter)} {formatApplyPatchInteger(item.count)}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="chat-tool-apply-patch-tabs-wrap">
          <div class="chat-tool-apply-patch-tabs">
            <For each={filteredDetails()}>
              {(detail) => (
                <button
                  type="button"
                  class={cn(
                    'chat-tool-apply-patch-tab',
                    selectedDetailID() === detail.id && 'chat-tool-apply-patch-tab-active',
                  )}
                  onClick={() => setSelectedDetailID(detail.id)}
                  title={detail.summary.path || detail.summary.newPath || detail.summary.oldPath || ''}
                >
                  <span class={cn('chat-tool-apply-patch-tab-dot', applyPatchDotClass(detail.summary.change))} />
                  <span class="chat-tool-apply-patch-tab-name">
                    {applyPatchFileName(detail.summary)}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="chat-tool-apply-patch-detail-panel">
          <Show when={selectedDetail()} fallback={<div class="chat-tool-apply-patch-detail-empty">No file changes in this filter.</div>}>
            {(detailAccessor) => {
              const detail = detailAccessor();
              const summary = detail.summary;
              return (
                <>
                  <div class="chat-tool-apply-patch-detail-head">
                    <div class="chat-tool-apply-patch-detail-main">
                      <span class={cn('chat-tool-apply-patch-change', applyPatchChangeClass(summary.change))}>
                        {applyPatchChangeLabel(summary.change)}
                      </span>
                      <span class="chat-tool-apply-patch-detail-path" title={summary.path || summary.newPath || summary.oldPath}>
                        {summary.path || summary.newPath || summary.oldPath || '(unknown path)'}
                      </span>
                      <span class="chat-tool-apply-patch-detail-metrics">
                        +{formatApplyPatchInteger(summary.additions)} / {'\u2212'}{formatApplyPatchInteger(summary.deletions)}
                        <Show when={summary.hunks > 0}>
                          <> {'\u00B7'} {formatApplyPatchInteger(summary.hunks)} hunks</>
                        </Show>
                      </span>
                    </div>
                    <button
                      type="button"
                      class="chat-tool-apply-patch-copy chat-tool-apply-patch-copy-inline"
                      onClick={() => void handleCopySelectedDetail()}
                      disabled={!detail.sectionText}
                    >
                      {copiedDetailID() === detail.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>

                  <Show when={summary.change === 'renamed' && summary.oldPath && summary.newPath}>
                    <div class="chat-tool-apply-patch-rename-row">
                      <span class="chat-tool-apply-patch-rename-path" title={summary.oldPath}>{summary.oldPath}</span>
                      <span class="chat-tool-apply-patch-rename-arrow">{'\u2192'}</span>
                      <span class="chat-tool-apply-patch-rename-path" title={summary.newPath}>{summary.newPath}</span>
                    </div>
                  </Show>

                  <Show when={visibleRenderedLines().length > 0} fallback={<div class="chat-tool-apply-patch-detail-empty">No inline diff lines available for this file.</div>}>
                    <div class="chat-tool-apply-patch-detail-code">
                      <For each={visibleRenderedLines()}>
                        {(line) => (
                          <div class={cn('chat-tool-apply-patch-detail-line', applyPatchRenderedLineClass(line))}>
                            <span class="chat-tool-apply-patch-detail-line-num">{formatApplyPatchLineNumber(line.oldLine)}</span>
                            <span class="chat-tool-apply-patch-detail-line-num">{formatApplyPatchLineNumber(line.newLine)}</span>
                            <span class={cn('chat-tool-apply-patch-detail-line-text', applyPatchPreviewLineClass(line.text))}>{line.text}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={hasMoreSectionLines()}>
                    <div class="chat-tool-apply-patch-toggle-row">
                      <button
                        type="button"
                        class="chat-tool-apply-patch-toggle-btn"
                        onClick={() => setSectionExpanded((value) => !value)}
                      >
                        {sectionExpanded()
                          ? 'Show less'
                          : `Show all ${selectedRenderedLines().length} lines`}
                      </button>
                    </div>
                  </Show>
                </>
              );
            }}
          </Show>
        </div>
      </Show>

      <Show when={props.display.details.length === 0 && props.display.patchText}>
        <div class="chat-tool-apply-patch-preview-wrap">
          <div class="chat-tool-apply-patch-preview-label">Raw patch</div>
          <pre class="chat-tool-apply-patch-preview">
            <For each={props.display.patchText!.split('\n').slice(0, APPLY_PATCH_RAW_PREVIEW_LINES)}>
              {(line) => (
                <span class={cn('chat-tool-apply-patch-line', applyPatchPreviewLineClass(line))}>
                  {line}
                </span>
              )}
            </For>
          </pre>
        </div>
      </Show>

      <Show when={props.block.error}>
        <div class="chat-tool-apply-patch-error">{props.block.error}</div>
      </Show>

      <Show when={props.block.children && props.block.children.length > 0}>
        <div class="chat-tool-apply-patch-children">
          <For each={props.block.children}>
            {(child) => (
              <BlockRenderer
                block={child}
                messageId={props.messageId}
                blockIndex={props.blockIndex}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

interface WebSearchToolCardProps {
  block: ToolCallBlockType;
  messageId: string;
  blockIndex: number;
  display: WebSearchDisplay;
  class?: string;
}

const WebSearchToolCard: Component<WebSearchToolCardProps> = (props) => {
  const [activeDomain, setActiveDomain] = createSignal(WEB_SEARCH_DEFAULT_DOMAIN_KEY);
  const [copiedURL, setCopiedURL] = createSignal('');
  const [copiedQuery, setCopiedQuery] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  const domainFilters = createMemo<WebSearchDomainFilter[]>(() => {
    const filters: WebSearchDomainFilter[] = [{
      id: WEB_SEARCH_DEFAULT_DOMAIN_KEY,
      label: 'All',
      count: props.display.items.length,
    }];
    filters.push(...props.display.domains.slice(0, 6));
    return filters;
  });

  const filteredItems = createMemo(() => {
    const targetDomain = activeDomain();
    if (targetDomain === WEB_SEARCH_DEFAULT_DOMAIN_KEY) {
      return props.display.items;
    }
    return props.display.items.filter((item) => item.domainKey === targetDomain);
  });

  const visibleItems = createMemo(() => {
    if (expanded()) {
      return filteredItems();
    }
    return filteredItems().slice(0, WEB_SEARCH_VISIBLE_RESULTS);
  });

  const hiddenCount = createMemo(() => Math.max(0, filteredItems().length - visibleItems().length));
  const canToggleExpand = createMemo(() => filteredItems().length > WEB_SEARCH_VISIBLE_RESULTS);
  const statusLabel = createMemo(() => webSearchStateLabel(props.block.status));
  const statusClass = createMemo(() => webSearchStateClass(props.block.status));
  const providerLabel = createMemo(() => normalizeWebSearchProvider(props.display.provider));
  const isWorking = createMemo(() => props.block.status === 'pending' || props.block.status === 'running');
  const visibleChildren = createMemo(() => {
    const children = Array.isArray(props.block.children) ? props.block.children : [];
    return children.filter((child) => !isLegacyWebSearchMarkdownChild(child));
  });
  const emptyMessage = createMemo(() => {
    if (isWorking()) return 'Searching the web...';
    if (props.block.status === 'success') return 'No results returned.';
    return 'No web results available.';
  });

  createEffect(() => {
    const filters = domainFilters();
    const selected = activeDomain();
    if (filters.some((item) => item.id === selected)) {
      return;
    }
    setActiveDomain(WEB_SEARCH_DEFAULT_DOMAIN_KEY);
  });

  createEffect(() => {
    activeDomain();
    setExpanded(false);
  });

  const handleCopyQuery = async () => {
    if (!props.display.query) return;
    const copied = await copyToolText(props.display.query);
    if (!copied) return;
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 1600);
  };

  const handleCopyURL = async (url: string) => {
    const copied = await copyToolText(url);
    if (!copied) return;
    setCopiedURL(url);
    setTimeout(() => {
      setCopiedURL((current) => (current === url ? '' : current));
    }, 1600);
  };

  return (
    <div class={cn('chat-tool-web-search-block', props.class)}>
      <div class="chat-tool-web-search-head">
        <div class="chat-tool-web-search-head-main">
          <span class="chat-tool-web-search-badge">Web search</span>
          <span class="chat-tool-web-search-provider">{providerLabel()}</span>
          <span class={cn('chat-tool-web-search-state', statusClass())}>
            {statusLabel()}
          </span>
        </div>
        <Show when={props.display.query}>
          <button
            class="chat-tool-web-search-copy-query"
            type="button"
            onClick={() => void handleCopyQuery()}
            aria-label={copiedQuery() ? 'Query copied' : 'Copy search query'}
            title={copiedQuery() ? 'Copied' : 'Copy query'}
          >
            <Show when={copiedQuery()} fallback={<CopyMiniIcon />}>
              <CheckMiniIcon />
            </Show>
            <span>{copiedQuery() ? 'Copied' : 'Copy query'}</span>
          </button>
        </Show>
      </div>

      <Show when={props.display.query}>
        <div class="chat-tool-web-search-query-row">
          <span class="chat-tool-web-search-query-label">Query</span>
          <p class="chat-tool-web-search-query-text">{props.display.query}</p>
        </div>
      </Show>

      <div class="chat-tool-web-search-meta">
        <span>{formatWebSearchInteger(filteredItems().length)} result{filteredItems().length === 1 ? '' : 's'}</span>
        <Show when={props.display.requestedCount > 0}>
          <span>Requested {formatWebSearchInteger(props.display.requestedCount)}</span>
        </Show>
        <Show when={props.display.timeoutMs > 0}>
          <span>Timeout {Math.max(1, Math.floor(props.display.timeoutMs / 1000))}s</span>
        </Show>
      </div>

      <Show when={domainFilters().length > 1}>
        <div class="chat-tool-web-search-domain-filters" role="tablist" aria-label="Filter search results by domain">
          <For each={domainFilters()}>
            {(item) => (
              <button
                type="button"
                class={cn(
                  'chat-tool-web-search-domain-chip',
                  activeDomain() === item.id && 'chat-tool-web-search-domain-chip-active',
                )}
                onClick={() => setActiveDomain(item.id)}
                role="tab"
                aria-selected={activeDomain() === item.id}
              >
                <span>{item.label}</span>
                <span class="chat-tool-web-search-domain-chip-count">{item.count}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={visibleItems().length > 0} fallback={<div class="chat-tool-web-search-empty">{emptyMessage()}</div>}>
        <div class="chat-tool-web-search-list">
          <For each={visibleItems()}>
            {(item, index) => (
              <article class="chat-tool-web-search-item">
                <div class="chat-tool-web-search-item-head">
                  <span class="chat-tool-web-search-item-rank">{index() + 1}</span>
                  <a
                    class="chat-tool-web-search-item-title"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.title}
                  >
                    <span>{item.title}</span>
                    <ExternalLinkMiniIcon />
                  </a>
                  <button
                    class="chat-tool-web-search-item-copy"
                    type="button"
                    onClick={() => void handleCopyURL(item.url)}
                    aria-label={copiedURL() === item.url ? 'URL copied' : 'Copy result URL'}
                    title={copiedURL() === item.url ? 'Copied' : 'Copy URL'}
                  >
                    <Show when={copiedURL() === item.url} fallback={<CopyMiniIcon />}>
                      <CheckMiniIcon />
                    </Show>
                  </button>
                </div>

                <div class="chat-tool-web-search-item-meta">
                  <span class="chat-tool-web-search-item-domain">{item.domainLabel}</span>
                  <a
                    class="chat-tool-web-search-item-url"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.url}
                  >
                    {item.url}
                  </a>
                </div>

                <Show when={item.snippet}>
                  <p class="chat-tool-web-search-item-snippet">{item.snippet}</p>
                </Show>
              </article>
            )}
          </For>
        </div>
      </Show>

      <Show when={canToggleExpand()}>
        <div class="chat-tool-web-search-toggle-row">
          <button
            type="button"
            class="chat-tool-web-search-toggle-btn"
            onClick={() => setExpanded((current) => !current)}
          >
            <Show when={expanded()} fallback={`Show ${hiddenCount()} more`}>
              Show less
            </Show>
          </button>
        </div>
      </Show>

      <Show when={props.block.error}>
        <div class="chat-tool-web-search-error">{props.block.error}</div>
      </Show>

      <Show when={visibleChildren().length > 0}>
        <div class="chat-tool-web-search-children">
          <For each={visibleChildren()}>
            {(child) => (
              <BlockRenderer
                block={child}
                messageId={props.messageId}
                blockIndex={props.blockIndex}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

interface KnowledgeToolCardProps {
  block: ToolCallBlockType;
  messageId: string;
  blockIndex: number;
  display: KnowledgeToolDisplay;
  class?: string;
}

const KnowledgeToolCard: Component<KnowledgeToolCardProps> = (props) => {
  const [copiedQuery, setCopiedQuery] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  const statusLabel = createMemo(() => knowledgeStateLabel(props.block.status));
  const statusClass = createMemo(() => knowledgeStateClass(props.block.status));
  const metaItems = createMemo(() => {
    const items: string[] = [];
    if (props.display.totalCards > 0) {
      items.push(`Indexed ${formatKnowledgeInteger(props.display.totalCards)} cards`);
    }
    if (props.display.isSearch || props.display.matches.length > 0) {
      const matchCount = props.display.matches.length;
      items.push(`${formatKnowledgeInteger(matchCount)} match${matchCount === 1 ? '' : 'es'}`);
    }
    if (props.display.requestedMaxResults > 0) {
      items.push(`Requested ${formatKnowledgeInteger(props.display.requestedMaxResults)}`);
    }
    if (props.display.sourceRepos.length > 0) {
      const repoCount = props.display.sourceRepos.length;
      items.push(`${formatKnowledgeInteger(repoCount)} repo${repoCount === 1 ? '' : 's'}`);
    }
    return items;
  });
  const visibleMatches = createMemo(() => {
    if (expanded()) {
      return props.display.matches;
    }
    return props.display.matches.slice(0, KNOWLEDGE_VISIBLE_MATCHES);
  });
  const hiddenMatchCount = createMemo(() => Math.max(0, props.display.matches.length - visibleMatches().length));
  const canToggleExpand = createMemo(() => props.display.matches.length > KNOWLEDGE_VISIBLE_MATCHES);
  const visibleChildren = createMemo(() => {
    const children = Array.isArray(props.block.children) ? props.block.children : [];
    return children;
  });
  const showEmptyState = createMemo(() => {
    if (visibleMatches().length > 0) return false;
    if (props.display.isSearch) return true;
    return props.display.details.length === 0 && !props.display.resultNote;
  });
  const shouldShowResultNote = createMemo(() => {
    if (!props.display.resultNote) return false;
    if (props.display.isSearch && props.display.matches.length === 0) return false;
    return true;
  });
  const emptyMessage = createMemo(() => {
    if (props.block.status === 'pending' || props.block.status === 'running') {
      return props.display.isSearch ? 'Searching knowledge cards...' : 'Running knowledge tool...';
    }
    if (props.display.isSearch) {
      return 'No matching cards found.';
    }
    if (props.block.status === 'success') {
      return 'No additional details returned.';
    }
    return 'No knowledge output available.';
  });

  createEffect(() => {
    props.display.toolName;
    props.display.query;
    props.display.matches.length;
    setExpanded(false);
  });

  const handleCopyQuery = async () => {
    if (!props.display.query) return;
    const copied = await copyToolText(props.display.query);
    if (!copied) return;
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 1600);
  };

  return (
    <div class={cn('chat-tool-knowledge-block', props.class)}>
      <div class="chat-tool-knowledge-head">
        <div class="chat-tool-knowledge-head-main">
          <span class="chat-tool-knowledge-badge">Knowledge</span>
          <span class="chat-tool-knowledge-operation">{props.display.operationLabel}</span>
          <span class={cn('chat-tool-knowledge-state', statusClass())}>{statusLabel()}</span>
        </div>
        <Show when={props.display.query}>
          <button
            class="chat-tool-knowledge-copy-query"
            type="button"
            onClick={() => void handleCopyQuery()}
            aria-label={copiedQuery() ? 'Query copied' : 'Copy query'}
            title={copiedQuery() ? 'Copied' : 'Copy query'}
          >
            <Show when={copiedQuery()} fallback={<CopyMiniIcon />}>
              <CheckMiniIcon />
            </Show>
            <span>{copiedQuery() ? 'Copied' : 'Copy query'}</span>
          </button>
        </Show>
      </div>

      <Show when={props.display.query}>
        <div class="chat-tool-knowledge-query-row">
          <span class="chat-tool-knowledge-query-label">Query</span>
          <p class="chat-tool-knowledge-query-text">{props.display.query}</p>
        </div>
      </Show>

      <Show when={metaItems().length > 0}>
        <div class="chat-tool-knowledge-meta">
          <For each={metaItems()}>
            {(item) => <span>{item}</span>}
          </For>
        </div>
      </Show>

      <Show when={props.display.requestedTags.length > 0}>
        <div class="chat-tool-knowledge-request-row">
          <span class="chat-tool-knowledge-request-label">Tags</span>
          <div class="chat-tool-knowledge-chip-list">
            <For each={props.display.requestedTags}>
              {(tag) => <span class="chat-tool-knowledge-chip">{tag}</span>}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.display.sourceRepos.length > 0}>
        <div class="chat-tool-knowledge-request-row">
          <span class="chat-tool-knowledge-request-label">Repos</span>
          <div class="chat-tool-knowledge-chip-list">
            <For each={props.display.sourceRepos}>
              {(repo) => <span class="chat-tool-knowledge-chip chat-tool-knowledge-chip-repo">{repo}</span>}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.display.details.length > 0}>
        <div class="chat-tool-knowledge-details">
          <For each={props.display.details}>
            {(detail) => (
              <div class="chat-tool-knowledge-detail-item">
                <span class="chat-tool-knowledge-detail-label">{detail.label}</span>
                <span class="chat-tool-knowledge-detail-value">{detail.value}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={visibleMatches().length > 0}>
        <div class="chat-tool-knowledge-list">
          <For each={visibleMatches()}>
            {(item, index) => (
              <article class="chat-tool-knowledge-item">
                <div class="chat-tool-knowledge-item-head">
                  <span class="chat-tool-knowledge-item-rank">{index() + 1}</span>
                  <div class="chat-tool-knowledge-item-title-wrap">
                    <p class="chat-tool-knowledge-item-title">{item.title}</p>
                    <Show when={item.cardId}>
                      <span class="chat-tool-knowledge-item-card-id">{item.cardId}</span>
                    </Show>
                  </div>
                  <Show when={item.score > 0}>
                    <span class="chat-tool-knowledge-item-score">Score {formatKnowledgeInteger(item.score)}</span>
                  </Show>
                </div>

                <Show when={item.summary}>
                  <p class="chat-tool-knowledge-item-summary">{item.summary}</p>
                </Show>

                <Show when={item.tags.length > 0}>
                  <div class="chat-tool-knowledge-item-tags">
                    <For each={item.tags}>
                      {(tag) => <span class="chat-tool-knowledge-item-tag">{tag}</span>}
                    </For>
                  </div>
                </Show>

                <Show when={item.sourceRepos.length > 0}>
                  <div class="chat-tool-knowledge-item-repos">
                    <For each={item.sourceRepos}>
                      {(repo) => <span class="chat-tool-knowledge-item-repo">{repo}</span>}
                    </For>
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
      </Show>

      <Show when={canToggleExpand()}>
        <div class="chat-tool-knowledge-toggle-row">
          <button
            type="button"
            class="chat-tool-knowledge-toggle-btn"
            onClick={() => setExpanded((current) => !current)}
          >
            <Show when={expanded()} fallback={`Show ${hiddenMatchCount()} more`}>
              Show less
            </Show>
          </button>
        </div>
      </Show>

      <Show when={shouldShowResultNote()}>
        <div class="chat-tool-knowledge-note">{props.display.resultNote}</div>
      </Show>

      <Show when={showEmptyState()}>
        <div class="chat-tool-knowledge-empty">{emptyMessage()}</div>
      </Show>

      <Show when={props.block.error}>
        <div class="chat-tool-knowledge-error">{props.block.error}</div>
      </Show>

      <Show when={visibleChildren().length > 0}>
        <div class="chat-tool-knowledge-children">
          <For each={visibleChildren()}>
            {(child) => (
              <BlockRenderer
                block={child}
                messageId={props.messageId}
                blockIndex={props.blockIndex}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const CopyMiniIcon: Component = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckMiniIcon: Component = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ExternalLinkMiniIcon: Component = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

interface AskUserToolCardProps {
  block: ToolCallBlockType;
  messageId: string;
  display: AskUserDisplay;
  class?: string;
}

const AskUserToolCard: Component<AskUserToolCardProps> = (props) => {
  const ctx = useChatContext();
  const ai = useAIChatContext();
  const [selectedOptionIndex, setSelectedOptionIndex] = createSignal<number>(-1);
  const [useCustomReply, setUseCustomReply] = createSignal(false);
  const [customReply, setCustomReply] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [submittedReply, setSubmittedReply] = createSignal('');
  const promptKey = createMemo(
    () => `${props.messageId}\u001f${props.block.toolId}\u001f${props.display.question}\u001f${props.display.options.join('\u001f')}`,
  );
  const sourceLabel = createMemo(() => humanizeAskUserSource(props.display.source));
  const interactiveAllowed = createMemo(() => {
    const waitingPrompt = ai.activeThreadWaitingPrompt();
    if (!waitingPrompt) return false;
    return (
      String(waitingPrompt.message_id ?? '').trim() === props.messageId &&
      String(waitingPrompt.tool_id ?? '').trim() === String(props.block.toolId ?? '').trim()
    );
  });
  const controlsDisabled = createMemo(() => submitting() || !interactiveAllowed());
  const canSubmitCustomReply = createMemo(
    () => useCustomReply() && customReply().trim().length > 0 && !controlsDisabled(),
  );
  const resolvedReplyLabel = createMemo(() => (submittedReply() ? 'Reply sent' : 'Input resolved'));
  const resolvedReplyText = createMemo(() => submittedReply() || 'This request has been handled.');

  createEffect(() => {
    promptKey();
    setSelectedOptionIndex(-1);
    setUseCustomReply(false);
    setCustomReply('');
    setSubmitting(false);
    setSubmittedReply('');
  });

  createEffect(() => {
    if (!submitting()) return;
    if (!interactiveAllowed()) {
      setSubmitting(false);
      return;
    }
    if (!ctx.isWorking()) {
      setSubmitting(false);
    }
  });

  const submitReply = async (value: string) => {
    const content = asTrimmedString(value);
    if (!content || controlsDisabled()) {
      return;
    }
    setSubmitting(true);
    setSubmittedReply(content);
    try {
      await ctx.sendMessage(content, []);
    } catch (error) {
      console.error('ask_user reply submit failed', error);
      setSubmitting(false);
    } finally {
      // Do not clear submitting here.
      // The card only closes after server ACK updates waiting_prompt state.
    }
  };

  const handleOptionSelect = (index: number) => {
    if (controlsDisabled()) return;
    const option = props.display.options[index];
    if (!option) return;
    setSelectedOptionIndex(index);
    setUseCustomReply(false);
    void submitReply(option);
  };

  const handleCustomFocus = () => {
    if (controlsDisabled()) return;
    setUseCustomReply(true);
    setSelectedOptionIndex(-1);
  };

  const handleCustomInput = (value: string) => {
    setCustomReply(value);
    if (!useCustomReply()) {
      setUseCustomReply(true);
      setSelectedOptionIndex(-1);
    }
  };

  const handleCustomSubmit = async () => {
    if (!canSubmitCustomReply()) {
      return;
    }
    await submitReply(customReply());
  };

  return (
    <div class={cn('chat-tool-ask-user-block', !interactiveAllowed() && 'chat-tool-ask-user-block-completed', props.class)}>
      <div class="chat-tool-ask-user-head">
        <span class="chat-tool-ask-user-badge">Input Requested</span>
        <Show when={sourceLabel()}>
          <span class="chat-tool-ask-user-source-tag">{sourceLabel()}</span>
        </Show>
      </div>

      <p class="chat-tool-ask-user-question">{props.display.question}</p>

      <Show when={interactiveAllowed()} fallback={
        <div class="chat-tool-ask-user-submitted">
          <span class="chat-tool-ask-user-submitted-label">{resolvedReplyLabel()}</span>
          <p class="chat-tool-ask-user-submitted-text">{resolvedReplyText()}</p>
        </div>
      }>
        <>
          <div class="chat-tool-ask-user-options" role="radiogroup" aria-label="Ask user reply options">
            <For each={props.display.options}>
              {(option, index) => (
                <label
                  class={cn(
                    'chat-tool-ask-user-option-row',
                    !useCustomReply() &&
                      selectedOptionIndex() === index() &&
                      'chat-tool-ask-user-option-row-selected',
                  )}
                >
                  <input
                    type="radio"
                    class="chat-tool-ask-user-option-radio"
                    name={`ask-user-reply-${props.block.toolId}`}
                    checked={!useCustomReply() && selectedOptionIndex() === index()}
                    onChange={() => handleOptionSelect(index())}
                    disabled={controlsDisabled()}
                  />
                  <span class="chat-tool-ask-user-option-text">{option}</span>
                </label>
              )}
            </For>

            <label
              class={cn(
                'chat-tool-ask-user-option-row chat-tool-ask-user-custom-row',
                useCustomReply() && 'chat-tool-ask-user-custom-row-active',
              )}
            >
              <input
                type="radio"
                class="chat-tool-ask-user-option-radio"
                name={`ask-user-reply-${props.block.toolId}`}
                checked={useCustomReply()}
                onChange={() => handleCustomFocus()}
                disabled={controlsDisabled()}
              />
              <div class="chat-tool-ask-user-custom-main">
                <input
                  class="chat-tool-ask-user-custom-input"
                  value={customReply()}
                  onFocus={() => handleCustomFocus()}
                  onInput={(event) => handleCustomInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleCustomSubmit();
                    }
                  }}
                  placeholder="None of above"
                  aria-label="Custom ask user reply"
                  disabled={controlsDisabled()}
                />
                <button
                  type="button"
                  class="chat-tool-ask-user-custom-submit"
                  disabled={!canSubmitCustomReply()}
                  onClick={() => void handleCustomSubmit()}
                >
                  Send
                </button>
              </div>
            </label>
          </div>
          <p class="chat-tool-ask-user-hint">Select one reply, or type your own and send.</p>
        </>
      </Show>

      <Show when={props.block.error}>
        <div class="chat-tool-ask-user-error">{props.block.error}</div>
      </Show>
    </div>
  );
};

/**
 * Renders a tool call block with collapsible body, status indicators,
 * and an approval workflow for tools that require user consent.
 */
export const ToolCallBlock: Component<ToolCallBlockProps> = (props) => {
  const ctx = useChatContext();
  const askUserDisplay = createMemo(() => buildAskUserDisplay(props.block));
  const waitSubagentsDisplay = createMemo(() => buildWaitSubagentsDisplay(props.block));
  const applyPatchDisplay = createMemo(() => buildApplyPatchDisplay(props.block));
  const webSearchDisplay = createMemo(() => buildWebSearchDisplay(props.block));
  const knowledgeDisplay = createMemo(() => buildKnowledgeToolDisplay(props.block));
  const shouldHideWaitSubagentsRow = createMemo(() => {
    const display = waitSubagentsDisplay();
    if (!display) return false;
    if (display.action !== 'wait') return false;
    const ids = display.items.length > 0
      ? display.items.map((item) => String(item.subagentId ?? '').trim()).filter(Boolean)
      : display.ids.map((id) => String(id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) return false;
    const pending = new Set(ids);
    const walkBlocks = (blocks: unknown[]): void => {
      for (const block of blocks) {
        const rec = asRecord(block);
        if (!rec) continue;
        if (String(rec.type ?? '').trim().toLowerCase() === 'subagent') {
          const subagentId = String(rec.subagentId ?? '').trim();
          if (subagentId) pending.delete(subagentId);
        }
        const children = Array.isArray((rec as any).children) ? ((rec as any).children as unknown[]) : [];
        if (children.length > 0) walkBlocks(children);
        if (pending.size === 0) return;
      }
    };
    for (const message of ctx.messages()) {
      const blocks = Array.isArray((message as any)?.blocks) ? ((message as any).blocks as unknown[]) : [];
      walkBlocks(blocks);
      if (pending.size === 0) return true;
    }
    return false;
  });

  const isCollapsed = () => props.block.collapsed ?? false;
  const showApproval = () =>
    props.block.requiresApproval === true &&
    props.block.approvalState === 'required';

  const handleToggle = () => {
    ctx.toggleToolCollapse(props.messageId, props.block.toolId);
  };

  const handleApprove = (event: MouseEvent) => {
    event.stopPropagation();
    ctx.approveToolCall(props.messageId, props.block.toolId, true);
  };

  const handleReject = (event: MouseEvent) => {
    event.stopPropagation();
    ctx.approveToolCall(props.messageId, props.block.toolId, false);
  };

  const collapsedSummary = () => summarizeArgs(props.block.args);

  if (askUserDisplay()) {
    return (
      <AskUserToolCard
        block={props.block}
        messageId={props.messageId}
        display={askUserDisplay() as AskUserDisplay}
        class={props.class}
      />
    );
  }

  if (waitSubagentsDisplay()) {
    if (shouldHideWaitSubagentsRow()) {
      return null;
    }
    return (
      <WaitSubagentsToolCard
        block={props.block}
        display={waitSubagentsDisplay() as WaitSubagentsDisplay}
        class={props.class}
      />
    );
  }

  if (applyPatchDisplay()) {
    return (
      <ApplyPatchToolCard
        block={props.block}
        messageId={props.messageId}
        blockIndex={props.blockIndex}
        display={applyPatchDisplay() as ApplyPatchDisplay}
        class={props.class}
      />
    );
  }

  if (webSearchDisplay()) {
    return (
      <WebSearchToolCard
        block={props.block}
        messageId={props.messageId}
        blockIndex={props.blockIndex}
        display={webSearchDisplay() as WebSearchDisplay}
        class={props.class}
      />
    );
  }

  if (knowledgeDisplay()) {
    return (
      <KnowledgeToolCard
        block={props.block}
        messageId={props.messageId}
        blockIndex={props.blockIndex}
        display={knowledgeDisplay() as KnowledgeToolDisplay}
        class={props.class}
      />
    );
  }

  return (
    <div class={cn('chat-tool-call-block', props.class)}>
      <div class="chat-tool-call-header" onClick={handleToggle}>
        <button
          class="chat-tool-collapse-btn"
          aria-label={isCollapsed() ? 'Expand' : 'Collapse'}
        >
          <ChevronIcon collapsed={isCollapsed()} />
        </button>

        <StatusIcon status={props.block.status} />

        <span class="chat-tool-name">{props.block.toolName}</span>

        <Show when={showApproval()}>
          <div class="chat-tool-approval-actions">
            <button
              class="chat-tool-approval-btn chat-tool-approval-btn-approve"
              onClick={handleApprove}
            >
              Allow
            </button>
            <button
              class="chat-tool-approval-btn chat-tool-approval-btn-reject"
              onClick={handleReject}
            >
              Deny
            </button>
          </div>
        </Show>

        <Show when={isCollapsed()}>
          <span class="chat-tool-summary">{collapsedSummary()}</span>
        </Show>
      </div>

      <Show when={!isCollapsed()}>
        <div class="chat-tool-call-body">
          <div class="chat-tool-section">
            <div class="chat-tool-section-label">Arguments</div>
            <pre class="chat-tool-args">
              {JSON.stringify(props.block.args, null, 2)}
            </pre>
          </div>

          <Show when={props.block.result !== undefined}>
            <div class="chat-tool-section">
              <div class="chat-tool-section-label">Result</div>
              <pre class="chat-tool-result">
                {JSON.stringify(props.block.result, null, 2)}
              </pre>
            </div>
          </Show>

          <Show when={props.block.error}>
            <div class="chat-tool-section chat-tool-error-section">
              <div class="chat-tool-section-label">Error</div>
              <div class="chat-tool-error">{props.block.error}</div>
            </div>
          </Show>

          <Show when={props.block.children && props.block.children.length > 0}>
            <div class="chat-tool-children">
              <For each={props.block.children}>
                {(child) => (
                  <BlockRenderer
                    block={child}
                    messageId={props.messageId}
                    blockIndex={props.blockIndex}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
