import { describe, expect, it } from 'vitest';

import {
  browserEditorLocalFailureFromError,
  buildBrowserEditorSetupActivity,
  localizeBrowserEditorSetupActivity,
  type BrowserEditorSetupFailureSource,
  type BrowserEditorSetupLocalFailure,
} from './browserEditorSetupActivity';
import { BrowserEditorSetupError } from './browserEditorSetupError';
import { type CodeRuntimeStatus } from './codeRuntimeApi';
import { createTestI18nHelpers as createI18nHelpers } from '../i18n/locales/testDictionaries';

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

function localFailure(
  message: string,
  source: BrowserEditorSetupFailureSource = 'unknown',
): BrowserEditorSetupLocalFailure {
  return browserEditorLocalFailureFromError(new BrowserEditorSetupError(source, message), 'desktop_transfer', () => 123);
}

describe('browserEditorSetupActivity', () => {
  it('models a missing editor as an idle setup result', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer', status: missingStatus() });

    expect(activity).toMatchObject({
      state: 'missing',
      presentation: 'idle',
      can_retry: false,
      can_cancel: false,
      active_step_index: 1,
    });
    expect(activity.steps.map((step) => step.state)).toEqual(['active', 'pending', 'pending', 'pending']);
  });

  it('preserves structured failure sources without inspecting user-facing messages', () => {
    expect(localFailure('opaque message', 'desktop_release_lookup').source).toBe('desktop_release_lookup');
    expect(localFailure('catalog words do not classify plain errors').source).toBe('unknown');
  });

  it('models Desktop release lookup failures as retryable inline activity', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: missingStatus(),
      localFailure: localFailure('Redeven Browser Editor catalog lookup failed with HTTP 503.', 'desktop_release_lookup'),
      pendingIntent: { kind: 'start' },
    });

    expect(activity).toMatchObject({
      state: 'failed',
      presentation: 'result',
      badge_label: 'Setup failed',
      summary: 'Couldn’t check the latest Browser Editor.',
      can_retry: true,
      show_log: false,
    });
    expect(activity.pending_action_label).toBeUndefined();
    expect(activity.detail).toContain('Redeven Browser Editor catalog lookup failed with HTTP 503.');
    expect(activity.detail).toContain('Redeven’s update catalog may be temporarily unavailable.');
    expect(activity.steps.map((step) => [step.id, step.state])).toEqual([
      ['catalog', 'error'],
      ['acquire', 'pending'],
      ['deliver', 'pending'],
      ['install', 'pending'],
    ]);
  });

  it.each([
    ['Browser Editor package download failed.', 'desktop_package_cache', 'acquire'],
    ['Browser Editor upload failed while sending chunk 2.', 'desktop_upload', 'deliver'],
  ] as const)('maps retryable Desktop failure %s to the %s step', (message, source, expectedStep) => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: missingStatus(),
      localFailure: localFailure(message, source),
    });

    expect(activity.can_retry).toBe(true);
    expect(activity.steps.find((step) => step.state === 'error')?.id).toBe(expectedStep);
  });

  it('shows local Desktop pending work before Runtime import starts', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: missingStatus(),
      localPending: true,
    });

    expect(activity.state).toBe('preparing');
    expect(activity.presentation).toBe('progress');
    expect(activity.summary).toBe('Desktop is preparing the Browser Editor.');
    expect(activity.can_cancel).toBe(true);
    expect(activity.steps[0]).toMatchObject({ id: 'catalog', state: 'active' });
  });

  it('maps Runtime receiving operations to the upload step', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: {
        ...missingStatus(),
        operation: {
          action: 'prepare_workspace_engine',
          operation_id: 'browser-editor:receiving',
          install_method: 'desktop_transfer',
          state: 'running',
          stage: 'receiving',
          started_at_unix_ms: 10,
          transfer: { received_bytes: 32, expected_bytes: 64 },
          log_tail: ['Receiving Browser Editor package from Desktop.'],
        },
      },
    });

    expect(activity.state).toBe('preparing');
    expect(activity.presentation).toBe('progress');
    expect(activity.can_cancel).toBe(true);
    expect(activity.show_log).toBe(true);
    expect(activity.log_tail).toEqual(['Receiving Browser Editor package from Desktop.']);
    expect(activity.progress).toMatchObject({
      phase: 'upload',
      state: 'running',
      completed_bytes: 32,
      total_bytes: 64,
    });
    expect(activity.steps.map((step) => [step.id, step.state])).toEqual([
      ['catalog', 'done'],
      ['acquire', 'done'],
      ['deliver', 'active'],
      ['install', 'pending'],
    ]);
  });

  it('maps Desktop download progress to the cache step without inventing overall progress', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: missingStatus(),
      localPending: true,
      localProgress: {
        operation_id: 'browser-editor:1',
        phase: 'download',
        state: 'running',
        completed_bytes: 20,
        total_bytes: 100,
        updated_at_unix_ms: 10,
      },
    });

    expect(activity.steps.map((step) => [step.id, step.state])).toEqual([
      ['catalog', 'done'],
      ['acquire', 'active'],
      ['deliver', 'pending'],
      ['install', 'pending'],
    ]);
    expect(activity.progress).toMatchObject({ phase: 'download', completed_bytes: 20, total_bytes: 100 });
    expect(activity).not.toHaveProperty('progress_percent');
  });

  it('uses Runtime operation failure details when Runtime records the failure', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
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
      ['catalog', 'done'],
      ['acquire', 'done'],
      ['deliver', 'done'],
      ['install', 'error'],
    ]);
  });

  it('models cancelled Runtime setup as a retryable warning result', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: {
        ...missingStatus(),
        operation: {
          action: 'prepare_workspace_engine',
          state: 'cancelled',
          stage: 'receiving',
          last_error_code: 'operation_cancelled',
          log_tail: ['cancelled by user'],
        },
      },
    });

    expect(activity).toMatchObject({
      state: 'cancelled',
      presentation: 'result',
      badge_variant: 'warning',
      can_retry: true,
      error_code: 'operation_cancelled',
    });
    expect(activity.steps.find((step) => step.state === 'cancelled')?.id).toBe('deliver');
  });

  it('prefers Runtime terminal setup failure over stale Desktop local failure', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
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
      localFailure: localFailure('Desktop upload failed.', 'desktop_upload'),
      pendingIntent: { kind: 'open' },
    });

    expect(activity.state).toBe('failed');
    expect(activity.summary).toBe('Runtime rejected the uploaded package.');
    expect(activity.show_log).toBe(true);
    expect(activity.log_tail).toEqual(['verify failed']);
    expect(activity.pending_action_label).toBeUndefined();
  });

  it('keeps pending intent labels only for states that can continue', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status: makeStatus('idle'),
      pendingIntent: { kind: 'open' },
    });

    expect(activity.state).toBe('ready');
    expect(activity.can_continue).toBe(true);
    expect(activity.pending_action_label).toBe('Continue to open codespace');
  });

  it('models unsupported musl platforms as localized non-retryable results', () => {
    const status: CodeRuntimeStatus = {
      ...missingStatus(),
      platform: {
        os: 'linux',
        arch: 'amd64',
        libc: 'musl',
        platform_id: 'linux-amd64-musl',
        supported: false,
        unsupported_code: 'unsupported_libc',
        message: 'This Linux distribution is not supported by the managed code workspace engine.',
      },
    };
    const raw = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
      status,
      localFailure: localFailure('This Linux Environment is not supported by the managed workspace engine.'),
    });
    const localized = localizeBrowserEditorSetupActivity(raw, {
      status,
      loading: false,
      localPending: false,
      localFailure: localFailure('This Linux Environment is not supported by the managed workspace engine.'),
      installMethod: 'desktop_transfer',
    }, createI18nHelpers('zh-CN'));

    expect(raw).toMatchObject({
      state: 'failed',
      presentation: 'result',
      can_retry: false,
      error_code: 'unsupported_libc',
      platform_diagnosis: {
        code: 'unsupported_libc',
        requirement: 'linux_glibc',
      },
    });
    expect(localized.summary).toBe('此环境暂不支持托管 Browser Editor。');
    expect(localized.badge_label).toBe('环境不受支持');
    expect(localized.platform_diagnosis?.detected_label).toBe('linux / amd64 / musl');
    expect(localized.platform_diagnosis?.required_label).toBe('Linux amd64/arm64 · glibc');
  });

  it('does not turn version-removal failures into Browser Editor setup failures', () => {
    const activity = buildBrowserEditorSetupActivity({ installMethod: 'desktop_transfer',
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
