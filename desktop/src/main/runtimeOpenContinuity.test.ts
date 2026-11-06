import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { canAttemptKnownRuntimeBridge, canReuseFreshRuntimeOpenPreflight, createRuntimeOpenConnectionBudget, runtimeOpenHasManagementEvidence } from './runtimeOpenPreflight';
import { DesktopSSHTransportAuthenticationError, DesktopSSHTransportInterruptedError, DesktopSSHTransportUnavailableError, DesktopSSHRemoteCommandError } from './sshTransportManager';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';

function boundary(name: string, context: object) {
  const source = ts.createSourceFile('main.ts', fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8'), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Missing production boundary: ${name}`);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${compiled}\n${name}`, context);
}

function fixture(known: boolean, error: Error) {
  const host = { kind: 'ssh_host', ssh: { ssh_destination: 'devbox', auth_mode: 'key_agent', connect_timeout_seconds: 15 } };
  const placement = { kind: 'host_process' };
  const ready = known ? { host_access: host, placement, runtime_started_at_unix_ms: 42, runtime_service: {
    compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH, compatibility: 'compatible', open_readiness: { state: 'openable' },
  } } : null;
  const refresh = vi.fn(async () => undefined);
  const lifecycle = vi.fn();
  const acquire = vi.fn(async () => { throw error; });
  const finish = vi.fn();
  const context: Record<string, unknown> = {
    Date, AbortController, DOMException, console: { info: vi.fn(), warn: vi.fn() },
    setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1; }, clearTimeout: vi.fn(),
    reinstallRecoveryBlockForEnvironment: async () => null,
    runtimeTargetEnvironmentIDFromRequest: () => 'env', runtimeTargetLabelFromRequest: () => 'Dev',
    runtimeHostAccessFromRequest: () => host, runtimePlacementFromRequest: () => placement,
    runtimeTargetIDFromRequest: () => 'ssh:devbox', runtimeLifecycleTargetKey: () => 'host:devbox',
    pendingRuntimePlacementOpenByTargetID: new Map(), managedEnvironmentOpenRecoveryAttemptsByTargetID: new Map(),
    launcherOperations: { get: () => null, create: (input: object) => input, operationSignal: () => undefined, finish },
    desktopSessionKeyFromRuntimeTargetID: () => 'ssh:devbox', liveSession: () => null,
    savedRuntimePlacementReadyRecord: () => ready, welcomeRuntimeHealthStore: { snapshot: () => ({}) },
    desktopWelcomeRuntimeHealthForEnvironment: () => ({ status: 'unknown', freshness: 'stale', offline_reason_code: 'probe_failed' }),
    canAttemptKnownRuntimeBridge, canReuseFreshRuntimeOpenPreflight, createRuntimeOpenConnectionBudget, runtimeOpenHasManagementEvidence,
    runtimePlacementBridgeRegistry: { get: () => null }, sshDetailsFromRuntimePlacement: () => ({}), buildSSHDesktopTarget: () => ({}),
    buildOpenConnectionProgress: () => ({}), retireSupersededEnvironmentOperations: vi.fn(), loadDesktopPreferencesCached: async () => ({}),
    refreshWelcomeRuntimeHealthForEnvironment: refresh, updateOpenConnectionOperation: vi.fn(),
    savedRuntimePlacementSSHPassword: () => '', acquireRuntimePlacementBridgeForReadyRecord: acquire,
    MANAGED_ENVIRONMENT_OPEN_BRIDGE_START_RETRY_DELAYS_MS: [1, 1],
    DesktopSSHRemoteCommandError, DesktopSSHTransportInterruptedError, DesktopSSHTransportUnavailableError, DesktopSSHTransportAuthenticationError,
    DesktopOperationFailureError: class extends Error { constructor(value: { summary: string }) { super(value.summary); } },
    desktopOperationFailurePresentation: (value: unknown) => value,
    desktopFailureFromError: () => ({ code: 'environment_open_failed', summary: 'Open failed' }),
    openConnectionFailureNextActions: () => [], runtimeOpenFailureRecoveryActions: () => ({}),
    desktopUpdateHandoffAvailable: () => false, scheduleLauncherOperationRemoval: vi.fn(),
    launcherActionFailureFromSessionOpenError: () => ({ ok: false }), compact: (value: unknown) => String(value).trim(),
    runtimeLifecycleFingerprint: () => 'open',
    runtimeLifecycleCoordinator: { runOpen: ({ execute }: { execute: () => Promise<unknown> }) => execute(), active: () => null },
    runEnvironmentRuntimeLifecycleFromLauncher: lifecycle,
  };
  context.runtimeBridgeStartCanRecover = boundary('runtimeBridgeStartCanRecover', context);
  const open = boundary('openRuntimePlacementBridgeFromLauncher', context) as (input: object) => Promise<unknown>;
  return { open: () => open({ kind: 'open_ssh_environment' }), refresh, acquire, lifecycle, finish };
}

describe('production Runtime Open continuity boundary', () => {
  it('dials a known placement before refreshing stale management observations', async () => {
    const f = fixture(true, new Error('bridge handshake unavailable'));
    expect(await f.open()).toMatchObject({ ok: false });
    expect(f.acquire).toHaveBeenCalledOnce();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.lifecycle).not.toHaveBeenCalled();
    expect(f.finish).toHaveBeenCalledWith('ssh:devbox:open', 'failed', expect.any(Object));
  });

  it.each([new DesktopSSHTransportUnavailableError('Network down'), new DesktopSSHTransportAuthenticationError('Access denied')])(
    'never turns %s into Runtime restart', async error => {
      const f = fixture(true, error);
      expect(await f.open()).toMatchObject({ ok: false });
      expect(f.lifecycle).not.toHaveBeenCalled();
      expect(f.acquire).toHaveBeenCalledTimes(error instanceof DesktopSSHTransportAuthenticationError ? 1 : 4);
    },
  );

  it('does not start a Runtime when management observation is unknown', async () => {
    const f = fixture(false, new Error('must not dial'));
    expect(await f.open()).toMatchObject({ ok: false });
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.lifecycle).not.toHaveBeenCalled();
  });
});
