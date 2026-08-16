import type { ProtocolContract, RpcHelpers } from '@floegence/floe-webapp-protocol';
import type { JsonValue } from '@floegence/flowersec-core';
import {
  captureDebugConsoleProtocolCall,
  publishDebugConsoleStructuredEvent,
} from '../../services/debugConsoleCapture';
import { redevenV1TypeIds } from './typeIds';
import type {
  AIRealtimeEvent,
  AIListMessagesRequest,
  AIListMessagesResponse,
  AISendUserTurnRequest,
  AISendUserTurnResponse,
  AISubmitRequestUserInputResponseRequest,
  AISubmitRequestUserInputResponseResponse,
  AIStopThreadRequest,
  AIStopThreadResponse,
} from './sdk/ai';
import type { AccessResumeRequest, AccessResumeResponse, AccessStatusResponse } from './sdk/access';
import type { FsCopyRequest, FsCopyResponse, FsDeleteRequest, FsDeleteResponse, FsListRequest, FsListResponse, FsMkdirRequest, FsMkdirResponse, FsPathContextResponse, FsReadFileRequest, FsReadFileResponse, FsRenameRequest, FsRenameResponse, FsWriteFileRequest, FsWriteFileResponse } from './sdk/fs';
import type {
  GitApplyStashRequest,
  GitApplyStashResponse,
  GitCheckoutBranchRequest,
  GitCheckoutBranchResponse,
  GitCapabilitiesResponse,
  GitCommitWorkspaceRequest,
  GitCommitWorkspaceResponse,
  GitDiscardWorkspaceRequest,
  GitDiscardWorkspaceResponse,
  GitDeleteBranchRequest,
  GitDeleteBranchResponse,
  GitDropStashRequest,
  GitDropStashResponse,
  GitGetStashDetailRequest,
  GitGetStashDetailResponse,
  GitMergeBranchRequest,
  GitMergeBranchResponse,
  GitListStashesRequest,
  GitListStashesResponse,
  GitPreviewDeleteBranchRequest,
  GitPreviewDeleteBranchResponse,
  GitPreviewApplyStashRequest,
  GitPreviewApplyStashResponse,
  GitPreviewDropStashRequest,
  GitPreviewDropStashResponse,
  GitPreviewMergeBranchRequest,
  GitPreviewMergeBranchResponse,
  GitFetchRepoRequest,
  GitFetchRepoResponse,
  GitGetBranchCompareRequest,
  GitGetBranchCompareResponse,
  GitGetCommitDetailRequest,
  GitGetCommitDetailResponse,
  GitGetDiffContentRequest,
  GitGetDiffContentResponse,
  GitListBranchesRequest,
  GitListBranchesResponse,
  GitListCommitsRequest,
  GitListCommitsResponse,
  GitListWorkspacePageRequest,
  GitListWorkspacePageResponse,
  GitListWorkspacePathStatusesRequest,
  GitListWorkspacePathStatusesResponse,
  GitListWorkspaceChangesRequest,
  GitListWorkspaceChangesResponse,
  GitPullRepoRequest,
  GitPullRepoResponse,
  GitPushRepoRequest,
  GitPushRepoResponse,
  GitRepoSummaryRequest,
  GitRepoSummaryResponse,
  GitResolveRepoRequest,
  GitResolveRepoResponse,
  GitSaveStashRequest,
  GitSaveStashResponse,
  GitStageWorkspaceRequest,
  GitStageWorkspaceResponse,
  GitSwitchDetachedRequest,
  GitSwitchDetachedResponse,
  GitUnstageWorkspaceRequest,
  GitUnstageWorkspaceResponse,
} from './sdk/git';
import type {
  SysMonitorKillProcessRequest,
  SysMonitorKillProcessResponse,
  SysMonitorRequest,
  SysMonitorSnapshot,
} from './sdk/monitor';
import type { SessionsListActiveResponse } from './sdk/sessions';
import type { SysPingResponse, SysRestartResponse, SysUpgradeRequest, SysUpgradeResponse } from './sdk/sys';
import type { TerminalExecutionContextUpdateEvent, TerminalForegroundCommandUpdateEvent, TerminalSemanticClearRequest, TerminalSemanticClearResponse, TerminalSemanticHistoryRequest, TerminalSemanticHistoryResponse, TerminalNameUpdateEvent, TerminalOutputActivityUpdateEvent, TerminalSessionCreateRequest, TerminalSessionCreateResponse, TerminalSessionDeleteRequest, TerminalSessionDeleteResponse, TerminalSessionInfo, TerminalSessionsChangedEvent, TerminalWorkStateUpdateEvent } from './sdk/terminal';
import {
  fromWireAIEventNotify,
  fromWireAIListMessagesResponse,
  fromWireAISendUserTurnResponse,
  fromWireAISubmitRequestUserInputResponseResponse,
  fromWireAIStopThreadResponse,
  toWireAIListMessagesRequest,
  toWireAISendUserTurnRequest,
  toWireAISubmitRequestUserInputResponseRequest,
  toWireAIStopThreadRequest,
} from './codec/ai';
import { fromWireAccessResumeResponse, fromWireAccessStatusResponse, toWireAccessResumeRequest } from './codec/access';
import { fromWireFsCopyResponse, fromWireFsDeleteResponse, fromWireFsListResponse, fromWireFsMkdirResponse, fromWireFsPathContextResponse, fromWireFsReadFileResponse, fromWireFsRenameResponse, fromWireFsWriteFileResponse, toWireFsCopyRequest, toWireFsDeleteRequest, toWireFsListRequest, toWireFsMkdirRequest, toWireFsReadFileRequest, toWireFsRenameRequest, toWireFsWriteFileRequest } from './codec/fs';
import {
  fromWireGitApplyStashResponse,
  fromWireGitCheckoutBranchResponse,
  fromWireGitCapabilitiesResponse,
  fromWireGitCommitWorkspaceResponse,
  fromWireGitDiscardWorkspaceResponse,
  fromWireGitDeleteBranchResponse,
  fromWireGitDropStashResponse,
  fromWireGitGetStashDetailResponse,
  fromWireGitMergeBranchResponse,
  fromWireGitListStashesResponse,
  fromWireGitPreviewDeleteBranchResponse,
  fromWireGitPreviewApplyStashResponse,
  fromWireGitPreviewDropStashResponse,
  fromWireGitPreviewMergeBranchResponse,
  fromWireGitFetchRepoResponse,
  fromWireGitGetBranchCompareResponse,
  fromWireGitGetCommitDetailResponse,
  fromWireGitGetDiffContentResponse,
  fromWireGitGetRepoSummaryResponse,
  fromWireGitListBranchesResponse,
  fromWireGitListCommitsResponse,
  fromWireGitListWorkspacePageResponse,
  fromWireGitListWorkspacePathStatusesResponse,
  fromWireGitListWorkspaceChangesResponse,
  fromWireGitPullRepoResponse,
  fromWireGitPushRepoResponse,
  fromWireGitResolveRepoResponse,
  fromWireGitSaveStashResponse,
  fromWireGitStageWorkspaceResponse,
  fromWireGitSwitchDetachedResponse,
  fromWireGitUnstageWorkspaceResponse,
  toWireGitApplyStashRequest,
  toWireGitCheckoutBranchRequest,
  toWireGitCommitWorkspaceRequest,
  toWireGitDiscardWorkspaceRequest,
  toWireGitDeleteBranchRequest,
  toWireGitDropStashRequest,
  toWireGitGetStashDetailRequest,
  toWireGitMergeBranchRequest,
  toWireGitListStashesRequest,
  toWireGitPreviewDeleteBranchRequest,
  toWireGitPreviewApplyStashRequest,
  toWireGitPreviewDropStashRequest,
  toWireGitPreviewMergeBranchRequest,
  toWireGitFetchRepoRequest,
  toWireGitGetBranchCompareRequest,
  toWireGitGetCommitDetailRequest,
  toWireGitGetDiffContentRequest,
  toWireGitGetRepoSummaryRequest,
  toWireGitListBranchesRequest,
  toWireGitListCommitsRequest,
  toWireGitListWorkspacePageRequest,
  toWireGitListWorkspacePathStatusesRequest,
  toWireGitListWorkspaceChangesRequest,
  toWireGitPullRepoRequest,
  toWireGitPushRepoRequest,
  toWireGitResolveRepoRequest,
  toWireGitSaveStashRequest,
  toWireGitStageWorkspaceRequest,
  toWireGitSwitchDetachedRequest,
  toWireGitUnstageWorkspaceRequest,
} from './codec/git';
import {
  fromWireSysMonitorKillProcessResponse,
  fromWireSysMonitorResponse,
  toWireSysMonitorKillProcessRequest,
  toWireSysMonitorRequest,
} from './codec/monitor';
import { fromWireSessionsListActiveResponse } from './codec/sessions';
import { fromWireSysPingResponse, fromWireSysRestartResponse, fromWireSysUpgradeResponse, toWireSysRestartRequest, toWireSysUpgradeRequest } from './codec/sys';
import { fromWireTerminalExecutionContextUpdateNotify, fromWireTerminalForegroundCommandUpdateNotify, fromWireTerminalNameUpdateNotify, fromWireTerminalOutputActivityUpdateNotify, fromWireTerminalSessionCreateResponse, fromWireTerminalSessionDeleteResponse, fromWireTerminalSessionListResponse, fromWireTerminalSemanticClearResponse, fromWireTerminalSemanticHistoryResponse, toWireTerminalSemanticClearRequest, toWireTerminalSessionCreateRequest, toWireTerminalSessionDeleteRequest, toWireTerminalSemanticHistoryRequest, fromWireTerminalSessionsChangedNotify, fromWireTerminalWorkStateUpdateNotify } from './codec/terminal';
import { redevenWireSchemaNames, type RedevenWireSchemaName } from './wire/schemas.generated';
import { validateRedevenWireValue } from './wire/validate';

