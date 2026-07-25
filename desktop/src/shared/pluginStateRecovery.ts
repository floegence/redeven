export type DesktopPluginStateRecoveryPlan = Readonly<{
  plan_sha256: string;
  root_identity_sha256: string;
  source_snapshot_sha256: string;
  source_entry_count: number;
  source_bytes: number;
  has_retained_quarantine: boolean;
  has_source_recovery_journal: boolean;
}>;

export const LOWER_SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function parseDesktopPluginStateRecoveryPlan(value: unknown): DesktopPluginStateRecoveryPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid plugin_state_recovery');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'has_retained_quarantine',
    'has_source_recovery_journal',
    'plan_sha256',
    'root_identity_sha256',
    'source_bytes',
    'source_entry_count',
    'source_snapshot_sha256',
  ];
  const keys = Object.keys(record).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('non-canonical plugin_state_recovery fields');
  }
  const planSHA256 = String(record.plan_sha256 ?? '');
  const rootIdentitySHA256 = String(record.root_identity_sha256 ?? '');
  const sourceSnapshotSHA256 = String(record.source_snapshot_sha256 ?? '');
  if (!LOWER_SHA256_PATTERN.test(planSHA256) || !LOWER_SHA256_PATTERN.test(rootIdentitySHA256) || !LOWER_SHA256_PATTERN.test(sourceSnapshotSHA256)) {
    throw new Error('invalid plugin_state_recovery digest');
  }
  if (!Number.isSafeInteger(record.source_entry_count) || Number(record.source_entry_count) < 1) {
    throw new Error('invalid plugin_state_recovery source_entry_count');
  }
  if (!Number.isSafeInteger(record.source_bytes) || Number(record.source_bytes) < 0) {
    throw new Error('invalid plugin_state_recovery source_bytes');
  }
  if (typeof record.has_retained_quarantine !== 'boolean' || typeof record.has_source_recovery_journal !== 'boolean') {
    throw new Error('invalid plugin_state_recovery flags');
  }
  return {
    plan_sha256: planSHA256,
    root_identity_sha256: rootIdentitySHA256,
    source_snapshot_sha256: sourceSnapshotSHA256,
    source_entry_count: Number(record.source_entry_count),
    source_bytes: Number(record.source_bytes),
    has_retained_quarantine: record.has_retained_quarantine,
    has_source_recovery_journal: record.has_source_recovery_journal,
  };
}
