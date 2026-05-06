import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  testDesktopPreferences,
  testLocalEnvironment,
  testLocalEnvironmentSession,
} from '../testSupport/desktopTestHelpers';
import { hydrateWelcomeLocalEnvironmentRuntimeState } from './desktopWelcomeRuntimeState';

const validEnvAppShellHTML = '<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>';

describe('desktopWelcomeRuntimeState', () => {
  it('hydrates local runtime ownership from an open external Local Environment session', async () => {
    const environment = testLocalEnvironment();
    const preferences = testDesktopPreferences({
      local_environment: environment,
    });

    const hydrated = await hydrateWelcomeLocalEnvironmentRuntimeState(
      preferences,
      [
        testLocalEnvironmentSession(
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

    expect(hydrated.local_environment.local_hosting.current_runtime).toEqual({
      local_ui_url: 'http://127.0.0.1:23998/',
      effective_run_mode: 'local',
      remote_enabled: false,
      desktop_managed: false,
      password_required: true,
      diagnostics_enabled: false,
      pid: 4242,
      runtime_service: expect.objectContaining({
        open_readiness: { state: 'openable' },
      }),
    });
    expect(hydrated.local_environment.local_hosting.current_runtime?.runtime_service).toMatchObject({
      service_owner: 'external',
      desktop_managed: false,
      effective_run_mode: 'local',
      remote_enabled: false,
      open_readiness: { state: 'openable' },
    });
  });

  it('probes a managed runtime from the Local Environment state file', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            status: 'online',
            password_required: false,
            runtime_service: {
              runtime_version: 'v1.4.0',
              service_owner: 'desktop',
              desktop_managed: true,
              effective_run_mode: 'desktop',
              remote_enabled: true,
              compatibility: 'compatible',
              open_readiness: { state: 'openable' },
              active_workload: {
                terminal_count: 3,
                session_count: 1,
                task_count: 0,
                port_forward_count: 0,
              },
            },
          },
        }));
        return;
      }
      if (request.url === '/_redeven_proxy/env/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(validEnvAppShellHTML);
        return;
      }
      if (request.url === '/_redeven_proxy/env/assets/index.js') {
        response.writeHead(200, { 'Content-Type': 'application/javascript' });
        response.end(request.method === 'HEAD' ? undefined : 'console.log("env");');
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

      const environment = testLocalEnvironment({
        stateDir,
      });
      const preferences = testDesktopPreferences({
        local_environment: environment,
      });

      const hydrated = await hydrateWelcomeLocalEnvironmentRuntimeState(preferences, [], {
        probeTimeoutMs: 200,
      });

      expect(hydrated.local_environment.local_hosting.current_runtime).toEqual({
        local_ui_url: `http://127.0.0.1:${address.port}/`,
        effective_run_mode: 'desktop',
        remote_enabled: true,
        desktop_managed: true,
        password_required: false,
        diagnostics_enabled: false,
        pid: 5252,
        runtime_service: {
          runtime_version: 'v1.4.0',
          runtime_commit: undefined,
          runtime_build_time: undefined,
          protocol_version: 'redeven-runtime-v1',
          compatibility_epoch: undefined,
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          compatibility: 'compatible',
          compatibility_message: undefined,
          minimum_desktop_version: undefined,
          minimum_runtime_version: undefined,
          compatibility_review_id: undefined,
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 3,
            session_count: 1,
            task_count: 0,
            port_forward_count: 0,
          },
        },
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
