import type {
  TerminalExecutionContextInfo,
  TerminalForegroundCommandInfo,
  TerminalOutputActivityInfo,
  TerminalSessionInfo as FloetermTerminalSessionInfo,
  TerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web';
import type {
  SemanticHistoryChunk,
  SemanticHistoryChunkRequest,
} from '@floegence/floeterm-terminal-web/semantic';

export type TerminalSessionInfo = FloetermTerminalSessionInfo & {
  localPathCapability?: {
    workingDir: string;
  };
};

export type TerminalSessionCreateRequest = {
  name?: string;
  workingDir?: string;
};

export type TerminalSessionCreateResponse = {
  session: TerminalSessionInfo;
};

export type TerminalSemanticHistoryRequest = {
  sessionId: string;
  connectionId: string;
  transportGeneration: number;
} & SemanticHistoryChunkRequest;

export type TerminalSemanticHistoryResponse = SemanticHistoryChunk;

export type TerminalSemanticClearRequest = {
  sessionId: string;
  connectionId: string;
  transportGeneration: number;
};

export type TerminalSemanticClearResponse = {
  presentationSequence: number;
  contentEpoch: number;
};

export type TerminalSessionDeleteRequest = {
  sessionId: string;
};

export type TerminalSessionDeleteResponse = {
  ok: boolean;
};

export type TerminalNameUpdateEvent = {
  sessionId: string;
  newName: string;
  workingDir: string;
  localPathCapability: TerminalSessionInfo['localPathCapability'] | null;
};

export type TerminalForegroundCommandUpdateEvent = {
  sessionId: string;
  foregroundCommand: TerminalForegroundCommandInfo;
};

export type TerminalOutputActivityUpdateEvent = {
  sessionId: string;
  outputActivity: TerminalOutputActivityInfo;
};

export type TerminalExecutionContextUpdateEvent = {
  sessionId: string;
  executionContext: TerminalExecutionContextInfo;
};

export type TerminalWorkStateUpdateEvent = {
  sessionId: string;
  workState: TerminalWorkStateInfo;
};

export type TerminalSessionLifecycle =
  | 'open'
  | 'closing'
  | 'closed'
  | 'close_failed_hidden';

export type TerminalSessionsChangedEvent = {
  reason: 'created' | 'closing' | 'closed' | 'deleted' | 'close_failed_hidden';
  sessionId?: string;
  timestampMs?: number;
  lifecycle?: TerminalSessionLifecycle;
  hidden?: boolean;
  ownerWidgetId?: string;
  failureCode?: string;
  failureMessage?: string;
};
