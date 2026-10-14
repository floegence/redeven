import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { resolveDesktopSessionTransport } from './desktopSessionTransport';
import type { DesktopSessionTarget } from './desktopTarget';

function productionBoundary(name: string, context: object) {
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8'), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Desktop boundary is missing: ${name}`);
  const script = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${script}\n${name}`, context);
}

const target: DesktopSessionTarget = {
  kind: 'local_environment', session_key: 'env:local:local_host', environment_id: 'local', label: 'Local Environment',
  route: 'local_host', local_environment_kind: 'local', has_local_hosting: true, has_remote_desktop: false,
};

function fixture() {
  const record = {
    target, closing: false, lifecycle: 'open', session_key: target.session_key,
    transport: resolveDesktopSessionTransport(target, {
      local_ui_url: '', local_ui_urls: [], local_ui_bridge_url: 'http://127.0.0.1:43123/', local_ui_bridge_token: 'A'.repeat(43),
    }),
    root_window: { webContentsID: 7 },
    diagnostics: { failRequest: vi.fn(), recordLifecycle: vi.fn() },
    transport_recovery_snapshot: null as Record<string, unknown> | null,
  };
  const send = vi.fn();
  const context: Record<string, unknown> = {
    URL,
    desktopDiagnosticsHookSessions: new Set(), sessionRecordForWebContentsID: (id: number) => id === 7 ? record : null,
    sendSessionTransportRecoverySnapshot: send,
  };
  // Execute the production HTTP failure hook, including its session routing.
  const source = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
  if (source.includes('function failNativeLocalSessionTransport(')) {
    context.failNativeLocalSessionTransport = productionBoundary('failNativeLocalSessionTransport', context);
  }
  let onError!: (details: { id: number; webContentsId: number; url: string; error: string }) => void;
  const webSession = { webRequest: {
    onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn(), onCompleted: vi.fn(),
    onErrorOccurred: (listener: typeof onError) => { onError = listener; },
  } };
  const install = productionBoundary('installDesktopDiagnosticsHooks', context) as (session: object) => void;
  install(webSession);
  const fail = (url = 'http://127.0.0.1:43123/api/local/direct/connect_artifact', error = 'net::ERR_CONNECTION_REFUSED') =>
    onError({ id: 1, webContentsId: 7, url, error });
  return { record, send, fail };
}

describe('native Local Runtime transport loss', () => {
  it('ends dead-port retries and offers native recovery when the trusted bridge refuses a connection', () => {
    const f = fixture(); f.fail();
    expect(f.record.transport_recovery_snapshot).toMatchObject({
      generation: 1, phase: 'failed', failure: { code: 'transport_unavailable' }, actions: ['open_connection_center'],
    });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(f.record);
    f.fail('http://127.0.0.1:43123/_redeven_proxy/env/assets/settings.js');
    expect(f.send).toHaveBeenCalledOnce();
  });

  it.each([
    ['http://127.0.0.1:43124/api/local/direct/connect_artifact', 'net::ERR_CONNECTION_REFUSED'],
    ['http://pf-service.localhost:43123/', 'net::ERR_CONNECTION_REFUSED'],
    ['https://api.openai.com/v1/models', 'net::ERR_CONNECTION_REFUSED'],
    ['invalid-url', 'net::ERR_CONNECTION_REFUSED'],
    ['http://127.0.0.1:43123/_redeven_proxy/api/settings', 'net::ERR_ABORTED'],
  ])('does not terminate the Runtime session for unrelated or canceled requests: %s', (url, error) => {
    const f = fixture(); f.fail(url, error);
    expect(f.record.transport_recovery_snapshot).toBeNull(); expect(f.send).not.toHaveBeenCalled();
  });

  it.each(['placement_bridge', 'provider_remote', 'gateway_member', 'external_local_ui'] as const)('leaves %s recovery with its existing owner', kind => {
    const f = fixture(); f.record.transport = { ...f.record.transport, kind }; f.fail();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('ignores teardown errors from a retiring session', () => {
    const f = fixture(); f.record.closing = true; f.fail(); expect(f.send).not.toHaveBeenCalled();
  });

  it('routes explicit Open of an unavailable local session through the existing workspace-preserving Restart owner', async () => {
    const f = fixture(); f.record.transport_recovery_snapshot = { phase: 'failed' };
    const restart = vi.fn(async () => ({ ok: true, outcome: 'restarted_environment_runtime' }));
    const coordinator = { runOpen: vi.fn(async () => ({ ok: true, outcome: 'focused_environment_window' })) };
    const open = productionBoundary('openLocalEnvironmentRecord', {
      reinstallRecoveryBlockForEnvironment: async () => null, buildLocalEnvironmentDesktopTarget: () => target,
      localHostOpenTarget: () => ({ targetID: 'local-target', hostAccess: { kind: 'local_host' }, placement: { kind: 'host_process' } }),
      localHostRuntimeLifecycleTargetKey: () => 'local-target', liveSession: () => f.record,
      runtimeLifecycleFingerprint: () => 'open-local',
      sessionTransportRecoveryFailed: (record: typeof f.record) => record.transport_recovery_snapshot?.phase === 'failed',
      runEnvironmentRuntimeLifecycleFromLauncher: restart, runtimeLifecycleCoordinator: coordinator,
    }) as (preferences: object, environment: object) => Promise<unknown>;
    expect(await open({}, { id: 'local', label: 'Local Environment' })).toMatchObject({ ok: true });
    expect(restart).toHaveBeenCalledExactlyOnceWith({
      kind: 'restart_environment_runtime', environment_id: 'local', label: 'Local Environment',
      runtime_target_id: 'local-target', host_access: { kind: 'local_host' }, placement: { kind: 'host_process' },
    });
    expect(coordinator.runOpen).not.toHaveBeenCalled();
  });

  it('recovers a failed native session when the launcher action is Show Env App', async () => {
    const f = fixture(); f.record.transport_recovery_snapshot = { phase: 'failed' };
    const open = vi.fn(async () => ({ ok: true, outcome: 'restarted_environment_runtime' }));
    const focus = vi.fn(() => true);
    const run = productionBoundary('focusEnvironmentWindow', {
      liveSession: () => f.record, focusEnvironmentSession: focus,
      sessionTransportRecoveryFailed: (record: typeof f.record) => record.transport_recovery_snapshot?.phase === 'failed',
      openLocalEnvironmentFromLauncher: open, resetLauncherIssueState: vi.fn(), broadcastDesktopWelcomeSnapshots: vi.fn(),
      launcherActionSuccess: () => ({ ok: true, outcome: 'focused_environment_window' }),
    }) as (sessionKey: string) => Promise<unknown>;
    expect(await run(target.session_key)).toMatchObject({ ok: true, outcome: 'restarted_environment_runtime' });
    expect(open).toHaveBeenCalledExactlyOnceWith({ kind: 'open_local_environment', environment_id: 'local', route: 'local_host' });
    expect(focus).not.toHaveBeenCalled();
  });
});
