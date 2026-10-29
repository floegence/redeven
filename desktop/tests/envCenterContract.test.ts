import { describe, expect, it, vi } from 'vitest';
import { passwordAction } from '../../internal/envcenter_web/src/api';

it('binds passwords to the login session using the server PBKDF2 vector', async () => {
  const expected = 'password:pbkdf2-sha256-v1:dr2wlfG3PcgTBo8JHTGESAVPzOqf6zvo8V602BaraJY';
  expect(await passwordAction('new strong password', 'device-one')).toBe(expected);
  expect(await passwordAction('new strong password', 'device-two')).not.toBe(expected);
  await expect(passwordAction('new strong password', '')).rejects.toThrow('CENTER_AUTH_REQUIRED');
});
import { createEnvironmentOpenController, requestEnvironmentOpen, environmentOpenRunning, createEnvironmentOperationObserver, createEnvironmentHandoffGuard } from '../src/envcenter/controller';
import { filterEnvironmentFacts, reduceEnvironmentOperation, classifyEnvironmentFailure, projectEnvironment, environmentRecovery } from '../src/envcenter/core';
import type { EnvironmentCenterHost, EnvironmentEntry } from '../src/envcenter/contracts';
const entry: EnvironmentEntry = { id: 'env-a', label: 'Production', gateway_id: 'gateway-a', gateway_env_id: 'member-a', runtime_operations: { open: { availability: 'available' } } };
describe.each(['window', 'navigation'] as const)('shared %s host contract', kind => {
  it('delegates exactly one explicit route and preserves the host result', async () => {
    const host: EnvironmentCenterHost = { focus: vi.fn(async () => true), open: vi.fn(async () => ({ kind, accepted: true })), invalidTarget: vi.fn() };
    expect(await requestEnvironmentOpen(host, entry)).toBe(true);
    expect(host.open).toHaveBeenCalledExactlyOnceWith({ environment_id: 'env-a', gateway_id: 'gateway-a', gateway_env_id: 'member-a', label: 'Production' });
    expect(host.focus).not.toHaveBeenCalled();
  });
  it('does not invent a route or replay a rejected action', async () => {
    const host: EnvironmentCenterHost = { focus: vi.fn(async () => true), open: vi.fn(async () => ({ kind, accepted: false })), invalidTarget: vi.fn() };
    expect(await requestEnvironmentOpen(host, { ...entry, gateway_id: '' })).toBe(false);
    expect(host.open).not.toHaveBeenCalled();
    expect(await requestEnvironmentOpen(host, entry)).toBe(false);
    expect(host.open).toHaveBeenCalledTimes(1);
  });
  it('keeps source filtering and progress association exact', () => {
    const other = { ...entry, id: 'env-b', gateway_id: 'gateway-b' };
    expect(filterEnvironmentFacts([entry, other], ' PROD ', e => e.label, e => e.gateway_id === 'gateway-b')).toEqual([other]);
    expect(environmentOpenRunning(entry, [{ action: 'open_gateway_environment', gateway_id: 'gateway-b', environment_id: entry.id, status: 'running' }])).toBe(false);
  });
});

describe('shared operation authority', () => {
  it('fences navigation synchronously before cancellation reaches the host', () => {
    const handoff = createEnvironmentHandoffGuard();
    handoff.requestCancel();
    expect(handoff.claim()).toBe(false);
    expect(handoff.claim()).toBe(false);
  });
  it('permits a handoff only once and does not cancel an already handed off view', () => {
    const handoff = createEnvironmentHandoffGuard();
    expect(handoff.claim()).toBe(true);
    expect(handoff.claim()).toBe(false);
    expect(handoff.requestCancel()).toBe(false);
  });
  it.each(['window', 'navigation'] as const)('joins duplicate %s intents and permits a later explicit action', async kind => {
    let finish!: (value: {kind: typeof kind; accepted: boolean}) => void;
    const host: EnvironmentCenterHost = { focus: vi.fn(async () => true), invalidTarget: vi.fn(), open: vi.fn(() => new Promise<{kind: typeof kind; accepted: boolean}>(resolve => { finish = resolve; })) };
    const controller = createEnvironmentOpenController(host);
    const first = controller.open(entry);
    expect(controller.open(entry)).toBe(first);
    expect(host.open).toHaveBeenCalledTimes(1);
    finish({kind, accepted: true});
    expect(await first).toBe(true);
    const next = controller.open(entry);
    expect(host.open).toHaveBeenCalledTimes(2);
    finish({kind, accepted:false});
    expect(await next).toBe(false);
  });
  it('rejects delayed, cross-operation, and terminal-revival events', () => {
    const initial = { id:'one', sequence:2, status:'running' as const };
    expect(reduceEnvironmentOperation(initial, {...initial, sequence:1})).toBe(initial);
    expect(reduceEnvironmentOperation(initial, {...initial, id:'two', sequence:3})).toBe(initial);
    const canceled = reduceEnvironmentOperation(initial, {...initial, sequence:3, status:'canceled'});
    expect(reduceEnvironmentOperation(canceled, {...initial, sequence:4, status:'succeeded'})).toBe(canceled);
  });
  it.each([['GATEWAY_UNREACHABLE','offline'],['CENTER_BINDING_REQUIRED','permission'],['RUNTIME_UNSUPPORTED','unsupported'],['CENTER_REVISION_CONFLICT','conflict'],['CENTER_BUSY','capacity'],['CENTER_OPERATION_CANCELED','canceled']])('classifies %s consistently', (code, expected) => {
    expect(classifyEnvironmentFailure(code)).toBe(expected);
  });
});

