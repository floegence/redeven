import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
  buildManagedLocalDesktopTarget,
  buildSSHDesktopTarget,
} from '../main/desktopTarget';
import { buildEnvironmentCardModel } from './viewModel';

describe('buildEnvironmentCardModel', () => {
  it('builds local, URL, and SSH card metadata from desktop snapshot entries', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: false,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            source: 'saved',
            last_used_at_ms: 20,
          },
        ],
        saved_ssh_environments: [
          {
            id: 'ssh_saved',
            label: 'Prod SSH',
            ssh_destination: 'ops@example.internal',
            ssh_port: 2222,
            remote_install_dir: '/opt/redeven-desktop/runtime',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: '',
            source: 'saved',
            last_used_at_ms: 30,
          },
        ],
        recent_external_local_ui_urls: ['http://192.168.1.12:24000/'],
        control_plane_refresh_tokens: {},
        control_planes: [],
      },
      openSessions: [
        {
          session_key: 'managed_local',
          target: buildManagedLocalDesktopTarget(),
          startup: {
            local_ui_url: 'http://localhost:23998/',
            local_ui_urls: ['http://localhost:23998/'],
          },
        },
        {
          session_key: 'url:http://192.168.1.12:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/', { label: 'Staging' }),
          startup: {
            local_ui_url: 'http://192.168.1.12:24000/',
            local_ui_urls: ['http://192.168.1.12:24000/'],
          },
        },
        {
          session_key: 'ssh:ops@example.internal:2222:/opt/redeven-desktop/runtime',
          target: buildSSHDesktopTarget(
            {
              ssh_destination: 'ops@example.internal',
              ssh_port: 2222,
              remote_install_dir: '/opt/redeven-desktop/runtime',
              bootstrap_strategy: 'desktop_upload',
              release_base_url: '',
            },
            {
              environmentID: 'ssh_saved',
              label: 'Prod SSH',
              forwardedLocalUIURL: 'http://127.0.0.1:24111/',
            },
          ),
          startup: {
            local_ui_url: 'http://127.0.0.1:24111/',
            local_ui_urls: ['http://127.0.0.1:24111/'],
          },
        },
      ],
    });

    const localEntry = snapshot.environments.find((environment) => environment.kind === 'local_environment');
    const urlEntry = snapshot.environments.find((environment) => environment.kind === 'external_local_ui');
    const sshEntry = snapshot.environments.find((environment) => environment.kind === 'ssh_environment');

    expect(localEntry).toBeTruthy();
    expect(urlEntry).toBeTruthy();
    expect(sshEntry).toBeTruthy();

    const localCard = buildEnvironmentCardModel(localEntry!);
    expect(localCard.kind_label).toBe('Local');
    expect(localCard.status_label).toBe('Open');
    expect(localCard.target_primary).toBe('http://localhost:23998/');

    const urlCard = buildEnvironmentCardModel(urlEntry!);
    expect(urlCard.kind_label).toBe('Redeven URL');
    expect(urlCard.status_label).toBe('Open');
    expect(urlCard.source_label).toBe('Saved');
    expect(urlCard.target_primary).toBe('http://192.168.1.12:24000/');

    const sshCard = buildEnvironmentCardModel(sshEntry!);
    expect(sshCard.kind_label).toBe('SSH');
    expect(sshCard.status_label).toBe('Open');
    expect(sshCard.target_primary).toBe('ops@example.internal:2222');
    expect(sshCard.target_secondary).toContain('Forwarded UI http://127.0.0.1:24111/');
    expect(sshCard.meta).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Bootstrap',
        value: 'Desktop upload',
      }),
      expect.objectContaining({
        label: 'Install root',
        value: '/opt/redeven-desktop/runtime',
      }),
    ]));
  });
});
