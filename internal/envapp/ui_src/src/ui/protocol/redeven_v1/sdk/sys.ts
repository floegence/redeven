export type SysMaintenanceSnapshot = {
  kind?: 'upgrade' | 'restart';
  state?: 'running' | 'failed';
  targetVersion?: string;
  message?: string;
  startedAtMs?: number;
  updatedAtMs?: number;
};

export type SysPingResponse = {
  serverTimeMs: number;
  agentInstanceId?: string;
  processStartedAtMs?: number;
  version?: string;
  commit?: string;
  buildTime?: string;
  maintenance?: SysMaintenanceSnapshot;
};

export type SysUpgradeRequest = {
  dryRun?: boolean;
  targetVersion?: string;
};

export type SysUpgradeResponse = {
  ok: boolean;
  message?: string;
};

export type SysRestartResponse = {
  ok: boolean;
  message?: string;
};
