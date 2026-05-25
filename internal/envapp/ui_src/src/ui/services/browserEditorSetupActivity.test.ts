import { describe, expect, it } from 'vitest';

import {
  browserEditorLocalFailureFromError,
  buildBrowserEditorSetupActivity,
  classifyBrowserEditorLocalFailure,
  type BrowserEditorSetupLocalFailure,
} from './browserEditorSetupActivity';
import { type CodeRuntimeStatus } from './codeRuntimeApi';

function makeStatus(state: CodeRuntimeStatus['operation']['state']): CodeRuntimeStatus {
  return {
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
      version: '4.109.1',
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
      version: '4.109.1',
    },
    managed_prefix: '/Users/test/.redeven/local-environment/apps/code/runtime/managed',
    shared_runtime_root: '/Users/test/.redeven/shared/code-server/darwin-arm64',
    managed_runtime_version: '4.109.1',
    managed_runtime_source: 'managed',
    installed_versions: [
      {
        version: '4.109.1',
        binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
        selected_by_local_environment: true,
        removable: false,
        detection_state: 'ready',
      },
    ],
    operation: {
      action: 'prepare_workspace_engine',
      state,
      log_tail: [],
    },
    updated_at_unix_ms: 1,
  };
}

function missingStatus(): CodeRuntimeStatus {
  return {
    ...makeStatus('idle'),
    active_runtime: {
      detection_state: 'missing',
      present: false,
      source: 'none',
    },
    managed_runtime: {
      detection_state: 'missing',
      present: false,
      source: 'managed',
    },
    installed_versions: [],
    managed_runtime_source: 'none',
    managed_runtime_version: '',
  };
}

function localFailure(message: string): BrowserEditorSetupLocalFailure {
  return browserEditorLocalFailureFromError(new Error(message), () => 123);
}

describe('browserEditorSetupActivity', () => {
  it('classifies Desktop-side release lookup failures for the first setup step', () => {
    expect(classifyBrowserEditorLocalFailure('GitHub release lookup failed with HTTP 403.')).toBe('desktop_release_lookup');
    expect(classifyBrowserEditorLocalFailure('API rate limit exceeded')).toBe('desktop_release_lookup');
  });

  it('models Desktop release lookup failures as retryable inline activity', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: missingStatus(),
      localFailure: localFailure('GitHub release lookup failed with HTTP 403.'),
      pendingIntent: { kind: 'start' },
    });

    expect(activity).toMatchObject({
      state: 'failed',
      badge_label: 'Setup failed',
      summary: 'Couldn’t check the latest Browser Editor package.',
      can_retry: true,
      show_log: false,
    });
    expect(activity.pending_action_label).toBeUndefined();
    expect(activity.detail).toContain('GitHub release lookup failed with HTTP 403.');
    expect(activity.detail).toContain('GitHub’s API limit');
    expect(activity.steps.map((step) => [step.id, step.state])).toEqual([
      ['lookup', 'error'],
      ['cache', 'pending'],
      ['upload', 'pending'],
      ['verify', 'pending'],
    ]);
  });

  it('shows local Desktop pending work before Runtime import starts', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: missingStatus(),
      localPending: true,
    });

    expect(activity.state).toBe('preparing');
    expect(activity.summary).toBe('Desktop is preparing the Browser Editor package.');
    expect(activity.can_cancel).toBe(false);
    expect(activity.steps[0]).toMatchObject({ id: 'lookup', state: 'active' });
  });

  it('maps Runtime receiving operations to the upload step', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: {
        ...missingStatus(),
        operation: {
          action: 'prepare_workspace_engine',
          state: 'running',
          stage: 'receiving',
          log_tail: ['Receiving Browser Editor package from Desktop.'],
        },
      },
    });

    expect(activity.state).toBe('preparing');
    expect(activity.can_cancel).toBe(true);
    expect(activity.show_log).toBe(true);
    expect(activity.log_tail).toEqual(['Receiving Browser Editor package from Desktop.']);
    expect(activity.steps.map((step) => [step.id, step.state])).toEqual([
      ['lookup', 'done'],
      ['cache', 'done'],
      ['upload', 'active'],
      ['verify', 'pending'],
    ]);
  });

  it('uses Runtime operation failure details when Runtime records the failure', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: {
        ...missingStatus(),
        operation: {
          action: 'prepare_workspace_engine',
          state: 'failed',
          stage: 'verifying',
          last_error: 'Runtime rejected the uploaded package.',
          log_tail: ['verify failed', 'checksum mismatch'],
        },
      },
    });

    expect(activity).toMatchObject({
      state: 'failed',
      badge_label: 'Setup failed',
      summary: 'Runtime rejected the uploaded package.',
      can_retry: true,
      show_log: true,
      log_tail: ['verify failed', 'checksum mismatch'],
    });
    expect(activity.steps.map((step) => [step.id, step.state])).toEqual([
      ['lookup', 'done'],
      ['cache', 'done'],
      ['upload', 'done'],
      ['verify', 'error'],
    ]);
  });

  it('prefers Runtime terminal setup failure over stale Desktop local failure', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: {
        ...missingStatus(),
        operation: {
          action: 'prepare_workspace_engine',
          state: 'failed',
          stage: 'verifying',
          last_error: 'Runtime rejected the uploaded package.',
          log_tail: ['verify failed'],
        },
      },
      localFailure: localFailure('Desktop upload failed.'),
      pendingIntent: { kind: 'open' },
    });

    expect(activity.state).toBe('failed');
    expect(activity.summary).toBe('Runtime rejected the uploaded package.');
    expect(activity.show_log).toBe(true);
    expect(activity.log_tail).toEqual(['verify failed']);
    expect(activity.pending_action_label).toBeUndefined();
  });

  it('keeps pending intent labels only for states that can continue', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: makeStatus('idle'),
      pendingIntent: { kind: 'open' },
    });

    expect(activity.state).toBe('ready');
    expect(activity.can_continue).toBe(true);
    expect(activity.pending_action_label).toBe('Continue to open codespace');
  });

  it('does not turn version-removal failures into Browser Editor setup failures', () => {
    const activity = buildBrowserEditorSetupActivity({
      status: {
        ...makeStatus('failed'),
        operation: {
          action: 'remove_local_environment_version',
          state: 'failed',
          last_error: 'Version is active.',
          log_tail: ['remove blocked'],
        },
      },
    });

    expect(activity.state).toBe('ready');
    expect(activity.summary).toContain('Ready.');
  });
});
