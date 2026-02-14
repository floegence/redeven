import type { StreamEvent } from '@floegence/floe-webapp-core/chat';

export type AIRealtimeEventType = 'stream_event' | 'thread_state' | 'transcript_message';

export type AIThreadRunStatus = 'idle' | 'accepted' | 'running' | 'waiting_approval' | 'recovering' | 'waiting_user' | 'success' | 'failed' | 'canceled' | 'timed_out';

export type AIActiveRun = {
  threadId: string;
  runId: string;
};

export type AIStartRunRequest = {
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
};

export type AIStartRunResponse = {
  runId: string;
};

export type AICancelRunRequest = {
  runId?: string;
  threadId?: string;
};

export type AICancelRunResponse = {
  ok: boolean;
};

export type AISubscribeResponse = {
  activeRuns: AIActiveRun[];
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
  streamKind?: 'lifecycle' | 'assistant' | 'tool';
  phase?: 'start' | 'state_change' | 'end' | 'error';
  diag?: Record<string, any>;
  streamEvent?: StreamEvent;
  runStatus?: AIThreadRunStatus;
  runError?: string;

  // transcript_message only
  messageRowId?: number;
  messageJson?: any;
};
