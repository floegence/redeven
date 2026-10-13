import { describe, expect, it } from 'vitest';
import { normalizeDesktopLauncherActionRequest } from './desktopLauncherIPC';

describe('Gateway verification and consent IPC', () => {
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
