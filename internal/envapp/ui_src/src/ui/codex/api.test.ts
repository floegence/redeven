import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAPIError, startCodexTurn } from './api';

vi.mock('../services/localApi', () => ({
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

describe('codex api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves structured local API details for turn start failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'provider rejected request',
      error_code: 'rateLimitExceeded',
      error_details: 'HTTP 429 rate limit exceeded',
    }), { status: 400 }));

    await expect(startCodexTurn({ threadID: 'thread_1', inputText: 'hi' })).rejects.toMatchObject({
      name: 'CodexAPIError',
      message: 'provider rejected request',
      errorCode: 'rateLimitExceeded',
      details: 'HTTP 429 rate limit exceeded',
      status: 400,
    });
  });

  it('uses the Codex-specific error class for turn start HTTP errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    await expect(startCodexTurn({ threadID: 'missing', inputText: 'hi' })).rejects.toBeInstanceOf(CodexAPIError);
  });
});
