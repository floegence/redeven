// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createEnvAppAssetRecovery } from './createEnvAppAssetRecovery';

const state = vi.hoisted(() => ({ check: vi.fn(async () => 'current'), create: vi.fn(), fetch: vi.fn() }));
vi.mock('@floegence/floe-webapp-core/app', () => ({
  createDocumentAssetRecovery: (options: unknown) => { state.create(options); return { check: state.check }; },
}));
vi.mock('../services/localApi', () => ({ fetchLocalApi: state.fetch }));

describe('Env App asset recovery adapter', () => {
  it('checks on each ready connection through the authorized Env App HTML route', async () => {
    vi.clearAllMocks();
    const [ready, setReady] = createSignal(false);
    let dispose!: () => void;
    createRoot((cleanup) => { dispose = cleanup; createEnvAppAssetRecovery(ready); });
    try {
      expect(state.check).not.toHaveBeenCalled();
      setReady(true);
      expect(state.check).toHaveBeenCalledTimes(1);
      setReady(true);
      expect(state.check).toHaveBeenCalledTimes(1);
      setReady(false);
      setReady(true);
      expect(state.check).toHaveBeenCalledTimes(2);
      const options = state.create.mock.calls[0]![0];
      expect(options.url).toBe('/_redeven_proxy/env/');
      const signal = new AbortController().signal;
      await options.fetch(options.url, { signal, cache: 'no-store', redirect: 'error' });
      expect(state.fetch).toHaveBeenCalledWith('/_redeven_proxy/env/', { signal, cache: 'no-store', redirect: 'error' });
    } finally {
      dispose();
    }
  });
});
