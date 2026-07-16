import type {
  DesktopRuntimeProcessTakeoverLocation,
  DesktopRuntimeProcessTakeoverOperation,
  DesktopRuntimeProcessTakeoverProposal,
} from '../shared/desktopRuntimeProcessTakeover';

export type DesktopRuntimeProcessIdentityStatus = 'verified' | 'incomplete';
export type DesktopRuntimeProcessOwnerStatus = 'current' | 'missing' | 'foreign';
export type DesktopRuntimeProcessLayoutStatus = 'current' | 'unknown';
export type DesktopRuntimeProcessOwnerEvidence = 'process_environment' | 'runtime_lock' | 'missing';
export type DesktopRuntimeProcessStopAuthority = 'automatic' | 'confirmed_takeover' | 'blocked';

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
  reason_code?: string;
  identity_status: DesktopRuntimeProcessIdentityStatus;
  owner_status: DesktopRuntimeProcessOwnerStatus;
  layout_status: DesktopRuntimeProcessLayoutStatus;
  owner_evidence: DesktopRuntimeProcessOwnerEvidence;
  stop_authority: DesktopRuntimeProcessStopAuthority;
}>;

export type DesktopRuntimeProcessInventory = Readonly<{
  schema_version: 2;
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
    automatic: number;
    confirmed_takeover: number;
    blocked: number;
  }>;
}>;

export type DesktopRuntimeProcessStopResult = Readonly<{
  schema_version: 2;
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
    'desktop_owner_id',
    'state_root',
    'executable_path',
    'executable_deleted',
    'namespace_id',
    'executable_device',
    'executable_inode',
    'runtime_version',
    'reason_code',
    'identity_status',
    'owner_status',
    'layout_status',
    'owner_evidence',
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
    desktop_owner_id: compact(record.desktop_owner_id) || undefined,
    state_root: stateRoot,
    executable_path: executablePath,
    executable_deleted: record.executable_deleted === true || undefined,
    namespace_id: compact(record.namespace_id) || undefined,
    executable_device: positiveInteger(record.executable_device) || undefined,
    executable_inode: positiveInteger(record.executable_inode) || undefined,
    runtime_version: compact(record.runtime_version) || undefined,
    reason_code: compact(record.reason_code) || undefined,
    identity_status: parseEnum(record.identity_status, ['verified', 'incomplete'] as const, 'identity status'),
    owner_status: parseEnum(record.owner_status, ['current', 'missing', 'foreign'] as const, 'owner status'),
    layout_status: parseEnum(record.layout_status, ['current', 'unknown'] as const, 'layout status'),
    owner_evidence: parseEnum(record.owner_evidence, ['process_environment', 'runtime_lock', 'missing'] as const, 'owner evidence'),
    stop_authority: parseEnum(record.stop_authority, ['automatic', 'confirmed_takeover', 'blocked'] as const, 'stop authority'),
  };
}

export function parseDesktopRuntimeProcessInventory(raw: string): DesktopRuntimeProcessInventory {
  const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  requireExactFields(record, ['schema_version', 'scope', 'inventory_digest', 'instances', 'summary'], 'inventory');
  const schemaVersion = Number(record.schema_version);
  if (schemaVersion !== 2) {
    throw new Error('Runtime process inventory schema is unsupported.');
  }
  const scope = record.scope && typeof record.scope === 'object' ? record.scope as Record<string, unknown> : {};
  const summary = record.summary && typeof record.summary === 'object' ? record.summary as Record<string, unknown> : {};
  requireExactFields(scope, ['runtime_root', 'state_root', 'desktop_owner_id', 'user_identity', 'namespace_id'], 'scope');
  requireExactFields(summary, ['automatic', 'confirmed_takeover', 'blocked'], 'summary');
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
  const confirmedTakeover = parseNonNegativeInteger(summary.confirmed_takeover, 'confirmed takeover process count');
  const blocked = parseNonNegativeInteger(summary.blocked, 'blocked process count');
  const actualSummary = instances.reduce((counts, instance) => {
    counts[instance.stop_authority] += 1;
    return counts;
  }, { automatic: 0, confirmed_takeover: 0, blocked: 0 });
  if (
    automatic !== actualSummary.automatic
    || confirmedTakeover !== actualSummary.confirmed_takeover
    || blocked !== actualSummary.blocked
  ) {
    throw new Error('Runtime process inventory summary does not match its instances.');
  }
  for (const instance of instances) {
    const automaticInstance = instance.stop_authority === 'automatic'
      && instance.identity_status === 'verified'
      && instance.owner_status === 'current'
      && instance.layout_status === 'current';
    const takeoverInstance = instance.stop_authority === 'confirmed_takeover'
      && instance.identity_status === 'verified'
      && (instance.owner_status === 'missing' || instance.owner_status === 'foreign')
      && instance.layout_status === 'current';
    const blockedInstance = instance.stop_authority === 'blocked'
      && (
        instance.identity_status === 'incomplete'
        || instance.layout_status === 'unknown'
      );
    if (!automaticInstance && !takeoverInstance && !blockedInstance) {
      throw new Error('Runtime process inventory contains an inconsistent process authority.');
    }
  }
  return {
    schema_version: 2,
    scope: {
      runtime_root: runtimeRoot,
      state_root: stateRoot,
      desktop_owner_id: compact(scope.desktop_owner_id) || undefined,
      user_identity: compact(scope.user_identity) || undefined,
      namespace_id: compact(scope.namespace_id) || undefined,
    },
    inventory_digest: digest,
    instances,
    summary: {
      automatic,
      confirmed_takeover: confirmedTakeover,
      blocked,
    },
  };
}

