// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getArtifact = vi.fn();
const createEntryControlplaneArtifactSource = vi.fn(() => ({ getArtifact }));

vi.mock('@floegence/floe-webapp-boot', () => ({
  createEntryControlplaneArtifactSource,
}));

describe('controlplaneApi controlplane helper usage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    getArtifact.mockReset();
    createEntryControlplaneArtifactSource.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redeems entry tickets through the stable controlplane module', async () => {
    const artifact = {
      v: 1,
      transport: 'tunnel',
      tunnel_grant: {
        tunnel_url: 'wss://example.com/ws',
        channel_id: 'ch_remote',
        token: 'token',
        role: 1,
        idle_timeout_seconds: 10,
        channel_init_expire_at_unix_s: 1,
        e2ee_psk_b64u: 'secret',
        allowed_suites: [1],
        default_suite: 1,
      },
    } as const;
    getArtifact.mockResolvedValue(artifact);

    const mod = await import('./controlplaneApi');
    const out = await mod.connectArtifactEntry({
      endpointId: 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      entryTicket: 'ticket-1',
    });

    expect(out).toBe(artifact);
    expect(createEntryControlplaneArtifactSource).toHaveBeenCalledWith({
      endpointId: 'env_demo',
      entryTicket: 'ticket-1',
      credentials: 'omit',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
    });
    expect(getArtifact).toHaveBeenCalledWith({});
  });
});
