import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  buildEnvironmentFlowerContextEnvelope,
  environmentFlowerPrimaryTargetID,
} from './environmentFlowerContext';

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
      provider_environments: [
        testProviderEnvironment('https://provider.example.invalid', 'env_demo', {
          label: 'Demo Environment',
          providerID: 'example_control_plane',
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
  it('builds a run-start compatible target for provider environment cards', () => {
    const environment = snapshotEnvironment((entry) => (
      entry.kind === 'provider_environment' && entry.env_public_id === 'env_demo'
    ));

    const envelope = buildEnvironmentFlowerContextEnvelope(environment, 'Provider · Online · Example Control Plane');

    expect(environmentFlowerPrimaryTargetID(environment)).toBe('provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo');
    expect(Object.keys(envelope.raw).sort()).toEqual([
      'action_id',
      'context',
      'execution_context',
      'presentation',
      'provider',
      'schema_version',
      'source',
      'target',
    ]);
    expect(Object.keys(envelope.raw.target).sort()).toEqual(['locality', 'target_id']);
    expect(envelope.raw.target).toEqual({
      target_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      locality: 'auto',
    });
    expect(envelope.raw.execution_context).toEqual({
      current_target_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      source_env_public_id: 'env_demo',
      runtime_hint: 'auto',
      session_source: 'desktop_welcome',
    });
    expect(envelope.raw.context[0].content).toContain('Provider origin: https://provider.example.invalid');
    expect(envelope.raw.context[0].content).toContain('Provider ID: example_control_plane');
    expect(envelope.raw.context[0].content).toContain('Env public ID: env_demo');
  });

  it('falls back to stable local environment identity without expanding the target schema', () => {
    const environment = snapshotEnvironment((entry) => entry.kind === 'local_environment');

    const envelope = buildEnvironmentFlowerContextEnvelope(environment, 'Local · Ready');

    expect(environmentFlowerPrimaryTargetID(environment)).toBe('local:local');
    expect(Object.keys(envelope.raw.target).sort()).toEqual(['locality', 'target_id']);
    expect(envelope.raw.target).toEqual({
      target_id: 'local:local',
      locality: 'auto',
    });
    expect(envelope.raw.context[0]).toMatchObject({
      kind: 'text_snapshot',
      title: 'Local Environment',
      detail: 'Local · Ready',
    });
    expect(envelope.raw.context[0].content).toContain('Environment ID: local');
  });
});
