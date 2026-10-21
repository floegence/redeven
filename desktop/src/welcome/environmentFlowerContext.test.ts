import { memberFixture } from '../testSupport/gatewayMembershipFixture';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testCloudEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  buildEnvironmentFlowerContextAction,
  environmentFlowerPrimaryTargetID,
} from './environmentFlowerContext';
import { IDLE_LAUNCHER_BUSY_STATE } from './launcherBusyState';

afterEach(() => vi.restoreAllMocks());

function snapshotEnvironment(
  predicate: (environment: DesktopEnvironmentEntry) => boolean,
): DesktopEnvironmentEntry {
  const snapshot = buildDesktopWelcomeSnapshot({
    preferences: testDesktopPreferences({
      local_environment: testLocalEnvironment({
        label: 'Local Environment',
        access: {
          local_ui_bind: '127.0.0.1:5173',
        },
      }),
      cloud_environments: [
        testCloudEnvironment('https://provider.example.invalid', 'env_demo', {
          label: 'Demo Environment',
          cloudID: 'example_control_plane',
          accessPointOrigin: 'https://dev.provider.example.invalid',
        }),
      ],
    }),
  });
  const environment = snapshot.environments.find(predicate);
  if (!environment) {
    throw new Error('Expected the desktop welcome snapshot to include a matching environment.');
  }
  return environment;
}

