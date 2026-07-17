import { describe, expect, it } from 'vitest';

import {
  buildExternalLocalUIDesktopTarget,
  buildGatewayDesktopTarget,
  buildLocalEnvironmentDesktopTarget,
  buildProviderEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
} from './desktopTarget';
import { desktopSessionContextSnapshotFromTarget } from './desktopSessionContext';
import { testLocalEnvironment, testProviderEnvironment } from '../testSupport/desktopTestHelpers';

describe('desktopSessionContext', () => {
  it('publishes local runtime identity without provider fields', () => {
    expect(desktopSessionContextSnapshotFromTarget(buildLocalEnvironmentDesktopTarget(testLocalEnvironment()))).toEqual({
      local_environment_id: 'local',
      renderer_storage_scope_id: 'local',
      target_kind: 'local_environment',
      target_route: 'local_host',
      session_source: 'local_runtime',
      label: 'Local Environment',
    });
  });

  it('publishes provider identity from the provider target instead of the remote desktop route alone', () => {
    expect(desktopSessionContextSnapshotFromTarget(buildProviderEnvironmentDesktopTarget(testProviderEnvironment(
      'https://provider.example.invalid/path',
      'env_demo',
      {
        providerID: 'example_control_plane',
        label: 'Demo Environment',
      },
    ), { route: 'remote_desktop' }))).toEqual({
      local_environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      renderer_storage_scope_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      target_kind: 'local_environment',
      target_route: 'remote_desktop',
      session_source: 'provider_environment',
      label: 'Demo Environment',
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
    });
  });

  it('publishes the remote Desktop route for external and SSH sessions', () => {
    expect(desktopSessionContextSnapshotFromTarget(buildExternalLocalUIDesktopTarget('http://192.168.1.11:24000/', {
      label: 'External host',
    }))).toEqual({
      local_environment_id: 'http://192.168.1.11:24000/',
      renderer_storage_scope_id: 'http://192.168.1.11:24000/',
      target_kind: 'external_local_ui',
      target_route: 'remote_desktop',
      session_source: 'external_local_ui',
      label: 'External host',
    });

    expect(desktopSessionContextSnapshotFromTarget(buildSSHDesktopTarget({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      runtime_root: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: '',
    }, {
      forwardedLocalUIURL: 'http://127.0.0.1:41111/',
      label: 'SSH Lab',
    }))).toEqual({
      local_environment_id: 'ssh:devbox:2222:key_agent:remote_default',
      renderer_storage_scope_id: 'ssh:devbox:2222:key_agent:remote_default',
      target_kind: 'ssh_environment',
      target_route: 'remote_desktop',
      session_source: 'ssh_environment',
      label: 'SSH Lab',
    });
  });

  it('publishes Gateway sessions as runtime_gateway without artifacts or proofs', () => {
    const snapshot = desktopSessionContextSnapshotFromTarget(buildGatewayDesktopTarget({
      gatewayID: 'bastion',
      gatewayLabel: 'Bastion Gateway',
      gatewayEnvID: 'env_demo',
      label: 'Demo Env',
      gatewaySessionID: 'gws_demo',
    }));

    expect(snapshot).toEqual({
      local_environment_id: 'gateway:bastion:env:env_demo',
      renderer_storage_scope_id: 'gateway:bastion:env:env_demo:session:gws_demo',
      target_kind: 'gateway_environment',
      target_route: 'remote_desktop',
      session_source: 'runtime_gateway',
      label: 'Demo Env',
    });
    expect(JSON.stringify(snapshot)).not.toContain('proof');
    expect(JSON.stringify(snapshot)).not.toContain('artifact');
  });
});
