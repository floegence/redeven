import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const protocolState = vi.hoisted(() => ({
  client: (() => null) as () => object | null,
  status: (() => 'connected') as () => string,
}));
const rpcState = vi.hoisted(() => ({
  sessions: [] as any[],
}));
const runtimeState = vi.hoisted(() => ({
  propsBySession: new Map<string, any>(),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ session: protocolState.client, status: protocolState.status }),
  ProtocolNotConnectedError: class extends Error {},
  RpcError: class extends Error {},
}));

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useCurrentWidgetId: () => null,
  useLayout: () => ({ isMobile: () => false }),
  useNotification: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
  useResolvedFloeConfig: () => ({
    persist: { load: (_key: string, fallback: unknown) => fallback, debouncedSave: vi.fn() },
  }),
  useTheme: () => ({ resolvedTheme: () => 'dark', shellPresetForMode: () => null }),
  useViewActivation: () => ({ id: 'terminal-continuity', active: () => true, activationSeq: () => 0 }),
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => {
    const env = Object.assign(
      () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
      { state: 'ready' },
    );
    return {
      env_id: () => 'env-1',
      env,
      viewMode: () => 'activity',
      setViewMode: vi.fn(),
      openDebugConsole: vi.fn(),
      openSettings: vi.fn(),
      openFileBrowserAtPath: vi.fn(async () => undefined),
      openFlowerTurnLauncher: vi.fn(),
    };
  },
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    terminal: {
      listSessions: vi.fn(async () => ({ sessions: rpcState.sessions })),
      listGroups: vi.fn(async () => ({
        groups: [{
          id: 'default',
          name: 'Default',
          defaultWorkingDir: '/',
          sortOrder: 0,
          createdAtMs: 1,
          updatedAtMs: 1,
          isDefault: true,
        }],
        revision: 1,
      })),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      onSessionsChanged: vi.fn(() => () => undefined),
      onGroupCatalogChanged: vi.fn(() => () => undefined),
      onForegroundCommandUpdate: vi.fn(() => () => undefined),
      onOutputActivityUpdate: vi.fn(() => () => undefined),
      onExecutionContextUpdate: vi.fn(() => () => undefined),
      onWorkStateUpdate: vi.fn(() => () => undefined),
    },
    fs: {
      getPathContext: vi.fn(async () => ({ agentHomePathAbs: '/Users/test' })),
      list: vi.fn(async () => ({ entries: [] })),
      readFile: vi.fn(async () => ({ content: '{}' })),
    },
  }),
}));

vi.mock('../services/terminalTransport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/terminalTransport')>(),
  createTerminalConnId: () => 'terminal-loading-continuity-browser',
  createRedevenTerminalLiveBundle: () => ({
    transport: {
      syncConnectionEpoch: vi.fn(),
      forgetSession: vi.fn(),
      dispose: vi.fn(),
    },
    eventSource: {},
  }),
}));

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    controller: {},
    openPreview: vi.fn(async () => undefined),
    closePreview: vi.fn(),
  }),
}));

vi.mock('./TerminalSessionRuntime', () => ({
  TerminalSessionRuntime: (props: any) => {
    runtimeState.propsBySession.set(props.session.id, props);
    return (
      <div
        data-terminal-runtime-session={props.session.id}
        data-terminal-runtime-parent-loading={
          props.initialLoadingCurtainOwnedByParent?.() ? 'true' : 'false'
        }
      >
        Terminal surface
      </div>
    );
  },
}));

import { TerminalSessionCatalogProvider } from '../services/terminalSessionCatalog';
import type { TerminalPanelSessionOperations } from './TerminalPanel';
import { TerminalPanel } from './TerminalPanel';

let disposeRendered: (() => void) | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createdSession(id = 'created-session') {
  return {
    id,
    groupId: 'default',
    name: 'Workspace',
    workingDir: '/workspace',
    createdAtMs: 10,
    lastActiveAtMs: 10,
    isActive: true,
  };
}

