import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  testDesktopPreferences,
  testManagedLocalEnvironment,
  testManagedSession,
} from '../testSupport/desktopTestHelpers';
import { hydrateWelcomeManagedEnvironmentRuntimeState } from './desktopWelcomeRuntimeState';

describe('desktopWelcomeRuntimeState', () => {
  it('hydrates local runtime ownership from an open external managed session', async () => {
    const environment = testManagedLocalEnvironment('default');
    const preferences = testDesktopPreferences({
      managed_environments: [environment],
    });

    const hydrated = await hydrateWelcomeManagedEnvironmentRuntimeState(
      preferences,
      [
        testManagedSession(
          environment,
          'http://127.0.0.1:23998/',
          'open',
          {
            desktop_managed: false,
            password_required: true,
            effective_run_mode: 'local',
            pid: 4242,
          },
          {
            runtimeLifecycleOwner: 'external',
            runtimeLaunchMode: 'attached',
          },
        ),
      ],
    );

    expect(hydrated.managed_environments[0]?.local_hosting?.current_runtime).toEqual({
      local_ui_url: 'http://127.0.0.1:23998/',
      effective_run_mode: 'local',
      remote_enabled: false,
      desktop_managed: false,
      password_required: true,
      diagnostics_enabled: false,
      pid: 4242,
    });
  });

  it('probes a detached managed runtime from the local scope state file', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            status: 'online',
            password_required: false,
          },
        }));
        return;
      }
      response.writeHead(404);
      response.end('not found');
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('expected a TCP server address');
      }

      const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-welcome-runtime-'));
      await fs.mkdir(path.join(stateDir, 'runtime'), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, 'runtime', 'local-ui.json'),
        JSON.stringify({
          local_ui_url: `http://127.0.0.1:${address.port}/`,
          local_ui_urls: [`http://127.0.0.1:${address.port}/`],
          desktop_managed: true,
          remote_enabled: true,
          effective_run_mode: 'desktop',
          pid: 5252,
        }),
        'utf8',
      );

      const environment = testManagedLocalEnvironment('lab', {
        stateDir,
      });
      const preferences = testDesktopPreferences({
        managed_environments: [environment],
      });

      const hydrated = await hydrateWelcomeManagedEnvironmentRuntimeState(preferences, [], {
        probeTimeoutMs: 200,
      });

      expect(hydrated.managed_environments[0]?.local_hosting?.current_runtime).toEqual({
        local_ui_url: `http://127.0.0.1:${address.port}/`,
        effective_run_mode: 'desktop',
        remote_enabled: true,
        desktop_managed: true,
        password_required: false,
        diagnostics_enabled: false,
        pid: 5252,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
