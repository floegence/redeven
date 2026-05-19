import http from 'node:http';

import { describe, expect, it } from 'vitest';

import { loadExternalLocalUIStartup } from './runtimeState';

const validEnvAppShellHTML = '<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>';

describe('runtimeState', () => {
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

      await expect(loadExternalLocalUIStartup(`http://127.0.0.1:${address.port}/_redeven_proxy/env/`)).resolves.toMatchObject({
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
          open_readiness: {
            state: 'blocked',
            reason_code: 'runtime_managed_elsewhere',
            message: 'This runtime is managed by another Desktop instance.',
          },
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

  it('blocks open-readiness when an openable runtime serves an invalid Env App shell', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            status: 'online',
            password_required: false,
            runtime_service: {
              runtime_version: 'v0.0.0-dev',
              service_owner: 'desktop',
              desktop_managed: true,
              remote_enabled: false,
              compatibility: 'compatible',
              open_readiness: { state: 'openable' },
              active_workload: {
                terminal_count: 0,
                session_count: 0,
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
        response.end('<pre><a href="favicon.svg">favicon.svg</a><a href="logo.png">logo.png</a></pre>');
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

      await expect(loadExternalLocalUIStartup(`http://127.0.0.1:${address.port}/`)).resolves.toMatchObject({
        local_ui_url: `http://127.0.0.1:${address.port}/`,
        password_required: false,
        runtime_service: {
          runtime_version: 'v0.0.0-dev',
          open_readiness: {
            state: 'blocked',
            reason_code: 'env_app_shell_unavailable',
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

  it('blocks open-readiness when an Env App shell references missing assets', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            status: 'online',
            password_required: false,
            runtime_service: {
              runtime_version: 'v0.0.0-dev',
              service_owner: 'desktop',
              desktop_managed: true,
              remote_enabled: false,
              compatibility: 'compatible',
              open_readiness: { state: 'openable' },
              active_workload: {
                terminal_count: 0,
                session_count: 0,
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

      await expect(loadExternalLocalUIStartup(`http://127.0.0.1:${address.port}/`)).resolves.toMatchObject({
        runtime_service: {
          open_readiness: {
            state: 'blocked',
            reason_code: 'env_app_shell_unavailable',
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
