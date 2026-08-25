import { describe, expect, it } from 'vitest';

import type { ReinstallTargetJournal } from './reinstallTargetCoordinator';
import {
  currentReinstallTargetJournalForEnvironment,
  currentReinstallTargetJournals,
} from './reinstallTargetJournalSelection';

function journal(input: Readonly<{
  preflightID: string;
  physicalTargetFingerprint: string;
  environmentID?: string;
  affectedEnvironmentIDs?: readonly string[];
  updatedAtUnixMS: number;
}>): ReinstallTargetJournal {
  const environmentID = input.environmentID ?? 'ssh:host:gzlight';
  return {
    schema_version: 1,
    preflight_id: input.preflightID,
    operation_id: `operation:${input.preflightID}`,
    environment_id: environmentID,
    descriptor_fingerprint: `descriptor:${input.preflightID}`,
    physical_target_fingerprint: input.physicalTargetFingerprint,
    target_root: '/srv/redeven',
    quarantine_root: `/srv/redeven-quarantine-${input.preflightID}`,
    target_existed: true,
    phase: 'old_root_isolated_or_cleared',
    affected_environment_ids: input.affectedEnvironmentIDs ?? [environmentID],
    preview: {
      preflight_id: input.preflightID,
      operation_key: `reinstall-target:${input.preflightID}`,
      environment_id: environmentID,
      label: environmentID,
      target_kind: 'ssh_host',
      host_label: 'gzlight',
      target_root: '/srv/redeven',
      target_exists: true,
      affected_environment_ids: input.affectedEnvironmentIDs ?? [environmentID],
      processes: [],
      deleted_data_keys: [],
      expires_at_unix_ms: input.updatedAtUnixMS + 60_000,
      mode: 'wipe_data',
      target_exists_known: true,
    },
    updated_at_unix_ms: input.updatedAtUnixMS,
  };
}

describe('reinstall target journal selection', () => {
  it('restores only the newest journal for each physical target', () => {
    const older = journal({
      preflightID: 'older',
      physicalTargetFingerprint: 'target-a',
      updatedAtUnixMS: 100,
    });
    const newer = journal({
      preflightID: 'newer',
      physicalTargetFingerprint: 'target-a',
      updatedAtUnixMS: 200,
    });
    const otherTarget = journal({
      preflightID: 'other',
      physicalTargetFingerprint: 'target-b',
      environmentID: 'ssh:host:gzcom',
      updatedAtUnixMS: 150,
    });

    expect(currentReinstallTargetJournals([older, otherTarget, newer])).toEqual([
      otherTarget,
      newer,
    ]);
  });

  it('uses the preflight id as a deterministic recency tie-breaker', () => {
    const first = journal({
      preflightID: 'a',
      physicalTargetFingerprint: 'target-a',
      updatedAtUnixMS: 200,
    });
    const second = journal({
      preflightID: 'b',
      physicalTargetFingerprint: 'target-a',
      updatedAtUnixMS: 200,
    });

    expect(currentReinstallTargetJournals([second, first])).toEqual([second]);
  });

  it('selects the newest current journal affecting an environment', () => {
    const older = journal({
      preflightID: 'older',
      physicalTargetFingerprint: 'target-a',
      environmentID: 'ssh:host:old-registration',
      affectedEnvironmentIDs: ['ssh:host:shared'],
      updatedAtUnixMS: 100,
    });
    const newer = journal({
      preflightID: 'newer',
      physicalTargetFingerprint: 'target-a',
      environmentID: 'ssh:host:new-registration',
      affectedEnvironmentIDs: ['ssh:host:shared'],
      updatedAtUnixMS: 200,
    });

    expect(currentReinstallTargetJournalForEnvironment(
      [older, newer],
      'ssh:host:shared',
    )).toBe(newer);
  });
});
