export type DesktopRuntimeProcessClassification =
  | 'current_owned'
  | 'legacy_owned'
  | 'legacy_ownerless'
  | 'foreign_owner'
  | 'ambiguous';

export type DesktopRuntimeProcessInstance = Readonly<{
  pid: number;
  process_started_at_unix_ms: number;
  instance_id?: string;
  desktop_owner_id?: string;
  state_root: string;
  executable_path: string;
  executable_deleted?: boolean;
  namespace_id?: string;
  executable_device?: number;
  executable_inode?: number;
  runtime_version?: string;
  classification: DesktopRuntimeProcessClassification;
  stoppable: boolean;
  reason_code?: string;
}>;

export type DesktopRuntimeProcessInventory = Readonly<{
  schema_version: 1;
  scope: Readonly<{
    runtime_root: string;
    state_root: string;
    desktop_owner_id?: string;
    user_identity?: string;
    namespace_id?: string;
  }>;
  inventory_digest: string;
  instances: readonly DesktopRuntimeProcessInstance[];
  summary: Readonly<{
    current_owned: number;
    legacy_owned: number;
    legacy_ownerless: number;
    foreign_owner: number;
    ambiguous: number;
    stoppable: number;
    blocking: number;
  }>;
}>;

export type DesktopRuntimeProcessStopResult = Readonly<{
  schema_version: 1;
  before: DesktopRuntimeProcessInventory;
  after: DesktopRuntimeProcessInventory;
  stopped?: readonly DesktopRuntimeProcessInstance[];
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseClassification(value: unknown): DesktopRuntimeProcessClassification {
  switch (compact(value)) {
    case 'current_owned':
    case 'legacy_owned':
    case 'legacy_ownerless':
    case 'foreign_owner':
    case 'ambiguous':
      return compact(value) as DesktopRuntimeProcessClassification;
    default:
      throw new Error('Runtime process inventory returned an unknown classification.');
  }
}

function parseInstance(value: unknown): DesktopRuntimeProcessInstance {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const pid = positiveInteger(record.pid);
  const startedAt = positiveInteger(record.process_started_at_unix_ms);
  const stateRoot = compact(record.state_root);
  const executablePath = compact(record.executable_path);
  if (pid <= 0 || startedAt <= 0 || !stateRoot || !executablePath) {
    throw new Error('Runtime process inventory returned an incomplete process identity.');
  }
  return {
    pid,
    process_started_at_unix_ms: startedAt,
    instance_id: compact(record.instance_id) || undefined,
    desktop_owner_id: compact(record.desktop_owner_id) || undefined,
    state_root: stateRoot,
    executable_path: executablePath,
    executable_deleted: record.executable_deleted === true || undefined,
    namespace_id: compact(record.namespace_id) || undefined,
    executable_device: positiveInteger(record.executable_device) || undefined,
    executable_inode: positiveInteger(record.executable_inode) || undefined,
    runtime_version: compact(record.runtime_version) || undefined,
    classification: parseClassification(record.classification),
    stoppable: record.stoppable === true,
    reason_code: compact(record.reason_code) || undefined,
  };
}

export function parseDesktopRuntimeProcessInventory(raw: string): DesktopRuntimeProcessInventory {
  const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  if (Number(record.schema_version) !== 1) {
    throw new Error('Runtime process inventory schema is unsupported.');
  }
  const scope = record.scope && typeof record.scope === 'object' ? record.scope as Record<string, unknown> : {};
  const summary = record.summary && typeof record.summary === 'object' ? record.summary as Record<string, unknown> : {};
  const runtimeRoot = compact(scope.runtime_root);
  const stateRoot = compact(scope.state_root);
  const digest = compact(record.inventory_digest);
  if (!runtimeRoot || !stateRoot || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error('Runtime process inventory scope or digest is invalid.');
  }
  return {
    schema_version: 1,
    scope: {
      runtime_root: runtimeRoot,
      state_root: stateRoot,
      desktop_owner_id: compact(scope.desktop_owner_id) || undefined,
      user_identity: compact(scope.user_identity) || undefined,
      namespace_id: compact(scope.namespace_id) || undefined,
    },
    inventory_digest: digest,
    instances: Array.isArray(record.instances) ? record.instances.map(parseInstance) : [],
    summary: {
      current_owned: nonNegativeInteger(summary.current_owned),
      legacy_owned: nonNegativeInteger(summary.legacy_owned),
      legacy_ownerless: nonNegativeInteger(summary.legacy_ownerless),
      foreign_owner: nonNegativeInteger(summary.foreign_owner),
      ambiguous: nonNegativeInteger(summary.ambiguous),
      stoppable: nonNegativeInteger(summary.stoppable),
      blocking: nonNegativeInteger(summary.blocking),
    },
  };
}

export function parseDesktopRuntimeProcessStopResult(raw: string): DesktopRuntimeProcessStopResult {
  const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  if (Number(record.schema_version) !== 1) {
    throw new Error('Runtime process stop result schema is unsupported.');
  }
  return {
    schema_version: 1,
    before: parseDesktopRuntimeProcessInventory(JSON.stringify(record.before ?? {})),
    after: parseDesktopRuntimeProcessInventory(JSON.stringify(record.after ?? {})),
    stopped: Array.isArray(record.stopped) ? record.stopped.map(parseInstance) : undefined,
  };
}

export function desktopRuntimeProcessInventoryNeedsMaintenance(inventory: DesktopRuntimeProcessInventory): boolean {
  return inventory.summary.legacy_owned > 0
    || inventory.summary.legacy_ownerless > 0
    || inventory.summary.foreign_owner > 0
    || inventory.summary.ambiguous > 0
    || inventory.summary.current_owned > 1;
}
