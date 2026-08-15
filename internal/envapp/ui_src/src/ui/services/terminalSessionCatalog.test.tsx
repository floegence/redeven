// @vitest-environment jsdom

import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
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
  onExecutionContextUpdate: vi.fn(),
  contextSubscriptionAvailable: true,
  executionContextHandler: null as ((event: any) => void) | null,
  onWorkStateUpdate: vi.fn(),
  workSubscriptionAvailable: true,
  workStateHandler: null as ((event: any) => void) | null,
}));

class FakeCoordinator {
  readonly transport: any;
  private snapshot: any[] = [];
  private listeners = new Set<(snapshot: any[]) => void>();
  private inFlight: { revision: number; promise: Promise<void> } | null = null;
  private mutationRevision = 0;
  private metadataConflictKeys = new Set<string>();

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
    if (!existing) return;
    const next = { ...existing, ...patch, id };
    const currentContext = existing.executionContext;
    const incomingContext = patch.executionContext;
    if (currentContext && incomingContext && incomingContext.revision <= currentContext.revision) {
      if (incomingContext.revision === currentContext.revision
        && JSON.stringify(incomingContext) !== JSON.stringify(currentContext)) {
        this.scheduleMetadataConflictReconcile(`${id}:context:${incomingContext.revision}`);
        next.executionContext = {
          location: { kind: 'unknown', phase: 'unknown', label: '', authority: '', workingDirectory: '', source: 'unknown' },
          application: { kind: 'unknown', identity: '', displayName: '' },
          revision: currentContext.revision,
          updatedAtMs: currentContext.updatedAtMs,
        };
      } else {
        next.executionContext = currentContext;
      }
    }
    const currentWork = existing.workState;
    const incomingWork = patch.workState;
    const context = next.executionContext ?? existing.executionContext;
    const foreground = next.foregroundCommand ?? existing.foregroundCommand;
    const workMatchesFences = incomingWork
      && incomingWork.contextRevision === (context?.revision ?? 0)
      && incomingWork.foregroundCommandRevision === (foreground?.revision ?? 0);
    if (incomingWork && !workMatchesFences) {
      next.workState = currentWork;
    } else if (currentWork && incomingWork && incomingWork.revision <= currentWork.revision) {
      if (incomingWork.revision === currentWork.revision
        && JSON.stringify(incomingWork) !== JSON.stringify(currentWork)) {
        this.scheduleMetadataConflictReconcile(`${id}:work:${incomingWork.revision}`);
      }
      next.workState = currentWork;
    }
    this.upsertSession(next);
  }

  private scheduleMetadataConflictReconcile(key: string) {
    if (this.metadataConflictKeys.has(key)) return;
    this.metadataConflictKeys.add(key);
    queueMicrotask(() => { void this.refresh(); });
  }

  dispose() {
    this.listeners.clear();
  }
}

