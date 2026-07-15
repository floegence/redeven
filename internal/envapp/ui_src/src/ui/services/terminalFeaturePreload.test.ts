import { beforeEach, describe, expect, it, vi } from 'vitest';

const preloadResources = vi.hoisted(() => vi.fn());

vi.mock('../pages/EnvTerminalPage', () => ({ EnvTerminalPage: () => null }));
vi.mock('../widgets/TerminalPanel', () => ({ TerminalPanel: () => null }));
vi.mock('@floegence/floeterm-terminal-web/preload', () => ({
  preloadTerminalResources: preloadResources,
}));

import {
  preloadTerminalFeatureResources,
  resetTerminalFeaturePreloadForTests,
} from './terminalFeaturePreload';

describe('terminal feature preload', () => {
  beforeEach(() => {
    preloadResources.mockReset();
    resetTerminalFeaturePreloadForTests();
  });

  it('deduplicates concurrent feature/resource loads', async () => {
    let release!: () => void;
    preloadResources.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = preloadTerminalFeatureResources({ reason: 'intent' });
    const second = preloadTerminalFeatureResources({ reason: 'idle' });
    expect(first).toBe(second);
    await vi.waitFor(() => expect(preloadResources).toHaveBeenCalledTimes(1));
    release();
    await expect(first).resolves.toBeUndefined();
  });

  it('resets after a failure so a later user intent can retry', async () => {
    preloadResources.mockRejectedValueOnce(new Error('renderer unavailable'));
    await expect(preloadTerminalFeatureResources()).rejects.toThrow('renderer unavailable');
    preloadResources.mockResolvedValueOnce(undefined);
    await expect(preloadTerminalFeatureResources({ reason: 'retry' })).resolves.toBeUndefined();
    expect(preloadResources).toHaveBeenCalledTimes(2);
  });

  it('does not publish raw loader paths in failure metadata', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    preloadResources.mockRejectedValueOnce(new Error('/Users/private/workspace/renderer.wasm failed'));

    await expect(preloadTerminalFeatureResources({ logger })).rejects.toThrow('renderer.wasm failed');

    const failedCall = logger.debug.mock.calls.find((call) => String(call[0]).includes('failed'));
    expect(failedCall?.[1]).toEqual({
      reason: 'idle',
      failure_code: 'feature_or_resource_load_failed',
    });
    expect(JSON.stringify(failedCall?.[1])).not.toContain('/Users/private');
  });
});
