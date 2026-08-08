// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const acquire = vi.fn();
const createControlplaneArtifactSource = vi.fn(() => ({ kind: 'refreshable', acquire }));

vi.mock('@floegence/floe-webapp-boot/artifact-source', () => ({
  createControlplaneArtifactSource,
}));

describe('controlplaneApi controlplane helper usage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    acquire.mockReset();
    createControlplaneArtifactSource.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redeems entry tickets through the stable controlplane module', async () => {
    const result = { kind: 'failure', code: 'test', disposition: { kind: 'terminal' } } as const;
    acquire.mockResolvedValue(result);
    const controller = new AbortController();

    const mod = await import('./controlplaneApi');
    const out = await mod.connectArtifactEntry({
      endpointId: 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      entryTicket: 'ticket-1',
      traceId: 'trace-1',
      signal: controller.signal,
    });

    expect(out).toBe(result);
    expect(createControlplaneArtifactSource).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:3000',
      endpointId: 'env_demo',
      entryTicket: 'ticket-1',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
      correlation: { traceId: 'trace-1' },
    });
    expect(acquire).toHaveBeenCalledWith({
      signal: controller.signal,
    });
  });

  it('forwards loopback HTTP permission only when the caller selects it', async () => {
    acquire.mockResolvedValue({ kind: 'failure', code: 'test', disposition: { kind: 'terminal' } });

    const mod = await import('./controlplaneApi');
    await mod.connectArtifactEntry({
      endpointId: 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      entryTicket: 'ticket-1',
      allowLoopbackHTTP: true,
    });

    expect(createControlplaneArtifactSource).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:3000',
      endpointId: 'env_demo',
      entryTicket: 'ticket-1',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
      allowLoopbackHTTP: true,
    });
  });
});
