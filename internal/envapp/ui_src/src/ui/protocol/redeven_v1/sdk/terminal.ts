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
  cols: number;
  rows: number;
};

export type TerminalSessionCreateResponse = {
  session: TerminalSessionInfo;
};

export type TerminalSessionAttachRequest = {
  sessionId: string;
  connId: string;
  cols: number;
  rows: number;
};

export type TerminalSessionAttachResponse = {
  ok: boolean;
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
};

export type TerminalHistoryResponse = {
  chunks: TerminalHistoryChunk[];
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

export type TerminalOutputEvent = {
  sessionId: string;
  data: Uint8Array;
  sequence?: number;
  timestampMs?: number;
  echoOfInput?: boolean;
  originalSource?: string;
};

export type TerminalNameUpdateEvent = {
  sessionId: string;
  newName: string;
  workingDir: string;
};

export type TerminalSessionsChangedEvent = {
  reason: 'created' | 'closed' | 'deleted';
  sessionId?: string;
  timestampMs?: number;
};
