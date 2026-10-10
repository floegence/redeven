import { describe, expect, it } from 'vitest';
import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';
import { normalizeGatewayNetworkSettings } from './gatewayNetworkSettings';

const settings = {listen_addresses:['0.0.0.0:7443','[::1]:7555'],allowed_hosts:['Gateway.Internal','::1'],endpoints:[{endpoint_id:'lan',address:'https://gateway.internal:7443',scope:'lan',priority:0}]};

describe('Gateway network IPC boundary',()=>{
 it('normalizes exact Hosts independently from bind and share addresses',()=>{
  expect(normalizeDesktopLauncherActionRequest({kind:'update_gateway_network_settings',gateway_id:'gateway',settings})).toEqual({kind:'update_gateway_network_settings',gateway_id:'gateway',settings:{...settings,allowed_hosts:['gateway.internal','::1']}});
  expect(normalizeGatewayNetworkSettings({...settings,allowed_hosts:[]})).toMatchObject({allowed_hosts:[]});
 });
 it.each([
  {listen_addresses:[]}, {listen_addresses:['https://example:7443']}, {listen_addresses:['0.0.0.0:65536']}, {listen_addresses:['0.0.0.0:7443','0.0.0.0:7443']},
  {allowed_hosts:['*.example']}, {allowed_hosts:['example:7443']}, {allowed_hosts:['Gateway.Internal','gateway.internal']},
  {endpoints:[{...settings.endpoints[0],address:'http://example:7443'}]}, {endpoints:[{...settings.endpoints[0],address:'https://user:pass@example:7443'}]},
 ])('rejects malformed settings %j before dispatch',edit=>{
  expect(normalizeDesktopLauncherActionRequest({kind:'update_gateway_network_settings',gateway_id:'gateway',settings:{...settings,...edit}})).toBeNull();
 });
});
