import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultRuntimeStatePath, loadAttachableRuntimeState, loadExternalLocalUIStartup } from './runtimeState';

describe('runtimeState', () => {
  it('uses the standard runtime state path under the redeven home directory', () => {
    expect(defaultRuntimeStatePath({ HOME: '/Users/tester' }, () => '/ignored')).toBe(
      '/Users/tester/.redeven/scopes/local/default/runtime/local-ui.json',
    );
  });

  it('fails clearly when no home directory is available', () => {
    expect(() => defaultRuntimeStatePath({}, () => '')).toThrow('user home directory is unavailable');
  });

  it('loads an attachable loopback runtime from disk', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            status: 'online',
            password_required: true,
            runtime_service: {
              runtime_version: 'v1.2.3',
              service_owner: 'desktop',
              desktop_managed: true,
              effective_run_mode: 'hybrid',
              remote_enabled: true,
              compatibility: 'compatible',
              active_workload: {
                terminal_count: 4,
                session_count: 2,
                task_count: 0,
                port_forward_count: 1,
              },
            },
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

      const runtimeStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-state-'));
      const runtimeStateFile = path.join(runtimeStateDir, 'local-ui.json');
      await fs.writeFile(runtimeStateFile, JSON.stringify({
        local_ui_url: `http://127.0.0.1:${address.port}/`,
        local_ui_urls: [`http://127.0.0.1:${address.port}/`],
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        desktop_managed: true,
        pid: 4242,
        runtime_service: {
          runtime_version: 'v1.2.0',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'hybrid',
          remote_enabled: true,
          compatibility: 'unknown',
          active_workload: {
            terminal_count: 1,
            session_count: 1,
            task_count: 0,
            port_forward_count: 0,
          },
        },
      }), 'utf8');

      const startup = await loadAttachableRuntimeState(runtimeStateFile);
      expect(startup).toEqual({
        local_ui_url: `http://127.0.0.1:${address.port}/`,
        local_ui_urls: [`http://127.0.0.1:${address.port}/`],
        password_required: true,
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        desktop_managed: true,
        pid: 4242,
        runtime_service: {
          runtime_version: 'v1.2.3',
          runtime_commit: undefined,
          runtime_build_time: undefined,
          protocol_version: 'redeven-runtime-v1',
          compatibility_epoch: undefined,
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'hybrid',
          remote_enabled: true,
          compatibility: 'compatible',
          compatibility_message: undefined,
          minimum_desktop_version: undefined,
          minimum_runtime_version: undefined,
          compatibility_review_id: undefined,
          active_workload: {
            terminal_count: 4,
            session_count: 2,
            task_count: 0,
            port_forward_count: 1,
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

  it('rejects runtime state entries that point to non-loopback hosts', async () => {
    const runtimeStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-state-'));
    const runtimeStateFile = path.join(runtimeStateDir, 'local-ui.json');
    await fs.writeFile(runtimeStateFile, JSON.stringify({
      local_ui_url: 'https://example.com/',
      local_ui_urls: ['https://example.com/'],
    }), 'utf8');

    await expect(loadAttachableRuntimeState(runtimeStateFile)).resolves.toBeNull();
  });

  it('loads an external Local UI startup payload from an explicit local IP url', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            status: 'online',
            password_required: false,
            runtime_service: {
              runtime_version: 'v2.0.0',
              service_owner: 'external',
              desktop_managed: false,
              remote_enabled: false,
              compatibility: 'managed_elsewhere',
              active_workload: {
                terminal_count: 1,
                session_count: 0,
                task_count: 0,
                port_forward_count: 0,
              },
            },
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

      await expect(loadExternalLocalUIStartup(`http://127.0.0.1:${address.port}/_redeven_proxy/env/`)).resolves.toEqual({
        local_ui_url: `http://127.0.0.1:${address.port}/`,
        local_ui_urls: [`http://127.0.0.1:${address.port}/`],
        password_required: false,
        runtime_service: {
          runtime_version: 'v2.0.0',
          runtime_commit: undefined,
          runtime_build_time: undefined,
          protocol_version: 'redeven-runtime-v1',
          compatibility_epoch: undefined,
          service_owner: 'external',
          desktop_managed: false,
          effective_run_mode: undefined,
          remote_enabled: false,
          compatibility: 'managed_elsewhere',
          compatibility_message: undefined,
          minimum_desktop_version: undefined,
          minimum_runtime_version: undefined,
          compatibility_review_id: undefined,
          active_workload: {
            terminal_count: 1,
            session_count: 0,
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

  it('rejects external Local UI startup for unsupported hosts', async () => {
    await expect(loadExternalLocalUIStartup('https://example.com/')).rejects.toThrow('Redeven URL must use localhost or an IP literal.');
  });

  it('rejects a local target that responds with non-Redeven access status payloads', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<html>not redeven</html>');
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

      await expect(loadExternalLocalUIStartup(`http://127.0.0.1:${address.port}/`)).resolves.toBeNull();
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
