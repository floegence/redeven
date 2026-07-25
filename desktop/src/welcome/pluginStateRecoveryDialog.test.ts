import { describe, expect, it } from 'vitest';

import type { DesktopPluginStateRecoveryProposal } from '../shared/desktopLauncherIPC';
import {
  pluginStateRecoveryDialogAfterFailure,
  type PluginStateRecoveryDialogState,
} from './pluginStateRecoveryDialog';

function proposal(digest: string): DesktopPluginStateRecoveryProposal {
  return {
    environment_id: 'local-environment',
    plan: {
      plan_sha256: digest,
      root_identity_sha256: 'b'.repeat(64),
      source_snapshot_sha256: 'c'.repeat(64),
      source_entry_count: 12,
      source_bytes: 2048,
      has_retained_quarantine: true,
      has_source_recovery_journal: false,
    },
  };
}

describe('pluginStateRecoveryDialogAfterFailure', () => {
  it('replaces a stale reviewed plan with the newly inspected proposal', () => {
    const stale: PluginStateRecoveryDialogState = {
      proposal: proposal('a'.repeat(64)),
      error: '',
    };
    const updated = pluginStateRecoveryDialogAfterFailure(stale, {
      ok: false,
      code: 'plugin_state_recovery_required',
      scope: 'environment',
      message: 'The plugin state changed. Review the new recovery plan before continuing.',
      plugin_state_recovery: proposal('d'.repeat(64)),
    }, 'Recovery failed.');

    expect(updated.proposal.plan.plan_sha256).toBe('d'.repeat(64));
    expect(updated.proposal).not.toBe(stale.proposal);
    expect(updated.error).toMatch(/review the new recovery plan/iu);
  });

  it('keeps the reviewed proposal for an unrelated recovery failure', () => {
    const current: PluginStateRecoveryDialogState = {
      proposal: proposal('a'.repeat(64)),
      error: '',
    };
    expect(pluginStateRecoveryDialogAfterFailure(current, {
      ok: false,
      code: 'plugin_state_recovery_failed',
      scope: 'environment',
      message: 'Recovery did not complete.',
    }, 'Recovery failed.')).toEqual({
      proposal: current.proposal,
      error: 'Recovery did not complete.',
    });
  });
});
