export type SysMaintenanceSnapshot = {
  kind?: 'upgrade' | 'restart';
  state?: 'running' | 'failed';
  targetVersion?: string;
  message?: string;
  startedAtMs?: number;
  updatedAtMs?: number;
};

export type RuntimeServiceOwner = 'desktop' | 'external' | 'unknown';
export type RuntimeServiceCompatibility =
  | 'compatible'
  | 'update_available'
  | 'restart_recommended'
  | 'update_required'
  | 'desktop_update_required'
  | 'managed_elsewhere'
  | 'unknown';

export type RuntimeServiceOpenReadinessState = 'starting' | 'openable' | 'blocked';

export type RuntimeServiceOpenReadiness = {
  state: RuntimeServiceOpenReadinessState;
  reasonCode?: string;
  message?: string;
};

export type RuntimeServiceWorkload = {
  terminalCount: number;
  sessionCount: number;
  taskCount: number;
  portForwardCount: number;
};

export type RuntimeServiceCapability = {
  supported: boolean;
  bindMethod?: string;
  reasonCode?: string;
  message?: string;
};

export type RuntimeServiceBindingState = 'unbound' | 'bound' | 'unsupported' | 'error' | 'expired';

export type RuntimeServiceBinding = {
  state: RuntimeServiceBindingState;
  sessionId?: string;
  sshRuntimeKey?: string;
  expiresAtUnixMs?: number;
  modelSource?: string;
  modelCount?: number;
  missingKeyProviderIds?: string[];
  lastError?: string;
};

export type RuntimeServiceSnapshot = {
  runtimeVersion?: string;
  runtimeCommit?: string;
  runtimeBuildTime?: string;
  protocolVersion?: string;
  compatibilityEpoch?: number;
  serviceOwner: RuntimeServiceOwner;
  desktopManaged: boolean;
  effectiveRunMode?: string;
  remoteEnabled: boolean;
  compatibility: RuntimeServiceCompatibility;
  compatibilityMessage?: string;
  minimumDesktopVersion?: string;
  minimumRuntimeVersion?: string;
  compatibilityReviewId?: string;
  openReadiness?: RuntimeServiceOpenReadiness;
  activeWorkload: RuntimeServiceWorkload;
  capabilities?: {
    desktopAiBroker: RuntimeServiceCapability;
  };
  bindings?: {
    desktopAiBroker: RuntimeServiceBinding;
  };
};

export type SysPingResponse = {
  serverTimeMs: number;
  agentInstanceId?: string;
  processStartedAtMs?: number;
  version?: string;
  commit?: string;
  buildTime?: string;
  maintenance?: SysMaintenanceSnapshot;
  runtimeService?: RuntimeServiceSnapshot;
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
