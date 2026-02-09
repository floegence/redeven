import type { ProtocolContract, RpcHelpers } from '@floegence/floe-webapp-protocol';
import { redevenV1TypeIds } from './typeIds';
import type { AIRealtimeEvent, AICancelRunRequest, AICancelRunResponse, AIStartRunRequest, AIStartRunResponse, AISubscribeResponse, AIToolApprovalRequest, AIToolApprovalResponse } from './sdk/ai';
import type { FsCopyRequest, FsCopyResponse, FsDeleteRequest, FsDeleteResponse, FsGetHomeResponse, FsListRequest, FsListResponse, FsReadFileRequest, FsReadFileResponse, FsRenameRequest, FsRenameResponse, FsWriteFileRequest, FsWriteFileResponse } from './sdk/fs';
import type { SysMonitorRequest, SysMonitorSnapshot } from './sdk/monitor';
import type { SessionsListActiveResponse } from './sdk/sessions';
import type { SysPingResponse, SysRestartResponse, SysUpgradeRequest, SysUpgradeResponse } from './sdk/sys';
import type { TerminalClearRequest, TerminalClearResponse, TerminalHistoryRequest, TerminalHistoryResponse, TerminalNameUpdateEvent, TerminalOutputEvent, TerminalSessionAttachRequest, TerminalSessionAttachResponse, TerminalSessionCreateRequest, TerminalSessionCreateResponse, TerminalSessionDeleteRequest, TerminalSessionDeleteResponse, TerminalSessionInfo, TerminalSessionStatsRequest, TerminalSessionStatsResponse, TerminalSessionsChangedEvent } from './sdk/terminal';
import { fromWireAIEventNotify, fromWireAICancelRunResponse, fromWireAIStartRunResponse, fromWireAISubscribeResponse, fromWireAIToolApprovalResponse, toWireAICancelRunRequest, toWireAIStartRunRequest, toWireAIToolApprovalRequest } from './codec/ai';
import { fromWireFsCopyResponse, fromWireFsDeleteResponse, fromWireFsGetHomeResponse, fromWireFsListResponse, fromWireFsReadFileResponse, fromWireFsRenameResponse, fromWireFsWriteFileResponse, toWireFsCopyRequest, toWireFsDeleteRequest, toWireFsListRequest, toWireFsReadFileRequest, toWireFsRenameRequest, toWireFsWriteFileRequest } from './codec/fs';
import { fromWireSysMonitorResponse, toWireSysMonitorRequest } from './codec/monitor';
import { fromWireSessionsListActiveResponse } from './codec/sessions';
import { fromWireSysPingResponse, fromWireSysRestartResponse, fromWireSysUpgradeResponse, toWireSysRestartRequest, toWireSysUpgradeRequest } from './codec/sys';
import { fromWireTerminalNameUpdateNotify, fromWireTerminalOutputNotify, fromWireTerminalSessionAttachResponse, fromWireTerminalSessionCreateResponse, fromWireTerminalSessionDeleteResponse, fromWireTerminalSessionListResponse, fromWireTerminalSessionStatsResponse, fromWireTerminalHistoryResponse, toWireTerminalInputNotify, toWireTerminalResizeNotify, toWireTerminalSessionAttachRequest, toWireTerminalSessionCreateRequest, toWireTerminalSessionDeleteRequest, toWireTerminalSessionStatsRequest, toWireTerminalHistoryRequest, toWireTerminalClearRequest, fromWireTerminalClearResponse, fromWireTerminalSessionsChangedNotify } from './codec/terminal';
import type { wire_ai_cancel_run_req, wire_ai_cancel_run_resp, wire_ai_event_notify, wire_ai_start_run_req, wire_ai_start_run_resp, wire_ai_subscribe_resp, wire_ai_tool_approval_req, wire_ai_tool_approval_resp } from './wire/ai';
import type { wire_fs_copy_req, wire_fs_copy_resp, wire_fs_delete_req, wire_fs_delete_resp, wire_fs_get_home_resp, wire_fs_list_req, wire_fs_list_resp, wire_fs_read_file_req, wire_fs_read_file_resp, wire_fs_rename_req, wire_fs_rename_resp, wire_fs_write_file_req, wire_fs_write_file_resp } from './wire/fs';
import type { wire_sys_monitor_req, wire_sys_monitor_resp } from './wire/monitor';
import type { wire_sessions_list_active_resp } from './wire/sessions';
import type { wire_sys_ping_resp, wire_sys_restart_req, wire_sys_restart_resp, wire_sys_upgrade_req, wire_sys_upgrade_resp } from './wire/sys';
import type { wire_terminal_clear_req, wire_terminal_clear_resp, wire_terminal_history_req, wire_terminal_history_resp, wire_terminal_name_update_notify, wire_terminal_output_notify, wire_terminal_session_attach_req, wire_terminal_session_attach_resp, wire_terminal_session_create_req, wire_terminal_session_create_resp, wire_terminal_session_delete_req, wire_terminal_session_delete_resp, wire_terminal_session_list_resp, wire_terminal_session_stats_req, wire_terminal_session_stats_resp, wire_terminal_sessions_changed_notify } from './wire/terminal';

