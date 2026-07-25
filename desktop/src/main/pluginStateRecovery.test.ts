import { describe, expect, it } from 'vitest';

import {
  parsePluginStateRecoveryCLIReport,
  PluginStateRecoveryCLIError,
} from './pluginStateRecovery';

describe('pluginStateRecovery', () => {
  const digest = 'a'.repeat(64);
  const plan = {
    plan_sha256: digest,
    root_identity_sha256: 'b'.repeat(64),
    source_snapshot_sha256: 'c'.repeat(64),
    source_entry_count: 96,
    source_bytes: 1132957,
    has_retained_quarantine: true,
    has_source_recovery_journal: false,
  };

  it('accepts the exact confirmed recovery result', () => {
    expect(parsePluginStateRecoveryCLIReport(JSON.stringify({
      schema_version: 'redeven.plugin_state_recovery.v1',
      operation: 'recover',
      status: 'recovered',
      code: 'plugin_state_recovered',
      plan,
      recovery_id: 'recovery-demo',
      fresh_generation_id: 'generation-demo',
    }), digest, 0)).toMatchObject({
      status: 'recovered',
      code: 'plugin_state_recovered',
    });
  });

  it('preserves a stale-plan failure as a typed outcome', () => {
    expect(() => parsePluginStateRecoveryCLIReport(JSON.stringify({
      schema_version: 'redeven.plugin_state_recovery.v1',
      operation: 'recover',
      status: 'failed',
      code: 'recovery_plan_changed',
      message: 'The plugin state changed. Review the new recovery plan before continuing.',
    }), digest, 1)).toThrow(PluginStateRecoveryCLIError);
    try {
      parsePluginStateRecoveryCLIReport(JSON.stringify({
        schema_version: 'redeven.plugin_state_recovery.v1',
        operation: 'recover',
        status: 'failed',
        code: 'recovery_plan_changed',
        message: 'The plugin state changed. Review the new recovery plan before continuing.',
      }), digest, 1);
    } catch (error) {
      expect(error).toMatchObject({ code: 'recovery_plan_changed' });
    }
  });

  it.each([
    '',
    '{}',
    JSON.stringify({ schema_version: 'other', operation: 'recover', status: 'recovered', code: 'plugin_state_recovered', plan, recovery_id: 'recovery-demo', fresh_generation_id: 'generation-demo' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'inspect', status: 'recovered', code: 'plugin_state_recovered', plan, recovery_id: 'recovery-demo', fresh_generation_id: 'generation-demo' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'recovered', code: 'plugin_state_recovered', plan: { ...plan, plan_sha256: 'b'.repeat(64) }, recovery_id: 'recovery-demo', fresh_generation_id: 'generation-demo' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'recovered', code: 'plugin_state_recovered', plan, recovery_id: '', fresh_generation_id: 'generation-demo' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'recovered', code: 'plugin_state_recovered', plan, recovery_id: 'recovery-demo' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'recovered', code: 'plugin_state_recovered', plan: { plan_sha256: digest }, recovery_id: 'recovery-demo', fresh_generation_id: 'generation-demo' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'recovered', code: 'plugin_state_recovered', plan, recovery_id: 'recovery-demo', fresh_generation_id: 'generation-demo', archive_path: '/secret' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'failed', code: 'recovery_plan_changed' }),
    JSON.stringify({ schema_version: 'redeven.plugin_state_recovery.v1', operation: 'recover', status: 'failed', code: 'recovery_plan_changed', message: 'changed', plan }),
  ])('rejects malformed or inconsistent CLI output %#', (raw) => {
    expect(() => parsePluginStateRecoveryCLIReport(raw, digest, 0)).toThrow(/invalid|inconsistent/iu);
  });
});
