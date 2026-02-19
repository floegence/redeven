import type { StreamEvent } from '../../../chat';

export type AIRealtimeEventType = 'stream_event' | 'thread_state' | 'transcript_message' | 'thread_summary';

export type AIThreadRunStatus = 'idle' | 'accepted' | 'running' | 'waiting_approval' | 'recovering' | 'finalizing' | 'waiting_user' | 'success' | 'failed' | 'canceled' | 'timed_out';

export type AIActiveRun = {
  threadId: string;
  runId: string;
};

export type AIWaitingPrompt = {
  promptId: string;
  messageId: string;
  toolId: string;
};

export type AISendUserTurnRequest = {
  threadId: string;
  model?: string;
  input: {
    messageId?: string;
    text: string;
    attachments: Array<{
      name: string;
      mimeType: string;
      url: string;
    }>;
  };
  options: {
    maxSteps: number;
    mode?: 'act' | 'plan';
  };
  expectedRunId?: string;
  replyToWaitingPromptId?: string;
};

export type AISendUserTurnResponse = {
  runId: string;
  kind: string;
  consumedWaitingPromptId?: string;
};

export type AICancelRunRequest = {
  runId?: string;
  threadId?: string;
};

export type AICancelRunResponse = {
  ok: boolean;
};

export type AISubscribeSummaryResponse = {
  activeRuns: AIActiveRun[];
};

export type AISubscribeThreadRequest = {
  threadId: string;
};

export type AISubscribeThreadResponse = {
  runId?: string;
};

export type AITranscriptMessageItem = {
  rowId: number;
  messageJson: any;
};

export type AIListMessagesRequest = {
  threadId: string;
  afterRowId?: number;
  // When true, return the latest messages (tail) instead of incrementally listing after afterRowId.
  tail?: boolean;
  limit?: number;
};

export type AIListMessagesResponse = {
  messages: AITranscriptMessageItem[];
  nextAfterRowId?: number;
  hasMore?: boolean;
};

export type AIGetActiveRunSnapshotRequest = {
  threadId: string;
};

export type AIGetActiveRunSnapshotResponse = {
  ok: boolean;
  runId?: string;
  messageJson?: any;
};

export type AISetToolCollapsedRequest = {
  threadId: string;
  messageId: string;
  toolId: string;
  collapsed: boolean;
};

export type AISetToolCollapsedResponse = {
  ok: boolean;
};

export type AIToolApprovalRequest = {
  runId: string;
  toolId: string;
  approved: boolean;
};

export type AIToolApprovalResponse = {
  ok: boolean;
};

export type AIRealtimeEvent = {
  eventType: AIRealtimeEventType;
  endpointId: string;
  threadId: string;
  runId: string;
  atUnixMs: number;
  streamKind?: 'lifecycle' | 'assistant' | 'tool' | 'context';
  phase?: 'start' | 'state_change' | 'end' | 'error';
  diag?: Record<string, any>;
  streamEvent?: StreamEvent;
  runStatus?: AIThreadRunStatus;
  runError?: string;
  waitingPrompt?: AIWaitingPrompt;

  // transcript_message only
  messageRowId?: number;
  messageJson?: any;

  // thread_summary only
  title?: string;
  updatedAtUnixMs?: number;
  lastMessagePreview?: string;
  lastMessageAtUnixMs?: number;
  activeRunId?: string;
};