export type RedevenV1Rpc = {
  fs: {
    getHome: () => Promise<FsGetHomeResponse>;
    list: (req: FsListRequest) => Promise<FsListResponse>;
    readFile: (req: FsReadFileRequest) => Promise<FsReadFileResponse>;
    writeFile: (req: FsWriteFileRequest) => Promise<FsWriteFileResponse>;
    rename: (req: FsRenameRequest) => Promise<FsRenameResponse>;
    copy: (req: FsCopyRequest) => Promise<FsCopyResponse>;
    delete: (req: FsDeleteRequest) => Promise<FsDeleteResponse>;
  };
  terminal: {
    createSession: (req: TerminalSessionCreateRequest) => Promise<TerminalSessionCreateResponse>;
    listSessions: () => Promise<{ sessions: TerminalSessionInfo[] }>;
    attach: (req: TerminalSessionAttachRequest) => Promise<TerminalSessionAttachResponse>;
    history: (req: TerminalHistoryRequest) => Promise<TerminalHistoryResponse>;
    clear: (req: TerminalClearRequest) => Promise<TerminalClearResponse>;
    deleteSession: (req: TerminalSessionDeleteRequest) => Promise<TerminalSessionDeleteResponse>;
    getSessionStats: (req: TerminalSessionStatsRequest) => Promise<TerminalSessionStatsResponse>;
    resize: (args: { sessionId: string; connId: string; cols: number; rows: number }) => Promise<void>;
    sendInput: (args: { sessionId: string; connId: string; data: Uint8Array }) => Promise<void>;
    sendTextInput: (args: { sessionId: string; connId: string; text: string }) => Promise<void>;
    onOutput: (handler: (event: TerminalOutputEvent) => void) => () => void;
    onNameUpdate: (handler: (event: TerminalNameUpdateEvent) => void) => () => void;
    onSessionsChanged: (handler: (event: TerminalSessionsChangedEvent) => void) => () => void;
  };
  ai: {
    startRun: (req: AIStartRunRequest) => Promise<AIStartRunResponse>;
    cancelRun: (req: AICancelRunRequest) => Promise<AICancelRunResponse>;
    subscribe: () => Promise<AISubscribeResponse>;
    approveTool: (req: AIToolApprovalRequest) => Promise<AIToolApprovalResponse>;
    onEvent: (handler: (event: AIRealtimeEvent) => void) => () => void;
  };
  monitor: {
    getSysMonitor: (req?: SysMonitorRequest) => Promise<SysMonitorSnapshot>;
  };
  sessions: {
    listActiveSessions: () => Promise<SessionsListActiveResponse>;
  };
  sys: {
    ping: () => Promise<SysPingResponse>;
    upgrade: (req?: SysUpgradeRequest) => Promise<SysUpgradeResponse>;
    restart: () => Promise<SysRestartResponse>;
  };
};

