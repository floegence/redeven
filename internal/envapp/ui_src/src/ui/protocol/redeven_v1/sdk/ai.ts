import type { StreamEvent } from '@floegence/floe-webapp-core/chat';

export type AIRealtimeEventType = 'stream_event' | 'thread_state';

export type AIThreadRunStatus = 'idle' | 'running' | 'success' | 'failed' | 'canceled';

export type AIActiveRun = {
  threadId: string;
  runId: string;
};

export type AIStartRunRequest = {
  threadId: string;
  model?: string;
  input: {
    text: string;
    attachments: Array<{
      name: string;
      mimeType: string;
      url: string;
    }>;
  };
  options: {
    maxSteps: number;
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
  streamEvent?: StreamEvent;
  runStatus?: AIThreadRunStatus;
  runError?: string;
};
