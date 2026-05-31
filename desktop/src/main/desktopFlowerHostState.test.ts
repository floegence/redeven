import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { DesktopFlowerHostSettingsDraft } from '../shared/flowerHostSettingsIPC';
import {
  createDesktopFlowerHostPlaintextSecretCodec,
  createDesktopFlowerHostSafeStorageSecretCodec,
  defaultDesktopFlowerHostPaths,
  listDesktopFlowerHostThreads,
  loadDesktopFlowerHostSettings,
  loadDesktopFlowerHostTargetCache,
  redactDesktopFlowerHostSettingsDraft,
  saveDesktopFlowerHostSettings,
  saveDesktopFlowerHostTargetCache,
  sendDesktopFlowerHostChat,
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

  it('sends and persists Flower Host chats without using Local Runtime state', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      await saveDesktopFlowerHostSettings(paths, validDraft({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            base_url: 'https://flower.example.invalid/v1',
            models: [{ model_name: 'gpt-5-mini', context_window: 400_000 }],
            provider_api_key: 'sk-demo-secret',
            provider_api_key_mode: 'replace',
          },
        ],
      }), codec);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://flower.example.invalid/v1/chat/completions');
        expect(init?.headers).toEqual(expect.objectContaining({
          authorization: 'Bearer sk-demo-secret',
          'content-type': 'application/json',
        }));
        expect(String(init?.body)).toContain('hello flower');
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: 'hello from Flower',
              },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
      try {
        const thread = await sendDesktopFlowerHostChat(
          paths,
          { prompt: 'hello flower' },
          codec,
          (() => {
            let now = 1000;
            return () => {
              now += 1;
              return now;
            };
          })(),
          (() => {
            let i = 0;
            return () => {
              i += 1;
              return `id_${i}`;
            };
          })(),
        );

        expect(thread.thread_id).toBe('flower_thread_id_1');
        expect(thread.messages.map((message) => message.content)).toEqual(['hello flower', 'hello from Flower']);
        await expect(listDesktopFlowerHostThreads(paths)).resolves.toEqual([thread]);
        expect(await fs.stat(paths.threadsFile)).toBeTruthy();
        await expect(fs.stat(path.join(paths.stateRoot, 'local-environment', 'threads.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('adds Brave Search context when a provider enables Brave web search', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      await saveDesktopFlowerHostSettings(paths, validDraft({
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
      }), codec);

      const originalFetch = globalThis.fetch;
      const calls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(input));
        if (String(input).startsWith('https://api.search.brave.com/res/v1/web/search?')) {
          expect(init?.headers).toEqual(expect.objectContaining({
            'x-subscription-token': 'brave-demo-secret',
          }));
          return new Response(JSON.stringify({
            web: {
              results: [
                {
                  title: 'Redeven release notes',
                  url: 'https://example.test/redeven',
                  description: 'Latest Redeven details.',
                },
              ],
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        expect(String(input)).toBe('https://flower.example.invalid/v1/chat/completions');
        expect(String(init?.body)).toContain('Redeven release notes');
        expect(String(init?.body)).toContain('hello flower');
        return new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: 'search-aware response',
              },
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      try {
        const thread = await sendDesktopFlowerHostChat(
          paths,
          { prompt: 'hello flower' },
          codec,
          (() => {
            let now = 2000;
            return () => {
              now += 1;
              return now;
            };
          })(),
          (() => {
            let i = 20;
            return () => {
              i += 1;
              return `id_${i}`;
            };
          })(),
        );

        expect(calls).toHaveLength(2);
        expect(thread.messages.map((message) => message.content)).toEqual(['hello flower', 'search-aware response']);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('fails before network calls when required Flower provider secrets are missing', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      await saveDesktopFlowerHostSettings(paths, validDraft({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            models: [{ model_name: 'gpt-5-mini', context_window: 400_000 }],
            provider_api_key: '',
            provider_api_key_mode: 'clear',
          },
        ],
      }), codec);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn() as unknown as typeof fetch;
      try {
        await expect(sendDesktopFlowerHostChat(paths, { prompt: 'hello flower' }, codec))
          .rejects
          .toThrow('Flower provider "openai" is missing an API key.');
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('fails before provider calls when Brave Search is enabled without a Brave key', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      await saveDesktopFlowerHostSettings(paths, validDraft({
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
            web_search_api_key: '',
            web_search_api_key_mode: 'clear',
          },
        ],
      }), codec);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn() as unknown as typeof fetch;
      try {
        await expect(sendDesktopFlowerHostChat(paths, { prompt: 'hello web' }, codec))
          .rejects
          .toThrow('Flower provider "custom" is missing a Brave Search API key.');
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('uses OpenAI Responses when a compatible provider enables built-in web search', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      await saveDesktopFlowerHostSettings(paths, validDraft({
        current_model_id: 'custom/gpt-5-mini',
        providers: [
          {
            id: 'custom',
            name: 'Custom',
            type: 'openai_compatible',
            base_url: 'https://flower.example.invalid/v1',
            web_search: { mode: 'openai_builtin' },
            models: [{ model_name: 'gpt-5-mini', context_window: 400_000 }],
            provider_api_key: 'sk-demo-secret',
            provider_api_key_mode: 'replace',
          },
        ],
      }), codec);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://flower.example.invalid/v1/responses');
        const body = JSON.parse(String(init?.body ?? '{}')) as { tools?: readonly { type?: string }[] };
        expect(body.tools).toEqual([{ type: 'web_search_preview' }]);
        return new Response(JSON.stringify({ output_text: 'responses web result' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      try {
        const thread = await sendDesktopFlowerHostChat(paths, { prompt: 'hello web' }, codec);

        expect(thread.messages.map((message) => message.content)).toEqual(['hello web', 'responses web result']);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('uses native provider built-in web search request payloads', async () => {
    const cases = [
      {
        providerID: 'openai',
        providerName: 'OpenAI',
        type: 'openai' as const,
        modelName: 'gpt-5-mini',
        url: 'https://api.openai.com/v1/responses',
        response: { output_text: 'openai web result' },
        expectBody: (body: Record<string, unknown>) => {
          expect(body.tools).toEqual([{ type: 'web_search_preview' }]);
        },
      },
      {
        providerID: 'moonshot',
        providerName: 'Moonshot',
        type: 'moonshot' as const,
        modelName: 'kimi-k2.6',
        baseURL: 'https://api.moonshot.cn/v1',
        url: 'https://api.moonshot.cn/v1/chat/completions',
        response: { choices: [{ message: { content: 'kimi web result' } }] },
        expectBody: (body: Record<string, unknown>) => {
          expect(body.tools).toEqual([
            {
              type: 'builtin_function',
              function: { name: '$web_search' },
            },
          ]);
          expect(body.thinking).toEqual({ type: 'disabled' });
        },
      },
      {
        providerID: 'chatglm',
        providerName: 'ChatGLM',
        type: 'chatglm' as const,
        modelName: 'glm-5.1',
        baseURL: 'https://api.z.ai/api/paas/v4/',
        url: 'https://api.z.ai/api/paas/v4/chat/completions',
        response: { choices: [{ message: { content: 'glm web result' } }] },
        expectBody: (body: Record<string, unknown>) => {
          expect(body.tools).toEqual([
            {
              type: 'web_search',
              web_search: { search_result: true },
            },
          ]);
        },
      },
      {
        providerID: 'deepseek',
        providerName: 'DeepSeek',
        type: 'deepseek' as const,
        modelName: 'deepseek-v4-pro',
        baseURL: 'https://api.deepseek.com',
        url: 'https://api.deepseek.com/chat/completions',
        response: { choices: [{ message: { content: 'deepseek web result' } }] },
        expectBody: (body: Record<string, unknown>) => {
          expect(body.enable_search).toBe(true);
        },
      },
      {
        providerID: 'qwen',
        providerName: 'Qwen',
        type: 'qwen' as const,
        modelName: 'qwen3.6-plus',
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/responses',
        response: { output_text: 'qwen web result' },
        expectBody: (body: Record<string, unknown>) => {
          expect(body.tools).toEqual([{ type: 'web_search' }]);
        },
      },
    ];

    for (const item of cases) {
      await withTempFlowerRoot(async (root) => {
        const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
        const codec = createDesktopFlowerHostPlaintextSecretCodec();
        await saveDesktopFlowerHostSettings(paths, validDraft({
          current_model_id: `${item.providerID}/${item.modelName}`,
          providers: [
            {
              id: item.providerID,
              name: item.providerName,
              type: item.type,
              ...(item.baseURL ? { base_url: item.baseURL } : {}),
              models: [{ model_name: item.modelName, context_window: 400_000 }],
              provider_api_key: `${item.providerID}-secret`,
              provider_api_key_mode: 'replace',
            },
          ],
        }), codec);

        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(String(input)).toBe(item.url);
          expect(init?.headers).toEqual(expect.objectContaining({
            authorization: `Bearer ${item.providerID}-secret`,
            'content-type': 'application/json',
          }));
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          expect(body.model).toBe(item.modelName);
          item.expectBody(body);
          return new Response(JSON.stringify(item.response), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;

        try {
          const thread = await sendDesktopFlowerHostChat(paths, { prompt: `hello ${item.providerID}` }, codec);

          expect(thread.messages[1]?.content).toContain('web result');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    }
  });

  it('does not duplicate the Anthropic v1 path when a saved base URL already includes it', async () => {
    await withTempFlowerRoot(async (root) => {
      const paths = defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored');
      const codec = createDesktopFlowerHostPlaintextSecretCodec();
      await saveDesktopFlowerHostSettings(paths, validDraft({
        current_model_id: 'anthropic/claude-sonnet',
        providers: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            type: 'anthropic',
            base_url: 'https://api.anthropic.com/v1',
            models: [{ model_name: 'claude-sonnet', context_window: 200_000 }],
            provider_api_key: 'anthropic-demo-secret',
            provider_api_key_mode: 'replace',
          },
        ],
      }), codec);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
        expect(init?.headers).toEqual(expect.objectContaining({
          'x-api-key': 'anthropic-demo-secret',
        }));
        return new Response(JSON.stringify({ content: [{ text: 'anthropic response' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      try {
        const thread = await sendDesktopFlowerHostChat(paths, { prompt: 'hello claude' }, codec);

        expect(thread.messages.map((message) => message.content)).toEqual(['hello claude', 'anthropic response']);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
