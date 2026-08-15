import type { StreamEvent } from '../../../chat';
import type { ContextActionEnvelope } from '../../../contextActions/protocol';
import type { FlowerReasoningSelection, FlowerTimelineDecoration } from '../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

export type AIRealtimeEventType = 'stream_event' | 'thread_state' | 'thread_summary';

export type AIThreadRunStatus = 'idle' | 'accepted' | 'running' | 'waiting_approval' | 'recovering' | 'finalizing' | 'waiting_user' | 'success' | 'failed' | 'canceled' | 'timed_out';
export type AIPermissionType = 'readonly' | 'approval_required' | 'full_access';

export type AIRequestUserInputAction = {
  type: string;
};

export type AIRequestUserInputChoice = {
  choiceId: string;
  label: string;
  description?: string;
  kind: 'select';
  actions?: AIRequestUserInputAction[];
};

export type AIRequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  responseMode?: 'select' | 'write' | 'select_or_write';
  writeLabel?: string;
  writePlaceholder?: string;
  choices?: AIRequestUserInputChoice[];
};

export type AIRequestUserInputPrompt = {
  promptId: string;
  messageId: string;
  toolId: string;
  toolName: string;
  reasonCode?: string;
  reasoningSelection?: FlowerReasoningSelection;
  requiredFromUser?: string[];
  evidenceRefs?: string[];
  publicSummary?: string;
  containsSecret?: boolean;
  questions?: AIRequestUserInputQuestion[];
};

export type AIRequestUserInputAnswer = {
  choiceId?: string;
  text?: string;
};

export type AIRequestUserInputResponse = {
  promptId: string;
  answers: Record<string, AIRequestUserInputAnswer>;
};

export type AISendUserTurnRequest = {
  threadId: string;
  model?: string;
  input: {
    text: string;
    attachments: Array<{
      name: string;
      mimeType: string;
      url: string;
    }>;
    contextAction?: ContextActionEnvelope;
  };
  options: {
    permissionType?: AIPermissionType;
    reasoningSelection?: FlowerReasoningSelection;
  };
};

export type AISendUserTurnResponse = {
  runId: string;
  turnId: string;
  kind: string;
  queueId?: string;
  queuePosition?: number;
};

export type AISubmitRequestUserInputResponseRequest = {
  threadId: string;
  model?: string;
  response: AIRequestUserInputResponse;
  input: {
    text: string;
    attachments: Array<{
      name: string;
      mimeType: string;
      url: string;
    }>;
  };
  options: {
    permissionType?: AIPermissionType;
    reasoningSelection?: FlowerReasoningSelection;
  };
};

export type AISubmitRequestUserInputResponseResponse = {
  runId: string;
  turnId: string;
  kind: string;
  consumedWaitingPromptId?: string;
};

export type AIStopThreadRequest = {
  threadId: string;
};

export type AIStopThreadResponse = {
  ok: boolean;
};

export type AITimelineMessageItem = {
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
  messages: AITimelineMessageItem[];
  timelineDecorations?: readonly FlowerTimelineDecoration[];
  nextAfterRowId?: number;
  hasMore?: boolean;
};

export type AIRealtimeEvent = {
  eventType: AIRealtimeEventType;
  endpointId: string;
  threadId: string;
  turnId?: string;
  runId: string;
  atUnixMs: number;
  streamKind?: 'lifecycle' | 'assistant' | 'tool' | 'context';
  phase?: 'start' | 'state_change' | 'end' | 'error';
  diag?: Record<string, any>;
  streamEvent?: StreamEvent;
  runStatus?: AIThreadRunStatus;
  runErrorCode?: string;
  runError?: string;
  waitingPrompt?: AIRequestUserInputPrompt;

  // thread_summary only
  title?: string;
  updatedAtUnixMs?: number;
  lastMessagePreview?: string;
  lastMessageAtUnixMs?: number;
  activeRunId?: string;
  permissionType?: AIPermissionType;
  queuedTurnCount?: number;
};
