import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  buildEnvironmentFlowerContextAction,
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
        environments: [{
          gateway_env_id: 'env_demo',
          display_name: 'Demo Gateway',
          env_kind: 'reachable_env',
          state: 'available',
          capabilities: ['open'],
          origin: { kind: 'network_target', label: 'Gateway network' },
        }],
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
});
