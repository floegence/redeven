// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestEntryConnectArtifact = vi.fn();
const browserRequestEntryConnectArtifact = vi.fn();

vi.mock('@floegence/flowersec-core/controlplane', () => ({
  requestEntryConnectArtifact,
}));

vi.mock('@floegence/flowersec-core/browser', () => ({
  requestEntryConnectArtifact: browserRequestEntryConnectArtifact,
}));

describe('controlplaneApi controlplane helper usage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    requestEntryConnectArtifact.mockReset();
    browserRequestEntryConnectArtifact.mockReset();
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
    requestEntryConnectArtifact.mockResolvedValue(artifact);

    const mod = await import('./controlplaneApi');
    const out = await mod.connectArtifactEntry({
      endpointId: 'env_demo',
      floeApp: 'com.floegence.redeven.agent',
      entryTicket: 'ticket-1',
    });

    expect(out).toBe(artifact);
    expect(requestEntryConnectArtifact).toHaveBeenCalledWith({
      endpointId: 'env_demo',
      entryTicket: 'ticket-1',
      credentials: 'omit',
      payload: {
        floe_app: 'com.floegence.redeven.agent',
      },
    });
    expect(browserRequestEntryConnectArtifact).not.toHaveBeenCalled();
  });
});