export function parseDesktopRuntimeProcessStopResult(raw: string): DesktopRuntimeProcessStopResult {
  const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  requireExactFields(record, ['schema_version', 'before', 'after', 'stopped'], 'stop result');
  const schemaVersion = Number(record.schema_version);
  if (schemaVersion !== 2) {
    throw new Error('Runtime process stop result schema is unsupported.');
  }
  return {
    schema_version: 2,
    before: parseDesktopRuntimeProcessInventory(JSON.stringify(record.before ?? {})),
    after: parseDesktopRuntimeProcessInventory(JSON.stringify(record.after ?? {})),
    stopped: Array.isArray(record.stopped) ? record.stopped.map(parseInstance) : undefined,
  };
}

export class RuntimeProcessTakeoverRequiredError extends Error {
  constructor(readonly inventory: DesktopRuntimeProcessInventory) {
    super('Runtime process takeover requires explicit user confirmation.');
    this.name = 'RuntimeProcessTakeoverRequiredError';
  }
}

export class RuntimeProcessIdentityBlockedError extends Error {
  constructor(readonly inventory: DesktopRuntimeProcessInventory) {
    super('Runtime process inventory contains an instance whose core identity cannot be safely verified.');
    this.name = 'RuntimeProcessIdentityBlockedError';
  }
}

export function buildDesktopRuntimeProcessTakeoverProposal(
  inventory: DesktopRuntimeProcessInventory,
  input: Readonly<{
    operation: DesktopRuntimeProcessTakeoverOperation;
    location: DesktopRuntimeProcessTakeoverLocation;
    environment_id: string;
    target_id: string;
    target_label: string;
  }>,
): DesktopRuntimeProcessTakeoverProposal {
  if (inventory.summary.blocked > 0) {
    throw new Error('A verified takeover proposal requires a fully verified runtime process inventory.');
  }
  if (inventory.summary.confirmed_takeover === 0) {
    throw new Error('Runtime process takeover inventory does not require confirmation.');
  }
  const instances = inventory.instances.map((instance) => {
    const automatic = instance.stop_authority === 'automatic' && instance.owner_status === 'current';
    const confirmed = instance.stop_authority === 'confirmed_takeover'
      && (instance.owner_status === 'missing' || instance.owner_status === 'foreign');
    if (
      instance.identity_status !== 'verified'
      || instance.layout_status !== 'current'
      || (!automatic && !confirmed)
    ) {
      throw new Error('Runtime process takeover inventory contains an invalid stop target.');
    }
    return {
      pid: instance.pid,
      process_started_at_unix_ms: instance.process_started_at_unix_ms,
      owner_status: instance.owner_status,
      owner_evidence: instance.owner_evidence,
      layout_status: instance.layout_status,
      state_root: instance.state_root,
      runtime_version: compact(instance.runtime_version) || undefined,
      reason_code: compact(instance.reason_code) || undefined,
    };
  });
  if (instances.length !== inventory.summary.automatic + inventory.summary.confirmed_takeover) {
    throw new Error('Runtime process takeover inventory does not match its stop targets.');
  }
  return {
    operation: input.operation,
    location: input.location,
    environment_id: compact(input.environment_id),
    target_id: compact(input.target_id),
    target_label: compact(input.target_label),
    inventory_digest: inventory.inventory_digest,
    process_count: instances.length,
    instances,
  };
}

export function requireDesktopRuntimeProcessReconciliation(
  inventory: DesktopRuntimeProcessInventory,
  reconciliation?: Readonly<{ mode: 'confirmed_takeover'; expected_inventory_digest: string }>,
): void {
  if (inventory.summary.blocked > 0) {
    throw new RuntimeProcessIdentityBlockedError(inventory);
  }
  if (
    reconciliation
    && compact(reconciliation.expected_inventory_digest) !== inventory.inventory_digest
  ) {
    if (inventory.summary.confirmed_takeover > 0) {
      throw new RuntimeProcessTakeoverRequiredError(inventory);
    }
    throw new RuntimeProcessCommandError(
      'runtime_inventory_changed',
      'Runtime process inventory changed after takeover confirmation.',
    );
  }
  if (inventory.summary.confirmed_takeover === 0) {
    return;
  }
  if (
    reconciliation?.mode !== 'confirmed_takeover'
    || compact(reconciliation.expected_inventory_digest) !== inventory.inventory_digest
  ) {
    throw new RuntimeProcessTakeoverRequiredError(inventory);
  }
}

export function desktopRuntimeProcessInventoryHasSingleCurrentOwner(
  inventory: DesktopRuntimeProcessInventory,
): boolean {
  const instance = inventory.instances[0];
  return inventory.instances.length === 1
    && !!instance
    && instance.identity_status === 'verified'
    && instance.owner_status === 'current'
    && instance.layout_status === 'current'
    && instance.stop_authority === 'automatic';
}

export function desktopRuntimeProcessInventoryNeedsMaintenance(inventory: DesktopRuntimeProcessInventory): boolean {
  return !desktopRuntimeProcessInventoryHasSingleCurrentOwner(inventory);
}

export function desktopRuntimeProcessStopTargetCount(
  inventory: DesktopRuntimeProcessInventory,
  reconciliation?: Readonly<{ mode: 'confirmed_takeover' }>,
): number {
  return inventory.summary.automatic
    + (reconciliation?.mode === 'confirmed_takeover' ? inventory.summary.confirmed_takeover : 0);
}