const coordinatorState = vi.hoisted(() => ({ current: null as FakeCoordinator | null }));
vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ session: protocolState.client, status: protocolState.status }),
  ProtocolNotConnectedError: class extends Error {},
  RpcError: class extends Error {},
}));
vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
}));
vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({ terminal: {
    listSessions: rpcState.list,
    onSessionsChanged: rpcState.onSessionsChanged,
    onForegroundCommandUpdate: rpcState.foregroundSubscriptionAvailable ? rpcState.onForegroundCommandUpdate : undefined,
    onOutputActivityUpdate: rpcState.outputSubscriptionAvailable ? rpcState.onOutputActivityUpdate : undefined,
    onExecutionContextUpdate: rpcState.contextSubscriptionAvailable ? rpcState.onExecutionContextUpdate : undefined,
    onWorkStateUpdate: rpcState.workSubscriptionAvailable ? rpcState.onWorkStateUpdate : undefined,
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
  useTerminalSessionCatalog,
} from './terminalSessionCatalog';
import { deriveTerminalSessionChrome } from './terminalSessionChrome';
import {
  createTerminalTabActivityTracker,
  observeTerminalSemanticWorkStates,
  shouldMarkTerminalSessionUnread,
  type TerminalTabVisualState,
} from './terminalTabActivity';
import {
  TerminalSessionNavigator,
  type TerminalSessionNavigationItem,
} from '../widgets/TerminalSessionNavigator';

function Consumer(props: { onValue: (value: ReturnType<typeof useTerminalSessionCatalog>) => void }) {
  const catalog = useTerminalSessionCatalog();
  createEffect(() => props.onValue(catalog));
  return null;
}

function SemanticAttentionNavigatorConsumer() {
  const catalog = useTerminalSessionCatalog();
  if (!catalog) throw new Error('terminal catalog provider is required');
  const [panelHasFocus, setPanelHasFocus] = createSignal(false);
  const [visualBySession, setVisualBySession] = createSignal<Readonly<Record<string, TerminalTabVisualState>>>({});
  const tracker = createTerminalTabActivityTracker({
    publishVisualState: (sessionId, state) => {
      setVisualBySession((current) => ({ ...current, [sessionId]: state }));
    },
  });
  onCleanup(() => tracker.dispose());

  const shouldMarkUnread = (sessionId: string) => shouldMarkTerminalSessionUnread({
    sessionExists: catalog.sessions().some((session) => session.id === sessionId),
    sessionId,
    activeSessionId: 's1',
    terminalFocusOwner: true,
    panelHasFocus: panelHasFocus(),
  });
  createEffect(() => {
    observeTerminalSemanticWorkStates(catalog.sessions(), tracker, shouldMarkUnread);
  });
  createEffect(() => {
    if (panelHasFocus()) tracker.clearUnread('s1');
  });

  const items = createMemo<TerminalSessionNavigationItem[]>(() => catalog.sessions().map((session) => {
    const chrome = deriveTerminalSessionChrome({
      session,
      directoryTitle: session.name,
      fallbackTitle: session.name,
      unread: visualBySession()[session.id] === 'unread',
    });
    return {
      id: session.id,
      label: session.name,
      title: chrome.title,
      avatarInitial: 'T',
      avatarTone: { background: '#111', border: '#222', foreground: '#fff' },
      avatar: chrome.avatar,
      subtitleIcon: chrome.subtitleIcon,
      subtitle: chrome.subtitle,
      fullPath: chrome.displayPath,
      localWorkingDir: chrome.localWorkingDir,
      transitionIndicator: 'none',
      processRunning: chrome.processRunning,
      transitionState: 'none',
      failureKind: 'none',
      outputState: chrome.status === 'wave' ? 'streaming' : 'none',
      activitySource: chrome.status === 'wave' && chrome.statusSource === 'semantic' ? 'semantic' : 'none',
      attentionState: chrome.attention,
      remote: chrome.remote,
      canBrowsePath: false,
      filesAvailability: 'invalid',
      canClear: true,
      canDuplicate: false,
      closable: true,
    };
  }));
  const itemById = createMemo(() => new Map(items().map((item) => [item.id, item])));

  return (
    <div
      data-testid="semantic-attention-consumer"
      data-hydrated={catalog.hydrated() ? 'true' : 'false'}
      data-error={catalog.error() ?? ''}
    >
      <button data-testid="terminal-reader" onFocus={() => setPanelHasFocus(true)}>Terminal reader</button>
      <TerminalSessionNavigator
        accessibilityIdPrefix="terminal-agent-unread"
        mobile={false}
        drawerOpen={false}
        connected
        refreshing={false}
        activeTitle={items()[0]?.title ?? ''}
        activeAvatar={items()[0]?.avatar ?? { kind: 'initial' }}
        shortcutModLabel="Ctrl"
        filterQuery=""
        itemIds={items().map((item) => item.id)}
        itemById={itemById()}
        sidebarActiveSessionId="s1"
        activeSessionId="s1"
        copiedPathSessionId={null}
        emptyListLoading={false}
        onCloseDrawer={() => undefined}
        onCreateSession={() => undefined}
        onRefresh={() => undefined}
        onFilterQueryChange={() => undefined}
        onPreviewSession={() => undefined}
        onResetSessionPreview={() => undefined}
        onSelectSession={() => undefined}
        onOpenKeyboardMenu={() => undefined}
        onOpenContextMenu={() => undefined}
        onCopyPath={() => undefined}
        onCloseSession={() => undefined}
        onOpenFiles={() => undefined}
      />
    </div>
  );
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
    rpcState.onExecutionContextUpdate.mockReset();
    rpcState.contextSubscriptionAvailable = true;
    rpcState.onExecutionContextUpdate.mockImplementation((handler: (event: any) => void) => {
      rpcState.executionContextHandler = handler;
      return () => { rpcState.executionContextHandler = null; };
    });
    rpcState.onWorkStateUpdate.mockReset();
    rpcState.workSubscriptionAvailable = true;
    rpcState.onWorkStateUpdate.mockImplementation((handler: (event: any) => void) => {
      rpcState.workStateHandler = handler;
      return () => { rpcState.workStateHandler = null; };
    });
    coordinatorState.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('projects semantic Agent completion into Navigator unread attention until terminal focus', async () => {
    rpcState.sessions = [{
      ...rpcState.sessions[0],
      foregroundCommand: { phase: 'running', displayName: 'codex', revision: 2, updatedAtMs: 20 },
      executionContext: {
        location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
        application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
        revision: 3,
        updatedAtMs: 30,
      },
      workState: {
        phase: 'idle', source: 'semantic', contextRevision: 3,
        foregroundCommandRevision: 2, revision: 4, updatedAtMs: 40,
      },
    }] as any;
    rpcState.list.mockResolvedValue({ sessions: rpcState.sessions });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <SemanticAttentionNavigatorConsumer />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect({
      hydrated: host.querySelector('[data-testid="semantic-attention-consumer"]')?.getAttribute('data-hydrated'),
      error: host.querySelector('[data-testid="semantic-attention-consumer"]')?.getAttribute('data-error'),
    }).toEqual({ hydrated: 'true', error: '' }));
    expect(host.querySelector('button[data-terminal-session-id="s1"]')).not.toBeNull();

    rpcState.workStateHandler?.({
      sessionId: 's1',
      workState: {
        phase: 'working', source: 'semantic', contextRevision: 3,
        foregroundCommandRevision: 2, revision: 5, updatedAtMs: 50,
      },
    });
    rpcState.workStateHandler?.({
      sessionId: 's1',
      workState: {
        phase: 'idle', source: 'semantic', contextRevision: 3,
        foregroundCommandRevision: 2, revision: 6, updatedAtMs: 60,
      },
    });
    await vi.waitFor(() => expect(host.querySelector('[data-terminal-attention-state="unread"]')).not.toBeNull());

    host.querySelector<HTMLButtonElement>('[data-testid="terminal-reader"]')?.focus();
    await vi.waitFor(() => expect(host.querySelector('[data-terminal-attention-state="unread"]')).toBeNull());
    dispose();
  });

  it('atomically replaces local path capabilities without deriving them from metadata', async () => {
    rpcState.sessions = [{
      id: 's1',
      name: 'Terminal 1',
      workingDir: '/',
      localPathCapability: { workingDir: '/' },
      createdAtMs: 1,
      lastActiveAtMs: 2,
      isActive: true,
    }] as any;
    rpcState.list.mockResolvedValue({ sessions: rpcState.sessions });
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()[0]?.localPathCapability).toEqual({ workingDir: '/' });

    latest.updateSessionMeta('s1', {
      workingDir: '/workspace/repo',
      localPathCapability: { workingDir: '/workspace/repo' },
    });
    expect(latest.sessions()[0]).toMatchObject({
      workingDir: '/workspace/repo',
      localPathCapability: { workingDir: '/workspace/repo' },
    });

    latest.updateSessionMeta('s1', { name: 'Renamed' });
    expect(latest.sessions()[0]?.localPathCapability).toEqual({ workingDir: '/workspace/repo' });

    latest.updateSessionMeta('s1', {
      workingDir: '/root/remote',
      localPathCapability: null,
    });
    expect(latest.sessions()[0]?.workingDir).toBe('/root/remote');
    expect(latest.sessions()[0]?.localPathCapability).toBeUndefined();

    latest.updateSessionMeta('s1', { workingDir: '/workspace/forged' });
    expect(latest.sessions()[0]?.localPathCapability).toBeUndefined();

    rpcState.list.mockResolvedValueOnce({ sessions: [{
      ...rpcState.sessions[0],
      workingDir: '/workspace/authoritative',
      localPathCapability: { workingDir: '/workspace/authoritative' },
      lastActiveAtMs: 3,
    }] });
    await latest.refresh();
    expect(latest.sessions()[0]?.localPathCapability).toEqual({
      workingDir: '/workspace/authoritative',
    });
    dispose();
  });

  it('falls back to authoritative refresh when optional metadata subscriptions are unavailable', async () => {
    rpcState.foregroundSubscriptionAvailable = false;
    rpcState.outputSubscriptionAvailable = false;
    rpcState.contextSubscriptionAvailable = false;
    rpcState.workSubscriptionAvailable = false;
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
    expect(rpcState.onExecutionContextUpdate).not.toHaveBeenCalled();
    expect(rpcState.onWorkStateUpdate).not.toHaveBeenCalled();

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

  it('retains early context and work truth across stale snapshots and ignores older revisions', async () => {
    let resolveList!: (value: any) => void;
    rpcState.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onWorkStateUpdate).toHaveBeenCalled());

    const remoteContext = {
      location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root/project', source: 'osc7' },
      application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
      revision: 3,
      updatedAtMs: 30,
    };
    const workingState = {
      phase: 'working', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 40,
    };
    rpcState.executionContextHandler?.({ sessionId: 's1', executionContext: remoteContext });
    rpcState.workStateHandler?.({ sessionId: 's1', workState: workingState });
    resolveList({ sessions: [{
      ...rpcState.sessions[0],
      foregroundCommand: { phase: 'running', displayName: 'codex', revision: 2, updatedAtMs: 20 },
      executionContext: {
        location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 2,
        updatedAtMs: 20,
      },
      workState: { phase: 'idle', source: 'semantic', contextRevision: 2, foregroundCommandRevision: 2, revision: 3, updatedAtMs: 20 },
    }] });

    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.sessions()[0]?.executionContext).toEqual(remoteContext);
    expect(latest.sessions()[0]?.workState).toEqual(workingState);

    rpcState.executionContextHandler?.({
      sessionId: 's1',
      executionContext: { ...remoteContext, revision: 2, updatedAtMs: 50 },
    });
    rpcState.workStateHandler?.({
      sessionId: 's1',
      workState: { ...workingState, phase: 'idle', revision: 3, updatedAtMs: 50 },
    });
    expect(latest.sessions()[0]?.executionContext).toEqual(remoteContext);
    expect(latest.sessions()[0]?.workState).toEqual(workingState);
    dispose();
  });

  it('fails closed during an equal-revision context conflict and accepts the authoritative value', async () => {
    const localSession = {
      ...rpcState.sessions[0],
      foregroundCommand: { phase: 'running', displayName: 'ssh', revision: 2, updatedAtMs: 20 },
      executionContext: {
        location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 3,
        updatedAtMs: 30,
      },
      workState: { phase: 'idle', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 40 },
    };
    const authoritativeSession = {
      ...localSession,
      executionContext: {
        location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' },
        application: { kind: 'shell', identity: '', displayName: '' },
        revision: 3,
        updatedAtMs: 31,
      },
    };
    rpcState.list.mockReset();
    rpcState.list
      .mockResolvedValueOnce({ sessions: [localSession] })
      .mockResolvedValueOnce({ sessions: [authoritativeSession] });
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    rpcState.executionContextHandler?.({
      sessionId: 's1',
      executionContext: authoritativeSession.executionContext,
    });
    expect(latest.sessions()[0]?.executionContext).toMatchObject({
      location: { kind: 'unknown', phase: 'unknown' },
      revision: 3,
    });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    expect(latest.sessions()[0]?.executionContext).toEqual(authoritativeSession.executionContext);
    dispose();
  });

  it('retains the first equal-revision early metadata and reconciles conflicting content once', async () => {
    const localContext = {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 30,
    };
    const remoteConflict = {
      location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 31,
    };
    const idleWork = {
      phase: 'idle', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 40,
    };
    const workingConflict = {
      phase: 'working', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 41,
    };
    const authoritativeSession = {
      ...rpcState.sessions[0],
      localPathCapability: { workingDir: '/' },
      foregroundCommand: { phase: 'running', displayName: 'codex', revision: 2, updatedAtMs: 20 },
      executionContext: localContext,
      workState: idleWork,
    };
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
    await vi.waitFor(() => expect(rpcState.onExecutionContextUpdate).toHaveBeenCalled());
    await vi.waitFor(() => expect(rpcState.onWorkStateUpdate).toHaveBeenCalled());

    rpcState.executionContextHandler?.({ sessionId: 's1', executionContext: localContext });
    rpcState.executionContextHandler?.({ sessionId: 's1', executionContext: remoteConflict });
    rpcState.executionContextHandler?.({ sessionId: 's1', executionContext: remoteConflict });
    rpcState.workStateHandler?.({ sessionId: 's1', workState: idleWork });
    rpcState.workStateHandler?.({ sessionId: 's1', workState: workingConflict });
    rpcState.workStateHandler?.({ sessionId: 's1', workState: workingConflict });

    resolveInitialList({ sessions: [{ ...authoritativeSession, executionContext: { ...localContext, revision: 2 } }] });
    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    expect(latest.sessions()[0]?.executionContext).toEqual({
      location: {
        kind: 'unknown', phase: 'unknown', label: '', authority: '', workingDirectory: '', source: 'unknown',
      },
      application: { kind: 'unknown', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 30,
    });
    expect(deriveTerminalSessionChrome({
      session: latest.sessions()[0],
      directoryTitle: 'workspace',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(false);
    resolveReconcile({ sessions: [authoritativeSession] });
    await vi.waitFor(() => {
      expect(latest.sessions()[0]?.executionContext).toEqual(localContext);
      expect(latest.sessions()[0]?.workState).toEqual(idleWork);
    });
    expect(deriveTerminalSessionChrome({
      session: latest.sessions()[0],
      directoryTitle: 'workspace',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(true);
    expect(rpcState.list).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('preserves newer conflict masks while an older reconcile completes and the next retry fails', async () => {
    const sessionOneLocalContext = {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 30,
    };
    const sessionOneRemoteConflict = {
      location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 31,
    };
    const sessionTwoLocalContext = {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/workspace/two', source: 'shell_integration' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 5,
      updatedAtMs: 50,
    };
    const sessionTwoRemoteConflict = {
      location: { kind: 'remote', phase: 'ready', label: 'root@two', authority: 'two', workingDirectory: '/root/two', source: 'osc7' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 5,
      updatedAtMs: 51,
    };
    const sessionOne = {
      ...rpcState.sessions[0],
      localPathCapability: { workingDir: '/' },
      executionContext: sessionOneLocalContext,
    };
    const sessionTwo = {
      id: 's2',
      name: 'Terminal 2',
      workingDir: '/workspace/two',
      createdAtMs: 2,
      lastActiveAtMs: 2,
      isActive: false,
      localPathCapability: { workingDir: '/workspace/two' },
      executionContext: sessionTwoLocalContext,
    };
    let resolveInitialList!: (value: any) => void;
    let resolveFirstReconcile!: (value: any) => void;
    let resolveRetry!: (value: any) => void;
    rpcState.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitialList = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstReconcile = resolve; }))
      .mockRejectedValueOnce(new Error('newer reconcile failed'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));

    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(rpcState.onExecutionContextUpdate).toHaveBeenCalled());

    rpcState.executionContextHandler?.({ sessionId: 's1', executionContext: sessionOneLocalContext });
    rpcState.executionContextHandler?.({ sessionId: 's1', executionContext: sessionOneRemoteConflict });
    resolveInitialList({
      sessions: [{ ...sessionOne, executionContext: { ...sessionOneLocalContext, revision: 2 } }],
    });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    rpcState.executionContextHandler?.({ sessionId: 's2', executionContext: sessionTwoLocalContext });
    rpcState.executionContextHandler?.({ sessionId: 's2', executionContext: sessionTwoRemoteConflict });
    resolveFirstReconcile({
      sessions: [sessionOne, { ...sessionTwo, executionContext: { ...sessionTwoLocalContext, revision: 4 } }],
    });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(3));
    const conflictedSession = () => latest.sessions().find((session: any) => session.id === 's2');
    expect(conflictedSession()?.executionContext?.location.kind).toBe('unknown');
    expect(deriveTerminalSessionChrome({
      session: conflictedSession(),
      directoryTitle: 'two',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(false);

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(4));
    expect(conflictedSession()?.executionContext?.location.kind).toBe('unknown');
    expect(deriveTerminalSessionChrome({
      session: conflictedSession(),
      directoryTitle: 'two',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(false);

    resolveRetry({ sessions: [sessionOne, sessionTwo] });
    await vi.waitFor(() => expect(deriveTerminalSessionChrome({
      session: conflictedSession(),
      directoryTitle: 'two',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(true));
    dispose();
  });

  it('keeps path authority fail closed when the bounded conflict-key buffer overflows', async () => {
    const sessionCount = 513;
    const localContext = {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 30,
    };
    const remoteConflict = {
      location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 31,
    };
    const authoritativeSessions = Array.from({ length: sessionCount }, (_, index) => ({
      id: `conflict-session-${index}`,
      name: `Terminal ${index}`,
      workingDir: '/',
      createdAtMs: index + 1,
      lastActiveAtMs: index + 1,
      isActive: index === 0,
      localPathCapability: { workingDir: '/' },
      executionContext: localContext,
    }));
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
    await vi.waitFor(() => expect(rpcState.onExecutionContextUpdate).toHaveBeenCalled());

    for (const session of authoritativeSessions) {
      rpcState.executionContextHandler?.({ sessionId: session.id, executionContext: localContext });
      rpcState.executionContextHandler?.({ sessionId: session.id, executionContext: remoteConflict });
    }
    resolveInitialList({ sessions: authoritativeSessions });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    const overflowSession = () => latest.sessions().find(
      (session: any) => session.id === `conflict-session-${sessionCount - 1}`,
    );
    expect(overflowSession()?.executionContext?.location.kind).toBe('unknown');
    expect(deriveTerminalSessionChrome({
      session: overflowSession(),
      directoryTitle: 'workspace',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(false);

    resolveReconcile({ sessions: authoritativeSessions });
    await vi.waitFor(() => expect(deriveTerminalSessionChrome({
      session: overflowSession(),
      directoryTitle: 'workspace',
      fallbackTitle: 'Terminal',
    }).canUseLocalPath).toBe(true));
    dispose();
  });

  it('reconciles a fence-valid equal work conflict but ignores a fence-stale one', async () => {
    const authoritativeSession = {
      ...rpcState.sessions[0],
      foregroundCommand: { phase: 'running', displayName: 'codex', revision: 2, updatedAtMs: 20 },
      executionContext: {
        location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
        application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
        revision: 3,
        updatedAtMs: 30,
      },
      workState: { phase: 'idle', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 40 },
    };
    rpcState.list.mockReset();
    rpcState.list.mockResolvedValue({ sessions: [authoritativeSession] });
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));

    rpcState.workStateHandler?.({
      sessionId: 's1',
      workState: { phase: 'working', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 41 },
    });
    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    expect(latest.sessions()[0]?.workState).toEqual(authoritativeSession.workState);

    rpcState.workStateHandler?.({
      sessionId: 's1',
      workState: { phase: 'waiting_user', source: 'semantic', contextRevision: 2, foregroundCommandRevision: 2, revision: 4, updatedAtMs: 42 },
    });
    await Promise.resolve();
    expect(rpcState.list).toHaveBeenCalledTimes(2);
    expect(latest.sessions()[0]?.workState).toEqual(authoritativeSession.workState);
    dispose();
  });

  it('anchors remote opening animation to one shared continuous epoch', async () => {
    let nowMs = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const openingContext = {
      location: { kind: 'remote', phase: 'opening', label: 'SSH', authority: '', workingDirectory: '', source: 'foreground_candidate' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 1,
      updatedAtMs: 10,
    };
    rpcState.list.mockReset();
    rpcState.list.mockResolvedValue({ sessions: [{ ...rpcState.sessions[0], executionContext: openingContext }] });
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(latest.remoteOpeningObservedAtMs('s1')).toBe(1_000);

    nowMs = 1_500;
    rpcState.executionContextHandler?.({
      sessionId: 's1',
      executionContext: { ...openingContext, revision: 2, updatedAtMs: 20 },
    });
    expect(latest.remoteOpeningObservedAtMs('s1')).toBe(1_000);

    rpcState.executionContextHandler?.({
      sessionId: 's1',
      executionContext: {
        ...openingContext,
        location: { ...openingContext.location, phase: 'ready', authority: 'host', label: 'root@host' },
        revision: 3,
        updatedAtMs: 30,
      },
    });
    expect(latest.remoteOpeningObservedAtMs('s1')).toBeUndefined();

    nowMs = 2_000;
    rpcState.executionContextHandler?.({
      sessionId: 's1',
      executionContext: { ...openingContext, revision: 4, updatedAtMs: 40 },
    });
    expect(latest.remoteOpeningObservedAtMs('s1')).toBe(2_000);
    nowSpy.mockRestore();
    dispose();
  });

  it('disposes context and work subscriptions across reconnects', async () => {
    let latest: any = null;
    const host = document.createElement('div');
    const dispose = render(() => (
      <TerminalSessionCatalogProvider>
        <Consumer onValue={(value) => { latest = value; }} />
      </TerminalSessionCatalogProvider>
    ), host);
    await vi.waitFor(() => expect(latest?.hydrated()).toBe(true));
    expect(rpcState.executionContextHandler).not.toBeNull();
    expect(rpcState.workStateHandler).not.toBeNull();

    protocolState.setStatus('connecting');
    protocolState.setClient(null);
    await vi.waitFor(() => expect(rpcState.executionContextHandler).toBeNull());
    expect(rpcState.workStateHandler).toBeNull();

    protocolState.setStatus('connected');
    protocolState.setClient({ id: 'client-2' });
    await vi.waitFor(() => expect(rpcState.onExecutionContextUpdate).toHaveBeenCalledTimes(2));
    expect(rpcState.onWorkStateUpdate).toHaveBeenCalledTimes(2);
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

  it('reconciles execution context and work truth when the bounded early-notification buffer overflows', async () => {
    const sessionCount = 513;
    const localContext = {
      location: { kind: 'local', phase: 'ready', label: '', authority: '', workingDirectory: '/', source: 'shell_integration' },
      application: { kind: 'shell', identity: '', displayName: '' },
      revision: 2,
      updatedAtMs: 20,
    };
    const remoteContext = {
      location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' },
      application: { kind: 'agent_cli', identity: 'codex', displayName: 'Codex' },
      revision: 3,
      updatedAtMs: 30,
    };
    const staleWork = {
      phase: 'idle', source: 'semantic', contextRevision: 2, foregroundCommandRevision: 0, revision: 2, updatedAtMs: 20,
    };
    const authoritativeWork = {
      phase: 'waiting_user', source: 'semantic', contextRevision: 3, foregroundCommandRevision: 0, revision: 3, updatedAtMs: 30,
    };
    const staleSessions = Array.from({ length: sessionCount }, (_, index) => ({
      id: `context-session-${index}`,
      name: `Terminal ${index}`,
      workingDir: '/',
      createdAtMs: index + 1,
      lastActiveAtMs: index + 1,
      isActive: index === 0,
      executionContext: localContext,
      workState: staleWork,
    }));
    const authoritativeSessions = staleSessions.map((session, index) => index === 0 ? {
      ...session,
      executionContext: remoteContext,
      workState: authoritativeWork,
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
    await vi.waitFor(() => expect(rpcState.onExecutionContextUpdate).toHaveBeenCalled());
    await vi.waitFor(() => expect(rpcState.onWorkStateUpdate).toHaveBeenCalled());

    for (let index = 0; index < sessionCount; index += 1) {
      rpcState.executionContextHandler?.({
        sessionId: `context-session-${index}`,
        executionContext: remoteContext,
      });
      rpcState.workStateHandler?.({
        sessionId: `context-session-${index}`,
        workState: authoritativeWork,
      });
    }
    resolveInitialList({ sessions: staleSessions });

    await vi.waitFor(() => expect(rpcState.list).toHaveBeenCalledTimes(2));
    resolveReconcile({ sessions: authoritativeSessions });
    await vi.waitFor(() => {
      expect(latest?.sessions()[0]?.executionContext).toEqual(remoteContext);
      expect(latest?.sessions()[0]?.workState).toEqual(authoritativeWork);
    });
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
