import type { StreamEvent } from '../../../chat';
import type { ContextActionEnvelope } from '../../../contextActions/protocol';
import type { FlowerReasoningSelection } from '../../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

export type AIRealtimeEventType = 'stream_event' | 'thread_state' | 'transcript_message' | 'transcript_reset' | 'thread_summary';

export type AIThreadRunStatus = 'idle' | 'accepted' | 'running' | 'waiting_approval' | 'recovering' | 'finalizing' | 'waiting_user' | 'success' | 'failed' | 'canceled' | 'timed_out';
export type AIPermissionType = 'readonly' | 'approval_required' | 'full_access';

export type AIActiveRun = {
  threadId: string;
  runId: string;
};

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
    messageId?: string;
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
  expectedRunId?: string;
  queueAfterWaitingUser?: boolean;
  sourceFollowupId?: string;
};

export type AISendUserTurnResponse = {
  runId: string;
  kind: string;
  queueId?: string;
  queuePosition?: number;
  consumedWaitingPromptId?: string;
};

export type AICompactThreadContextRequest = {
  threadId: string;
  expectedRunId?: string;
  source: 'slash_command';
};

export type AICompactThreadContextResponse = {
  operationId?: string;
  kind: string;
  errorCode?: string;
};

export type AISubmitRequestUserInputResponseRequest = {
  threadId: string;
  model?: string;
  response: AIRequestUserInputResponse;
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
    permissionType?: AIPermissionType;
    reasoningSelection?: FlowerReasoningSelection;
  };
  expectedRunId?: string;
  sourceFollowupId?: string;
};

export type AISubmitRequestUserInputResponseResponse = {
  runId: string;
  kind: string;
  consumedWaitingPromptId?: string;
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

export type AIFollowupAttachment = {
  name: string;
  mimeType?: string;
  url?: string;
};

export type AIFollowupItem = {
  followupId: string;
  lane: 'queued' | 'draft';
  messageId: string;
  text: string;
  modelId?: string;
  permissionType?: AIPermissionType;
  position: number;
  createdAtUnixMs: number;
  attachments?: AIFollowupAttachment[];
};

export type AIStopThreadRequest = {
  threadId: string;
};

export type AIStopThreadResponse = {
  ok: boolean;
  recoveredFollowups?: AIFollowupItem[];
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
  runErrorCode?: string;
  runError?: string;
  waitingPrompt?: AIRequestUserInputPrompt;

  // transcript_message only
  messageRowId?: number;
  messageJson?: any;

  // thread_summary only
  title?: string;
  updatedAtUnixMs?: number;
  lastMessagePreview?: string;
  lastMessageAtUnixMs?: number;
  activeRunId?: string;
  lastContextRunId?: string;
  permissionType?: AIPermissionType;
  queuedTurnCount?: number;

  // transcript_reset only
  resetReason?: string;
  resetCheckpointId?: string;
};
