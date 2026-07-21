// @vitest-environment jsdom

import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const protocolState = vi.hoisted(() => ({
  client: (() => null) as () => object | null,
  setClient: (() => undefined) as (client: object | null) => void,
  status: (() => 'connected') as () => string,
  setStatus: (() => undefined) as (status: string) => void,
}));
const envState = vi.hoisted(() => ({
  value: (() => ({ permissions: { can_write: true, can_execute: true } })) as () => any,
  setValue: (() => undefined) as (value: any) => void,
  id: (() => 'env-1') as () => string,
  setId: (() => undefined) as (value: string) => void,
}));
const rpcState = vi.hoisted(() => ({
  sessions: [{ id: 's1', name: 'Terminal 1', workingDir: '/', createdAtMs: 1, lastActiveAtMs: 2, isActive: true }],
  list: vi.fn(),
  onSessionsChanged: vi.fn(),
  lifecycleHandler: null as ((event: any) => void) | null,
  onForegroundCommandUpdate: vi.fn(),
  foregroundSubscriptionAvailable: true,
  commandHandler: null as ((event: any) => void) | null,
  onOutputActivityUpdate: vi.fn(),
  outputSubscriptionAvailable: true,
  outputActivityHandler: null as ((event: any) => void) | null,
}));

class FakeCoordinator {
  readonly transport: any;
  private snapshot: any[] = [];
  private listeners = new Set<(snapshot: any[]) => void>();
  private inFlight: { revision: number; promise: Promise<void> } | null = null;
  private mutationRevision = 0;

  constructor(options: any) {
    this.transport = options.transport;
  }

  subscribe(listener: (snapshot: any[]) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot() { return this.snapshot; }

  refresh() {
    const requestRevision = this.mutationRevision;
    if (this.inFlight?.revision === requestRevision) return this.inFlight.promise;
    const request = {
      revision: requestRevision,
      promise: Promise.resolve() as Promise<void>,
    };
    request.promise = this.transport.listSessions().then((response: any) => {
      if (this.mutationRevision !== requestRevision) return;
      this.snapshot = Array.isArray(response) ? response : (response.sessions ?? []);
      for (const listener of this.listeners) listener(this.snapshot);
    }).finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });
    this.inFlight = request;
    return request.promise;
  }

  upsertSession(session: any) {
    this.mutationRevision += 1;
    this.snapshot = [...this.snapshot.filter((entry) => entry.id !== session.id), session];
    for (const listener of this.listeners) listener(this.snapshot);
  }

  removeSession(id: string) {
    this.mutationRevision += 1;
    this.snapshot = this.snapshot.filter((entry) => entry.id !== id);
    for (const listener of this.listeners) listener(this.snapshot);
  }

  updateSessionMeta(id: string, patch: any) {
    const existing = this.snapshot.find((entry) => entry.id === id);
    if (existing) this.upsertSession({ ...existing, ...patch, id });
  }

  dispose() {
    this.listeners.clear();
  }
}

const coordinatorState = vi.hoisted(() => ({ current: null as FakeCoordinator | null }));

vi.mock('@floegence/floeterm-terminal-web/history', () => ({
  preparePagedTerminalHistory: vi.fn(),
}));
vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ client: protocolState.client, status: protocolState.status }),
  ProtocolNotConnectedError: class extends Error {},
  RpcError: class extends Error {},
}));
vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
}));
vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({ terminal: {
    listSessions: rpcState.list,
    onSessionsChanged: rpcState.onSessionsChanged,
    onForegroundCommandUpdate: rpcState.foregroundSubscriptionAvailable ? rpcState.onForegroundCommandUpdate : undefined,
    onOutputActivityUpdate: rpcState.outputSubscriptionAvailable ? rpcState.onOutputActivityUpdate : undefined,
    createSession: vi.fn(),
    deleteSession: vi.fn(),
  } }),
}));
vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    env_id: envState.id,
    env: Object.assign(envState.value, { state: 'ready' }),
  }),
}));
vi.mock('./terminalSessions', () => ({
  createRedevenTerminalSessionsCoordinator: vi.fn((options: any) => {
    coordinatorState.current = new FakeCoordinator(options);
    return coordinatorState.current;
  }),
  refreshRedevenTerminalSessionsCoordinator: vi.fn(),
}));
vi.mock('../pages/EnvTerminalPage', () => ({ EnvTerminalPage: () => null }));
vi.mock('../widgets/TerminalPanel', () => ({ TerminalPanel: () => null }));

