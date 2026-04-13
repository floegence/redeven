import { describe, expect, it } from 'vitest';

import {
  buildExternalLocalUIDesktopTarget,
  buildManagedEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
  controlPlaneDesktopSessionKey,
  desktopSessionStateKeyFragment,
  externalLocalUIDesktopSessionKey,
  sshDesktopSessionKey,
} from './desktopTarget';
import {
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
} from '../testSupport/desktopTestHelpers';

describe('desktopTarget', () => {
  it('builds the managed local session target with a stable per-environment key', () => {
    expect(buildManagedEnvironmentDesktopTarget(testManagedLocalEnvironment())).toEqual({
      kind: 'managed_environment',
      session_key: 'env:local%3Adefault:local_host',
      environment_id: 'local:default',
      label: 'Local Environment',
      route: 'local_host',
      managed_environment_kind: 'local',
      local_environment_name: 'default',
      provider_origin: undefined,
      provider_id: undefined,
      env_public_id: undefined,
      has_local_hosting: true,
      has_remote_desktop: false,
    });
  });

  it('normalizes remote targets into URL-scoped session keys and labels', () => {
    expect(externalLocalUIDesktopSessionKey('  http://192.168.1.11:24000/path?q=1  ')).toBe(
      'url:http://192.168.1.11:24000/',
    );
    expect(buildExternalLocalUIDesktopTarget('http://192.168.1.11:24000/path?q=1', {
      environmentID: ' env-1 ',
      label: ' Work laptop ',
    })).toEqual({
      kind: 'external_local_ui',
      session_key: 'url:http://192.168.1.11:24000/',
      environment_id: 'env-1',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      label: 'Work laptop',
    });
  });

  it('falls back to a default URL-derived label and produces safe state-key fragments', () => {
    expect(buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/')).toEqual(
      expect.objectContaining({
        environment_id: 'http://192.168.1.12:24000/',
        label: '192.168.1.12:24000',
      }),
    );
    expect(desktopSessionStateKeyFragment('url:http://192.168.1.12:24000/')).toBe('url%3Ahttp%3A%2F%2F192.168.1.12%3A24000%2F');
  });

  it('builds provider-backed targets with provider-scoped session keys', () => {
    expect(controlPlaneDesktopSessionKey('https://cp.example.invalid/path', ' env_demo ')).toBe(
      'env:cp%3Ahttps%253A%252F%252Fcp.example.invalid%3Aenv%3Aenv_demo:remote_desktop',
    );
    expect(buildManagedEnvironmentDesktopTarget(testManagedControlPlaneEnvironment(
      'https://cp.example.invalid/path',
      ' env_demo ',
      {
        providerID: ' redeven_portal ',
        label: ' Demo Environment ',
      },
    ), { route: 'remote_desktop' })).toEqual({
      kind: 'managed_environment',
      session_key: 'env:cp%3Ahttps%253A%252F%252Fcp.example.invalid%3Aenv%3Aenv_demo:remote_desktop',
      environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      route: 'remote_desktop',
      managed_environment_kind: 'controlplane',
      provider_id: 'redeven_portal',
      provider_origin: 'https://cp.example.invalid',
      env_public_id: 'env_demo',
      label: 'Demo Environment',
      local_environment_name: undefined,
      has_local_hosting: true,
      has_remote_desktop: true,
    });
  });

  it('builds SSH targets with stable session keys that ignore forwarded local ports', () => {
    expect(sshDesktopSessionKey({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'auto',
      release_base_url: '',
    })).toBe('ssh:devbox:2222:remote_default');

    expect(buildSSHDesktopTarget({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases',
    }, {
      forwardedLocalUIURL: 'http://127.0.0.1:41111/',
      label: 'SSH Lab',
    })).toEqual({
      kind: 'ssh_environment',
      session_key: 'ssh:devbox:2222:remote_default',
      environment_id: 'ssh:devbox:2222:remote_default',
      label: 'SSH Lab',
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases',
      forwarded_local_ui_url: 'http://127.0.0.1:41111/',
    });
  });
});
