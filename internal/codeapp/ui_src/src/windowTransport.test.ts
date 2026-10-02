import { describe, expect, it } from 'vitest';
import { validateWindowSpend, windowTransportPath, type WindowTransportConfig } from './windowTransport';
import type { SpendBindingView } from '@floegence/floe-webapp-boot';

const config: WindowTransportConfig = { kind:'direct', forward_id:'owned', base:'/pf/owned' };
const origin = 'https://host.test';
const binding: SpendBindingView = { artifactDigestB64u:'artifact', projectionDigestB64u:'projection', expiresAt:'2026-10-02T12:00:00Z',
  consumer:'trusted', launcherOrigin:origin, runtimeOrigin:origin, appOrigin:origin,
  targetBinding:{v:1,kind:'window',env_public_id:'env_local',floe_app:'com.floegence.redeven.portforward',forward_id:'owned'} };

describe('graphical window Flowersec authority', () => {
  it('maps HTTP and both independent media streams into the same resource session', () => {
    for (const route of ['/_redeven_desktop/ticket','/_redeven_desktop/control','/_redeven_desktop/media','/_redeven_host_app/state','/_redeven_host_app/stream','/index.html']) {
      expect(windowTransportPath(origin+config.base+route,config.base,origin)).toBe(route);
      expect(windowTransportPath('wss://host.test'+config.base+route,config.base,origin)).toBe(route);
      expect(windowTransportPath(origin+route,'',origin)).toBe(route);
    }
  });
  it.each(['https://other.test/pf/owned/stream','wss://host.test:444/pf/owned/stream','ws://host.test/pf/owned/stream',
    '/pf/other/stream','/pf/owned-other/stream','/pf/owned/../other/stream','//other.test/pf/owned/stream','https://secret@host.test/pf/owned/stream'])('rejects routing outside the window: %s', input => {
    expect(()=>windowTransportPath(input,config.base,origin)).toThrow('route mismatch');
  });
  it('requires the exact issuer origin, target and consumer before spending an artifact', () => {
    expect(()=>validateWindowSpend(binding,config,origin)).not.toThrow();
    for (const key of ['launcherOrigin','runtimeOrigin','appOrigin'] as const) expect(()=>validateWindowSpend({...binding,[key]:'https://other.test'},config,origin)).toThrow();
    expect(()=>validateWindowSpend({...binding,consumer:'isolated'},config,origin)).toThrow();
    for (const targetBinding of [{...binding.targetBinding as object,forward_id:'other'}, {...binding.targetBinding as object,admin:true},null] as SpendBindingView['targetBinding'][]) {
      expect(()=>validateWindowSpend({...binding,targetBinding},config,origin)).toThrow();
    }
  });
});
