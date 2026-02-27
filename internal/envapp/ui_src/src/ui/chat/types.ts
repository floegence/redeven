// Chat module types — forked from @floegence/floe-webapp-core/chat for local customization.

import type { Component } from 'solid-js';

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface MarkdownBlock {
  type: 'markdown';
  content: string;
}

export interface CodeBlock {
  type: 'code';
  language: string;
  content: string;
  filename?: string;
}

export interface CodeDiffBlock {
  type: 'code-diff';
  language: string;
  oldCode: string;
  newCode: string;
  filename?: string;
}

export interface ImageBlock {
  type: 'image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface SvgBlock {
  type: 'svg';
  content: string;
}

export interface MermaidBlock {
  type: 'mermaid';
  content: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface ChecklistBlock {
  type: 'checklist';
  items: ChecklistItem[];
}

export interface ShellBlock {
  type: 'shell';
  command: string;
  output?: string;
  outputRef?: {
    runId: string;
    toolId: string;
  };
  cwd?: string;
  timeoutMs?: number;
  durationMs?: number;
  timedOut?: boolean;
  truncated?: boolean;
  exitCode?: number;
  status: 'running' | 'success' | 'error';
}

export interface FileBlock {
  type: 'file';
  name: string;
  size: number;
  mimeType: string;
  url?: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  content?: string;
  duration?: number;
}

export interface ToolCallBlock {
  type: 'tool-call';
  toolName: string;
  toolId: string;
  args: Record<string, unknown>;
  requiresApproval?: boolean;
  approvalState?: 'required' | 'approved' | 'rejected';
  status: 'pending' | 'running' | 'success' | 'error';
  result?: unknown;
  error?: string;
  children?: MessageBlock[];
  collapsed?: boolean;
}

export interface TodosBlock {
  type: 'todos';
  version: number;
  updatedAtUnixMs: number;
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    note?: string;
  }>;
}

export interface SourcesBlock {
  type: 'sources';
  sources: Array<{ title: string; url: string }>;
}

export type SubagentStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'unknown';

export interface SubagentBlock {
  type: 'subagent';
  subagentId: string;
  taskId: string;
  specId?: string;
  title?: string;
  objective?: string;
  contextMode?: string;
  promptHash?: string;
  delegationPromptMarkdown?: string;
  deliverables?: string[];
  definitionOfDone?: string[];
  outputSchema?: Record<string, unknown>;
  agentType: string;
  triggerReason: string;
  status: SubagentStatus;
  summary: string;
  evidenceRefs: string[];
  keyFiles: Array<{
    path: string;
    line?: number;
    purpose?: string;
  }>;
  openRisks: string[];
  nextActions: string[];
  history: Array<{
    role: 'user' | 'assistant' | 'system';
    text: string;
  }>;
  stats: {
    steps: number;
    toolCalls: number;
    tokens: number;
    elapsedMs: number;
    outcome: string;
  };
  updatedAtUnixMs: number;
  error?: string;
}

export type MessageBlock =
  | TextBlock
  | MarkdownBlock
  | CodeBlock
  | CodeDiffBlock
  | ImageBlock
  | SvgBlock
  | MermaidBlock
  | ChecklistBlock
  | ShellBlock
  | FileBlock
  | ThinkingBlock
  | ToolCallBlock
  | TodosBlock
  | SourcesBlock
  | SubagentBlock;

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'streaming' | 'complete' | 'error';
export type ChatAvatarRenderer = Component<{ role: MessageRole }>;
export type ChatAvatar = string | ChatAvatarRenderer;

export interface Message {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
  status: MessageStatus;
  timestamp: number;
  error?: string;
}

export interface BlockSummary {
  type: string;
  preview?: string;
}

export interface ColdMessage {
  id: string;
  role: MessageRole;
  estimatedHeight: number;
  blockSummary: BlockSummary[];
  timestamp: number;
}

export type AttachmentType = 'image' | 'file';
export type AttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

export interface Attachment {
  id: string;
  file: File;
  type: AttachmentType;
  preview?: string;
  uploadProgress: number;
  status: AttachmentStatus;
  url?: string;
  error?: string;
}

export type StreamEvent =
  | { type: 'message-start'; messageId: string }
  | { type: 'block-start'; messageId: string; blockIndex: number; blockType: MessageBlock['type'] }
  | { type: 'block-delta'; messageId: string; blockIndex: number; delta: string }
  | { type: 'block-set'; messageId: string; blockIndex: number; block: MessageBlock }
  | { type: 'block-end'; messageId: string; blockIndex: number }
  | { type: 'message-end'; messageId: string }
  | { type: 'error'; messageId: string; error: string };

export interface VirtualListConfig {
  overscan: number;
  hotWindow: number;
  warmWindow: number;
  loadBatchSize: number;
  loadThreshold: number;
  defaultItemHeight: number;
}

export const DEFAULT_VIRTUAL_LIST_CONFIG: VirtualListConfig = {
  overscan: 5,
  hotWindow: 20,
  warmWindow: 50,
  loadBatchSize: 20,
  loadThreshold: 5,
  defaultItemHeight: 80,
};

export interface ChatConfig {
  virtualList?: Partial<VirtualListConfig>;
  userAvatar?: ChatAvatar;
  assistantAvatar?: ChatAvatar;
  placeholder?: string;
  allowAttachments?: boolean;
  acceptedFileTypes?: string;
  maxAttachmentSize?: number;
  maxAttachments?: number;
}

export interface ChatCallbacks {
  onWillSend?: (content: string, attachments: Attachment[], userMessageId: string) => void;
  onSendMessage?: (
    content: string,
    attachments: Attachment[],
    userMessageId: string,
    addMessage: (msg: Message) => void,
  ) => Promise<void>;
  onLoadMore?: () => Promise<Message[]>;
  onRetry?: (messageId: string) => void;
  onUploadAttachment?: (file: File) => Promise<string>;
  onToolApproval?: (messageId: string, toolId: string, approved: boolean) => Promise<void> | void;
  onChecklistChange?: (
    messageId: string,
    blockIndex: number,
    itemId: string,
    checked: boolean,
  ) => void;
}

// Worker-related types (for code highlight / mermaid / markdown / diff workers)

export interface ShikiWorkerRequest {
  id: string;
  code: string;
  language: string;
  theme: string;
}

export interface ShikiWorkerResponse {
  id: string;
  html: string;
  error?: string;
}

export interface MermaidWorkerRequest {
  id: string;
  content: string;
  theme: string;
}

export interface MermaidWorkerResponse {
  id: string;
  svg: string;
  error?: string;
}

export interface MarkdownWorkerRequest {
  id: string;
  content: string;
}

export interface MarkdownWorkerResponse {
  id: string;
  html: string;
  error?: string;
}

export interface UnifiedDiffLine {
  type: 'context' | 'added' | 'removed';
  sign: ' ' | '+' | '-';
  lineNumber: number | null;
  content: string;
}

export interface SplitDiffLine {
  type: 'context' | 'added' | 'removed' | 'empty';
  lineNumber: number | null;
  content: string;
}

export interface CodeDiffRenderModel {
  unifiedLines: UnifiedDiffLine[];
  split: {
    left: SplitDiffLine[];
    right: SplitDiffLine[];
  };
  stats: {
    added: number;
    removed: number;
  };
}

export interface DiffWorkerRequest {
  id: string;
  oldCode: string;
  newCode: string;
}

export interface DiffWorkerResponse {
  id: string;
  model: CodeDiffRenderModel;
  error?: string;
}
