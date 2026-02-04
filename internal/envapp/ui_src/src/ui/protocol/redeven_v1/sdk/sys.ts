export type SysPingResponse = {
  serverTimeMs: number;
  agentInstanceId?: string;
  version?: string;
  commit?: string;
  buildTime?: string;
};

export type SysUpgradeRequest = {
  dryRun?: boolean;
};

export type SysUpgradeResponse = {
  ok: boolean;
  message?: string;
};

export type SysRestartResponse = {
  ok: boolean;
  message?: string;
};