describe('environment Flower context envelope', () => {
  it('captures inspection state and the selected operation failure with safe diagnostic excerpts', () => {
    const local = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const environment = { ...local, runtime_health: {
      ...local.runtime_health, status: 'offline' as const, freshness: 'failed' as const,
      checked_at_unix_ms: 1234, offline_reason_code: 'probe_failed' as const,
      offline_reason: 'Connection refused',
    } };
    const progress: DesktopLauncherActionProgress = {
      action: 'start_environment_runtime', environment_id: environment.id,
      operation_key: 'start-fixture', started_at_unix_ms: 1000, updated_at_unix_ms: 1200,
      status: 'failed', active_progress_surface: 'runtime_lifecycle', phase: 'starting_runtime_process', title: 'Start runtime', detail: 'Process exited',
      failure: { code: 'local_runtime_launch_failed', severity: 'error', title: 'Start failed',
        summary: 'Runtime exited before readiness', recovery_hint: 'Check the port and retry', diagnostics: [
          { channel: 'stderr', label: 'Runtime output', text: 'address already in use\napi_key=private-key' },
          { channel: 'authorization', label: 'Private authorization', text: 'private-proof', sensitive: true },
        ] },
    };
    const content = buildEnvironmentFlowerContextAction(environment, 'Local · Offline', 'This environment', {
      progressItems: [progress],
    }).context[0].content;
    for (const fact of ['probe_failed', 'Connection refused', '1234', 'start-fixture', 'failed',
      'local_runtime_launch_failed', 'Runtime exited before readiness', 'Check the port and retry',
      'address already in use', '[redacted]']) expect(content).toContain(fact);
    expect(content).not.toContain('private-key');
    expect(content).not.toContain('private-proof');
  });

  it('excludes other environments and captures only the current card operation after retry', () => {
    const environment = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const failed: DesktopLauncherActionProgress = {
      action: 'start_environment_runtime', environment_id: environment.id, operation_key: 'old-start',
      started_at_unix_ms: 1000, status: 'failed', phase: 'failed', title: 'Old failure', detail: 'stale error',
    };
    const running = { ...failed, operation_key: 'new-start', started_at_unix_ms: 2000,
      status: 'running' as const, phase: 'starting_runtime_process', title: 'Starting', detail: 'Retry running' };
    const content = buildEnvironmentFlowerContextAction(environment, 'Local', 'This environment', {
      progressItems: [failed, running, { ...running, environment_id: 'other', detail: 'Other device secret' }],
    }).context[0].content;
    expect(content).toContain('new-start');
    expect(content).toContain('Retry running');
    expect(content).not.toContain('stale error');
    expect(content).not.toContain('Other device secret');
  });

  it.each(['checking', 'fresh', 'failed', 'unknown'] as const)('preserves %s inspection and readiness facts independently', freshness => {
    const local = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const content = buildEnvironmentFlowerContextAction({ ...local,
      runtime_health: { ...local.runtime_health, status: 'online', freshness },
      runtime_service: { remote_enabled: false, compatibility: 'update_required', runtime_version: 'v0.12.0',
        active_workload: { terminal_count: 0, session_count: 0, task_count: 0, port_forward_count: 0 },
        open_readiness: { state: 'blocked', reason_code: 'runtime_update_required' },
        ai_readiness: { state: 'recovering', retryable: false },
      },
    }, 'Local').context[0].content;
    for (const fact of [`"freshness": "${freshness}"`, '"runtime_status": "online"',
      '"state": "blocked"', '"state": "recovering"', 'runtime_update_required', 'v0.12.0']) expect(content).toContain(fact);
  });

  it.each(['succeeded', 'failed', 'canceled', 'cleanup_failed', 'needs_confirmation'] as const)('reports the retained %s operation truthfully', status => {
    const environment = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const content = buildEnvironmentFlowerContextAction(environment, 'Local', 'This environment', {
      progressItems: [{ action: 'start_environment_runtime', environment_id: environment.id,
        active_progress_surface: 'runtime_lifecycle', status, phase: 'terminal', title: 'Start runtime', detail: '' }],
    }).context[0].content;
    expect(content).toContain(`"status": "${status}"`);
  });

  it('reports omitted diagnostics while keeping explicit sensitive output out of the snapshot', () => {
    const environment = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const content = buildEnvironmentFlowerContextAction(environment, 'Local', 'This environment', {
      progressItems: [{ action: 'start_environment_runtime', environment_id: environment.id,
        status: 'failed', active_progress_surface: 'runtime_lifecycle', phase: 'failed', title: 'Start failed', detail: '',
        failure: { code: 'operation_failed', severity: 'error', title: 'Start failed', summary: 'Failed',
          diagnostics: [
            { channel: 'private', label: 'Hidden diagnostic label', text: 'sensitive output', sensitive: true },
            ...Array.from({ length: 5 }, (_, index) => ({ channel: 'stderr', label: 'Output', text: `output-${index}` })),
          ] } }],
    }).context[0].content;
    expect(content).toContain('"omitted_diagnostic_count": 2');
    expect(content).toContain('output-3');
    expect(content).not.toContain('output-4');
    expect(content).not.toContain('Hidden diagnostic label');
    expect(content).not.toContain('sensitive output');
  });

  it('distinguishes unknown inspection and absent progress from successful operations', () => {
    const local = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const content = buildEnvironmentFlowerContextAction({ ...local, runtime_health: {
      ...local.runtime_health, freshness: 'unknown', checked_at_unix_ms: 0,
    } }, 'Local').context[0].content;
    expect(content).toContain('"freshness": "unknown"');
    expect(content).toContain('"card_operation": null');
    expect(content).not.toContain('succeeded');
    const pending = buildEnvironmentFlowerContextAction(local, 'Local', 'This environment', {
      busyState: { ...IDLE_LAUNCHER_BUSY_STATE, action: 'start_environment_runtime', environment_id: local.id },
    }).context[0].content;
    expect(pending).toContain('"submission_pending": true');
  });

  it('bounds large Unicode logs with an explicit omission marker and preserves their final error', () => {
    const environment = snapshotEnvironment(entry => entry.kind === 'local_environment');
    const content = buildEnvironmentFlowerContextAction(environment, 'Local', 'This environment', {
      progressItems: [{ action: 'start_environment_runtime', environment_id: environment.id,
        status: 'failed', active_progress_surface: 'runtime_lifecycle', phase: 'failed', title: 'Start failed', detail: '',
        failure: { code: 'operation_failed', severity: 'error', title: 'Start failed', summary: 'Failed',
          diagnostics: [{ channel: 'stderr', label: 'Output', text: `begin\n${'🌸'.repeat(40000)}\nfinal error` }] } }],
    }).context[0].content;
    expect([...content].length).toBeLessThanOrEqual(24000);
    expect(content).toContain('[... truncated ...]');
    expect(content).toContain('final error');
    expect(content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });

  it('matches the environment card fixture exercised through Send and DeepSeek HTTP', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1760000000000);
    const local = snapshotEnvironment((entry) => entry.kind === 'local_environment');
    const environment: DesktopEnvironmentEntry = {
      ...local,
      id: 'ssh:host:udesk26:7afba939',
      kind: 'ssh_environment',
      label: 'udesk26',
      local_ui_url: '',
      env_public_id: undefined,
      cloud_origin: undefined,
      cloud_id: undefined,
      managed_runtime_target_id: 'ssh:host:udesk26:7afba939',
      provider_runtime_link_target: undefined,
      managed_runtime_placement_target_id: undefined,
      runtime_platform: 'linux',
      runtime_health: { status: 'offline', freshness: 'failed', checked_at_unix_ms: 1759999999000,
        source: 'ssh_runtime_probe', offline_reason_code: 'probe_failed', offline_reason: 'Connection refused' },
    };
    const progress: DesktopLauncherActionProgress = {
      action: 'start_environment_runtime', environment_id: environment.id, operation_key: 'ssh-start-fixture',
      status: 'failed', active_progress_surface: 'runtime_lifecycle', phase: 'starting_runtime_process',
      title: 'Start runtime', detail: 'Process exited', started_at_unix_ms: 1759999998000,
      updated_at_unix_ms: 1759999999000,
      failure: { code: 'ssh_runtime_launch_failed', severity: 'error', title: 'Start failed',
        summary: 'Runtime exited before readiness', recovery_hint: 'Check the port and retry',
        diagnostics: [{ channel: 'stderr', label: 'Runtime output', text: 'address already in use' }] },
    };
    const fixturePath = join(__dirname, '../../../internal/ai/testdata/environment_flower_context.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(buildEnvironmentFlowerContextAction(environment, 'SSH · Configured', 'This environment', {
      progressItems: [progress],
    })).toEqual(fixture);
  });

  it('builds a run-start compatible target for provider environment cards', () => {
    const environment = snapshotEnvironment((entry) => (
      entry.kind === 'provider_environment' && entry.env_public_id === 'env_demo'
    ));

    const action = buildEnvironmentFlowerContextAction(environment, 'Provider · Online · Example Control Plane');

    expect(environmentFlowerPrimaryTargetID(environment)).toBe('provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo');
    expect(Object.keys(action).sort()).toEqual([
      'action_id',
      'context',
      'execution_context',
      'presentation',
      'provider',
      'schema_version',
      'source',
      'target',
    ]);
    expect(Object.keys(action.target).sort()).toEqual(['locality', 'target_id']);
    expect(action).toMatchObject({
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      provider: 'flower',
      source: {
        surface: 'desktop_welcome_environment_card',
        surface_id: environment.id,
      },
      presentation: {
        label: 'Ask Flower',
        priority: 100,
      },
    });
    expect(action.target).toEqual({
      target_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      locality: 'auto',
    });
    expect(action.execution_context).toEqual({
      current_target_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      source_env_public_id: 'env_demo',
      runtime_hint: 'auto',
      session_source: 'provider_environment',
    });
    const contextItem = action.context[0];
    expect(contextItem).toMatchObject({
      kind: 'text_snapshot',
      title: 'Demo Environment',
      detail: 'Provider · Online · Example Control Plane',
    });
    if (contextItem.kind !== 'text_snapshot') {
      throw new Error('Expected a text snapshot context item.');
    }
    expect(contextItem.content).toContain('Kind: provider_environment');
    expect(contextItem.content).toContain('Provider origin: https://provider.example.invalid');
    expect(contextItem.content).toContain('Provider ID: example_control_plane');
    expect(contextItem.content).toContain('Env public ID: env_demo');
  });

  it('falls back to stable local environment identity without expanding the target schema', () => {
    const environment = snapshotEnvironment((entry) => entry.kind === 'local_environment');

    const action = buildEnvironmentFlowerContextAction(environment, 'Local · Ready');

    expect(environmentFlowerPrimaryTargetID(environment)).toBe('local:local');
    expect(Object.keys(action.target).sort()).toEqual(['locality', 'target_id']);
    expect(action.target).toEqual({
      target_id: 'local:local',
      locality: 'auto',
    });
    expect(action.execution_context).toEqual({
      current_target_id: 'local:local',
      runtime_hint: 'auto',
      session_source: 'local_runtime',
    });
    const localContextItem = action.context[0];
    expect(localContextItem).toMatchObject({
      kind: 'text_snapshot',
      title: 'Local Environment',
      detail: 'Local · Ready',
    });
    if (localContextItem.kind !== 'text_snapshot') {
      throw new Error('Expected a text snapshot context item.');
    }
    expect(localContextItem.content).toContain('Kind: local_environment');
    expect(localContextItem.content).toContain('Environment ID: local');
  });

  it('uses the launcher fallback label when an environment label is blank', () => {
    const environment = {
      ...snapshotEnvironment((entry) => entry.kind === 'local_environment'),
      label: '   ',
    };

    const action = buildEnvironmentFlowerContextAction(environment, 'Local · Ready', 'This environment');

    expect(action.context[0]?.title).toBe('This environment');
    expect(action.context[0]?.content).toContain('User-selected device: This environment');
  });

  it('maps gateway environments to runtime_gateway session source', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [{
        gateway_id: 'bastion',
        display_name: 'Bastion Gateway',
        local_enabled: true,
        connection_kind: 'url',
        management_capability: 'access_only',
        capabilities: [],
        status: 'online',
        trust_state: 'paired',
        endpoint_label: 'https://gateway.example.invalid',
        created_at_ms: 10,
        updated_at_ms: 20,
        environments: [{ ...memberFixture, member_id: 'env_demo', display_name: 'Demo Gateway' }],
      }],
    });
    const environment = snapshot.environments.find((entry) => entry.kind === 'gateway_environment');
    if (!environment) {
      throw new Error('Expected a gateway environment.');
    }

    const action = buildEnvironmentFlowerContextAction(environment, 'Gateway · Online');
    expect(action.execution_context).toEqual({
      current_target_id: 'gateway:bastion:env:env_demo',
      runtime_hint: 'auto',
      session_source: 'runtime_gateway',
    });
  });

  it.each([
    {
      kind: 'ssh_environment' as const,
      id: 'saved:ssh:orange',
      targetID: 'ssh:orange',
      sessionSource: 'ssh_environment',
    },
    {
      kind: 'wsl_environment' as const,
      id: 'saved:wsl:ubuntu',
      targetID: 'wsl:ubuntu',
      sessionSource: 'wsl_environment',
    },
    {
      kind: 'external_local_ui' as const,
      id: 'external:lab',
      targetID: 'external:lab',
      sessionSource: 'external_local_ui',
    },
  ])('keeps $kind target identity as routing metadata', ({ kind, id, targetID, sessionSource }) => {
    const local = snapshotEnvironment((entry) => entry.kind === 'local_environment');
    const environment: DesktopEnvironmentEntry = {
      ...local,
      id,
      kind,
      label: kind,
      env_public_id: undefined,
      provider_runtime_link_target: undefined,
      managed_runtime_target_id: kind === 'external_local_ui'
        ? undefined
        : targetID as NonNullable<DesktopEnvironmentEntry['managed_runtime_target_id']>,
      managed_runtime_placement_target_id: undefined,
    };

    const action = buildEnvironmentFlowerContextAction(environment, `${kind} context`);

    expect(environmentFlowerPrimaryTargetID(environment)).toBe(targetID);
    expect(action.target).toEqual({ target_id: targetID, locality: 'auto' });
    expect(action.execution_context).toEqual({
      current_target_id: targetID,
      runtime_hint: 'auto',
      session_source: sessionSource,
    });
  });
});
