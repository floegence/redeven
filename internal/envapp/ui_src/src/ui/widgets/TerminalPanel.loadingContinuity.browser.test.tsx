import '../../index.css';

import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layoutState = vi.hoisted(() => ({ mobile: false, active: (() => true) as () => boolean }));
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
const flowerLauncher = vi.hoisted(() => vi.fn());

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ session: protocolState.client, status: protocolState.status }),
  ProtocolNotConnectedError: class extends Error {},
  RpcError: class extends Error {},
}));

vi.mock('@floegence/floe-webapp-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core')>(),
  useCurrentWidgetId: () => null,
  useLayout: () => ({ isMobile: () => layoutState.mobile }),
  useNotification: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
  useResolvedFloeConfig: () => ({
    persist: { load: (_key: string, fallback: unknown) => fallback, debouncedSave: vi.fn() },
  }),
  useTheme: () => ({ resolvedTheme: () => 'dark', shellPresetForMode: () => null }),
  useViewActivation: () => ({ id: 'terminal-continuity', visible: layoutState.active, active: layoutState.active, activationSeq: () => 0 }),
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
      openFlowerTurnLauncher: flowerLauncher,
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
        class="redeven-terminal-surface"
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
import type { FlowerPageContextRegistrar } from '../flower/flowerPageContext';
import { flowerPageContextSnapshot } from '../flower/flowerPageContext';
import type { SemanticTerminalViewportHandle } from './semanticTerminalViewport';

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

