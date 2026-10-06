import https from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareGatewayEnvironmentAccess } from './gatewayEnvironmentAccess';
import { gatewayRecordFixture, memberFixture, catalogFixture } from '../testSupport/gatewayMembershipFixture';
import { GatewayClient } from './gatewayClient';

const mocks = vi.hoisted(() => ({ transport: vi.fn(), probe: vi.fn() }));
vi.mock('./gatewayMemberTransport', () => ({ createGatewayMemberTransport: mocks.transport }));
vi.mock('./runtimeState', () => ({ probeExternalLocalUIStartup: mocks.probe }));
const agent = new https.Agent();
const close = vi.fn(async () => {});
const transport = { origin: 'https://signed-member.redeven.invalid', agent, close };
const client = new GatewayClient({ readSecret: () => '', writeSecret: () => {}, deleteSecret: () => {} });
beforeEach(() => {
  vi.clearAllMocks(); mocks.transport.mockResolvedValue(transport);
  mocks.probe.mockResolvedValue({ ok: true, value: { local_ui_url: 'https://untrusted-advertisement', local_ui_urls: ['https://untrusted-advertisement'] } });
});
describe('member access owner', () => {
  it('keeps the signed logical origin and probes through the member SDK agent', async () => {
    const access = await prepareGatewayEnvironmentAccess(gatewayRecordFixture, memberFixture, catalogFixture, client);
    expect(mocks.probe).toHaveBeenCalledWith(transport.origin, expect.objectContaining({ agent, gatewayEndpoint: true }));
    expect(access.startup.local_ui_url).toBe(transport.origin);
    expect(access.startup.local_ui_urls).toEqual([transport.origin]);
    await access.close(); expect(close).toHaveBeenCalledOnce();
  });
  it.each(['removed', 'offline', 'denied'])('rejects %s before opening a transport', async state => {
    const member = { ...memberFixture, ...(state === 'removed' ? { state: 'removed' as const } : state === 'offline' ? { connected: false } : {}) };
    const catalog = state === 'denied' ? { ...catalogFixture, gateway: { ...catalogFixture.gateway, permissions: { ...catalogFixture.gateway.permissions, access: false } } } : catalogFixture;
    await expect(prepareGatewayEnvironmentAccess(gatewayRecordFixture, member, catalog, client)).rejects.toMatchObject({ code: 'MEMBER_OFFLINE' });
    expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('closes the owned transport after an unsuccessful application probe without trying another route', async () => {
    mocks.probe.mockResolvedValue({ ok: false, failure: { kind: 'network_error', stage: 'runtime_health' } });
    await expect(prepareGatewayEnvironmentAccess(gatewayRecordFixture, memberFixture, catalogFixture, client)).rejects.toMatchObject({ code: 'GATEWAY_TARGET_UNAVAILABLE' });
    expect(mocks.transport).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
});