function decodeWire<Wire, Result>(
  schemaName: RedevenWireSchemaName,
  decoder: (value: Wire) => Result,
): (value: JsonValue) => Result {
  return (value: JsonValue) => decoder(validateRedevenWireValue<Wire>(schemaName, value));
}

export type RedevenV1Rpc = {
  fs: {
    getPathContext: () => Promise<FsPathContextResponse>;
    list: (req: FsListRequest) => Promise<FsListResponse>;
    readFile: (req: FsReadFileRequest) => Promise<FsReadFileResponse>;
    writeFile: (req: FsWriteFileRequest) => Promise<FsWriteFileResponse>;
    mkdir: (req: FsMkdirRequest) => Promise<FsMkdirResponse>;
    rename: (req: FsRenameRequest) => Promise<FsRenameResponse>;
    copy: (req: FsCopyRequest) => Promise<FsCopyResponse>;
    delete: (req: FsDeleteRequest) => Promise<FsDeleteResponse>;
  };
  git: {
    resolveRepo: (req: GitResolveRepoRequest) => Promise<GitResolveRepoResponse>;
    getCapabilities: () => Promise<GitCapabilitiesResponse>;
    getRepoSummary: (req: GitRepoSummaryRequest) => Promise<GitRepoSummaryResponse>;
    listWorkspacePage: (req: GitListWorkspacePageRequest) => Promise<GitListWorkspacePageResponse>;
    listWorkspacePathStatuses: (req: GitListWorkspacePathStatusesRequest) => Promise<GitListWorkspacePathStatusesResponse>;
    listWorkspaceChanges: (req: GitListWorkspaceChangesRequest) => Promise<GitListWorkspaceChangesResponse>;
    listStashes: (req: GitListStashesRequest) => Promise<GitListStashesResponse>;
    getStashDetail: (req: GitGetStashDetailRequest) => Promise<GitGetStashDetailResponse>;
    stageWorkspace: (req: GitStageWorkspaceRequest) => Promise<GitStageWorkspaceResponse>;
    unstageWorkspace: (req: GitUnstageWorkspaceRequest) => Promise<GitUnstageWorkspaceResponse>;
    discardWorkspace: (req: GitDiscardWorkspaceRequest) => Promise<GitDiscardWorkspaceResponse>;
    commitWorkspace: (req: GitCommitWorkspaceRequest) => Promise<GitCommitWorkspaceResponse>;
    saveStash: (req: GitSaveStashRequest) => Promise<GitSaveStashResponse>;
    fetchRepo: (req: GitFetchRepoRequest) => Promise<GitFetchRepoResponse>;
    pullRepo: (req: GitPullRepoRequest) => Promise<GitPullRepoResponse>;
    pushRepo: (req: GitPushRepoRequest) => Promise<GitPushRepoResponse>;
    checkoutBranch: (req: GitCheckoutBranchRequest) => Promise<GitCheckoutBranchResponse>;
    switchDetached: (req: GitSwitchDetachedRequest) => Promise<GitSwitchDetachedResponse>;
    previewDeleteBranch: (req: GitPreviewDeleteBranchRequest) => Promise<GitPreviewDeleteBranchResponse>;
    deleteBranch: (req: GitDeleteBranchRequest) => Promise<GitDeleteBranchResponse>;
    previewApplyStash: (req: GitPreviewApplyStashRequest) => Promise<GitPreviewApplyStashResponse>;
    applyStash: (req: GitApplyStashRequest) => Promise<GitApplyStashResponse>;
    previewDropStash: (req: GitPreviewDropStashRequest) => Promise<GitPreviewDropStashResponse>;
    dropStash: (req: GitDropStashRequest) => Promise<GitDropStashResponse>;
    previewMergeBranch: (req: GitPreviewMergeBranchRequest) => Promise<GitPreviewMergeBranchResponse>;
    mergeBranch: (req: GitMergeBranchRequest) => Promise<GitMergeBranchResponse>;
    listBranches: (req: GitListBranchesRequest) => Promise<GitListBranchesResponse>;
    listCommits: (req: GitListCommitsRequest) => Promise<GitListCommitsResponse>;
    getCommitDetail: (req: GitGetCommitDetailRequest) => Promise<GitGetCommitDetailResponse>;
    getBranchCompare: (req: GitGetBranchCompareRequest) => Promise<GitGetBranchCompareResponse>;
    getDiffContent: (req: GitGetDiffContentRequest) => Promise<GitGetDiffContentResponse>;
  };
  terminal: {
    createSession: (req: TerminalSessionCreateRequest) => Promise<TerminalSessionCreateResponse>;
    listSessions: () => Promise<{ sessions: TerminalSessionInfo[] }>;
    semanticHistory: (req: TerminalSemanticHistoryRequest) => Promise<TerminalSemanticHistoryResponse>;
    semanticClear: (req: TerminalSemanticClearRequest) => Promise<TerminalSemanticClearResponse>;
    deleteSession: (req: TerminalSessionDeleteRequest) => Promise<TerminalSessionDeleteResponse>;
    onNameUpdate: (handler: (event: TerminalNameUpdateEvent) => void) => () => void;
    onForegroundCommandUpdate: (handler: (event: TerminalForegroundCommandUpdateEvent) => void) => () => void;
    onOutputActivityUpdate: (handler: (event: TerminalOutputActivityUpdateEvent) => void) => () => void;
    onExecutionContextUpdate: (handler: (event: TerminalExecutionContextUpdateEvent) => void) => () => void;
    onWorkStateUpdate: (handler: (event: TerminalWorkStateUpdateEvent) => void) => () => void;
    onSessionsChanged: (handler: (event: TerminalSessionsChangedEvent) => void) => () => void;
  };
  ai: {
    sendUserTurn: (req: AISendUserTurnRequest) => Promise<AISendUserTurnResponse>;
    submitRequestUserInputResponse: (req: AISubmitRequestUserInputResponseRequest) => Promise<AISubmitRequestUserInputResponseResponse>;
    stopThread: (req: AIStopThreadRequest) => Promise<AIStopThreadResponse>;
    listMessages: (req: AIListMessagesRequest) => Promise<AIListMessagesResponse>;
    onEvent: (handler: (event: AIRealtimeEvent) => void) => () => void;
  };
  monitor: {
    getSysMonitor: (req?: SysMonitorRequest) => Promise<SysMonitorSnapshot>;
    killProcess: (req: SysMonitorKillProcessRequest) => Promise<SysMonitorKillProcessResponse>;
  };
  sessions: {
    listActiveSessions: () => Promise<SessionsListActiveResponse>;
  };
  access: {
    status: () => Promise<AccessStatusResponse>;
    resume: (req: AccessResumeRequest) => Promise<AccessResumeResponse>;
  };
  sys: {
    ping: () => Promise<SysPingResponse>;
    upgrade: (req?: SysUpgradeRequest) => Promise<SysUpgradeResponse>;
    restart: () => Promise<SysRestartResponse>;
  };
};

