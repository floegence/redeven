import { describe, expect, it } from 'vitest';
import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

describe('Gateway verification and consent IPC', () => {
 it('accepts a scoped connection attempt and keeps its password out of enrollment commands', () => {
  const request = { kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'status', connection_token: 7, ssh_password: ' temporary password ' };
  expect(normalizeDesktopLauncherActionRequest(request)).toEqual(request);
  for (const connection_token of [0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1]) {
   expect(normalizeDesktopLauncherActionRequest({ ...request, connection_token })).toBeNull();
  }
  expect(normalizeDesktopLauncherActionRequest({ ...request, connection_token: undefined })).toBeNull();
  expect(normalizeDesktopLauncherActionRequest({ ...request, operation: 'join', preview_id: 'a'.repeat(43) })).toBeNull();
  const close = { kind: 'close_runtime_gateway', runtime_target_id: 'ssh:chosen', connection_token: 7 };
  expect(normalizeDesktopLauncherActionRequest(close)).toEqual(close);
 });
 it.each(['local:chosen', 'ssh:chosen', 'wsl:chosen', 'local:container', 'ssh:container'])('sends only an address and code to the chosen %s Runtime', runtime_target_id => {
  const request = { kind: 'manage_runtime_gateway', runtime_target_id, operation: 'preview', purpose: 'join', address: 'https://gateway.internal:7443', code: 'abcd-efgh' };
  expect(normalizeDesktopLauncherActionRequest(request)).toEqual(request);
 });
 it('confirms only opaque Runtime preview IDs and rejects file material', () => {
  const request = { kind: 'manage_runtime_gateway', runtime_target_id: 'local:chosen', operation: 'join', preview_id: 'a'.repeat(43) };
  expect(normalizeDesktopLauncherActionRequest(request)).toEqual(request);
  expect(normalizeDesktopLauncherActionRequest({ ...request, invitation: {} })).toBeNull();
  expect(normalizeDesktopLauncherActionRequest({ ...request, preview_id: undefined })).toBeNull();
  expect(normalizeDesktopLauncherActionRequest({ ...request, operation: 'status' })).toBeNull();
 });
 it('rejects untrusted targets, unknown fields and unbounded credentials', () => {
  const request = { kind: 'manage_runtime_gateway', runtime_target_id: 'ssh:chosen', operation: 'preview', purpose: 'replace', address: 'https://gateway.example', code: 'A'.repeat(26) };
  for (const patch of [{runtime_target_id:'https://runtime.example'}, {address:'https://user:password@gateway.example'}, {address:'http://gateway.example'}, {code:'A'.repeat(129)}, {purpose:'leave'}, {token:'secret'}]) expect(normalizeDesktopLauncherActionRequest({...request,...patch})).toBeNull();
 });
});
