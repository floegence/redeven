import {
  parseDesktopPluginStateRecoveryPlan,
  type DesktopPluginStateRecoveryPlan,
} from '../shared/pluginStateRecovery';

export type PluginStateRecoveryCLIReport = Readonly<{
  schema_version: 'redeven.plugin_state_recovery.v1';
  operation: 'recover';
  status: 'recovered';
  code: 'plugin_state_recovered';
  plan: DesktopPluginStateRecoveryPlan;
  recovery_id: string;
  fresh_generation_id: string;
}>;

export class PluginStateRecoveryCLIError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginStateRecoveryCLIError';
    this.code = code;
  }
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

export function parsePluginStateRecoveryCLIReport(
  raw: string,
  expectedPlanSHA256: string,
  exitCode: number | null,
): PluginStateRecoveryCLIReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Redeven returned an invalid plugin state recovery result.', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Redeven returned an invalid plugin state recovery result.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema_version !== 'redeven.plugin_state_recovery.v1' || record.operation !== 'recover') {
    throw new Error('Redeven returned an invalid plugin state recovery result.');
  }
  if (record.status === 'failed') {
    if (
      exitCode === 0
      || !hasExactKeys(record, ['schema_version', 'operation', 'status', 'code', 'message'])
      || compact(record.code) === ''
      || compact(record.message) === ''
    ) {
      throw new Error('Redeven returned an inconsistent plugin state recovery result.');
    }
    throw new PluginStateRecoveryCLIError(
      compact(record.code),
      compact(record.message),
    );
  }
  if (
    record.status !== 'recovered'
    || exitCode !== 0
    || record.code !== 'plugin_state_recovered'
    || !hasExactKeys(record, [
      'schema_version',
      'operation',
      'status',
      'code',
      'plan',
      'recovery_id',
      'fresh_generation_id',
    ])
    || compact(record.recovery_id) === ''
    || compact(record.fresh_generation_id) === ''
  ) {
    throw new Error('Redeven returned an inconsistent plugin state recovery result.');
  }
  let plan: DesktopPluginStateRecoveryPlan;
  try {
    plan = parseDesktopPluginStateRecoveryPlan(record.plan);
  } catch (error) {
    throw new Error('Redeven returned an invalid plugin state recovery result.', { cause: error });
  }
  if (plan.plan_sha256 !== expectedPlanSHA256) {
    throw new Error('Redeven returned an inconsistent plugin state recovery result.');
  }
  return {
    schema_version: 'redeven.plugin_state_recovery.v1',
    operation: 'recover',
    status: 'recovered',
    code: 'plugin_state_recovered',
    plan,
    recovery_id: compact(record.recovery_id),
    fresh_generation_id: compact(record.fresh_generation_id),
  };
}