export function createRedevenV1Rpc(helpers: RpcHelpers): RedevenV1Rpc {
  const call = <Req extends JsonValue, Resp>(
    typeID: number,
    payload: Req,
    decodeResponse: (value: JsonValue) => Resp,
  ) =>
    captureDebugConsoleProtocolCall<Req, Resp>({
      typeID,
      payload,
      execute: () => helpers.call(typeID, payload, decodeResponse),
    });

  return {
    fs: {
      getPathContext: async () => {
        const resp = await call(redevenV1TypeIds.fs.getPathContext, {}, decodeWire(redevenWireSchemaNames.fromWireFsPathContextResponse, fromWireFsPathContextResponse));
        return resp;
      },
      list: async (req) => {
        const payload = toWireFsListRequest(req);
        const resp = await call(redevenV1TypeIds.fs.list, payload, decodeWire(redevenWireSchemaNames.fromWireFsListResponse, fromWireFsListResponse));
        return resp;
      },
      readFile: async (req) => {
        const payload = toWireFsReadFileRequest(req);
        const resp = await call(redevenV1TypeIds.fs.readFile, payload, decodeWire(redevenWireSchemaNames.fromWireFsReadFileResponse, fromWireFsReadFileResponse));
        return resp;
      },
      writeFile: async (req) => {
        const payload = toWireFsWriteFileRequest(req);
        const resp = await call(redevenV1TypeIds.fs.writeFile, payload, decodeWire(redevenWireSchemaNames.fromWireFsWriteFileResponse, fromWireFsWriteFileResponse));
        return resp;
      },
      mkdir: async (req) => {
        const payload = toWireFsMkdirRequest(req);
        const resp = await call(redevenV1TypeIds.fs.mkdir, payload, decodeWire(redevenWireSchemaNames.fromWireFsMkdirResponse, fromWireFsMkdirResponse));
        return resp;
      },
      rename: async (req) => {
        const payload = toWireFsRenameRequest(req);
        const resp = await call(redevenV1TypeIds.fs.rename, payload, decodeWire(redevenWireSchemaNames.fromWireFsRenameResponse, fromWireFsRenameResponse));
        return resp;
      },
      copy: async (req) => {
        const payload = toWireFsCopyRequest(req);
        const resp = await call(redevenV1TypeIds.fs.copy, payload, decodeWire(redevenWireSchemaNames.fromWireFsCopyResponse, fromWireFsCopyResponse));
        return resp;
      },
      delete: async (req) => {
        const payload = toWireFsDeleteRequest(req);
        const resp = await call(redevenV1TypeIds.fs.delete, payload, decodeWire(redevenWireSchemaNames.fromWireFsDeleteResponse, fromWireFsDeleteResponse));
        return resp;
      },
    },
    git: {
      getCapabilities: async () => {
        const resp = await call(redevenV1TypeIds.git.getCapabilities, {}, decodeWire(redevenWireSchemaNames.fromWireGitCapabilitiesResponse, fromWireGitCapabilitiesResponse));
        return resp;
      },
      resolveRepo: async (req) => {
        const payload = toWireGitResolveRepoRequest(req);
        const resp = await call(redevenV1TypeIds.git.resolveRepo, payload, decodeWire(redevenWireSchemaNames.fromWireGitResolveRepoResponse, fromWireGitResolveRepoResponse));
        return resp;
      },
      getRepoSummary: async (req) => {
        const payload = toWireGitGetRepoSummaryRequest(req);
        const resp = await call(redevenV1TypeIds.git.getRepoSummary, payload, decodeWire(redevenWireSchemaNames.fromWireGitGetRepoSummaryResponse, fromWireGitGetRepoSummaryResponse));
        return resp;
      },
      listWorkspacePage: async (req) => {
        const payload = toWireGitListWorkspacePageRequest(req);
        const resp = await call(redevenV1TypeIds.git.listWorkspacePage, payload, decodeWire(redevenWireSchemaNames.fromWireGitListWorkspacePageResponse, fromWireGitListWorkspacePageResponse));
        return resp;
      },
      listWorkspacePathStatuses: async (req) => {
        const payload = toWireGitListWorkspacePathStatusesRequest(req);
        const resp = await call(redevenV1TypeIds.git.listWorkspacePathStatuses, payload, decodeWire(redevenWireSchemaNames.fromWireGitListWorkspacePathStatusesResponse, fromWireGitListWorkspacePathStatusesResponse));
        return resp;
      },
      listWorkspaceChanges: async (req) => {
        const payload = toWireGitListWorkspaceChangesRequest(req);
        const resp = await call(redevenV1TypeIds.git.listWorkspaceChanges, payload, decodeWire(redevenWireSchemaNames.fromWireGitListWorkspaceChangesResponse, fromWireGitListWorkspaceChangesResponse));
        return resp;
      },
      listStashes: async (req) => {
        const payload = toWireGitListStashesRequest(req);
        const resp = await call(redevenV1TypeIds.git.listStashes, payload, decodeWire(redevenWireSchemaNames.fromWireGitListStashesResponse, fromWireGitListStashesResponse));
        return resp;
      },
      getStashDetail: async (req) => {
        const payload = toWireGitGetStashDetailRequest(req);
        const resp = await call(redevenV1TypeIds.git.getStashDetail, payload, decodeWire(redevenWireSchemaNames.fromWireGitGetStashDetailResponse, fromWireGitGetStashDetailResponse));
        return resp;
      },
      stageWorkspace: async (req) => {
        const payload = toWireGitStageWorkspaceRequest(req);
        const resp = await call(redevenV1TypeIds.git.stageWorkspace, payload, decodeWire(redevenWireSchemaNames.fromWireGitStageWorkspaceResponse, fromWireGitStageWorkspaceResponse));
        return resp;
      },
      unstageWorkspace: async (req) => {
        const payload = toWireGitUnstageWorkspaceRequest(req);
        const resp = await call(redevenV1TypeIds.git.unstageWorkspace, payload, decodeWire(redevenWireSchemaNames.fromWireGitUnstageWorkspaceResponse, fromWireGitUnstageWorkspaceResponse));
        return resp;
      },
      discardWorkspace: async (req) => {
        const payload = toWireGitDiscardWorkspaceRequest(req);
        const resp = await call(redevenV1TypeIds.git.discardWorkspace, payload, decodeWire(redevenWireSchemaNames.fromWireGitDiscardWorkspaceResponse, fromWireGitDiscardWorkspaceResponse));
        return resp;
      },
      commitWorkspace: async (req) => {
        const payload = toWireGitCommitWorkspaceRequest(req);
        const resp = await call(redevenV1TypeIds.git.commitWorkspace, payload, decodeWire(redevenWireSchemaNames.fromWireGitCommitWorkspaceResponse, fromWireGitCommitWorkspaceResponse));
        return resp;
      },
      saveStash: async (req) => {
        const payload = toWireGitSaveStashRequest(req);
        const resp = await call(redevenV1TypeIds.git.saveStash, payload, decodeWire(redevenWireSchemaNames.fromWireGitSaveStashResponse, fromWireGitSaveStashResponse));
        return resp;
      },
      fetchRepo: async (req) => {
        const payload = toWireGitFetchRepoRequest(req);
        const resp = await call(redevenV1TypeIds.git.fetchRepo, payload, decodeWire(redevenWireSchemaNames.fromWireGitFetchRepoResponse, fromWireGitFetchRepoResponse));
        return resp;
      },
      pullRepo: async (req) => {
        const payload = toWireGitPullRepoRequest(req);
        const resp = await call(redevenV1TypeIds.git.pullRepo, payload, decodeWire(redevenWireSchemaNames.fromWireGitPullRepoResponse, fromWireGitPullRepoResponse));
        return resp;
      },
      pushRepo: async (req) => {
        const payload = toWireGitPushRepoRequest(req);
        const resp = await call(redevenV1TypeIds.git.pushRepo, payload, decodeWire(redevenWireSchemaNames.fromWireGitPushRepoResponse, fromWireGitPushRepoResponse));
        return resp;
      },
      checkoutBranch: async (req) => {
        const payload = toWireGitCheckoutBranchRequest(req);
        const resp = await call(redevenV1TypeIds.git.checkoutBranch, payload, decodeWire(redevenWireSchemaNames.fromWireGitCheckoutBranchResponse, fromWireGitCheckoutBranchResponse));
        return resp;
      },
      switchDetached: async (req) => {
        const payload = toWireGitSwitchDetachedRequest(req);
        const resp = await call(redevenV1TypeIds.git.switchDetached, payload, decodeWire(redevenWireSchemaNames.fromWireGitSwitchDetachedResponse, fromWireGitSwitchDetachedResponse));
        return resp;
      },
      previewDeleteBranch: async (req) => {
        const payload = toWireGitPreviewDeleteBranchRequest(req);
        const resp = await call(redevenV1TypeIds.git.previewDeleteBranch, payload, decodeWire(redevenWireSchemaNames.fromWireGitPreviewDeleteBranchResponse, fromWireGitPreviewDeleteBranchResponse));
        return resp;
      },
      deleteBranch: async (req) => {
        const payload = toWireGitDeleteBranchRequest(req);
        const resp = await call(redevenV1TypeIds.git.deleteBranch, payload, decodeWire(redevenWireSchemaNames.fromWireGitDeleteBranchResponse, fromWireGitDeleteBranchResponse));
        return resp;
      },
      previewApplyStash: async (req) => {
        const payload = toWireGitPreviewApplyStashRequest(req);
        const resp = await call(redevenV1TypeIds.git.previewApplyStash, payload, decodeWire(redevenWireSchemaNames.fromWireGitPreviewApplyStashResponse, fromWireGitPreviewApplyStashResponse));
        return resp;
      },
      applyStash: async (req) => {
        const payload = toWireGitApplyStashRequest(req);
        const resp = await call(redevenV1TypeIds.git.applyStash, payload, decodeWire(redevenWireSchemaNames.fromWireGitApplyStashResponse, fromWireGitApplyStashResponse));
        return resp;
      },
      previewDropStash: async (req) => {
        const payload = toWireGitPreviewDropStashRequest(req);
        const resp = await call(redevenV1TypeIds.git.previewDropStash, payload, decodeWire(redevenWireSchemaNames.fromWireGitPreviewDropStashResponse, fromWireGitPreviewDropStashResponse));
        return resp;
      },
      dropStash: async (req) => {
        const payload = toWireGitDropStashRequest(req);
        const resp = await call(redevenV1TypeIds.git.dropStash, payload, decodeWire(redevenWireSchemaNames.fromWireGitDropStashResponse, fromWireGitDropStashResponse));
        return resp;
      },
      previewMergeBranch: async (req) => {
        const payload = toWireGitPreviewMergeBranchRequest(req);
        const resp = await call(redevenV1TypeIds.git.previewMergeBranch, payload, decodeWire(redevenWireSchemaNames.fromWireGitPreviewMergeBranchResponse, fromWireGitPreviewMergeBranchResponse));
        return resp;
      },
      mergeBranch: async (req) => {
        const payload = toWireGitMergeBranchRequest(req);
        const resp = await call(redevenV1TypeIds.git.mergeBranch, payload, decodeWire(redevenWireSchemaNames.fromWireGitMergeBranchResponse, fromWireGitMergeBranchResponse));
        return resp;
      },
      listBranches: async (req) => {
        const payload = toWireGitListBranchesRequest(req);
        const resp = await call(redevenV1TypeIds.git.listBranches, payload, decodeWire(redevenWireSchemaNames.fromWireGitListBranchesResponse, fromWireGitListBranchesResponse));
        return resp;
      },
      listCommits: async (req) => {
        const payload = toWireGitListCommitsRequest(req);
        const resp = await call(redevenV1TypeIds.git.listCommits, payload, decodeWire(redevenWireSchemaNames.fromWireGitListCommitsResponse, fromWireGitListCommitsResponse));
        return resp;
      },
      getCommitDetail: async (req) => {
        const payload = toWireGitGetCommitDetailRequest(req);
        const resp = await call(redevenV1TypeIds.git.getCommitDetail, payload, decodeWire(redevenWireSchemaNames.fromWireGitGetCommitDetailResponse, fromWireGitGetCommitDetailResponse));
        return resp;
      },
      getBranchCompare: async (req) => {
        const payload = toWireGitGetBranchCompareRequest(req);
        const resp = await call(redevenV1TypeIds.git.getBranchCompare, payload, decodeWire(redevenWireSchemaNames.fromWireGitGetBranchCompareResponse, fromWireGitGetBranchCompareResponse));
        return resp;
      },
      getDiffContent: async (req) => {
        const payload = toWireGitGetDiffContentRequest(req);
        const resp = await call(redevenV1TypeIds.git.getDiffContent, payload, decodeWire(redevenWireSchemaNames.fromWireGitGetDiffContentResponse, fromWireGitGetDiffContentResponse));
        return resp;
      },
    },
    terminal: {
      createSession: async (req) => {
        const payload = toWireTerminalSessionCreateRequest(req);
        const resp = await call(redevenV1TypeIds.terminal.sessionCreate, payload, decodeWire(redevenWireSchemaNames.fromWireTerminalSessionCreateResponse, fromWireTerminalSessionCreateResponse));
        return resp;
      },
      listSessions: async () => {
        const resp = await call(redevenV1TypeIds.terminal.sessionList, {}, decodeWire(redevenWireSchemaNames.fromWireTerminalSessionListResponse, fromWireTerminalSessionListResponse));
        return resp;
      },
      semanticHistory: async (req) => {
        const payload = toWireTerminalSemanticHistoryRequest(req);
        const resp = await call(redevenV1TypeIds.terminal.semanticHistory, payload, decodeWire(redevenWireSchemaNames.fromWireTerminalSemanticHistoryResponse, fromWireTerminalSemanticHistoryResponse));
        return resp;
      },
      semanticClear: async (req) => {
        const payload = toWireTerminalSemanticClearRequest(req);
        const resp = await call(redevenV1TypeIds.terminal.semanticClear, payload, decodeWire(redevenWireSchemaNames.fromWireTerminalSemanticClearResponse, fromWireTerminalSemanticClearResponse));
        return resp;
      },
      deleteSession: async (req) => {
        const payload = toWireTerminalSessionDeleteRequest(req);
        const resp = await call(redevenV1TypeIds.terminal.sessionDelete, payload, decodeWire(redevenWireSchemaNames.fromWireTerminalSessionDeleteResponse, fromWireTerminalSessionDeleteResponse));
        return resp;
      },
      onNameUpdate: (handler) =>
        helpers.onNotify(redevenV1TypeIds.terminal.nameUpdate, decodeWire(redevenWireSchemaNames.fromWireTerminalNameUpdateNotify, fromWireTerminalNameUpdateNotify), (ev) => {
          if (ev) handler(ev);
        }),
      onForegroundCommandUpdate: (handler) =>
        helpers.onNotify(redevenV1TypeIds.terminal.foregroundCommandUpdate, decodeWire(redevenWireSchemaNames.fromWireTerminalForegroundCommandUpdateNotify, fromWireTerminalForegroundCommandUpdateNotify), (ev) => {
          if (ev) handler(ev);
        }),
      onOutputActivityUpdate: (handler) =>
        helpers.onNotify(redevenV1TypeIds.terminal.outputActivityUpdate, decodeWire(redevenWireSchemaNames.fromWireTerminalOutputActivityUpdateNotify, fromWireTerminalOutputActivityUpdateNotify), (ev) => {
          if (ev) {
            handler(ev);
            return;
          }
          publishDebugConsoleStructuredEvent({
            created_at: new Date().toISOString(),
            source: 'ui',
            scope: 'terminal_catalog',
            kind: 'notify_rejected',
            message: 'Rejected malformed terminal output activity notification',
            detail: {
              type_id: redevenV1TypeIds.terminal.outputActivityUpdate,
              error_code: 'malformed_output_activity_notify',
              delivered: false,
            },
          });
        }),
      onExecutionContextUpdate: (handler) =>
        helpers.onNotify(redevenV1TypeIds.terminal.executionContextUpdate, decodeWire(redevenWireSchemaNames.fromWireTerminalExecutionContextUpdateNotify, fromWireTerminalExecutionContextUpdateNotify), (ev) => {
          if (ev) {
            handler(ev);
            return;
          }
          publishDebugConsoleStructuredEvent({
            created_at: new Date().toISOString(),
            source: 'ui',
            scope: 'terminal_catalog',
            kind: 'notify_rejected',
            message: 'Rejected malformed terminal execution context notification',
            detail: {
              type_id: redevenV1TypeIds.terminal.executionContextUpdate,
              error_code: 'malformed_execution_context_notify',
              delivered: false,
            },
          });
        }),
      onWorkStateUpdate: (handler) =>
        helpers.onNotify(redevenV1TypeIds.terminal.workStateUpdate, decodeWire(redevenWireSchemaNames.fromWireTerminalWorkStateUpdateNotify, fromWireTerminalWorkStateUpdateNotify), (ev) => {
          if (ev) {
            handler(ev);
            return;
          }
          publishDebugConsoleStructuredEvent({
            created_at: new Date().toISOString(),
            source: 'ui',
            scope: 'terminal_catalog',
            kind: 'notify_rejected',
            message: 'Rejected malformed terminal semantic work notification',
            detail: {
              type_id: redevenV1TypeIds.terminal.workStateUpdate,
              error_code: 'malformed_work_state_notify',
              delivered: false,
            },
          });
        }),
      onSessionsChanged: (handler) =>
        helpers.onNotify(redevenV1TypeIds.terminal.sessionsChanged, decodeWire(redevenWireSchemaNames.fromWireTerminalSessionsChangedNotify, fromWireTerminalSessionsChangedNotify), (ev) => {
          if (ev) handler(ev);
        }),
    },
    ai: {
      sendUserTurn: async (req) => {
        const payload = toWireAISendUserTurnRequest(req);
        const resp = await call(redevenV1TypeIds.ai.sendUserTurn, payload, decodeWire(redevenWireSchemaNames.fromWireAISendUserTurnResponse, fromWireAISendUserTurnResponse));
        return resp;
      },
      submitRequestUserInputResponse: async (req) => {
        const payload = toWireAISubmitRequestUserInputResponseRequest(req);
        const resp = await call(redevenV1TypeIds.ai.submitRequestUserInputResponse, payload, decodeWire(redevenWireSchemaNames.fromWireAISubmitRequestUserInputResponseResponse, fromWireAISubmitRequestUserInputResponseResponse));
        return resp;
      },
      stopThread: async (req) => {
        const payload = toWireAIStopThreadRequest(req);
        const resp = await call(redevenV1TypeIds.ai.stopThread, payload, decodeWire(redevenWireSchemaNames.fromWireAIStopThreadResponse, fromWireAIStopThreadResponse));
        return resp;
      },
      listMessages: async (req) => {
        const payload = toWireAIListMessagesRequest(req);
        const resp = await call(redevenV1TypeIds.ai.listMessages, payload, decodeWire(redevenWireSchemaNames.fromWireAIListMessagesResponse, fromWireAIListMessagesResponse));
        return resp;
      },
      onEvent: (handler) =>
        helpers.onNotify(redevenV1TypeIds.ai.event, decodeWire(redevenWireSchemaNames.fromWireAIEventNotify, fromWireAIEventNotify), (ev) => {
          if (ev) handler(ev);
        }),
    },
    monitor: {
      getSysMonitor: async (req = {}) => {
        const payload = toWireSysMonitorRequest(req);
        const resp = await call(redevenV1TypeIds.monitor.sysMonitor, payload, decodeWire(redevenWireSchemaNames.fromWireSysMonitorResponse, fromWireSysMonitorResponse));
        return resp;
      },
      killProcess: async (req) => {
        const payload = toWireSysMonitorKillProcessRequest(req);
        const resp = await call(redevenV1TypeIds.monitor.killProcess, payload, decodeWire(redevenWireSchemaNames.fromWireSysMonitorKillProcessResponse, fromWireSysMonitorKillProcessResponse));
        return resp;
      },
    },
    sessions: {
      listActiveSessions: async () => {
        const resp = await call(redevenV1TypeIds.sessions.listActive, {}, decodeWire(redevenWireSchemaNames.fromWireSessionsListActiveResponse, fromWireSessionsListActiveResponse));
        return resp;
      },
    },
    access: {
      status: async () => {
        const resp = await call(redevenV1TypeIds.access.status, {}, decodeWire(redevenWireSchemaNames.fromWireAccessStatusResponse, fromWireAccessStatusResponse));
        return resp;
      },
      resume: async (req) => {
        const payload = toWireAccessResumeRequest(req);
        const resp = await call(redevenV1TypeIds.access.resume, payload, decodeWire(redevenWireSchemaNames.fromWireAccessResumeResponse, fromWireAccessResumeResponse));
        return resp;
      },
    },
    sys: {
      ping: async () => {
        const resp = await call(redevenV1TypeIds.sys.ping, {}, decodeWire(redevenWireSchemaNames.fromWireSysPingResponse, fromWireSysPingResponse));
        return resp;
      },
      upgrade: async (req = {}) => {
        const payload = toWireSysUpgradeRequest(req);
        const resp = await call(redevenV1TypeIds.sys.upgrade, payload, decodeWire(redevenWireSchemaNames.fromWireSysUpgradeResponse, fromWireSysUpgradeResponse));
        return resp;
      },
      restart: async () => {
        const payload = toWireSysRestartRequest();
        const resp = await call(redevenV1TypeIds.sys.restart, payload, decodeWire(redevenWireSchemaNames.fromWireSysRestartResponse, fromWireSysRestartResponse));
        return resp;
      },
    },
  };
}

export const redevenV1Contract: ProtocolContract<RedevenV1Rpc> = {
  id: 'redeven_v1',
  createRpc: (helpers) => createRedevenV1Rpc(helpers),
};
