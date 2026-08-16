export type DesktopRuntimeProcessIdentityStatus = 'verified' | 'incomplete';
export type DesktopRuntimeProcessLayoutStatus = 'current' | 'verified_alternate' | 'unknown';
export type DesktopRuntimeProcessStopAuthority = 'automatic' | 'blocked';

export type DesktopRuntimeProcessInstance = Readonly<{
  pid: number;
  process_started_at_unix_ms: number;
  instance_id?: string;
  state_root: string;
  executable_path: string;
  executable_deleted?: boolean;
  namespace_id?: string;
  executable_device?: number;
  executable_inode?: number;
  runtime_version?: string;
  reason_code?: string;
  identity_status: DesktopRuntimeProcessIdentityStatus;
  layout_status: DesktopRuntimeProcessLayoutStatus;
  stop_authority: DesktopRuntimeProcessStopAuthority;
}>;

export type DesktopRuntimeProcessInventory = Readonly<{
  schema_version: 3;
  scope: Readonly<{
    runtime_root: string;
    state_root: string;
    user_identity?: string;
    namespace_id?: string;
  }>;
  inventory_digest: string;
  instances: readonly DesktopRuntimeProcessInstance[];
  summary: Readonly<{
    automatic: number;
    blocked: number;
  }>;
}>;

export type DesktopRuntimeProcessStopResult = Readonly<{
  schema_version: 3;
  before: DesktopRuntimeProcessInventory;
  after: DesktopRuntimeProcessInventory;
  stopped?: readonly DesktopRuntimeProcessInstance[];
}>;

export class RuntimeProcessCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RuntimeProcessCommandError';
  }
}

