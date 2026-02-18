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
const WEB_SEARCH_TOOL_NAME = 'web.search';

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
  triggerReason: string;
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
  const visibleItems = createMemo(() => props.display.items.slice(0, 4));
  const trackedIDsPreview = createMemo(() => {
    if (props.display.items.length > 0) {
      return props.display.items.slice(0, 3).map((item) => item.subagentId);
    }
    return props.display.ids.slice(0, 3);
  });

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

      <Show when={props.display.items.length === 0}>
        <div class="chat-tool-wait-subagents-empty">
          <Show
            when={trackedIDsPreview().length > 0}
            fallback={<span>No subagent snapshots yet.</span>}
          >
            <span>
              Tracking IDs: {trackedIDsPreview().join(', ')}
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

                <div class="chat-tool-wait-subagents-item-metrics">
                  <span>Steps {formatSubagentInteger(item.steps)}</span>
                  <span>Tools {formatSubagentInteger(item.toolCalls)}</span>
                  <span>Tokens {formatSubagentInteger(item.tokens)}</span>
                  <span>Elapsed {formatSubagentDuration(item.elapsedMs)}</span>
                  <span>Outcome {item.outcome || waitSubagentStatusLabel(item.status)}</span>
                </div>

                <Show when={item.triggerReason}>
                  <div class="chat-tool-wait-subagents-item-trigger">
                    Trigger: {item.triggerReason}
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

const WEB_SEARCH_UNKNOWN_DOMAIN_KEY = 'domain:unknown';
const WEB_SEARCH_DEFAULT_DOMAIN_KEY = 'all';
const WEB_SEARCH_VISIBLE_RESULTS = 5;
const webSearchIntegerFormatter = new Intl.NumberFormat('en-US');

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
            <Show when={isWorking()}>
              <span class="chat-tool-web-search-state-loader" aria-hidden="true">
                <SnakeLoader size="sm" class="chat-tool-inline-snake-loader" />
              </span>
            </Show>
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

      <Show when={props.block.children && props.block.children.length > 0}>
        <div class="chat-tool-web-search-children">
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
  const webSearchDisplay = createMemo(() => buildWebSearchDisplay(props.block));
  const shouldHideWaitSubagentsRow = createMemo(() => {
    const display = waitSubagentsDisplay();
    if (!display) return false;
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
