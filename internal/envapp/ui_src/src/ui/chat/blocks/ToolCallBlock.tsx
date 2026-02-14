// ToolCallBlock — tool call display with approval workflow and collapsible body.

import { createSignal, Show, For } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { useChatContext } from '../ChatProvider';
import type { ToolCallBlock as ToolCallBlockType } from '../types';
import { BlockRenderer } from './BlockRenderer';

export interface ToolCallBlockProps {
  block: ToolCallBlockType;
  messageId: string;
  blockIndex: number;
  class?: string;
}

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
        // Clock icon
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
        // Spinner icon
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
          class="chat-tool-status-icon chat-tool-status-running chat-tool-spinner"
          style={iconStyle}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      )}
      {props.status === 'success' && (
        // Check icon
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
        // X icon
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

/**
 * Summarize arguments into a short preview string (max 50 chars).
 */
function summarizeArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args);
  if (text.length <= 50) return text;
  return text.slice(0, 47) + '...';
}

/**
 * Renders a tool call block with collapsible body, status indicators,
 * and an approval workflow for tools that require user consent.
 */
export const ToolCallBlock: Component<ToolCallBlockProps> = (props) => {
  const ctx = useChatContext();

  const isCollapsed = () => props.block.collapsed ?? false;
  const showApproval = () =>
    props.block.requiresApproval === true &&
    props.block.approvalState === 'required';

  const handleToggle = () => {
    ctx.toggleToolCollapse(props.messageId, props.block.toolId);
  };

  const handleApprove = (e: MouseEvent) => {
    e.stopPropagation();
    ctx.approveToolCall(props.messageId, props.block.toolId, true);
  };

  const handleReject = (e: MouseEvent) => {
    e.stopPropagation();
    ctx.approveToolCall(props.messageId, props.block.toolId, false);
  };

  return (
    <div class={cn('chat-tool-call-block', props.class)}>
      {/* Header row — click to toggle collapse */}
      <div class="chat-tool-call-header" onClick={handleToggle}>
        <button
          class="chat-tool-collapse-btn"
          aria-label={isCollapsed() ? 'Expand' : 'Collapse'}
        >
          <ChevronIcon collapsed={isCollapsed()} />
        </button>

        <StatusIcon status={props.block.status} />

        <span class="chat-tool-name">{props.block.toolName}</span>

        {/* Approval action buttons */}
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

        {/* Collapsed summary */}
        <Show when={isCollapsed()}>
          <span class="chat-tool-summary">{summarizeArgs(props.block.args)}</span>
        </Show>
      </div>

      {/* Expandable body */}
      <Show when={!isCollapsed()}>
        <div class="chat-tool-call-body">
          {/* Arguments section */}
          <div class="chat-tool-section">
            <div class="chat-tool-section-label">Arguments</div>
            <pre class="chat-tool-args">
              {JSON.stringify(props.block.args, null, 2)}
            </pre>
          </div>

          {/* Result section */}
          <Show when={props.block.result !== undefined}>
            <div class="chat-tool-section">
              <div class="chat-tool-section-label">Result</div>
              <pre class="chat-tool-result">
                {JSON.stringify(props.block.result, null, 2)}
              </pre>
            </div>
          </Show>

          {/* Error section */}
          <Show when={props.block.error}>
            <div class="chat-tool-section chat-tool-error-section">
              <div class="chat-tool-section-label">Error</div>
              <div class="chat-tool-error">{props.block.error}</div>
            </div>
          </Show>

          {/* Nested child blocks */}
          <Show when={props.block.children && props.block.children.length > 0}>
            <div class="chat-tool-children">
              <For each={props.block.children}>
                {(child, i) => (
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

export default ToolCallBlock;
