export type DesktopRuntimeProcessReconciliation = Readonly<{
  mode: 'confirmed_takeover';
  expected_inventory_digest: string;
}>;

export type DesktopRuntimeProcessTakeoverOperation = 'stop' | 'restart' | 'update';

export type DesktopRuntimeProcessTakeoverLocation =
  | 'local_host'
  | 'ssh_host'
  | 'local_container'
  | 'ssh_container';

export type DesktopRuntimeProcessTakeoverInstance = Readonly<{
  pid: number;
  process_started_at_unix_ms: number;
  owner_status: 'current' | 'missing' | 'foreign';
  owner_evidence: 'process_environment' | 'runtime_lock' | 'missing';
  layout_status: 'current';
  state_root: string;
  runtime_version?: string;
  reason_code?: string;
}>;

export type DesktopRuntimeProcessTakeoverProposal = Readonly<{
  operation: DesktopRuntimeProcessTakeoverOperation;
  location: DesktopRuntimeProcessTakeoverLocation;
  environment_id: string;
  target_id: string;
  target_label: string;
  inventory_digest: string;
  process_count: number;
  instances: readonly DesktopRuntimeProcessTakeoverInstance[];
}>;
