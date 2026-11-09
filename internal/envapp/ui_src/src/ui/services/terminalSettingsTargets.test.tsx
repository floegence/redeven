// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { TerminalSettingsAttachmentsProvider, parseTerminalSettingsResource, terminalSettingsResource, trackTerminalSettingsControllers, useTerminalSettingsAttachments, type TerminalSettingsAttachment, type TerminalSettingsTarget } from './terminalSettingsTargets';
import type { RedevenTerminalLiveBundle } from './terminalTransport';
import type { TerminalControllerEvent, TerminalLiveAttachmentLifecycleEvent, TerminalLiveAttachResult } from '@floegence/floeterm-terminal-web/live';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
it.each<TerminalSettingsTarget>([{ kind: 'session', id: 'session-a' }, { kind: 'widget', id: 'widget-a' }, { kind: 'widget', id: 'widget-a', sessionId: 'session-a' }])('round-trips only an explicit target $kind', target => {
  expect(parseTerminalSettingsResource(terminalSettingsResource(target))).toEqual(target);
});
it.each([undefined, '', '{', 'null', '[]', 'true', '{}', '{"kind":"unknown","id":"a"}', '{"kind":"widget","id":" "}', '{"kind":"session","id":"a","sessionId":"b"}', '{"kind":"widget","id":"a","sessionId":""}', '{"kind":"widget","id":"a","owner":"other"}'])('rejects ambiguous target %s', raw => {
  expect(parseTerminalSettingsResource(raw)).toBeNull();
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function bundle() {
  const controller = new Map<string, (event: TerminalControllerEvent) => void>();
  const lifecycle = new Map<string, (event: TerminalLiveAttachmentLifecycleEvent) => void>();
  const unsubController = vi.fn(), unsubLifecycle = vi.fn();
  const attach = vi.fn(), disposeTransport = vi.fn();
  const raw = {
    transport: { attachWithPresentation: attach, dispose: disposeTransport },
    eventSource: {
      onTerminalController: (id: string, callback: (event: TerminalControllerEvent) => void) => { controller.set(id, callback); return () => { controller.delete(id); unsubController(); }; },
      onTerminalLiveAttachmentLifecycle: (id: string, callback: (event: TerminalLiveAttachmentLifecycleEvent) => void) => { lifecycle.set(id, callback); return () => { lifecycle.delete(id); unsubLifecycle(); }; },
    },
  } as unknown as RedevenTerminalLiveBundle;
  const tracked = trackTerminalSettingsControllers(raw);
  const grant = (id: string, epoch = 1) => controller.get(id)!({ sessionId: id, epoch, isController: true });
  const revoke = (id: string) => controller.get(id)!({ sessionId: id, epoch: 2, isController: false });
  const close = (id: string) => lifecycle.get(id)!({ sessionId: id, runtimeAttachGeneration: 1, state: 'closed', reason: 'detached' });
  return { tracked, attach, disposeTransport, controller, lifecycle, unsubController, unsubLifecycle, grant, revoke, close };
}
const attached: TerminalLiveAttachResult = { presentationSequence: 1, geometryGeneration: 1, cols: 80, rows: 24, runtimeAttachGeneration: 1, controllerEpoch: 1, isController: true };

it.each(['closed', 'revoked'] as const)('never resurrects ownership from a late attach response after %s', async reason => {
  const v = bundle(), pending = deferred<TerminalLiveAttachResult>(); v.attach.mockReturnValueOnce(pending.promise);
  const task = v.tracked.transport.attachWithPresentation('a', 80, 24); v.grant('a'); expect(v.tracked.controllers().has('a')).toBe(true);
  if (reason === 'closed') v.close('a'); else v.revoke('a');
  pending.resolve(attached); await task; expect(v.tracked.controllers().has('a')).toBe(false);
  v.tracked.transport.dispose();
});

it('uses authoritative controller events and never treats successful attachment alone as control', async () => {
  const v = bundle(); v.attach.mockResolvedValue(attached); await v.tracked.transport.attach('a', 80, 24);
  expect(v.tracked.controllers().size).toBe(0); v.grant('a', 4); const first = v.tracked.controllers().get('a'); expect(first).toBeDefined();
  v.grant('a', 5); expect(v.tracked.controllers().get('a')).not.toBe(first);
  await v.tracked.transport.attach('b', 80, 24); v.grant('b'); v.close('a');
  expect([...v.tracked.controllers().keys()]).toEqual(['b']);
  v.tracked.transport.dispose(); expect(v.tracked.controllers().size).toBe(0); expect(v.unsubController).toHaveBeenCalledTimes(2); expect(v.unsubLifecycle).toHaveBeenCalledTimes(2); expect(v.disposeTransport).toHaveBeenCalledOnce();
});

it('registers and removes exact existing attachment owners without attaching sessions', () => {
  let registry!: NonNullable<ReturnType<typeof useTerminalSettingsAttachments>>;
  const host = document.createElement('div'); document.body.append(host);
  const Consumer = () => { registry = useTerminalSettingsAttachments()!; return <div />; };
  dispose = render(() => <TerminalSettingsAttachmentsProvider><Consumer /></TerminalSettingsAttachmentsProvider>, host);
  const attach = vi.fn();
  const first = { widgetID: null, controllers: () => new Map([['a', 'authority']]), ready: () => true, transport: { attach } } as unknown as TerminalSettingsAttachment;
  const second = { ...first, widgetID: 'widget-b' };
  const removeFirst = registry.register(first), removeSecond = registry.register(second);
  expect(registry.entries()).toEqual([first, second]); removeFirst(); removeFirst(); expect(registry.entries()).toEqual([second]);
  removeSecond(); expect(registry.entries()).toEqual([]); expect(attach).not.toHaveBeenCalled();
});
