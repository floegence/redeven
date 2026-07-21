import type { ProtocolContract, RpcHelpers } from '@floegence/floe-webapp-protocol';
import {
  captureDebugConsoleProtocolCall,
  publishDebugConsoleStructuredEvent,
} from '../../services/debugConsoleCapture';
import { redevenV1TypeIds } from './typeIds';
import type {
  AICompactThreadContextRequest,
  AICompactThreadContextResponse,
  AIRealtimeEvent,
  AIListMessagesRequest,
  AIListMessagesResponse,
  AISendUserTurnRequest,
  AISendUserTurnResponse,
  AISubmitRequestUserInputResponseRequest,
  AISubmitRequestUserInputResponseResponse,
  AIStopThreadRequest,
  AIStopThreadResponse,
  AISubscribeSummaryResponse,
  AISubscribeThreadRequest,
  AISubscribeThreadResponse,
} from './sdk/ai';
import type { AccessResumeRequest, AccessResumeResponse, AccessStatusResponse } from './sdk/access';
import type { FsCopyRequest, FsCopyResponse, FsDeleteRequest, FsDeleteResponse, FsListRequest, FsListResponse, FsMkdirRequest, FsMkdirResponse, FsPathContextResponse, FsReadFileRequest, FsReadFileResponse, FsRenameRequest, FsRenameResponse, FsWriteFileRequest, FsWriteFileResponse } from './sdk/fs';
import type {
  GitApplyStashRequest,
  GitApplyStashResponse,
  GitCheckoutBranchRequest,
  GitCheckoutBranchResponse,
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
import type { TerminalClearRequest, TerminalClearResponse, TerminalForegroundCommandUpdateEvent, TerminalHistoryRequest, TerminalHistoryResponse, TerminalNameUpdateEvent, TerminalOutputActivityUpdateEvent, TerminalSessionCreateRequest, TerminalSessionCreateResponse, TerminalSessionDeleteRequest, TerminalSessionDeleteResponse, TerminalSessionInfo, TerminalSessionStatsRequest, TerminalSessionStatsResponse, TerminalSessionsChangedEvent } from './sdk/terminal';
import {
  fromWireAIEventNotify,
  fromWireAICompactThreadContextResponse,
  fromWireAIListMessagesResponse,
  fromWireAISendUserTurnResponse,
  fromWireAISubmitRequestUserInputResponseResponse,
  fromWireAISubscribeSummaryResponse,
  fromWireAISubscribeThreadResponse,
  fromWireAIStopThreadResponse,
  toWireAIListMessagesRequest,
  toWireAICompactThreadContextRequest,
  toWireAISendUserTurnRequest,
  toWireAISubmitRequestUserInputResponseRequest,
  toWireAISubscribeThreadRequest,
  toWireAIStopThreadRequest,
} from './codec/ai';
import { fromWireAccessResumeResponse, fromWireAccessStatusResponse, toWireAccessResumeRequest } from './codec/access';
import { fromWireFsCopyResponse, fromWireFsDeleteResponse, fromWireFsListResponse, fromWireFsMkdirResponse, fromWireFsPathContextResponse, fromWireFsReadFileResponse, fromWireFsRenameResponse, fromWireFsWriteFileResponse, toWireFsCopyRequest, toWireFsDeleteRequest, toWireFsListRequest, toWireFsMkdirRequest, toWireFsReadFileRequest, toWireFsRenameRequest, toWireFsWriteFileRequest } from './codec/fs';
import {
  fromWireGitApplyStashResponse,
  fromWireGitCheckoutBranchResponse,
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
import { fromWireTerminalForegroundCommandUpdateNotify, fromWireTerminalNameUpdateNotify, fromWireTerminalOutputActivityUpdateNotify, fromWireTerminalSessionCreateResponse, fromWireTerminalSessionDeleteResponse, fromWireTerminalSessionListResponse, fromWireTerminalSessionStatsResponse, fromWireTerminalHistoryResponse, toWireTerminalSessionCreateRequest, toWireTerminalSessionDeleteRequest, toWireTerminalSessionStatsRequest, toWireTerminalHistoryRequest, toWireTerminalClearRequest, fromWireTerminalClearResponse, fromWireTerminalSessionsChangedNotify } from './codec/terminal';
import type { wire_access_resume_req, wire_access_resume_resp, wire_access_status_resp } from './wire/access';
import type {
  wire_ai_event_notify,
  wire_ai_compact_thread_context_req,
  wire_ai_compact_thread_context_resp,
  wire_ai_list_messages_req,
  wire_ai_list_messages_resp,
  wire_ai_send_user_turn_req,
  wire_ai_send_user_turn_resp,
  wire_ai_submit_request_user_input_response_req,
  wire_ai_submit_request_user_input_response_resp,
  wire_ai_stop_thread_req,
  wire_ai_stop_thread_resp,
  wire_ai_subscribe_summary_resp,
  wire_ai_subscribe_thread_req,
  wire_ai_subscribe_thread_resp,
} from './wire/ai';
import type { wire_fs_copy_req, wire_fs_copy_resp, wire_fs_delete_req, wire_fs_delete_resp, wire_fs_get_path_context_resp, wire_fs_list_req, wire_fs_list_resp, wire_fs_mkdir_req, wire_fs_mkdir_resp, wire_fs_read_file_req, wire_fs_read_file_resp, wire_fs_rename_req, wire_fs_rename_resp, wire_fs_write_file_req, wire_fs_write_file_resp } from './wire/fs';
import type {
  wire_git_apply_stash_req,
  wire_git_apply_stash_resp,
  wire_git_checkout_branch_req,
  wire_git_checkout_branch_resp,
  wire_git_commit_workspace_req,
  wire_git_commit_workspace_resp,
  wire_git_discard_workspace_req,
  wire_git_discard_workspace_resp,
  wire_git_delete_branch_req,
  wire_git_delete_branch_resp,
  wire_git_drop_stash_req,
  wire_git_drop_stash_resp,
  wire_git_get_stash_detail_req,
  wire_git_get_stash_detail_resp,
  wire_git_merge_branch_req,
  wire_git_merge_branch_resp,
  wire_git_list_stashes_req,
  wire_git_list_stashes_resp,
  wire_git_preview_delete_branch_req,
  wire_git_preview_delete_branch_resp,
  wire_git_preview_apply_stash_req,
  wire_git_preview_apply_stash_resp,
  wire_git_preview_drop_stash_req,
  wire_git_preview_drop_stash_resp,
  wire_git_preview_merge_branch_req,
  wire_git_preview_merge_branch_resp,
  wire_git_fetch_repo_req,
  wire_git_fetch_repo_resp,
  wire_git_get_branch_compare_req,
  wire_git_get_branch_compare_resp,
  wire_git_get_commit_detail_req,
  wire_git_get_commit_detail_resp,
  wire_git_get_diff_content_req,
  wire_git_get_diff_content_resp,
  wire_git_get_repo_summary_req,
  wire_git_get_repo_summary_resp,
  wire_git_list_branches_req,
  wire_git_list_branches_resp,
  wire_git_list_commits_req,
  wire_git_list_commits_resp,
  wire_git_list_workspace_page_req,
  wire_git_list_workspace_page_resp,
  wire_git_list_workspace_changes_req,
  wire_git_list_workspace_changes_resp,
  wire_git_pull_repo_req,
  wire_git_pull_repo_resp,
  wire_git_push_repo_req,
  wire_git_push_repo_resp,
  wire_git_resolve_repo_req,
  wire_git_resolve_repo_resp,
  wire_git_save_stash_req,
  wire_git_save_stash_resp,
  wire_git_stage_workspace_req,
  wire_git_stage_workspace_resp,
  wire_git_switch_detached_req,
  wire_git_switch_detached_resp,
  wire_git_unstage_workspace_req,
  wire_git_unstage_workspace_resp,
} from './wire/git';
import type {
  wire_sys_monitor_kill_process_req,
  wire_sys_monitor_kill_process_resp,
  wire_sys_monitor_req,
  wire_sys_monitor_resp,
} from './wire/monitor';
import type { wire_sessions_list_active_resp } from './wire/sessions';
import type { wire_sys_ping_resp, wire_sys_restart_req, wire_sys_restart_resp, wire_sys_upgrade_req, wire_sys_upgrade_resp } from './wire/sys';
import type { wire_terminal_clear_req, wire_terminal_clear_resp, wire_terminal_foreground_command_update_notify, wire_terminal_history_req, wire_terminal_history_resp, wire_terminal_name_update_notify, wire_terminal_output_activity_update_notify, wire_terminal_session_create_req, wire_terminal_session_create_resp, wire_terminal_session_delete_req, wire_terminal_session_delete_resp, wire_terminal_session_list_resp, wire_terminal_session_stats_req, wire_terminal_session_stats_resp, wire_terminal_sessions_changed_notify } from './wire/terminal';

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
    getRepoSummary: (req: GitRepoSummaryRequest) => Promise<GitRepoSummaryResponse>;
    listWorkspacePage: (req: GitListWorkspacePageRequest) => Promise<GitListWorkspacePageResponse>;
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
    history: (req: TerminalHistoryRequest) => Promise<TerminalHistoryResponse>;
    clear: (req: TerminalClearRequest) => Promise<TerminalClearResponse>;
    deleteSession: (req: TerminalSessionDeleteRequest) => Promise<TerminalSessionDeleteResponse>;
    getSessionStats: (req: TerminalSessionStatsRequest) => Promise<TerminalSessionStatsResponse>;
    onNameUpdate: (handler: (event: TerminalNameUpdateEvent) => void) => () => void;
    onForegroundCommandUpdate: (handler: (event: TerminalForegroundCommandUpdateEvent) => void) => () => void;
    onOutputActivityUpdate: (handler: (event: TerminalOutputActivityUpdateEvent) => void) => () => void;
    onSessionsChanged: (handler: (event: TerminalSessionsChangedEvent) => void) => () => void;
  };
  ai: {
    sendUserTurn: (req: AISendUserTurnRequest) => Promise<AISendUserTurnResponse>;
    compactThreadContext: (req: AICompactThreadContextRequest) => Promise<AICompactThreadContextResponse>;
    submitRequestUserInputResponse: (req: AISubmitRequestUserInputResponseRequest) => Promise<AISubmitRequestUserInputResponseResponse>;
    subscribeSummary: () => Promise<AISubscribeSummaryResponse>;
    subscribeThread: (req: AISubscribeThreadRequest) => Promise<AISubscribeThreadResponse>;
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
  const call = <Req, Resp>(typeID: number, payload: Req) =>
    captureDebugConsoleProtocolCall<Req, Resp>({
      typeID,
      payload,
      execute: () => helpers.call<Req, Resp>(typeID, payload),
    });
  const onNotify = helpers.onNotify;

  return {
    fs: {
      getPathContext: async () => {
        const resp = await call<Record<string, never>, wire_fs_get_path_context_resp>(redevenV1TypeIds.fs.getPathContext, {});
        return fromWireFsPathContextResponse(resp);
      },
      list: async (req) => {
        const payload = toWireFsListRequest(req);
        const resp = await call<wire_fs_list_req, wire_fs_list_resp>(redevenV1TypeIds.fs.list, payload);
        return fromWireFsListResponse(resp);
      },
      readFile: async (req) => {
        const payload = toWireFsReadFileRequest(req);
        const resp = await call<wire_fs_read_file_req, wire_fs_read_file_resp>(redevenV1TypeIds.fs.readFile, payload);
        return fromWireFsReadFileResponse(resp);
      },
      writeFile: async (req) => {
        const payload = toWireFsWriteFileRequest(req);
        const resp = await call<wire_fs_write_file_req, wire_fs_write_file_resp>(redevenV1TypeIds.fs.writeFile, payload);
        return fromWireFsWriteFileResponse(resp);
      },
      mkdir: async (req) => {
        const payload = toWireFsMkdirRequest(req);
        const resp = await call<wire_fs_mkdir_req, wire_fs_mkdir_resp>(redevenV1TypeIds.fs.mkdir, payload);
        return fromWireFsMkdirResponse(resp);
      },
      rename: async (req) => {
        const payload = toWireFsRenameRequest(req);
        const resp = await call<wire_fs_rename_req, wire_fs_rename_resp>(redevenV1TypeIds.fs.rename, payload);
        return fromWireFsRenameResponse(resp);
      },
      copy: async (req) => {
        const payload = toWireFsCopyRequest(req);
        const resp = await call<wire_fs_copy_req, wire_fs_copy_resp>(redevenV1TypeIds.fs.copy, payload);
        return fromWireFsCopyResponse(resp);
      },
      delete: async (req) => {
        const payload = toWireFsDeleteRequest(req);
        const resp = await call<wire_fs_delete_req, wire_fs_delete_resp>(redevenV1TypeIds.fs.delete, payload);
        return fromWireFsDeleteResponse(resp);
      },
    },
    git: {
      resolveRepo: async (req) => {
        const payload = toWireGitResolveRepoRequest(req);
        const resp = await call<wire_git_resolve_repo_req, wire_git_resolve_repo_resp>(redevenV1TypeIds.git.resolveRepo, payload);
        return fromWireGitResolveRepoResponse(resp);
      },
      getRepoSummary: async (req) => {
        const payload = toWireGitGetRepoSummaryRequest(req);
        const resp = await call<wire_git_get_repo_summary_req, wire_git_get_repo_summary_resp>(redevenV1TypeIds.git.getRepoSummary, payload);
        return fromWireGitGetRepoSummaryResponse(resp);
      },
      listWorkspacePage: async (req) => {
        const payload = toWireGitListWorkspacePageRequest(req);
        const resp = await call<wire_git_list_workspace_page_req, wire_git_list_workspace_page_resp>(redevenV1TypeIds.git.listWorkspacePage, payload);
        return fromWireGitListWorkspacePageResponse(resp);
      },
      listWorkspaceChanges: async (req) => {
        const payload = toWireGitListWorkspaceChangesRequest(req);
        const resp = await call<wire_git_list_workspace_changes_req, wire_git_list_workspace_changes_resp>(redevenV1TypeIds.git.listWorkspaceChanges, payload);
        return fromWireGitListWorkspaceChangesResponse(resp);
      },
      listStashes: async (req) => {
        const payload = toWireGitListStashesRequest(req);
        const resp = await call<wire_git_list_stashes_req, wire_git_list_stashes_resp>(redevenV1TypeIds.git.listStashes, payload);
        return fromWireGitListStashesResponse(resp);
      },
      getStashDetail: async (req) => {
        const payload = toWireGitGetStashDetailRequest(req);
        const resp = await call<wire_git_get_stash_detail_req, wire_git_get_stash_detail_resp>(redevenV1TypeIds.git.getStashDetail, payload);
        return fromWireGitGetStashDetailResponse(resp);
      },
      stageWorkspace: async (req) => {
        const payload = toWireGitStageWorkspaceRequest(req);
        const resp = await call<wire_git_stage_workspace_req, wire_git_stage_workspace_resp>(redevenV1TypeIds.git.stageWorkspace, payload);
        return fromWireGitStageWorkspaceResponse(resp);
      },
      unstageWorkspace: async (req) => {
        const payload = toWireGitUnstageWorkspaceRequest(req);
        const resp = await call<wire_git_unstage_workspace_req, wire_git_unstage_workspace_resp>(redevenV1TypeIds.git.unstageWorkspace, payload);
        return fromWireGitUnstageWorkspaceResponse(resp);
      },
      discardWorkspace: async (req) => {
        const payload = toWireGitDiscardWorkspaceRequest(req);
        const resp = await call<wire_git_discard_workspace_req, wire_git_discard_workspace_resp>(redevenV1TypeIds.git.discardWorkspace, payload);
        return fromWireGitDiscardWorkspaceResponse(resp);
      },
      commitWorkspace: async (req) => {
        const payload = toWireGitCommitWorkspaceRequest(req);
        const resp = await call<wire_git_commit_workspace_req, wire_git_commit_workspace_resp>(redevenV1TypeIds.git.commitWorkspace, payload);
        return fromWireGitCommitWorkspaceResponse(resp);
      },
      saveStash: async (req) => {
        const payload = toWireGitSaveStashRequest(req);
        const resp = await call<wire_git_save_stash_req, wire_git_save_stash_resp>(redevenV1TypeIds.git.saveStash, payload);
        return fromWireGitSaveStashResponse(resp);
      },
      fetchRepo: async (req) => {
        const payload = toWireGitFetchRepoRequest(req);
        const resp = await call<wire_git_fetch_repo_req, wire_git_fetch_repo_resp>(redevenV1TypeIds.git.fetchRepo, payload);
        return fromWireGitFetchRepoResponse(resp);
      },
      pullRepo: async (req) => {
        const payload = toWireGitPullRepoRequest(req);
        const resp = await call<wire_git_pull_repo_req, wire_git_pull_repo_resp>(redevenV1TypeIds.git.pullRepo, payload);
        return fromWireGitPullRepoResponse(resp);
      },
      pushRepo: async (req) => {
        const payload = toWireGitPushRepoRequest(req);
        const resp = await call<wire_git_push_repo_req, wire_git_push_repo_resp>(redevenV1TypeIds.git.pushRepo, payload);
        return fromWireGitPushRepoResponse(resp);
      },
      checkoutBranch: async (req) => {
        const payload = toWireGitCheckoutBranchRequest(req);
        const resp = await call<wire_git_checkout_branch_req, wire_git_checkout_branch_resp>(redevenV1TypeIds.git.checkoutBranch, payload);
        return fromWireGitCheckoutBranchResponse(resp);
      },
      switchDetached: async (req) => {
        const payload = toWireGitSwitchDetachedRequest(req);
        const resp = await call<wire_git_switch_detached_req, wire_git_switch_detached_resp>(redevenV1TypeIds.git.switchDetached, payload);
        return fromWireGitSwitchDetachedResponse(resp);
      },
      previewDeleteBranch: async (req) => {
        const payload = toWireGitPreviewDeleteBranchRequest(req);
        const resp = await call<wire_git_preview_delete_branch_req, wire_git_preview_delete_branch_resp>(redevenV1TypeIds.git.previewDeleteBranch, payload);
        return fromWireGitPreviewDeleteBranchResponse(resp);
      },
      deleteBranch: async (req) => {
        const payload = toWireGitDeleteBranchRequest(req);
        const resp = await call<wire_git_delete_branch_req, wire_git_delete_branch_resp>(redevenV1TypeIds.git.deleteBranch, payload);
        return fromWireGitDeleteBranchResponse(resp);
      },
      previewApplyStash: async (req) => {
        const payload = toWireGitPreviewApplyStashRequest(req);
        const resp = await call<wire_git_preview_apply_stash_req, wire_git_preview_apply_stash_resp>(redevenV1TypeIds.git.previewApplyStash, payload);
        return fromWireGitPreviewApplyStashResponse(resp);
      },
      applyStash: async (req) => {
        const payload = toWireGitApplyStashRequest(req);
        const resp = await call<wire_git_apply_stash_req, wire_git_apply_stash_resp>(redevenV1TypeIds.git.applyStash, payload);
        return fromWireGitApplyStashResponse(resp);
      },
      previewDropStash: async (req) => {
        const payload = toWireGitPreviewDropStashRequest(req);
        const resp = await call<wire_git_preview_drop_stash_req, wire_git_preview_drop_stash_resp>(redevenV1TypeIds.git.previewDropStash, payload);
        return fromWireGitPreviewDropStashResponse(resp);
      },
      dropStash: async (req) => {
        const payload = toWireGitDropStashRequest(req);
        const resp = await call<wire_git_drop_stash_req, wire_git_drop_stash_resp>(redevenV1TypeIds.git.dropStash, payload);
        return fromWireGitDropStashResponse(resp);
      },
      previewMergeBranch: async (req) => {
        const payload = toWireGitPreviewMergeBranchRequest(req);
        const resp = await call<wire_git_preview_merge_branch_req, wire_git_preview_merge_branch_resp>(redevenV1TypeIds.git.previewMergeBranch, payload);
        return fromWireGitPreviewMergeBranchResponse(resp);
      },
      mergeBranch: async (req) => {
        const payload = toWireGitMergeBranchRequest(req);
        const resp = await call<wire_git_merge_branch_req, wire_git_merge_branch_resp>(redevenV1TypeIds.git.mergeBranch, payload);
        return fromWireGitMergeBranchResponse(resp);
      },
      listBranches: async (req) => {
        const payload = toWireGitListBranchesRequest(req);
        const resp = await call<wire_git_list_branches_req, wire_git_list_branches_resp>(redevenV1TypeIds.git.listBranches, payload);
        return fromWireGitListBranchesResponse(resp);
      },
      listCommits: async (req) => {
        const payload = toWireGitListCommitsRequest(req);
        const resp = await call<wire_git_list_commits_req, wire_git_list_commits_resp>(redevenV1TypeIds.git.listCommits, payload);
        return fromWireGitListCommitsResponse(resp);
      },
      getCommitDetail: async (req) => {
        const payload = toWireGitGetCommitDetailRequest(req);
        const resp = await call<wire_git_get_commit_detail_req, wire_git_get_commit_detail_resp>(redevenV1TypeIds.git.getCommitDetail, payload);
        return fromWireGitGetCommitDetailResponse(resp);
      },
      getBranchCompare: async (req) => {
        const payload = toWireGitGetBranchCompareRequest(req);
        const resp = await call<wire_git_get_branch_compare_req, wire_git_get_branch_compare_resp>(redevenV1TypeIds.git.getBranchCompare, payload);
        return fromWireGitGetBranchCompareResponse(resp);
      },
      getDiffContent: async (req) => {
        const payload = toWireGitGetDiffContentRequest(req);
        const resp = await call<wire_git_get_diff_content_req, wire_git_get_diff_content_resp>(redevenV1TypeIds.git.getDiffContent, payload);
        return fromWireGitGetDiffContentResponse(resp);
      },
    },
    terminal: {
      createSession: async (req) => {
        const payload = toWireTerminalSessionCreateRequest(req);
        const resp = await call<wire_terminal_session_create_req, wire_terminal_session_create_resp>(redevenV1TypeIds.terminal.sessionCreate, payload);
        return fromWireTerminalSessionCreateResponse(resp);
      },
      listSessions: async () => {
        const resp = await call<Record<string, never>, wire_terminal_session_list_resp>(redevenV1TypeIds.terminal.sessionList, {});
        return fromWireTerminalSessionListResponse(resp);
      },
      history: async (req) => {
        const payload = toWireTerminalHistoryRequest(req);
        const resp = await call<wire_terminal_history_req, wire_terminal_history_resp>(redevenV1TypeIds.terminal.history, payload);
        return fromWireTerminalHistoryResponse(resp);
      },
      clear: async (req) => {
        const payload = toWireTerminalClearRequest(req);
        const resp = await call<wire_terminal_clear_req, wire_terminal_clear_resp>(redevenV1TypeIds.terminal.clear, payload);
        return fromWireTerminalClearResponse(resp);
      },
      deleteSession: async (req) => {
        const payload = toWireTerminalSessionDeleteRequest(req);
        const resp = await call<wire_terminal_session_delete_req, wire_terminal_session_delete_resp>(redevenV1TypeIds.terminal.sessionDelete, payload);
        return fromWireTerminalSessionDeleteResponse(resp);
      },
      getSessionStats: async (req) => {
        const payload = toWireTerminalSessionStatsRequest(req);
        const resp = await call<wire_terminal_session_stats_req, wire_terminal_session_stats_resp>(redevenV1TypeIds.terminal.sessionStats, payload);
        return fromWireTerminalSessionStatsResponse(resp);
      },
      onNameUpdate: (handler) =>
        onNotify<wire_terminal_name_update_notify>(redevenV1TypeIds.terminal.nameUpdate, (payload) => {
          const ev = fromWireTerminalNameUpdateNotify(payload);
          if (ev) handler(ev);
        }),
      onForegroundCommandUpdate: (handler) =>
        onNotify<wire_terminal_foreground_command_update_notify>(redevenV1TypeIds.terminal.foregroundCommandUpdate, (payload) => {
          const ev = fromWireTerminalForegroundCommandUpdateNotify(payload);
          if (ev) handler(ev);
        }),
      onOutputActivityUpdate: (handler) =>
        onNotify<wire_terminal_output_activity_update_notify>(redevenV1TypeIds.terminal.outputActivityUpdate, (payload) => {
          const ev = fromWireTerminalOutputActivityUpdateNotify(payload);
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
      onSessionsChanged: (handler) =>
        onNotify<wire_terminal_sessions_changed_notify>(redevenV1TypeIds.terminal.sessionsChanged, (payload) => {
          const ev = fromWireTerminalSessionsChangedNotify(payload);
          if (ev) handler(ev);
        }),
    },
    ai: {
      sendUserTurn: async (req) => {
        const payload = toWireAISendUserTurnRequest(req);
        const resp = await call<wire_ai_send_user_turn_req, wire_ai_send_user_turn_resp>(redevenV1TypeIds.ai.sendUserTurn, payload);
        return fromWireAISendUserTurnResponse(resp);
      },
      compactThreadContext: async (req) => {
        const payload = toWireAICompactThreadContextRequest(req);
        const resp = await call<wire_ai_compact_thread_context_req, wire_ai_compact_thread_context_resp>(redevenV1TypeIds.ai.compactThreadContext, payload);
        return fromWireAICompactThreadContextResponse(resp);
      },
      submitRequestUserInputResponse: async (req) => {
        const payload = toWireAISubmitRequestUserInputResponseRequest(req);
        const resp = await call<wire_ai_submit_request_user_input_response_req, wire_ai_submit_request_user_input_response_resp>(redevenV1TypeIds.ai.submitRequestUserInputResponse, payload);
        return fromWireAISubmitRequestUserInputResponseResponse(resp);
      },
      subscribeSummary: async () => {
        const resp = await call<Record<string, never>, wire_ai_subscribe_summary_resp>(redevenV1TypeIds.ai.subscribeSummary, {});
        return fromWireAISubscribeSummaryResponse(resp);
      },
      subscribeThread: async (req) => {
        const payload = toWireAISubscribeThreadRequest(req);
        const resp = await call<wire_ai_subscribe_thread_req, wire_ai_subscribe_thread_resp>(redevenV1TypeIds.ai.subscribeThread, payload);
        return fromWireAISubscribeThreadResponse(resp);
      },
      stopThread: async (req) => {
        const payload = toWireAIStopThreadRequest(req);
        const resp = await call<wire_ai_stop_thread_req, wire_ai_stop_thread_resp>(redevenV1TypeIds.ai.stopThread, payload);
        return fromWireAIStopThreadResponse(resp);
      },
      listMessages: async (req) => {
        const payload = toWireAIListMessagesRequest(req);
        const resp = await call<wire_ai_list_messages_req, wire_ai_list_messages_resp>(redevenV1TypeIds.ai.listMessages, payload);
        return fromWireAIListMessagesResponse(resp);
      },
      onEvent: (handler) =>
        onNotify<wire_ai_event_notify>(redevenV1TypeIds.ai.event, (payload) => {
          const ev = fromWireAIEventNotify(payload);
          if (ev) handler(ev);
        }),
    },
    monitor: {
      getSysMonitor: async (req = {}) => {
        const payload = toWireSysMonitorRequest(req);
        const resp = await call<wire_sys_monitor_req, wire_sys_monitor_resp>(redevenV1TypeIds.monitor.sysMonitor, payload);
        return fromWireSysMonitorResponse(resp);
      },
      killProcess: async (req) => {
        const payload = toWireSysMonitorKillProcessRequest(req);
        const resp = await call<wire_sys_monitor_kill_process_req, wire_sys_monitor_kill_process_resp>(redevenV1TypeIds.monitor.killProcess, payload);
        return fromWireSysMonitorKillProcessResponse(resp);
      },
    },
    sessions: {
      listActiveSessions: async () => {
        const resp = await call<Record<string, never>, wire_sessions_list_active_resp>(redevenV1TypeIds.sessions.listActive, {});
        return fromWireSessionsListActiveResponse(resp);
      },
    },
    access: {
      status: async () => {
        const resp = await call<Record<string, never>, wire_access_status_resp>(redevenV1TypeIds.access.status, {});
        return fromWireAccessStatusResponse(resp);
      },
      resume: async (req) => {
        const payload = toWireAccessResumeRequest(req);
        const resp = await call<wire_access_resume_req, wire_access_resume_resp>(redevenV1TypeIds.access.resume, payload);
        return fromWireAccessResumeResponse(resp);
      },
    },
    sys: {
      ping: async () => {
        const resp = await call<Record<string, never>, wire_sys_ping_resp>(redevenV1TypeIds.sys.ping, {});
        return fromWireSysPingResponse(resp);
      },
      upgrade: async (req = {}) => {
        const payload = toWireSysUpgradeRequest(req);
        const resp = await call<wire_sys_upgrade_req, wire_sys_upgrade_resp>(redevenV1TypeIds.sys.upgrade, payload);
        return fromWireSysUpgradeResponse(resp);
      },
      restart: async () => {
        const payload = toWireSysRestartRequest();
        const resp = await call<wire_sys_restart_req, wire_sys_restart_resp>(redevenV1TypeIds.sys.restart, payload);
        return fromWireSysRestartResponse(resp);
      },
    },
  };
}

export const redevenV1Contract: ProtocolContract<RedevenV1Rpc> = {
  id: 'redeven_v1',
  createRpc: (helpers) => createRedevenV1Rpc(helpers),
};
