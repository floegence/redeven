import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { DesktopFlowerHostSettingsDraft } from '../shared/flowerHostSettingsIPC';
import {
  createDesktopFlowerHostPlaintextSecretCodec,
  createDesktopFlowerHostSafeStorageSecretCodec,
  defaultDesktopFlowerHostPaths,
  loadDesktopFlowerHostSettings,
  loadDesktopFlowerHostTargetCache,
  redactDesktopFlowerHostSettingsDraft,
  saveDesktopFlowerHostSettings,
  saveDesktopFlowerHostTargetCache,
  validateDesktopFlowerHostConfig,
} from './desktopFlowerHostState';

async function withTempFlowerRoot(testFn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-host-state-test-'));
  try {
    await testFn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function validDraft(overrides: Partial<DesktopFlowerHostSettingsDraft['config']> = {}): DesktopFlowerHostSettingsDraft {
  return {
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
          name: 'OpenAI',
          type: 'openai',
          models: [
            {
              model_name: 'gpt-5-mini',
              context_window: 400_000,
              input_modalities: ['text', 'image'],
            },
          ],
          provider_api_key: 'sk-demo-secret',
          provider_api_key_mode: 'replace',
        },
      ],
      ...overrides,
    },
  };
}

describe('desktopFlowerHostState', () => {
  it('loads default config from an empty Flower Host state directory', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');

      await expect(loadDesktopFlowerHostSettings(paths)).resolves.toEqual({
        config: {
          schema_version: 1,
          enabled: false,
          current_model_id: '',
          execution_policy: {
            require_user_approval: true,
            block_dangerous_commands: true,
          },
          terminal_exec_policy: {
            default_timeout_ms: 120_000,
            max_timeout_ms: 600_000,
          },
          providers: [],
        },
        provider_secrets: [],
        target_cache: {
          version: 1,
          entries: [],
        },
      });
    });
  });

  it('surfaces malformed Flower Host state instead of replacing it with defaults', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      await fs.mkdir(path.dirname(paths.configPath), { recursive: true });
      await fs.writeFile(paths.configPath, '{not-json', 'utf8');

      await expect(loadDesktopFlowerHostSettings(paths)).rejects.toThrow(`Invalid Flower Host state file: ${paths.configPath}`);
    });
  });

  it('validates Flower Host config shape and rejects stale current model ids', () => {
    expect(validateDesktopFlowerHostConfig(validDraft().config)).toEqual(expect.objectContaining({
      enabled: true,
      current_model_id: 'openai/gpt-5-mini',
    }));

    expect(() => validateDesktopFlowerHostConfig({
      ...validDraft().config,
      current_model_id: 'openai/missing',
    })).toThrow('Flower current_model_id is not in providers[].models[]: openai/missing.');

    expect(() => validateDesktopFlowerHostConfig({
      ...validDraft().config,
      providers: [
        {
          id: 'custom',
          type: 'openai_compatible',
          base_url: 'https://llm.example.invalid/v1',
          models: [{ model_name: 'custom-model' }],
        },
      ],
    })).toThrow('Flower provider "custom" model "custom-model" requires context_window.');
  });

  it('saves without a Local Runtime state directory and keeps secrets out of config snapshots', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();

      const saved = await saveDesktopFlowerHostSettings(paths, validDraft(), codec);

      expect(saved.provider_secrets).toEqual([
        {
          provider_id: 'openai',
          provider_api_key_configured: true,
          web_search_api_key_configured: false,
        },
      ]);
      expect(JSON.stringify(saved)).not.toContain('sk-demo-secret');
      expect(await fs.stat(paths.configPath)).toBeTruthy();
      await expect(fs.stat(path.join(paths.stateRoot, 'local-environment', 'config.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const configJSON = await fs.readFile(paths.configPath, 'utf8');
      const secretsJSON = await fs.readFile(paths.secretsFile, 'utf8');
      expect(configJSON).not.toContain('sk-demo-secret');
      expect(configJSON).not.toContain('provider_api_key');
      expect(secretsJSON).toContain('sk-demo-secret');

      const loaded = await loadDesktopFlowerHostSettings(paths);
      expect(loaded.config.providers[0]).toEqual({
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        models: [
          {
            model_name: 'gpt-5-mini',
            context_window: 400_000,
            input_modalities: ['text', 'image'],
          },
        ],
      });
      expect(JSON.stringify(loaded)).not.toContain('sk-demo-secret');
    });
  });

  it('redacts write-only provider secrets from drafts', () => {
    const redacted = redactDesktopFlowerHostSettingsDraft(validDraft());

    expect(JSON.stringify(redacted)).not.toContain('sk-demo-secret');
    expect(redacted.config.providers[0]).toEqual(expect.objectContaining({
      id: 'openai',
      provider_api_key: '',
      provider_api_key_mode: 'replace',
      web_search_api_key: '',
    }));
  });

  it('stores and redacts web search provider secrets independently from model provider keys', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      const draft = validDraft({
        current_model_id: 'custom/gpt-5-mini',
        providers: [
          {
            id: 'custom',
            name: 'Custom',
            type: 'openai_compatible',
            base_url: 'https://flower.example.invalid/v1',
            web_search: { mode: 'brave' },
            models: [{ model_name: 'gpt-5-mini', context_window: 400_000 }],
            provider_api_key: 'sk-demo-secret',
            provider_api_key_mode: 'replace',
            web_search_api_key: 'brave-demo-secret',
            web_search_api_key_mode: 'replace',
          },
        ],
      });

      const saved = await saveDesktopFlowerHostSettings(paths, draft, codec);

      expect(saved.provider_secrets).toEqual([
        {
          provider_id: 'custom',
          provider_api_key_configured: true,
          web_search_api_key_configured: true,
        },
      ]);
      expect(JSON.stringify(saved)).not.toContain('brave-demo-secret');
      expect(await fs.readFile(paths.configPath, 'utf8')).not.toContain('brave-demo-secret');
      expect(await fs.readFile(paths.secretsFile, 'utf8')).toContain('brave-demo-secret');
      expect(JSON.stringify(redactDesktopFlowerHostSettingsDraft(draft))).not.toContain('brave-demo-secret');
    });
  });

  it('clears web search secrets without removing the model provider key', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      const draft = validDraft({
        current_model_id: 'custom/gpt-5-mini',
        providers: [
          {
            id: 'custom',
            name: 'Custom',
            type: 'openai_compatible',
            base_url: 'https://flower.example.invalid/v1',
            web_search: { mode: 'brave' },
            models: [{ model_name: 'gpt-5-mini', context_window: 400_000 }],
            provider_api_key: 'sk-demo-secret',
            provider_api_key_mode: 'replace',
            web_search_api_key: 'brave-demo-secret',
            web_search_api_key_mode: 'replace',
          },
        ],
      });
      await saveDesktopFlowerHostSettings(paths, draft, codec);

      const saved = await saveDesktopFlowerHostSettings(paths, {
        config: {
          ...draft.config,
          providers: [
            {
              ...draft.config.providers[0],
              web_search: { mode: 'disabled' },
              provider_api_key: '',
              provider_api_key_mode: 'keep',
              web_search_api_key: '',
              web_search_api_key_mode: 'clear',
            },
          ],
        },
      }, codec);

      expect(saved.provider_secrets).toEqual([
        {
          provider_id: 'custom',
          provider_api_key_configured: true,
          web_search_api_key_configured: false,
        },
      ]);
      expect(await fs.readFile(paths.secretsFile, 'utf8')).not.toContain('brave-demo-secret');
    });
  });

  it('refuses to encode provider secrets when secure storage is unavailable', () => {
    const codec = createDesktopFlowerHostSafeStorageSecretCodec({
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    });

    expect(() => codec.encodeSecret('sk-demo-secret')).toThrow('Secure storage is unavailable');
  });

  it('persists the Flower Host target cache under the independent state path', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');

      await saveDesktopFlowerHostTargetCache(paths, {
        version: 1,
        entries: [
          {
            target_id: 'local',
            label: 'Local Environment',
            target_url: 'http://127.0.0.1:24000/',
            last_seen_at_unix_ms: 123,
            metadata: {
              route: 'local_host',
            },
          },
        ],
      });

      await expect(loadDesktopFlowerHostTargetCache(paths)).resolves.toEqual({
        version: 1,
        entries: [
          {
            target_id: 'local',
            label: 'Local Environment',
            target_url: 'http://127.0.0.1:24000/',
            last_seen_at_unix_ms: 123,
            metadata: {
              route: 'local_host',
            },
          },
        ],
      });
      expect(paths.targetCacheFile).toBe(path.join(root, '.redeven', 'flower', 'target-cache.json'));
    });
  });

  it('keeps Desktop state limited to config, secrets, and target cache files', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();

      await saveDesktopFlowerHostSettings(paths, validDraft(), codec);

      await expect(fs.stat(paths.configPath)).resolves.toBeTruthy();
      await expect(fs.stat(paths.secretsFile)).resolves.toBeTruthy();
      await expect(fs.stat(paths.targetCacheFile)).resolves.toBeTruthy();
      await expect(fs.stat(path.join(paths.stateDir, 'threads.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
    });
  });
});
