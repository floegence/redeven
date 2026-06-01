import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDesktopFlowerHostPlaintextSecretCodec,
  defaultDesktopFlowerHostPaths,
  saveDesktopFlowerHostSettings,
} from './desktopFlowerHostState';
import { startFlowerHostSecretResolver } from './flowerHostSecretResolver';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

async function postJSON(baseURL: string, token: string, body: unknown): Promise<{
  status: number;
  payload: unknown;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseURL}/v1/secrets/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
      });
    });
    request.once('error', reject);
    request.end(JSON.stringify(body));
  });
}

describe('Flower Host secret resolver', () => {
  it('rejects unsupported secret kinds instead of defaulting to provider keys', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-secret-resolver-test-'));
    closers.push(() => fs.rm(root, { recursive: true, force: true }));
    const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
    const codec = createDesktopFlowerHostPlaintextSecretCodec();
    await saveDesktopFlowerHostSettings(paths, {
      config: {
        schema_version: 1,
        enabled: true,
        current_model_id: 'openai/gpt-5-mini',
        execution_policy: {
          require_user_approval: true,
          block_dangerous_commands: true,
        },
        terminal_exec_policy: {
          default_timeout_ms: 120_000,
          max_timeout_ms: 600_000,
        },
        providers: [
          {
            id: 'openai',
            type: 'openai',
            models: [{ model_name: 'gpt-5-mini', context_window: 400_000 }],
            provider_api_key: 'sk-demo-secret',
            provider_api_key_mode: 'replace',
          },
        ],
      },
    }, codec);
    const resolver = await startFlowerHostSecretResolver(paths, codec);
    closers.push(resolver.close);

    const unsupported = await postJSON(resolver.baseURL, resolver.token, {
      provider_id: 'openai',
      kind: 'unexpected_secret',
    });
    expect(unsupported).toEqual({
      status: 400,
      payload: { ok: false, error: 'unsupported secret kind' },
    });

    const supported = await postJSON(resolver.baseURL, resolver.token, {
      provider_id: 'openai',
      kind: 'provider_api_key',
    });
    expect(supported).toEqual({
      status: 200,
      payload: { ok: true, configured: true, value: 'sk-demo-secret' },
    });

    const unauthorized = await postJSON(resolver.baseURL, 'wrong-token', {
      provider_id: 'openai',
      kind: 'provider_api_key',
    });
    expect(unauthorized).toEqual({
      status: 401,
      payload: { ok: false, error: 'unauthorized' },
    });
  });

  it('resolves provider-origin control plane tokens from the target cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-secret-resolver-test-'));
    closers.push(() => fs.rm(root, { recursive: true, force: true }));
    const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
    const codec = createDesktopFlowerHostPlaintextSecretCodec();
    await fs.mkdir(paths.stateDir, { recursive: true });
    await fs.writeFile(paths.targetCacheFile, `${JSON.stringify({
      version: 1,
      entries: [{
        target_id: 'cp:test:env:env_a',
        label: 'Env A',
        target_url: 'https://region.example.test/app/env_a',
        last_seen_at_unix_ms: Date.now(),
        metadata: {
          provider_origin: 'https://region.example.test',
          control_plane_access_token: 'region-token',
        },
      }],
    })}\n`);
    const resolver = await startFlowerHostSecretResolver(
      paths,
      codec,
      async (providerOrigin) => (providerOrigin === 'https://region.example.test' ? 'region-token' : ''),
    );
    closers.push(resolver.close);

    const response = await postJSON(resolver.baseURL, resolver.token, {
      provider_origin: 'https://region.example.test',
      kind: 'control_plane_access_token',
    });
    expect(response).toEqual({
      status: 200,
      payload: { ok: true, configured: true, value: 'region-token' },
    });
  });
});