function encodeUtf8(text: string): Uint8Array {
  const t = String(text ?? '');
  if (t === '') return new Uint8Array();
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(t);
  }
  throw new Error('TextEncoder is not available in this environment');
}

export function createRedevenV1Rpc(helpers: RpcHelpers): RedevenV1Rpc {
  const call = helpers.call;
  const notify = helpers.notify;
  const onNotify = helpers.onNotify;

  return {
    fs: {
      getHome: async () => {
        const resp = await call<Record<string, never>, wire_fs_get_home_resp>(redevenV1TypeIds.fs.getHome, {});
        return fromWireFsGetHomeResponse(resp);
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
      attach: async (req) => {
        const payload = toWireTerminalSessionAttachRequest(req);
        const resp = await call<wire_terminal_session_attach_req, wire_terminal_session_attach_resp>(redevenV1TypeIds.terminal.sessionAttach, payload);
        return fromWireTerminalSessionAttachResponse(resp);
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
      resize: async ({ sessionId, connId, cols, rows }) => {
        await notify(redevenV1TypeIds.terminal.resize, toWireTerminalResizeNotify({ sessionId, connId, cols, rows }));
      },
      sendInput: async ({ sessionId, connId, data }) => {
        if (!(data instanceof Uint8Array) || data.length === 0) return;
        await notify(redevenV1TypeIds.terminal.input, toWireTerminalInputNotify({ sessionId, connId, data }));
      },
      sendTextInput: async ({ sessionId, connId, text }) => {
        const bytes = encodeUtf8(text);
        if (bytes.length === 0) return;
        await notify(redevenV1TypeIds.terminal.input, toWireTerminalInputNotify({ sessionId, connId, data: bytes }));
      },
      onOutput: (handler) =>
        onNotify<wire_terminal_output_notify>(redevenV1TypeIds.terminal.output, (payload) => {
          const ev = fromWireTerminalOutputNotify(payload);
          if (ev) handler(ev);
        }),
      onNameUpdate: (handler) =>
        onNotify<wire_terminal_name_update_notify>(redevenV1TypeIds.terminal.nameUpdate, (payload) => {
          const ev = fromWireTerminalNameUpdateNotify(payload);
          if (ev) handler(ev);
        }),
      onSessionsChanged: (handler) =>
        onNotify<wire_terminal_sessions_changed_notify>(redevenV1TypeIds.terminal.sessionsChanged, (payload) => {
          const ev = fromWireTerminalSessionsChangedNotify(payload);
          if (ev) handler(ev);
        }),
    },
    ai: {
      startRun: async (req) => {
        const payload = toWireAIStartRunRequest(req);
        const resp = await call<wire_ai_start_run_req, wire_ai_start_run_resp>(redevenV1TypeIds.ai.runStart, payload);
        return fromWireAIStartRunResponse(resp);
      },
      cancelRun: async (req) => {
        const payload = toWireAICancelRunRequest(req);
        const resp = await call<wire_ai_cancel_run_req, wire_ai_cancel_run_resp>(redevenV1TypeIds.ai.runCancel, payload);
        return fromWireAICancelRunResponse(resp);
      },
      subscribe: async () => {
        const resp = await call<Record<string, never>, wire_ai_subscribe_resp>(redevenV1TypeIds.ai.subscribe, {});
        return fromWireAISubscribeResponse(resp);
      },
      approveTool: async (req) => {
        const payload = toWireAIToolApprovalRequest(req);
        const resp = await call<wire_ai_tool_approval_req, wire_ai_tool_approval_resp>(redevenV1TypeIds.ai.toolApproval, payload);
        return fromWireAIToolApprovalResponse(resp);
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
    },
    sessions: {
      listActiveSessions: async () => {
        const resp = await call<Record<string, never>, wire_sessions_list_active_resp>(redevenV1TypeIds.sessions.listActive, {});
        return fromWireSessionsListActiveResponse(resp);
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