describe('shared verified directory facts', () => {
  it('preserves exact route identity when labels and addresses are equal', () => {
    const a = projectEnvironment(entry);
    const b = projectEnvironment({ ...entry, gateway_id: 'another-source' });
    expect(a.identity).not.toBe(b.identity);
    expect(a.target?.gateway_id).toBe('gateway-a');
    expect(a.openAvailable).toBe(true);
    expect(projectEnvironment({ ...entry, runtime_operations: { open: { availability: 'forbidden' } } }).openAvailable).toBe(false);
  });
  it('retains terminal owner state on reconnect and rejects other operations', () => {
    const observe = createEnvironmentOperationObserver('operation-a');
    expect(observe({ id: 'operation-b', sequence: 1, status: 'running' })).toBeUndefined();
    observe({ id: 'operation-a', sequence: 1, status: 'running' });
    const done = observe({ id: 'operation-a', sequence: 2, status: 'canceled' });
    expect(observe({ id: 'operation-a', sequence: 1, status: 'running' })).toBe(done);
    expect(observe({ id: 'operation-a', sequence: 3, status: 'succeeded' })).toBe(done);
  });
  it.each([
    ['CENTER_CONNECTOR_UNREACHABLE', 'check_connection'], ['CENTER_CONNECTOR_UNSUPPORTED', 'update_target'],
    ['CENTER_ACCESS_EXPIRED', 'sign_in'], ['CENTER_BINDING_REQUIRED', 'request_access'],
    ['RUNTIME_UNSUPPORTED', 'update_target'], ['CENTER_PASSWORD_COMMON', 'configure'],
    ['CENTER_BUSY', 'wait'], ['BROWSER_PERMISSION_DENIED', 'browser_settings'],
  ])('maps %s to one explicit recovery action', (code, action) => {
    expect(environmentRecovery(classifyEnvironmentFailure(code))).toBe(action);
  });
});

import { createDesktopCenterHost, desktopCenterOperation, createDesktopCenterProgressAdapter } from '../src/welcome/envCenterAdapter';
import { createWebCenterHost, webCenterEntry, webCenterOperation } from '../../internal/envcenter_web/src/adapter';
import type { DesktopLauncherActionProgress } from '../src/shared/desktopLauncherIPC';
import type { Route, Member } from '../../internal/envcenter_web/src/contracts.generated';
import { validateCenterContract } from '../../internal/envcenter_web/src/contracts.generated';

describe('generated public wire contracts', () => {
  const operation = {id:'op',request_id:'request',route_id:'route',sequence:1,status:'connecting'};
  it('rejects unknown owner states, negative sequences, unsafe integers and extra fields', () => {
    expect(() => validateCenterContract('Operation',operation)).not.toThrow();
    for (const value of [{...operation,status:'invented'}, {...operation,sequence:-1}, {...operation,sequence:Number.MAX_SAFE_INTEGER+1}, {...operation,secret:'not public'}]) {
      expect(() => validateCenterContract('Operation',value)).toThrow('CENTER_INVALID_RESPONSE');
    }
  });
});

describe('production host adapters', () => {
  it('projects equivalent verified routes and delegates the same target', async () => {
    const route = { id:'env-a',label:'Production',source_id:'gateway-a',member_id:'member-a',runtime_id:'runtime-a' } as Route;
    const member = { member_id:'member-a',runtime_public_id:'runtime-a',connected:true,metadata:{hostname:'host'} } as Member;
    const web = webCenterEntry(route, member, '');
    const desktop = { ...entry, gateway_member:{connected:true,metadata:{hostname:'host'}} };
    expect(projectEnvironment(web)).toEqual(projectEnvironment(desktop));
    const effects = vi.fn(async () => true);
    const adapters = [createDesktopCenterHost({ focus:async()=>false,open:effects,invalidTarget:vi.fn() }),createWebCenterHost(effects)];
    for(const adapter of adapters) await createEnvironmentOpenController(adapter).open(web);
    expect(effects.mock.calls).toEqual([[projectEnvironment(web).target],[projectEnvironment(web).target]]);
    expect(projectEnvironment(webCenterEntry(route,{...member,runtime_public_id:'wrong'},'')).connected).toBe(false);
  });
  it('maps equivalent owner states and rejects stale Desktop events', () => {
    const desktop: DesktopLauncherActionProgress={action:'open_gateway_environment',operation_key:'open-a',started_at_unix_ms:1,operation_revision:2,status:'succeeded',phase:'ready',title:'',detail:''};
    const web=webCenterOperation({id:'open-a',request_id:'request-a',route_id:'env-a',sequence:2,status:'ready'});
    const projected=desktopCenterOperation(desktop)!;
    expect({...projected,id:web.id}).toEqual(web);
    const accept=createDesktopCenterProgressAdapter();
    expect(accept({...desktop,operation_revision:1,status:'running'})).toBe(true);
    expect(accept(desktop)).toBe(true);
    expect(accept(desktop)).toBe(false);
    expect(accept({...desktop,operation_revision:3,status:'running'})).toBe(false);
    expect(accept({...desktop,started_at_unix_ms:2,operation_revision:1,status:'running'})).toBe(true);
    expect(accept(desktop)).toBe(false);
  });
});