function renderCreateFlow(createSession: TerminalPanelSessionOperations['createSession'], registerPageContext?: FlowerPageContextRegistrar) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: '960px', height: '640px' });
  document.body.append(host);
  disposeRendered = render(() => (
    <TerminalSessionCatalogProvider>
      <TerminalPanel
        variant="panel"
        registerPageContext={registerPageContext}
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
  it('retains an externally opened drawer through the initial inactive mount', async () => {
    await page.viewport(393, 740);
    layoutState.mobile = true;
    const [active, setActive] = createSignal(false);
    const [open, setOpen] = createSignal(true);
    layoutState.active = active;
    const host = document.createElement('div');
    Object.assign(host.style, { width: '393px', height: '640px' });
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider>
      <TerminalPanel variant="panel" mobileSessionsOpen={open()} onMobileSessionsOpenChange={setOpen} />
    </TerminalSessionCatalogProvider>, host);
    expect(open()).toBe(true);
    setActive(true);
    await expect.poll(() => host.querySelector('[data-terminal-mobile-drawer]')?.getAttribute('role')).toBe('dialog');
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-drawer-open"]')!;
    await userEvent.click(page.getByTestId('terminal-session-drawer-close'));
    await expect.poll(open).toBe(false);
    await userEvent.click(trigger);
    await expect.poll(open).toBe(true);
    await userEvent.click(page.getByTestId('terminal-session-drawer-close'));
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  beforeEach(() => {
    const [client] = createSignal<object | null>({ id: 'client-1' });
    const [status] = createSignal('connected');
    protocolState.client = client;
    protocolState.status = status;
    layoutState.mobile = false;
    layoutState.active = () => true;
    rpcState.sessions = [];
    runtimeState.propsBySession.clear();
    flowerLauncher.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    disposeRendered?.();
    disposeRendered = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('captures the active displayed screen for page references and right-click Ask Flower without reading scrollback', async () => {
    let readPage = (): Readonly<Record<string, unknown>> | undefined => undefined;
    const host = renderCreateFlow(vi.fn(async () => createdSession()), read => { readPage = read; });
    await vi.waitFor(() => expect(runtimeState.propsBySession.has('created-session')).toBe(true));
    const runtime = runtimeState.propsBySession.get('created-session');
    let screen = '$ run tests\nvisible failure 🪷';
    let selection = 'selected fragment';
    const readBufferLine = vi.fn(() => 'offscreen live output');
    const viewport: SemanticTerminalViewportHandle = {
      activate: vi.fn(async () => undefined), focus: vi.fn(), forceResize: vi.fn(), setAppearance: vi.fn(),
      getDimensions: () => ({ rows: 24, cols: 80 }),
      getTerminalInfo: () => ({ rows: 24, cols: 80, bufferLength: 1000 }),
      readBufferLine, getVisibleScreenText: () => screen,
      getSelectionText: () => selection, hasSelection: () => Boolean(selection),
      copySelection: vi.fn(async () => ({ copied: false, reason: 'empty_selection', source: 'command' } as const)),
      getTouchScrollRuntime: () => ({ isAlternateScreen: () => false, getScrollbackLength: () => 976,
        scrollLines: vi.fn(), sendAlternateScreenInput: vi.fn() }),
      setSearchResultsCallback: vi.fn(), clearSearch: vi.fn(), findNext: vi.fn(), findPrevious: vi.fn(),
      getPresentation: () => null,
    };
    runtime.registerViewport('created-session', viewport);
    const readInactiveScreen = vi.fn(() => 'inactive session content');
    runtime.registerViewport('inactive-session', { ...viewport, getVisibleScreenText: readInactiveScreen });
    expect(readPage()).toEqual({
      session: { id: 'created-session', name: 'Workspace', working_directory: '/workspace' },
      screen_text: screen,
    });
    const frozen = flowerPageContextSnapshot({ environmentID: 'env-1', environmentName: 'Development',
      pageID: 'terminal', pageName: 'Terminal', capturedAtMs: 1, state: readPage() });
    const frozenScreen = screen;
    screen = 'scrolled history currently visible';
    expect(JSON.parse(frozen.content).state.screen_text).toBe(frozenScreen);
    expect(readPage()?.screen_text).toBe(screen);

    const surface = host.querySelector<HTMLElement>('[data-terminal-runtime-session]')!;
    const ask = async () => {
      surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 450, clientY: 200 }));
      await userEvent.click(page.getByRole('menuitem', { name: 'Ask Flower', exact: true }));
      return flowerLauncher.mock.calls.at(-1)?.[0].context_items[0];
    };
    // The explicit selection path stays intact; automatic page capture always uses the screen.
    expect((await ask()).selection).toBe(selection);
    selection = '';
    expect((await ask()).selection).toBe(screen);
    expect(readBufferLine).not.toHaveBeenCalled();
    expect(readInactiveScreen).not.toHaveBeenCalled();
    screen = `${'🪷'.repeat(10_001)}\nlatest prompt`;
    const bounded = readPage()?.screen_text as string;
    expect(Array.from(bounded)).toHaveLength(10_000);
    expect(bounded.startsWith('...')).toBe(true);
    expect(bounded.endsWith('latest prompt')).toBe(true);
    expect((await ask()).selection).toBe(bounded);

    runtime.registerViewport('created-session', null);
    expect(readPage()).toEqual({ session: { id: 'created-session', name: 'Workspace', working_directory: '/workspace' } });
    runtime.registerViewport('created-session', { ...viewport, getVisibleScreenText: () => { throw new Error('disposed viewport'); } });
    expect(readPage()).toEqual({ session: { id: 'created-session', name: 'Workspace', working_directory: '/workspace' } });
  });

  it('keeps the Activity Flower footer host available without sessions and unregisters it on removal', async () => {
    const unregister = vi.fn();
    const register = vi.fn(() => unregister);
    const [enabled, setEnabled] = createSignal(true);
    const host = document.createElement('div');
    Object.assign(host.style, { width: '960px', height: '640px' });
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider>
      <TerminalPanel registerActivityFlowerAnchor={enabled() ? register : undefined} />
    </TerminalSessionCatalogProvider>, host);
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    const anchor = host.querySelector<HTMLElement>('[data-terminal-flower-anchor]')!;
    expect(anchor.closest('[data-testid="terminal-status-bar"]')).not.toBeNull();
    expect(anchor.getBoundingClientRect().height).toBe(24);
    setEnabled(false);
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    expect(host.querySelector('[data-terminal-flower-anchor]')).toBeNull();
    expect(host.querySelector('[data-testid="terminal-status-bar"]')).toBeNull();
  });

  it.each(['workbench', 'mobile'] as const)('does not register a Flower entry in a %s terminal', async (mode) => {
    layoutState.mobile = mode === 'mobile';
    const register = vi.fn();
    const host = document.createElement('div');
    Object.assign(host.style, { width: '960px', height: '640px' });
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider>
      <TerminalPanel variant={mode === 'workbench' ? 'workbench' : 'panel'} registerActivityFlowerAnchor={register} />
    </TerminalSessionCatalogProvider>, host);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(register).not.toHaveBeenCalled();
    expect(host.querySelector('[data-terminal-flower-anchor]')).toBeNull();
  });

  it('reserves the center for Flower and keeps geometry and recovery controls on the right in narrow footers', async () => {
    rpcState.sessions = [createdSession()];
    const register = vi.fn(() => vi.fn());
    const host = document.createElement('div');
    Object.assign(host.style, { width: '960px', height: '640px' });
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider>
      <TerminalPanel registerActivityFlowerAnchor={register} />
    </TerminalSessionCatalogProvider>, host);
    await vi.waitFor(() => expect(runtimeState.propsBySession.has('created-session')).toBe(true));
    const runtime = runtimeState.propsBySession.get('created-session');
    runtime.onGeometryPresentation('created-session', {
      lifecycleEpoch: 1, rendererEpoch: 1, requestEpoch: 1,
      local: { cols: 160, rows: 40 },
      effective: { cols: 80, rows: 24, lifecycleEpoch: 1, rendererEpoch: 1, generation: 1, presentationSequence: 1 },
    });
    for (const width of [960, 720, 640]) {
      host.style.width = `${width}px`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const anchor = host.querySelector<HTMLElement>('[data-terminal-flower-anchor]')!;
      const geometry = host.querySelector<HTMLElement>('[data-testid="terminal-shared-geometry-status-notice"]')!;
      const footer = anchor.closest<HTMLElement>('[data-testid="terminal-status-bar"]')!;
      const rect = anchor.getBoundingClientRect();
      const bounds = footer.getBoundingClientRect();
      expect(bounds.height).toBe(28);
      expect(rect.height).toBe(24);
      expect(rect.width).toBeGreaterThan(96);
      expect(rect.width).toBeLessThanOrEqual(360);
      expect(Math.abs(rect.left + rect.width / 2 - bounds.left - bounds.width / 2)).toBeLessThan(1);
      expect(geometry.getBoundingClientRect().left).toBeGreaterThanOrEqual(rect.right);
      expect(geometry.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
      expect(geometry.getBoundingClientRect().width).toBe(bounds.width <= 720 ? 28 : 104);
      const short = geometry.querySelector<HTMLElement>('.terminal-shared-geometry-notice__short')!;
      expect(getComputedStyle(short).display).toBe(bounds.width <= 720 ? 'none' : 'inline');
      runtime.onRuntimeStatus('created-session', { state: 'degraded', retryable: true });
      const recovery = host.querySelector<HTMLElement>('[data-testid="terminal-recovery-status-actions"]')!;
      expect(recovery.getBoundingClientRect().left).toBeGreaterThanOrEqual(rect.right);
      expect(recovery.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
      runtime.onRuntimeStatus('created-session', { state: 'idle' });
      expect(host.scrollWidth).toBe(host.clientWidth);
    }
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

  it('keeps terminal runtime and session filter while desktop navigation adapts to local width', async () => {
    await page.viewport(1280, 850);
    let readPage = (): Readonly<Record<string, unknown>> | undefined => undefined;
    const host = renderCreateFlow(vi.fn(async () => createdSession()), read => { readPage = read; });
    await expect.poll(() => host.querySelector('[data-terminal-runtime-session]')).toBeTruthy();
    const runtime = host.querySelector('[data-terminal-runtime-session]');
    expect(readPage()).toMatchObject({ session: { id: 'created-session', name: 'Workspace', working_directory: '/workspace' } });
    expect(readPage()).not.toHaveProperty('output');
    const filter = host.querySelector<HTMLInputElement>('[data-testid="terminal-session-filter"]')!;
    await userEvent.fill(filter, 'Workspace');
    host.style.width = '640px';
    await expect.poll(() => host.querySelector('[data-terminal-sidebar-presentation]')?.getAttribute('data-terminal-sidebar-presentation')).toBe('overlay');
    expect(host.querySelector('[data-terminal-mobile-drawer]')).toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="terminal-session-drawer-open"]')!;
    await userEvent.click(trigger);
    await expect.poll(() => host.querySelector('[data-floe-drawer-side="left"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="terminal-session-filter"]')).toBe(filter);
    expect(document.activeElement).not.toBe(filter);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await expect.poll(() => host.querySelector('[data-floe-drawer-side="left"]')).toBeTruthy();
    await userEvent.click(host.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!);
    await expect.poll(() => host.querySelector('[data-floe-drawer-side="left"]')).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger);
    host.style.width = '1000px';
    await expect.poll(() => host.querySelector('[data-terminal-sidebar-presentation]')?.getAttribute('data-terminal-sidebar-presentation')).toBe('inline');
    expect(host.querySelector('[data-terminal-runtime-session]')).toBe(runtime);
    expect(host.querySelector('[data-testid="terminal-session-filter"]')).toBe(filter);
    expect(filter.value).toBe('Workspace');
  });

});