export class RuntimeProcessIdentityBlockedError extends Error {
  constructor(readonly inventory: DesktopRuntimeProcessInventory) {
    super('Runtime process inventory contains an instance whose core identity cannot be safely verified.');
    this.name = 'RuntimeProcessIdentityBlockedError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function runtimeProcessCommandErrorFromOutput(
  stdout: unknown,
  stderr: unknown,
  fallback: string,
): Error {
  const raw = compact(stdout);
  if (raw !== '') {
    try {
      const parsed = JSON.parse(raw) as Readonly<{ error?: Readonly<{ code?: unknown; message?: unknown }> }>;
      const code = compact(parsed.error?.code);
      const message = compact(parsed.error?.message);
      if (message !== '') {
        return new RuntimeProcessCommandError(code || 'runtime_process_command_failed', message);
      }
    } catch {
      return new Error(compact(stderr) || fallback);
    }
  }
  return new Error(compact(stderr) || fallback);
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Runtime process inventory returned an invalid ${label}.`);
  }
  return parsed;
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const parsed = compact(value) as T;
  if (!allowed.includes(parsed)) {
    throw new Error(`Runtime process inventory returned an invalid ${label}.`);
  }
  return parsed;
}

function requireExactFields(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedFields = new Set(allowed);
  if (Object.keys(record).some((field) => !allowedFields.has(field))) {
    throw new Error(`Runtime process inventory returned an unexpected ${label} field.`);
  }
}

function parseInstance(value: unknown): DesktopRuntimeProcessInstance {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  requireExactFields(record, [
    'pid',
    'process_started_at_unix_ms',
    'instance_id',
    'state_root',
    'executable_path',
    'executable_deleted',
    'namespace_id',
    'executable_device',
    'executable_inode',
    'runtime_version',
    'reason_code',
    'identity_status',
    'layout_status',
    'stop_authority',
  ], 'process');
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
    state_root: stateRoot,
    executable_path: executablePath,
    executable_deleted: record.executable_deleted === true || undefined,
    namespace_id: compact(record.namespace_id) || undefined,
    executable_device: positiveInteger(record.executable_device) || undefined,
    executable_inode: positiveInteger(record.executable_inode) || undefined,
    runtime_version: compact(record.runtime_version) || undefined,
    reason_code: compact(record.reason_code) || undefined,
    identity_status: parseEnum(record.identity_status, ['verified', 'incomplete'] as const, 'identity status'),
    layout_status: parseEnum(record.layout_status, ['current', 'verified_alternate', 'unknown'] as const, 'layout status'),
    stop_authority: parseEnum(record.stop_authority, ['automatic', 'blocked'] as const, 'stop authority'),
  };
}

export function parseDesktopRuntimeProcessInventory(raw: string): DesktopRuntimeProcessInventory {
  const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  requireExactFields(record, ['schema_version', 'scope', 'inventory_digest', 'instances', 'summary'], 'inventory');
  if (Number(record.schema_version) !== 3) {
    throw new Error('Runtime process inventory schema is unsupported.');
  }
  const scope = record.scope && typeof record.scope === 'object' ? record.scope as Record<string, unknown> : {};
  const summary = record.summary && typeof record.summary === 'object' ? record.summary as Record<string, unknown> : {};
  requireExactFields(scope, ['runtime_root', 'state_root', 'user_identity', 'namespace_id'], 'scope');
  requireExactFields(summary, ['automatic', 'blocked'], 'summary');
  const runtimeRoot = compact(scope.runtime_root);
  const stateRoot = compact(scope.state_root);
  const digest = compact(record.inventory_digest);
  if (!runtimeRoot || !stateRoot || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error('Runtime process inventory scope or digest is invalid.');
  }
  if (!Array.isArray(record.instances)) {
    throw new Error('Runtime process inventory instances are invalid.');
  }
  const instances = record.instances.map(parseInstance);
  const automatic = parseNonNegativeInteger(summary.automatic, 'automatic process count');
  const blocked = parseNonNegativeInteger(summary.blocked, 'blocked process count');
  const actualSummary = instances.reduce((counts, instance) => {
    counts[instance.stop_authority] += 1;
    return counts;
  }, { automatic: 0, blocked: 0 });
  if (automatic !== actualSummary.automatic || blocked !== actualSummary.blocked) {
    throw new Error('Runtime process inventory summary does not match its instances.');
  }
  for (const instance of instances) {
    const verifiedLayout = instance.layout_status === 'current' || instance.layout_status === 'verified_alternate';
    const automaticInstance = instance.stop_authority === 'automatic'
      && instance.identity_status === 'verified'
      && verifiedLayout;
    const blockedInstance = instance.stop_authority === 'blocked'
      && (instance.identity_status === 'incomplete' || instance.layout_status === 'unknown');
    if (!automaticInstance && !blockedInstance) {
      throw new Error('Runtime process inventory contains an inconsistent process authority.');
    }
  }
  return {
    schema_version: 3,
    scope: {
      runtime_root: runtimeRoot,
      state_root: stateRoot,
      user_identity: compact(scope.user_identity) || undefined,
      namespace_id: compact(scope.namespace_id) || undefined,
    },
    inventory_digest: digest,
    instances,
    summary: { automatic, blocked },
  };
}

export function parseDesktopRuntimeProcessStopResult(raw: string): DesktopRuntimeProcessStopResult {
  const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  requireExactFields(record, ['schema_version', 'before', 'after', 'stopped'], 'stop result');
  if (Number(record.schema_version) !== 3) {
    throw new Error('Runtime process stop result schema is unsupported.');
  }
  return {
    schema_version: 3,
    before: parseDesktopRuntimeProcessInventory(JSON.stringify(record.before ?? {})),
    after: parseDesktopRuntimeProcessInventory(JSON.stringify(record.after ?? {})),
    stopped: Array.isArray(record.stopped) ? record.stopped.map(parseInstance) : undefined,
  };
}

export function requireDesktopRuntimeProcessIdentity(inventory: DesktopRuntimeProcessInventory): void {
  if (inventory.summary.blocked > 0) {
    throw new RuntimeProcessIdentityBlockedError(inventory);
  }
}

export function desktopRuntimeProcessInventoryHasSingleCurrent(
  inventory: DesktopRuntimeProcessInventory,
): boolean {
  const instance = inventory.instances[0];
  return inventory.instances.length === 1
    && !!instance
    && instance.identity_status === 'verified'
    && instance.layout_status === 'current'
    && instance.stop_authority === 'automatic';
}

export function desktopRuntimeProcessInventoryNeedsMaintenance(inventory: DesktopRuntimeProcessInventory): boolean {
  return !desktopRuntimeProcessInventoryHasSingleCurrent(inventory);
}

export function desktopRuntimeProcessStopTargetCount(inventory: DesktopRuntimeProcessInventory): number {
  return inventory.summary.automatic;
}
