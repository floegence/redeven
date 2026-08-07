import type {
  TerminalExecutionContextInfo,
  TerminalForegroundCommandInfo,
  TerminalOutputActivityInfo,
  TerminalSessionInfo as FloetermTerminalSessionInfo,
  TerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web';

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

export type TerminalHistoryChunk = {
  sequence: number;
  timestampMs: number;
  data: Uint8Array;
  geometryGeneration?: number;
  cols?: number;
  rows?: number;
};

export type TerminalHistoryRequest = {
  sessionId: string;
  startSeq: number;
  endSeq: number;
  historyGeneration?: number;
  limitChunks?: number;
  maxBytes?: number;
};

export type TerminalHistoryResponse = {
  chunks: TerminalHistoryChunk[];
  nextStartSeq: number;
  hasMore: boolean;
  firstSequence: number;
  lastSequence: number;
  coveredThroughSequence?: number;
  snapshotEndSequence?: number;
  firstRetainedSequence?: number;
  historyGeneration?: number;
  historyReset: boolean;
  historyTruncated: boolean;
  coveredBytes: number;
  totalBytes: number;
};

export type TerminalClearRequest = {
  sessionId: string;
};

export type TerminalClearResponse = {
  ok: boolean;
};

export type TerminalSessionDeleteRequest = {
  sessionId: string;
};

export type TerminalSessionDeleteResponse = {
  ok: boolean;
};

export type TerminalSessionStatsRequest = {
  sessionId: string;
};

export type TerminalSessionStatsResponse = {
  history: {
    totalBytes: number;
  };
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