import {
  TerminalSessionCatalogProvider,
  terminalHistoryWarmupPerformanceStage,
  useTerminalSessionCatalog,
} from './terminalSessionCatalog';

function Consumer(props: { onValue: (value: ReturnType<typeof useTerminalSessionCatalog>) => void }) {
  const catalog = useTerminalSessionCatalog();
  createEffect(() => props.onValue(catalog));
  return null;
}

describe('TerminalSessionCatalogProvider', () => {
  beforeEach(() => {
    const [client, setClient] = createSignal<object | null>({ id: 'client-1' });
    const [status, setStatus] = createSignal('connected');
    const [envValue, setEnvValue] = createSignal<any>({ permissions: { can_write: true, can_execute: true } });
    const [envId, setEnvId] = createSignal('env-1');
    protocolState.client = client;
    protocolState.setClient = setClient;
    protocolState.status = status;
    protocolState.setStatus = setStatus;
    envState.value = envValue;
    envState.setValue = setEnvValue;
    envState.id = envId;
    envState.setId = setEnvId;
    rpcState.sessions = [{ id: 's1', name: 'Terminal 1', workingDir: '/', createdAtMs: 1, lastActiveAtMs: 2, isActive: true }];
    rpcState.list.mockReset();
    rpcState.list.mockResolvedValue({ sessions: rpcState.sessions });
    rpcState.onSessionsChanged.mockReset();
    rpcState.onSessionsChanged.mockImplementation((handler: (event: any) => void) => {
      rpcState.lifecycleHandler = handler;
      return () => { rpcState.lifecycleHandler = null; };
    });
    rpcState.onForegroundCommandUpdate.mockReset();
    rpcState.foregroundSubscriptionAvailable = true;
    rpcState.onForegroundCommandUpdate.mockImplementation((handler: (event: any) => void) => {
      rpcState.commandHandler = handler;
      return () => { rpcState.commandHandler = null; };
    });
    rpcState.onOutputActivityUpdate.mockReset();
    rpcState.outputSubscriptionAvailable = true;
    rpcState.onOutputActivityUpdate.mockImplementation((handler: (event: any) => void) => {
      rpcState.outputActivityHandler = handler;
      return () => { rpcState.outputActivityHandler = null; };
    });
    coordinatorState.current = null;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hydrates the catalog before a terminal panel mounts and shares one list request', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions().map((session: any) => session.id)).toEqual(['s1']);
    expect(rpcState.list).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('falls back to authoritative refresh when optional metadata subscriptions are unavailable', async () => {
    rpcState.foregroundSubscriptionAvailable = false;
    rpcState.outputSubscriptionAvailable = false;
    let latest: any = null;
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);

    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()).toHaveLength(1);
    expect(rpcState.onForegroundCommandUpdate).not.toHaveBeenCalled();
    expect(rpcState.onOutputActivityUpdate).not.toHaveBeenCalled();

    rpcState.sessions = [{ ...rpcState.sessions[0], name: 'Refreshed terminal' }];
    rpcState.list.mockImplementation(async () => ({ sessions: rpcState.sessions }));
    await latest.refresh();
    expect(latest.sessions()[0]?.name).toBe('Refreshed terminal');
  });

  it('clears immediately when process permission is revoked and preserves stale data across disconnect', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    protocolState.setStatus('connecting');
    protocolState.setClient(null);
    await vi.waitFor(() => expect(latest.stale()).toBe(true));
    expect(latest.sessions()).toHaveLength(1);
    envState.setValue({ permissions: { can_write: false, can_execute: true } });
    protocolState.setStatus('connected');
    protocolState.setClient({ id: 'client-2' });
    await vi.waitFor(() => expect(latest.sessions()).toHaveLength(0));
    dispose();
  });

  it('publishes a server-side process permission denial before the Env permission resource catches up', async () => {
    rpcState.list.mockRejectedValueOnce(new Error('process permission denied'));
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalled());
    await vi.waitFor(() => expect(latest?.loading()).toBe(false));
    expect({
      permissionDenied: latest?.permissionDenied(),
      hydrated: latest?.hydrated(),
      sessions: latest?.sessions().length,
      error: latest?.error(),
    }).toEqual({
      permissionDenied: true,
      hydrated: false,
      sessions: 0,
      error: null,
    });
    expect(rpcState.list).toHaveBeenCalledTimes(1);

    envState.setValue({ permissions: { can_write: true, can_execute: true } });
    await vi.waitFor(() => expect(latest.hydrated()).toBe(true));
    expect(latest.permissionDenied()).toBe(false);
    expect(latest.sessions().map((session: any) => session.id)).toEqual(['s1']);
    expect(rpcState.list).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('upserts create responses synchronously and removes lifecycle-deleted sessions', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    latest.upsertSession({ id: 's2', name: 'New', workingDir: '/', createdAtMs: 3, lastActiveAtMs: 3, isActive: true });
    expect(latest.sessions().map((session: any) => session.id)).toContain('s2');
    rpcState.lifecycleHandler?.({ reason: 'deleted', sessionId: 's2' });
    expect(latest.sessions().map((session: any) => session.id)).not.toContain('s2');
    dispose();
  });

  it('applies command notifications globally before any terminal panel mounts', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    rpcState.commandHandler?.({
      sessionId: 's1',
      foregroundCommand: { phase: 'running', displayName: 'top', revision: 1, updatedAtMs: 10 },
    });

    await vi.waitFor(() => expect(latest.sessions()[0]?.foregroundCommand).toEqual({
      phase: 'running', displayName: 'top', revision: 1, updatedAtMs: 10,
    }));
    dispose();
  });

  it('retains an early command notification across a stale initial snapshot', async () => {
    let resolveList!: (value: any) => void;
    rpcState.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onForegroundCommandUpdate).toHaveBeenCalled());

    rpcState.commandHandler?.({
      sessionId: 's1',
      foregroundCommand: { phase: 'running', displayName: 'sleep', revision: 3, updatedAtMs: 30 },
    });
    resolveList({ sessions: [{
      ...rpcState.sessions[0],
      foregroundCommand: { phase: 'idle', displayName: '', revision: 2, updatedAtMs: 20 },
    }] });

    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()[0]?.foregroundCommand).toEqual({
      phase: 'running', displayName: 'sleep', revision: 3, updatedAtMs: 30,
    });
    dispose();
  });

  it('applies only newer output activity revisions for a hydrated session', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    rpcState.outputActivityHandler?.({
      sessionId: 's1',
      outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 30 },
    });
    rpcState.outputActivityHandler?.({
      sessionId: 's1',
      outputActivity: { phase: 'settled', revision: 2, updatedAtMs: 20 },
    });

    await vi.waitFor(() => expect(latest.sessions()[0]?.outputActivity).toEqual({
      phase: 'streaming', revision: 3, updatedAtMs: 30,
    }));
    dispose();
  });

  it('retains an early output activity notification across a stale initial snapshot', async () => {
    let resolveList!: (value: any) => void;
    rpcState.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onOutputActivityUpdate).toHaveBeenCalled());

    rpcState.outputActivityHandler?.({
      sessionId: 's1',
      outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 30 },
    });
    resolveList({ sessions: [{
      ...rpcState.sessions[0],
      outputActivity: { phase: 'settled', revision: 2, updatedAtMs: 20 },
    }] });

    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()[0]?.outputActivity).toEqual({
      phase: 'streaming', revision: 3, updatedAtMs: 30,
    });
    dispose();
  });

  it('converges missed output activity updates through an authoritative refresh', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    rpcState.list.mockResolvedValueOnce({ sessions: [{
      ...rpcState.sessions[0],
      outputActivity: { phase: 'settled', revision: 7, updatedAtMs: 70 },
    }] });
    await latest.refresh();

    expect(latest.sessions()[0]?.outputActivity).toEqual({
      phase: 'settled', revision: 7, updatedAtMs: 70,
    });
    dispose();
  });

  it('does not let an older refresh response overwrite a newer output activity notification', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    rpcState.outputActivityHandler?.({
      sessionId: 's1',
      outputActivity: { phase: 'streaming', revision: 8, updatedAtMs: 80 },
    });
    rpcState.list.mockResolvedValueOnce({ sessions: [{
      ...rpcState.sessions[0],
      outputActivity: { phase: 'settled', revision: 7, updatedAtMs: 70 },
    }] });
    await latest.refresh();

    expect(latest.sessions()[0]?.outputActivity).toEqual({
      phase: 'streaming', revision: 8, updatedAtMs: 80,
    });
    expect(coordinatorState.current?.getSnapshot()[0]?.outputActivity).toEqual({
      phase: 'streaming', revision: 8, updatedAtMs: 80,
    });
    dispose();
  });

  it('drops output activity pending state on delete and disconnect', async () => {
    let resolveList!: (value: any) => void;
    rpcState.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onOutputActivityUpdate).toHaveBeenCalled());

    rpcState.outputActivityHandler?.({
      sessionId: 's1',
      outputActivity: { phase: 'streaming', revision: 8, updatedAtMs: 80 },
    });
    rpcState.lifecycleHandler?.({ reason: 'deleted', sessionId: 's1' });
    resolveList({ sessions: [{
      ...rpcState.sessions[0],
      outputActivity: { phase: 'settled', revision: 7, updatedAtMs: 70 },
    }] });
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()).toHaveLength(0);

    protocolState.setStatus('connecting');
    protocolState.setClient(null);
    await vi.waitFor(() => expect(rpcState.outputActivityHandler).toBeNull());
    dispose();
  });

  it('reconciles output activity truth when the bounded early-notification buffer overflows', async () => {
    const sessionCount = 513;
    const staleSessions = Array.from({ length: sessionCount }, (_, index) => ({
      id: `output-session-${index}`,
      name: `Terminal ${index}`,
      workingDir: '/',
      createdAtMs: index + 1,
      lastActiveAtMs: index + 1,
      isActive: index === 0,
      outputActivity: { phase: 'unknown', revision: 2, updatedAtMs: 20 },
    }));
    const authoritativeSessions = staleSessions.map((session, index) => index === 0 ? {
      ...session,
      outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 30 },
    } : session);
    let resolveInitialList!: (value: any) => void;
    let resolveReconcile!: (value: any) => void;
    rpcState.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitialList = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReconcile = resolve; }));

    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onOutputActivityUpdate).toHaveBeenCalled());

    for (let index = 0; index < sessionCount; index += 1) {
      rpcState.outputActivityHandler?.({
        sessionId: `output-session-${index}`,
        outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 30 },
      });
    }
    resolveInitialList({ sessions: staleSessions });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    resolveReconcile({ sessions: authoritativeSessions });
    await vi.waitFor(() => expect(latest?.sessions()[0]?.outputActivity).toEqual({
      phase: 'streaming', revision: 3, updatedAtMs: 30,
    }));
    dispose();
  });

  it('retries overflow reconciliation after a transient authoritative refresh failure', async () => {
    const sessionCount = 513;
    const staleSessions = Array.from({ length: sessionCount }, (_, index) => ({
      id: `retry-output-session-${index}`,
      name: `Terminal ${index}`,
      workingDir: '/',
      createdAtMs: index + 1,
      lastActiveAtMs: index + 1,
      isActive: index === 0,
      outputActivity: { phase: 'unknown', revision: 2, updatedAtMs: 20 },
    }));
    const authoritativeSessions = staleSessions.map((session, index) => index === 0 ? {
      ...session,
      outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 30 },
    } : session);
    let resolveInitialList!: (value: any) => void;
    rpcState.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitialList = resolve; }))
      .mockRejectedValueOnce(new Error('temporary catalog failure'))
      .mockResolvedValueOnce({ sessions: authoritativeSessions });

    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onOutputActivityUpdate).toHaveBeenCalled());

    for (let index = 0; index < sessionCount; index += 1) {
      rpcState.outputActivityHandler?.({
        sessionId: `retry-output-session-${index}`,
        outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 30 },
      });
    }
    resolveInitialList({ sessions: staleSessions });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(latest?.sessions()[0]?.outputActivity).toEqual({
      phase: 'streaming', revision: 3, updatedAtMs: 30,
    }));
    dispose();
  });

  it('reconciles command truth when the bounded early-notification buffer overflows', async () => {
    const sessionCount = 513;
    const staleSessions = Array.from({ length: sessionCount }, (_, index) => ({
      id: `session-${index}`,
      name: `Terminal ${index}`,
      workingDir: '/',
      createdAtMs: index + 1,
      lastActiveAtMs: index + 1,
      isActive: index === 0,
      foregroundCommand: { phase: 'idle', displayName: '', revision: 2, updatedAtMs: 20 },
    }));
    const authoritativeSessions = staleSessions.map((session, index) => index === 0 ? {
      ...session,
      foregroundCommand: { phase: 'running', displayName: 'top', revision: 3, updatedAtMs: 30 },
    } : session);
    let resolveInitialList!: (value: any) => void;
    let resolveReconcile!: (value: any) => void;
    rpcState.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitialList = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReconcile = resolve; }));

    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onForegroundCommandUpdate).toHaveBeenCalled());

    for (let index = 0; index < sessionCount; index += 1) {
      rpcState.commandHandler?.({
        sessionId: `session-${index}`,
        foregroundCommand: {
          phase: 'running',
          displayName: index === 0 ? 'top' : 'sleep',
          revision: 3,
          updatedAtMs: 30,
        },
      });
    }
    resolveInitialList({ sessions: staleSessions });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    resolveReconcile({ sessions: authoritativeSessions });
    await vi.waitFor(() => expect(latest?.sessions()[0]?.foregroundCommand).toEqual({
      phase: 'running', displayName: 'top', revision: 3, updatedAtMs: 30,
    }));
    dispose();
  });

  it('reschedules overflow reconciliation for a new connection while the old refresh is still pending', async () => {
    const sessionCount = 513;
    const staleSessions = Array.from({ length: sessionCount }, (_, index) => ({
      id: `reconnected-${index}`,
      name: `Terminal ${index}`,
      workingDir: '/',
      createdAtMs: index + 1,
      lastActiveAtMs: index + 1,
      isActive: index === 0,
      foregroundCommand: { phase: 'idle', displayName: '', revision: 2, updatedAtMs: 20 },
    }));
    const authoritativeSessions = staleSessions.map((session, index) => index === 0 ? {
      ...session,
      foregroundCommand: { phase: 'running', displayName: 'top', revision: 3, updatedAtMs: 30 },
    } : session);
    let resolveOldList!: (value: any) => void;
    let resolveNewList!: (value: any) => void;
    let resolveNewReconcile!: (value: any) => void;
    rpcState.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldList = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewList = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewReconcile = resolve; }));

    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onForegroundCommandUpdate).toHaveBeenCalledTimes(1));
    for (let index = 0; index < sessionCount; index += 1) {
      rpcState.commandHandler?.({
        sessionId: `old-${index}`,
        foregroundCommand: { phase: 'running', displayName: 'sleep', revision: 1, updatedAtMs: 10 },
      });
    }

    protocolState.setStatus('connecting');
    protocolState.setClient(null);
    await vi.waitFor(() => expect(rpcState.commandHandler).toBeNull());
    protocolState.setStatus('connected');
    protocolState.setClient({ id: 'client-2' });
    await vi.waitFor(() => expect(rpcState.onForegroundCommandUpdate).toHaveBeenCalledTimes(2));
    for (let index = 0; index < sessionCount; index += 1) {
      rpcState.commandHandler?.({
        sessionId: `reconnected-${index}`,
        foregroundCommand: {
          phase: 'running',
          displayName: index === 0 ? 'top' : 'sleep',
          revision: 3,
          updatedAtMs: 30,
        },
      });
    }

    resolveNewList({ sessions: staleSessions });
    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(3));
    resolveNewReconcile({ sessions: authoritativeSessions });
    await vi.waitFor(() => expect(latest?.sessions()[0]?.foregroundCommand).toEqual({
      phase: 'running', displayName: 'top', revision: 3, updatedAtMs: 30,
    }));
    resolveOldList({ sessions: [] });
    dispose();
  });

  it('preserves local mutations while disconnected and seeds them into the reconnect coordinator', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    protocolState.setStatus('connecting');
    protocolState.setClient(null);
    await vi.waitFor(() => expect(latest.stale()).toBe(true));
    latest.upsertSession({ id: 's2', name: 'Pending reconnect', workingDir: '/tmp', createdAtMs: 2, lastActiveAtMs: 2, isActive: true });
    latest.removeSession('s1');
    latest.updateSessionMeta('s2', { name: 'Updated offline' });
    expect(latest.sessions().map((session: any) => [session.id, session.name])).toEqual([['s2', 'Updated offline']]);

    let resolveReconnect!: (value: any) => void;
    rpcState.list.mockImplementationOnce(() => new Promise((resolve) => { resolveReconnect = resolve; }));
    const previousCoordinator = coordinatorState.current;
    protocolState.setStatus('connected');
    protocolState.setClient({ id: 'client-2' });
    await vi.waitFor(() => expect(coordinatorState.current).not.toBe(previousCoordinator));
    expect(coordinatorState.current?.getSnapshot().map((session: any) => session.id)).toEqual(['s2']);
    expect(latest.sessions().map((session: any) => session.id)).toEqual(['s2']);

    resolveReconnect({ sessions: [{ id: 's2', name: 'Canonical', workingDir: '/tmp', createdAtMs: 2, lastActiveAtMs: 3, isActive: true }] });
    await vi.waitFor(() => expect(latest.sessions()[0]?.name).toBe('Canonical'));
    dispose();
  });

  it('ignores an older refresh failure after a newer mutation-aware refresh succeeds', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    let rejectOlder!: (reason: unknown) => void;
    let resolveNewer!: (value: any) => void;
    rpcState.list
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectOlder = reject;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));

    const older = latest.refresh();
    latest.upsertSession({ id: 's2', name: 'Local', workingDir: '/', createdAtMs: 2, lastActiveAtMs: 2, isActive: true });
    const newer = latest.refresh();
    resolveNewer({ sessions: [{ id: 's2', name: 'Canonical', workingDir: '/', createdAtMs: 2, lastActiveAtMs: 3, isActive: true }] });
    await newer;
    rejectOlder(new Error('old request failed'));
    await older;

    expect(latest.stale()).toBe(false);
    expect(latest.error()).toBeNull();
    expect(latest.sessions().map((session: any) => session.id)).toEqual(['s2']);
    dispose();
  });

  it('marks an already hydrated empty catalog stale when the connection drops', async () => {
    rpcState.list.mockResolvedValue({ sessions: [] });
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()).toHaveLength(0);

    protocolState.setStatus('connecting');
    protocolState.setClient(null);
    await vi.waitFor(() => expect(latest.stale()).toBe(true));
    dispose();
  });
});

describe('terminalHistoryWarmupPerformanceStage', () => {
  it.each([
    ['start', 'history-prefetch-start'],
    ['ready', 'history-prefetch-ready'],
    ['skipped', 'history-prefetch-skipped'],
    ['evicted', 'history-prefetch-evicted'],
    ['paused', 'warm-queue-paused'],
    ['complete', 'warm-queue-complete'],
  ] as const)('maps %s to %s', (event, stage) => {
    expect(terminalHistoryWarmupPerformanceStage(event)).toBe(stage);
  });
});
