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
const WAIT_SUBAGENTS_TOOL_NAME = 'wait_subagents';

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
  agentType: string;
  status: WaitSubagentStatus;
  summary: string;
  steps: number;
  toolCalls: number;
  tokens: number;
  elapsedMs: number;
  outcome: string;
  error: string;
};

type WaitSubagentsDisplay = {
  ids: string[];
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

function clampText(value: string, maxLength = 160): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function readWaitSubagentSummary(snapshot: Record<string, unknown>): string {
  const resultStruct = asRecord(snapshot.result_struct ?? snapshot.resultStruct);
  if (resultStruct) {
    const summary = asTrimmedString(resultStruct.summary ?? resultStruct.result);
    if (summary) return summary;
  }
  return asTrimmedString(snapshot.result);
}

function buildWaitSubagentsDisplay(block: ToolCallBlockType): WaitSubagentsDisplay | null {
  if (String(block.toolName ?? '').trim() !== WAIT_SUBAGENTS_TOOL_NAME) return null;

  const args = asRecord(block.args);
  const result = asRecord(block.result);
  const ids = Array.isArray(args?.ids)
    ? Array.from(new Set(args.ids.map((value) => String(value ?? '').trim()).filter(Boolean)))
    : [];
  const timeoutMs = Math.max(0, Math.floor(readFiniteNumber(args?.timeout_ms ?? args?.timeoutMs, 0)));
  const timedOut = result?.timed_out === true || readFiniteNumber(result?.timed_out, 0) === 1;
  const rawStatusMap = asRecord(result?.status);

  const items: WaitSubagentItem[] = [];
  const counts = {
    queued: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
  };

  if (rawStatusMap) {
    for (const [fallbackID, raw] of Object.entries(rawStatusMap)) {
      const snapshot = asRecord(raw);
      if (!snapshot) continue;
      const subagentId =
        asTrimmedString(snapshot.subagent_id ?? snapshot.subagentId ?? snapshot.id) ||
        asTrimmedString(fallbackID) ||
        'unknown';
      const status = normalizeWaitSubagentStatus(snapshot.status);
      const stats = asRecord(snapshot.stats);
      const item: WaitSubagentItem = {
        subagentId,
        agentType: asTrimmedString(snapshot.agent_type ?? snapshot.agentType) || 'subagent',
        status,
        summary: clampText(readWaitSubagentSummary(snapshot), 180),
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
    }
  }

  items.sort((a, b) => {
    const rankDelta = waitSubagentStatusRank(a.status) - waitSubagentStatusRank(b.status);
    if (rankDelta !== 0) return rankDelta;
    return a.subagentId.localeCompare(b.subagentId);
  });

  return {
    ids,
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
  const headlineStateLabel = createMemo(() => {
    if (props.block.status === 'running') return 'Waiting snapshots';
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

  const isWorking = createMemo(() => props.block.status === 'running' || props.block.status === 'pending');
  const targetsCount = createMemo(() => (props.display.items.length > 0 ? props.display.items.length : props.display.ids.length));

  return (
    <div class={cn('chat-tool-wait-subagents-block', props.class)}>
      <div class="chat-tool-wait-subagents-head">
        <div class="chat-tool-wait-subagents-head-main">
          <span class="chat-tool-wait-subagents-badge">Wait subagents</span>
          <span class={cn('chat-tool-wait-subagents-state', headlineStateClass())}>
            <Show when={isWorking()}>
              <span class="chat-tool-wait-subagents-state-loader" aria-hidden="true">
                <SnakeLoader size="sm" class="chat-tool-inline-snake-loader" />
              </span>
            </Show>
            {headlineStateLabel()}
          </span>
        </div>
        <div class="chat-tool-wait-subagents-head-meta">
          <Show when={props.display.timeoutMs > 0}>
            <span>Timeout {Math.max(1, Math.floor(props.display.timeoutMs / 1000))}s</span>
          </Show>
          <Show when={props.display.timedOut}>
            <span class="chat-tool-wait-subagents-timeout-flag">Timed out</span>
          </Show>
        </div>
      </div>

      <div class="chat-tool-wait-subagents-summary">
        <span>{targetsCount()} target{targetsCount() === 1 ? '' : 's'}</span>
        <Show when={props.display.items.length > 0}>
          <span>
            {props.display.counts.running} running · {props.display.counts.waiting} waiting · {props.display.counts.completed} completed · {props.display.counts.failed} failed
          </span>
        </Show>
      </div>

      <Show
        when={props.display.items.length > 0}
        fallback={
          <div class="chat-tool-wait-subagents-empty">
            <Show
              when={props.display.ids.length > 0}
              fallback={<span>No subagent snapshots yet.</span>}
            >
              <span>
                Tracking IDs: {props.display.ids.slice(0, 4).join(', ')}
                <Show when={props.display.ids.length > 4}> +{props.display.ids.length - 4} more</Show>
              </span>
            </Show>
          </div>
        }
      >
        <div class="chat-tool-wait-subagents-list">
          <For each={props.display.items}>
            {(item) => (
              <div class="chat-tool-wait-subagents-item">
                <div class="chat-tool-wait-subagents-item-head">
                  <span class={cn('chat-subagent-status', waitSubagentStatusClass(item.status))}>
                    <Show when={item.status === 'running'}>
                      <span class="chat-subagent-status-loader" aria-hidden="true">
                        <SnakeLoader size="sm" class="chat-inline-snake-loader-subagent" />
                      </span>
                    </Show>
                    {waitSubagentStatusLabel(item.status)}
                  </span>
                  <span class="chat-tool-wait-subagents-item-agent">{item.agentType || 'subagent'}</span>
                  <span class="chat-tool-wait-subagents-item-id" title={item.subagentId}>{item.subagentId}</span>
                </div>
                <Show when={item.summary}>
                  <p class="chat-tool-wait-subagents-item-summary">{item.summary}</p>
                </Show>
                <div class="chat-tool-wait-subagents-item-metrics">
                  <span>Steps {formatSubagentInteger(item.steps)}</span>
                  <span>Tool calls {formatSubagentInteger(item.toolCalls)}</span>
                  <span>Tokens {formatSubagentInteger(item.tokens)}</span>
                  <span>Elapsed {formatSubagentDuration(item.elapsedMs)}</span>
                  <Show when={item.outcome}>
                    <span>Outcome {item.outcome}</span>
                  </Show>
                </div>
                <Show when={item.error}>
                  <div class="chat-tool-wait-subagents-item-error">{item.error}</div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.block.error}>
        <div class="chat-tool-wait-subagents-error">Error: {props.block.error}</div>
      </Show>
    </div>
  );
};

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
    return (
      <WaitSubagentsToolCard
        block={props.block}
        display={waitSubagentsDisplay() as WaitSubagentsDisplay}
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