function visibleElements(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter((element) => (
    element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
  ));
}

function renderCreateFlow(createSession: TerminalPanelSessionOperations['createSession']) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: '960px', height: '640px' });
  document.body.append(host);
  disposeRendered = render(() => (
    <TerminalSessionCatalogProvider>
      <TerminalPanel
        variant="panel"
        openSessionRequest={{
          requestId: 'create-workspace-terminal',
          workingDir: '/workspace',
          preferredName: 'Workspace',
        }}
        sessionOperations={{ createSession, deleteSession: vi.fn(async () => undefined) }}
      />
    </TerminalSessionCatalogProvider>
  ), host);
  return host;
}

describe('TerminalPanel loading continuity', () => {
  beforeEach(() => {
    const [client] = createSignal<object | null>({ id: 'client-1' });
    const [status] = createSignal('connected');
    protocolState.client = client;
    protocolState.status = status;
    rpcState.sessions = [];
    runtimeState.propsBySession.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    disposeRendered?.();
    disposeRendered = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps one animated curtain node while only its text changes from creating to attaching', async () => {
    const create = deferred<ReturnType<typeof createdSession>>();
    const host = renderCreateFlow(vi.fn(() => create.promise));

    await vi.waitFor(() => expect(
      host.querySelector('[data-redeven-loading-curtain-stage="creating"]'),
    ).toBeTruthy());
    const curtain = host.querySelector('[data-redeven-loading-curtain-stage="creating"]') as HTMLElement;
    const transition = curtain.closest('[data-terminal-creation-transition]') as HTMLElement;
    const indicator = curtain.querySelector('.redeven-loading-curtain__indicator-bar') as HTMLElement;
    const message = curtain.querySelector('.redeven-loading-curtain__message') as HTMLElement;
    const creatingText = message.textContent;

    await new Promise((resolve) => setTimeout(resolve, 80));
    const animation = indicator.getAnimations()[0];
    expect(animation).toBeTruthy();
    const creatingAnimationTime = Number(animation.currentTime);

    create.resolve(createdSession());

    await vi.waitFor(() => expect(
      transition.querySelector('[data-redeven-loading-curtain-stage="attaching"]'),
    ).toBe(curtain));
    expect(transition.querySelector('.redeven-loading-curtain__indicator-bar')).toBe(indicator);
    expect(transition.querySelector('.redeven-loading-curtain__message')).toBe(message);
    expect(message.textContent).not.toBe(creatingText);
    expect(runtimeState.propsBySession.get('created-session')?.initialLoadingCurtainOwnedByParent?.()).toBe(true);
    expect(visibleElements(transition, '[role="status"]')).toHaveLength(1);
    expect(visibleElements(transition, '[role="progressbar"]')).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(indicator.getAnimations()[0]).toBe(animation);
    expect(Number(animation.currentTime)).toBeGreaterThan(creatingAnimationTime);

    runtimeState.propsBySession.get('created-session')?.onInteractive?.('created-session');
    await vi.waitFor(() => expect(transition.isConnected).toBe(false));
    expect(host.querySelector('[data-terminal-runtime-session="created-session"]')).toBeTruthy();
    expect(runtimeState.propsBySession.get('created-session')?.initialLoadingCurtainOwnedByParent?.()).toBe(false);
    runtimeState.propsBySession.get('created-session')?.onRuntimeStatus?.('created-session', { state: 'reconnecting' });
    expect(host.querySelector('[data-terminal-creation-transition]')).toBeNull();
  });

  it('removes the continuity curtain when terminal creation fails', async () => {
    const create = deferred<ReturnType<typeof createdSession>>();
    const createSession = vi.fn(() => create.promise);
    const host = renderCreateFlow(createSession);

    await vi.waitFor(() => expect(host.querySelector('[data-terminal-creation-transition]')).toBeTruthy());
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    create.reject(new Error('creation failed for test'));

    await vi.waitFor(() => expect(host.querySelector('[data-terminal-creation-transition]')).toBeNull());
    expect(host.querySelector('[data-terminal-pending-surface="true"]')?.textContent).toContain(
      'creation failed for test',
    );
  });

  it('hands loading ownership back to the runtime on a blocking attach failure', async () => {
    const create = deferred<ReturnType<typeof createdSession>>();
    const host = renderCreateFlow(vi.fn(() => create.promise));

    await vi.waitFor(() => expect(host.querySelector('[data-terminal-creation-transition]')).toBeTruthy());
    create.resolve(createdSession());
    await vi.waitFor(() => expect(
      host.querySelector('[data-redeven-loading-curtain-stage="attaching"]'),
    ).toBeTruthy());

    const runtimeProps = runtimeState.propsBySession.get('created-session');
    expect(runtimeProps.initialLoadingCurtainOwnedByParent()).toBe(true);
    runtimeProps.onRuntimeStatus?.('created-session', { state: 'blocking', failureCode: 'terminal_attach_failed' });

    await vi.waitFor(() => expect(host.querySelector('[data-terminal-creation-transition]')).toBeNull());
    expect(runtimeProps.initialLoadingCurtainOwnedByParent()).toBe(false);
  });

  it('keeps concurrent creation transitions correlated by their stable pending identities', async () => {
    const first = deferred<ReturnType<typeof createdSession>>();
    const second = deferred<ReturnType<typeof createdSession>>();
    const createSession = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const [request, setRequest] = createSignal({
      requestId: 'create-first',
      workingDir: '/workspace/first',
      preferredName: 'First',
    });
    const host = document.createElement('div');
    Object.assign(host.style, { width: '960px', height: '640px' });
    document.body.append(host);
    disposeRendered = render(() => (
      <TerminalSessionCatalogProvider>
        <TerminalPanel
          variant="panel"
          openSessionRequest={request()}
          sessionOperations={{ createSession, deleteSession: vi.fn(async () => undefined) }}
        />
      </TerminalSessionCatalogProvider>
    ), host);

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    const firstTransition = host.querySelector('[data-terminal-creation-transition]') as HTMLElement;
    expect(firstTransition).toBeTruthy();
    setRequest({
      requestId: 'create-second',
      workingDir: '/workspace/second',
      preferredName: 'Second',
    });
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(host.querySelectorAll('[data-terminal-creation-transition]')).toHaveLength(2));
    const secondTransition = [...host.querySelectorAll<HTMLElement>('[data-terminal-creation-transition]')]
      .find((element) => element !== firstTransition) as HTMLElement;
    expect(secondTransition).toBeTruthy();

    first.resolve({ ...createdSession('first-session'), name: 'First', workingDir: '/workspace/first' });
    await vi.waitFor(() => expect(
      firstTransition.querySelector('[data-redeven-loading-curtain-stage="attaching"]'),
    ).toBeTruthy());
    expect(firstTransition.isConnected).toBe(true);
    expect(secondTransition.querySelector('[data-redeven-loading-curtain-stage="creating"]')).toBeTruthy();

    runtimeState.propsBySession.get('first-session')?.onInteractive?.('first-session');
    await vi.waitFor(() => expect(firstTransition.isConnected).toBe(false));
    expect(secondTransition.isConnected).toBe(true);

    second.resolve({ ...createdSession('second-session'), name: 'Second', workingDir: '/workspace/second' });
    await vi.waitFor(() => expect(
      secondTransition.querySelector('[data-redeven-loading-curtain-stage="attaching"]'),
    ).toBeTruthy());
    runtimeState.propsBySession.get('second-session')?.onInteractive?.('second-session');
    await vi.waitFor(() => expect(secondTransition.isConnected).toBe(false));
  });
});
