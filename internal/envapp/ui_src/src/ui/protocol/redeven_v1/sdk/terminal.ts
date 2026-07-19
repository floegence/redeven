export type TerminalSessionInfo = {
  id: string;
  name: string;
  workingDir: string;
  createdAtMs: number;
  lastActiveAtMs: number;
  isActive: boolean;
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
