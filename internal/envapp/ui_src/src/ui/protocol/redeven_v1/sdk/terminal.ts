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
  groupId: string;
  localPathCapability?: {
    workingDir: string;
  };
};

export type TerminalSessionCreateRequest = {
  name?: string;
  workingDir?: string;
  groupId?: string;
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

export type TerminalGroup = Readonly<{
  id: string;
  name: string;
  defaultWorkingDir: string;
  sortOrder: number;
  createdAtMs: number;
  updatedAtMs: number;
  isDefault: boolean;
  pending?: boolean;
}>;

export type TerminalGroupCatalogSnapshot = Readonly<{
  revision: number;
  groups: readonly TerminalGroup[];
}>;

export type TerminalGroupCreateRequest = Readonly<{
  name: string;
  defaultWorkingDir: string;
}>;

export type TerminalGroupUpdateRequest = Readonly<{
  groupId: string;
  name?: string;
  defaultWorkingDir?: string;
}>;

export type TerminalGroupMutationResponse = Readonly<{
  revision: number;
  group: TerminalGroup;
}>;

export type TerminalGroupDeleteRequest = Readonly<{ groupId: string }>;

export type TerminalGroupDeleteResponse = Readonly<{
  revision: number;
  failedSessionIds: readonly string[];
}>;

export type TerminalGroupReorderRequest = Readonly<{
  groupId: string;
  beforeGroupId: string | null;
}>;

export type TerminalSessionMoveRequest = Readonly<{ sessionId: string; groupId: string }>;

export type TerminalSessionMoveResponse = Readonly<{
  revision: number;
  sessionId: string;
  groupId: string;
}>;

export type TerminalGroupCatalogChangedEvent = Readonly<{
  reason: 'created' | 'updated' | 'deleted' | 'reordered' | 'session_moved';
  groupId?: string;
  sessionId?: string;
  revision: number;
}>;

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
