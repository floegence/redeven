import '../../index.css';

import { createSignal } from 'solid-js';
import { commands, page, userEvent } from 'vitest/browser';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layoutState = vi.hoisted(() => ({ mobile: false, active: (() => true) as () => boolean }));
const protocolState = vi.hoisted(() => ({
  client: (() => null) as () => object | null,
  status: (() => 'connected') as () => string,
}));
const rpcState = vi.hoisted(() => ({
  sessions: [] as any[],
  views: [] as any[],
  viewRevision: 1,
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
      listViews: vi.fn(async () => ({ revision: rpcState.viewRevision, views: [...rpcState.views] })),
      putView: vi.fn(async req => {
        const previous = rpcState.views.find(view => view.id === req.id);
        if ((previous?.revision ?? 0) !== req.baseRevision) throw new Error('conflict');
        rpcState.views = [...rpcState.views.filter(view => view.id !== req.id), { id: req.id, name: req.name, layout: req.layout, revision: ++rpcState.viewRevision, createdAtMs: 1, updatedAtMs: 1 }];
        return { revision: rpcState.viewRevision, views: [...rpcState.views] };
      }),
      deleteView: vi.fn(async req => { rpcState.views = rpcState.views.filter(view => view.id !== req.id); return { revision: ++rpcState.viewRevision, views: [...rpcState.views] }; }),
      onViewsChanged: vi.fn(() => () => undefined),
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
import { useTerminalPreferences } from '../services/terminalPreferences';
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
    rpcState.views = []; rpcState.viewRevision = 1;
    localStorage.removeItem("redeven_terminal_workspace:v1:env-1:terminal_page:active-view");
    runtimeState.propsBySession.clear();
    flowerLauncher.mockClear();
    sessionStorage.clear();
    localStorage.removeItem('redeven_terminal_workspace:v1:env-1:terminal_page');
    localStorage.removeItem('redeven_terminal_sidebar_width:v1:env-1:terminal_page');
  });

  afterEach(() => {
    disposeRendered?.();
    disposeRendered = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('retains terminal instances while applying layouts, focusing panes, maximizing and closing placement', async () => {
    let sequence = 0;
    const create = vi.fn(async () => ({ ...createdSession('split-session-' + ++sequence), name: 'Shell ' + sequence }));
    const host = renderCreateFlow(create);
    await vi.waitFor(() => expect(runtimeState.propsBySession.has('split-session-1')).toBe(true));
    const original = host.querySelector('[data-terminal-runtime-session="split-session-1"]');
    await userEvent.click(page.getByTestId('terminal-workspace-layout'));
    await userEvent.click(page.getByRole('menuitem', { name: 'Grid', exact: true }));
    await vi.waitFor(() => expect(runtimeState.propsBySession.size).toBe(4));
    for (const [id, props] of runtimeState.propsBySession) props.onInteractive?.(id);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(4);
    expect(host.querySelector('[data-terminal-runtime-session="split-session-1"]')).toBe(original);
    for (const props of runtimeState.propsBySession.values()) expect(props.visible()).toBe(true);
    expect([...runtimeState.propsBySession.values()].filter(props => props.active())).toHaveLength(1);
    const second = host.querySelector<HTMLElement>('[data-floe-split-pane="split-session-2"]')!;
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(runtimeState.propsBySession.get('split-session-2').active()).toBe(true);
    await userEvent.click(second.querySelector<HTMLButtonElement>('[aria-label="Maximize pane"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(1);
    await userEvent.click(page.getByRole('button', { name: 'Restore panes', exact: true }));
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(4);
    await userEvent.click(second.querySelector<HTMLButtonElement>('[aria-label="Close pane"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(3);
    expect(runtimeState.propsBySession.size).toBe(4);
    expect(host.querySelector('[data-terminal-session-id="split-session-2"]')).not.toBeNull();
    expect(host.querySelector('[data-terminal-runtime-session="split-session-1"]')).toBe(original);
    await expect.poll(() => rpcState.views.length).toBe(1);
    expect(rpcState.views[0].layout.type).toBe('split');
    const first = host.querySelector<HTMLElement>('[data-floe-split-pane="split-session-1"]')!;
    await userEvent.click(first.querySelector<HTMLButtonElement>('[aria-label="Split pane"]')!);
    await userEvent.click(page.getByRole('menuitem', { name: 'Split right', exact: true }));
    await expect.poll(() => create.mock.calls.length).toBe(5);
    // No local cwd capability was verified in this fixture; use the group directory.
    expect(create).toHaveBeenLastCalledWith(undefined, '/', 'default');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').map(pane => pane.getAttribute('data-floe-split-pane'))).toContain('split-session-5');
    expect(visibleElements(host, '[data-floe-split-pane]').map(pane => pane.getAttribute('data-floe-split-pane'))).not.toContain('split-session-2');
    expect(host.querySelector('[data-terminal-runtime-session="split-session-2"]')).not.toBeNull();
    await page.screenshot({ element: host, path: '../../../node_modules/.cache/terminal-workspace/desktop.png' });
  });

  it.each([1, 0.75, 1.25])('docks a full sidebar row without replacing or remounting sessions at scale %s', async (scale) => {
    rpcState.sessions = ['dock-a', 'dock-b', 'dock-c'].map((id) => ({ ...createdSession(id), isActive: id === 'dock-a' }));
    const host = document.createElement('div');
    Object.assign(host.style, { width: '1100px', height: '700px' });
    host.style.transform = 'scale(' + scale + ')';
    host.style.transformOrigin = 'top left';
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider><TerminalPanel variant="panel" /></TerminalSessionCatalogProvider>, host);
    await expect.poll(() => runtimeState.propsBySession.has('dock-a')).toBe(true);
    runtimeState.propsBySession.get('dock-a').onInteractive?.('dock-a');
    const original = host.querySelector('[data-terminal-runtime-session="dock-a"]');
    const dock = async (sourceId: string, targetId: string, edge: 'left' | 'bottom' | 'center') => {
      const source = host.querySelector<HTMLElement>('[data-terminal-session-id="' + sourceId + '"]')!;
      expect(source.closest('[data-terminal-session-row]')?.getAttribute('draggable')).toBe('true');
      const target = host.querySelector<HTMLElement>('[data-floe-split-pane="' + targetId + '"]')!;
      const transfer = new DataTransfer();
      const sourceBox = source.getBoundingClientRect();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: sourceBox.left + 80, clientY: sourceBox.top + 15 }));
      expect(transfer.getData('application/x-redeven-terminal-session')).toBe(sourceId);
      const rect = target.getBoundingClientRect();
      const clientX = edge === 'left' ? rect.left + 4 : rect.left + rect.width / 2;
      const clientY = edge === 'bottom' ? rect.bottom - 4 : rect.top + rect.height / 2;
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY }));
      expect(target.querySelector('[data-floe-split-drop]')?.getAttribute('data-floe-split-drop')).toBe(edge);
      const preview = host.querySelector<HTMLElement>('[data-terminal-drag-preview="session"]')!;
      expect(preview.getBoundingClientRect().right).toBeGreaterThan(host.querySelector('[data-terminal-drag-boundary]')!.getBoundingClientRect().right);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      await expect.poll(() => runtimeState.propsBySession.has(sourceId)).toBe(true);
      runtimeState.propsBySession.get(sourceId).onInteractive?.(sourceId);
    };
    await dock('dock-b', 'dock-a', 'left');
    expect(visibleElements(host, '[data-floe-split-pane]')).toHaveLength(2);
    await dock('dock-c', 'dock-a', 'bottom');
    expect(visibleElements(host, '[data-floe-split-pane]')).toHaveLength(3);
    const previousPosition = host.querySelector<HTMLElement>('[data-floe-split-pane="dock-c"]')!.getBoundingClientRect();
    await dock('dock-b', 'dock-c', 'center');
    const swappedPosition = host.querySelector<HTMLElement>('[data-floe-split-pane="dock-b"]')!.getBoundingClientRect();
    expect(swappedPosition.x).toBeCloseTo(previousPosition.x, 1);
    expect(swappedPosition.y).toBeCloseTo(previousPosition.y, 1);
    expect(visibleElements(host, '[data-floe-split-pane]')).toHaveLength(3);
    expect(runtimeState.propsBySession.size).toBe(3);
    expect(host.querySelector('[data-terminal-runtime-session="dock-a"]')).toBe(original);
    expect(host.querySelector('.terminal-workspace-toolbar')).toBeNull();
    expect(host.querySelector('[data-floe-split-header]')!.getBoundingClientRect().top).toBe(host.querySelector('[data-terminal-work-area]')!.getBoundingClientRect().top);
  });

  it('supports native row dragging, center replacement, maximize docking and cancellation', async () => {
    await page.viewport(1280, 800);
    rpcState.sessions = ['native-a', 'native-b', 'native-c'].map((id) => ({ ...createdSession(id), isActive: id === 'native-a' }));
    const host = document.createElement('div');
    Object.assign(host.style, { width: '1100px', height: '700px' });
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider><TerminalPanel variant="panel" /></TerminalSessionCatalogProvider>, host);
    await expect.poll(() => runtimeState.propsBySession.has('native-a')).toBe(true);
    runtimeState.propsBySession.get('native-a').onInteractive?.('native-a');
    const native = commands as unknown as {
      dragTerminalSessionToPane: (source: string, target: string, edge: 'left' | 'right' | 'top' | 'bottom' | 'center') => Promise<void>;
    };
    const original = host.querySelector('[data-terminal-runtime-session="native-a"]');
    await native.dragTerminalSessionToPane('native-b', 'native-a', 'right');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    runtimeState.propsBySession.get('native-b').onInteractive?.('native-b');
    await native.dragTerminalSessionToPane('native-c', 'native-b', 'center');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').map(pane => pane.getAttribute('data-floe-split-pane'))).toEqual(['native-a', 'native-c']);
    runtimeState.propsBySession.get('native-c').onInteractive?.('native-c');
    const pane = host.querySelector('[data-floe-split-pane="native-a"]')!;
    await userEvent.click(pane.querySelector<HTMLButtonElement>('[aria-label="Maximize pane"]')!);
    await native.dragTerminalSessionToPane('native-b', 'native-a', 'bottom');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(3);
    const saved = localStorage.getItem('redeven_terminal_workspace:v1:env-1:terminal_page');
    const source = host.querySelector('[data-terminal-session-id="native-b"]')!;
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    expect(localStorage.getItem('redeven_terminal_workspace:v1:env-1:terminal_page')).toBe(saved);
    expect(host.querySelector('[data-terminal-runtime-session="native-a"]')).toBe(original);
    expect(runtimeState.propsBySession.size).toBe(3);
    await expect.poll(() => host.querySelector('[data-terminal-drag-preview]')).toBeNull();
    await native.dragTerminalSessionToPane('native-c', 'native-a', 'top');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(3);
    const above = host.querySelector('[data-floe-split-pane="native-c"]')!.getBoundingClientRect();
    const below = host.querySelector('[data-floe-split-pane="native-a"]')!.getBoundingClientRect();
    expect(above.bottom).toBeLessThanOrEqual(below.top);
    await expect.poll(() => host.querySelector('[data-terminal-drag-preview]')).toBeNull();
    await page.screenshot({ element: host, path: '../../../node_modules/.cache/terminal-workspace/sidebar-docking.png' });
  });

  it('keeps search, settings and session creation reachable from the sidebar footer', async () => {
    await page.viewport(1280, 800);
    let sequence = 0;
    const create = vi.fn(async () => createdSession('footer-' + ++sequence));
    const host = renderCreateFlow(create);
    await expect.poll(() => runtimeState.propsBySession.has('footer-1')).toBe(true);
    runtimeState.propsBySession.get('footer-1').onInteractive?.('footer-1');
    const footer = host.querySelector<HTMLElement>('.terminal-navigation-footer')!;
    const menu = footer.querySelector<HTMLButtonElement>('[aria-label="More options"]')!;
    expect(host.querySelector('.terminal-workspace-toolbar')).toBeNull();
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'Search', exact: true }));
    await expect.poll(() => host.querySelector('[data-terminal-search-state]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => host.querySelector('[data-terminal-search-state]')).toBeNull();
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'Terminal settings', exact: true }));
    await expect.element(page.getByRole('dialog', { name: 'Terminal settings', exact: true })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: 'Terminal settings', exact: true })).not.toBeInTheDocument();
    await userEvent.click(menu);
    await userEvent.click(page.getByRole('menuitem', { name: 'New session', exact: true }));
    await expect.poll(() => create.mock.calls.length).toBe(2);
  });

  it('preserves the split arrangement while browsing sidebar sessions and restores pane focus', async () => {
    await page.viewport(1280, 800);
    rpcState.sessions = ['browse-a', 'browse-b', 'browse-c'].map((id) => ({ ...createdSession(id), isActive: id === 'browse-a' }));
    localStorage.setItem('redeven_terminal_workspace:v1:env-1:terminal_page', JSON.stringify({ type: 'split', id: 'browse-split', axis: 'x', ratio: 0.4, first: { type: 'pane', id: 'browse-a' }, second: { type: 'pane', id: 'browse-b' } }));
    const host = document.createElement('div');
    Object.assign(host.style, { width: '1100px', height: '700px' });
    document.body.append(host);
    disposeRendered = render(() => <TerminalSessionCatalogProvider><TerminalPanel variant="panel" /></TerminalSessionCatalogProvider>, host);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    for (const [id, runtime] of runtimeState.propsBySession) runtime.onInteractive?.(id);
    const original = host.querySelector('[data-terminal-runtime-session="browse-a"]');
    const saved = localStorage.getItem('redeven_terminal_workspace:v1:env-1:terminal_page');
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-session-id="browse-c"]')!);
    await expect.poll(() => runtimeState.propsBySession.has('browse-c')).toBe(true);
    runtimeState.propsBySession.get('browse-c').onInteractive?.('browse-c');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').map(pane => pane.getAttribute('data-floe-split-pane'))).toEqual(['browse-c']);
    await expect.poll(() => rpcState.views.length).toBe(1);
    expect(rpcState.views[0].layout).toEqual(JSON.parse(saved!));
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-view-id]')!);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-session-id="browse-b"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    await expect.poll(() => runtimeState.propsBySession.get('browse-b').active()).toBe(true);
    const pane = host.querySelector('[data-floe-split-pane="browse-b"]')!;
    const maximize = pane.querySelector<HTMLButtonElement>('[aria-label="Maximize pane"]')!;
    const maximizeIcon = maximize.innerHTML;
    await userEvent.click(maximize);
    const restore = pane.querySelector<HTMLButtonElement>('[aria-label="Restore panes"]')!;
    expect(restore.innerHTML).not.toBe(maximizeIcon);
    expect(restore.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-session-id="browse-a"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    await expect.poll(() => runtimeState.propsBySession.get('browse-a').active()).toBe(true);
    expect(rpcState.views[0].layout).toEqual(JSON.parse(saved!));
    expect(host.querySelector('[data-terminal-runtime-session="browse-a"]')).toBe(original);
    expect(host.textContent).not.toContain('Quick switch');
  });

  it.each([1, 0.75, 1.25])('resizes and remembers the sidebar at scale %s without remounting terminals', async (scale) => {
    await page.viewport(1440, 960);
    rpcState.sessions = [{ ...createdSession('resize-a'), isActive: true }];
    const host = document.createElement('div');
    Object.assign(host.style, { width: '1100px', height: '700px', transform: 'scale(' + scale + ')', transformOrigin: 'top left' });
    document.body.append(host);
    const mount = () => render(() => <TerminalSessionCatalogProvider><TerminalPanel variant="panel" /></TerminalSessionCatalogProvider>, host);
    disposeRendered = mount();
    await expect.poll(() => runtimeState.propsBySession.has('resize-a')).toBe(true);
    runtimeState.propsBySession.get('resize-a').onInteractive?.('resize-a');
    const original = host.querySelector('[data-terminal-runtime-session="resize-a"]');
    const width = () => host.querySelector<HTMLElement>('.redeven-terminal-session-sidebar')!.offsetWidth;
    const native = commands as unknown as { resizeTerminalSidebar: (delta: number) => Promise<void> };
    expect(width()).toBe(258);
    await native.resizeTerminalSidebar(80);
    await expect.poll(width).toBe(338);
    expect(Number(localStorage.getItem('redeven_terminal_sidebar_width:v1:env-1:terminal_page'))).toBeCloseTo(338);
    expect(host.querySelector('[data-terminal-runtime-session="resize-a"]')).toBe(original);
    const handle = host.querySelector<HTMLElement>('[data-terminal-sidebar-resizer]')!;
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(width()).toBe(328);
    await userEvent.keyboard('{Home}');
    expect(width()).toBe(220);
    await userEvent.keyboard('{End}');
    expect(width()).toBe(480);
    expect(document.activeElement).toBe(handle);
    disposeRendered();
    disposeRendered = mount();
    await expect.poll(width).toBe(480);
    expect(host.textContent).not.toContain('Quick switch');
  });

  it('manages independent backend views, renames and deletes without closing sessions', async () => {
    await page.viewport(1280, 800);
    rpcState.sessions = ['views-a', 'views-b', 'views-c'].map(id => ({ ...createdSession(id), isActive: id === 'views-a' }));
    const host = document.createElement('div');
    Object.assign(host.style, { width: '1100px', height: '700px' }); document.body.append(host);
    const mount = () => render(() => <TerminalSessionCatalogProvider><TerminalPanel variant="panel" /></TerminalSessionCatalogProvider>, host);
    disposeRendered = mount();
    await expect.poll(() => runtimeState.propsBySession.has('views-a')).toBe(true);
    runtimeState.propsBySession.get('views-a').onInteractive?.('views-a');
    const native = commands as unknown as { dragTerminalSessionToPane: (source: string, target: string, edge: string) => Promise<void> };
    await native.dragTerminalSessionToPane('views-b', 'views-a', 'right');
    await expect.poll(() => rpcState.views.length).toBe(1);
    const firstId = rpcState.views[0].id;
    const firstLayout = rpcState.views[0].layout;
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-session-id="views-c"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(1);
    runtimeState.propsBySession.get('views-c').onInteractive?.('views-c');
    await native.dragTerminalSessionToPane('views-a', 'views-c', 'bottom');
    await expect.poll(() => rpcState.views.length).toBe(2);
    const secondId = rpcState.views.find(view => view.id !== firstId)!.id;
    expect(rpcState.views.find(view => view.id === firstId)!.layout).toEqual(firstLayout);
    expect(host.querySelectorAll('[data-terminal-view-id]')).toHaveLength(2);
    expect(host.querySelector('[data-terminal-view-count], .terminal-view-pane-count')).toBeNull();
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-view-id="' + firstId + '"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').map(node => node.getAttribute('data-floe-split-pane'))).toEqual(['views-a', 'views-b']);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Actions for View 1"]')!);
    await userEvent.click(page.getByRole('menuitem', { name: 'Rename view', exact: true }));
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Services');
    await userEvent.click(page.getByRole('button', { name: 'Confirm', exact: true }));
    await expect.poll(() => rpcState.views.find(view => view.id === firstId)?.name).toBe('Services');
    disposeRendered(); disposeRendered = mount();
    await expect.poll(() => host.querySelectorAll('[data-terminal-view-id]').length).toBe(2);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-terminal-view-id="' + secondId + '"]')!);
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').map(node => node.getAttribute('data-floe-split-pane'))).toEqual(['views-a', 'views-c']);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Actions for View 2"]')!);
    await userEvent.click(page.getByRole('menuitem', { name: 'Delete view', exact: true }));
    await expect.poll(() => rpcState.views.length).toBe(1);
    expect(host.querySelectorAll('[data-terminal-session-id]').length).toBe(3);
    expect(rpcState.views[0].name).toBe('Services');
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(1);
    await page.screenshot({ element: host, path: '../../../node_modules/.cache/terminal-workspace/views.png' });
  });

  it('keeps the existing pane active and visible while a split session is being created', async () => {
    await page.viewport(1280, 800);
    let resolveCreate!: (value: ReturnType<typeof createdSession>) => void;
    const create = vi.fn().mockResolvedValueOnce(createdSession('steady-a')).mockImplementationOnce(() => new Promise(resolve => { resolveCreate = resolve; }));
    const host = renderCreateFlow(create);
    await expect.poll(() => runtimeState.propsBySession.has('steady-a')).toBe(true);
    runtimeState.propsBySession.get('steady-a').onInteractive?.('steady-a');
    const original = host.querySelector('[data-terminal-runtime-session="steady-a"]');
    await userEvent.click(host.querySelector<HTMLButtonElement>('[data-floe-split-pane="steady-a"] [aria-label="Split pane"]')!);
    await userEvent.click(page.getByRole('menuitem', { name: 'Split right', exact: true }));
    await expect.poll(() => create.mock.calls.length).toBe(2);
    expect(runtimeState.propsBySession.get('steady-a').active()).toBe(true);
    expect(host.querySelector('[data-terminal-runtime-session="steady-a"]')).toBe(original);
    expect(visibleElements(host, '[data-floe-split-pane]').map(p => p.getAttribute('data-floe-split-pane'))).toEqual(['steady-a']);
    resolveCreate(createdSession('steady-b'));
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    expect(visibleElements(host, '[data-terminal-creation-transition]')).toHaveLength(0);
    expect(host.querySelector('[data-terminal-runtime-session="steady-a"]')).toBe(original);
  });

  it('keeps headers, dividers and buttons within the selected terminal palette across shell themes', async () => {
    let sequence = 0;
    const host = renderCreateFlow(vi.fn(async () => createdSession('palette-' + ++sequence)));
    await vi.waitFor(() => expect(runtimeState.propsBySession.has('palette-1')).toBe(true));
    await userEvent.click(page.getByTestId('terminal-workspace-layout'));
    await userEvent.click(page.getByRole('menuitem', { name: 'Two columns', exact: true }));
    await expect.poll(() => visibleElements(host, '[data-floe-split-pane]').length).toBe(2);
    const preferences = useTerminalPreferences();
    const originalTheme = preferences.userTheme();
    const htmlClass = document.documentElement.className;
    try {
      for (const terminalTheme of ['light', 'dark', 'solarizedDark'] as const) {
        document.documentElement.className = terminalTheme === 'light' ? 'dark' : 'light';
        preferences.setUserTheme(terminalTheme);
        const area = host.querySelector<HTMLElement>('[data-terminal-work-area]')!;
        const colors = runtimeState.propsBySession.get('palette-1').themeColors();
        expect(area.style.getPropertyValue('--background')).toBe(colors.background);
        expect(area.style.getPropertyValue('--foreground')).toBe(colors.foreground);
        expect(area.style.getPropertyValue('--primary')).toBe(colors.foreground);
        expect(area.style.getPropertyValue('--ring')).toBe(colors.foreground);
        expect(area.style.getPropertyValue('--floe-ink-soft')).toBe(area.style.getPropertyValue('--muted-foreground'));
        expect(area.style.getPropertyValue('--floe-state-hover')).toContain(colors.background);
        const inactiveHeader = host.querySelector<HTMLElement>('[data-floe-split-pane][data-active="false"] [data-floe-split-header]')!;
        expect(getComputedStyle(inactiveHeader).backgroundColor).toBe(getComputedStyle(area).backgroundColor);
        expect(getComputedStyle(inactiveHeader).borderBottomColor).toBe(getComputedStyle(host.querySelector('[data-floe-split-header]')!).borderBottomColor);
        await expect.poll(() => getComputedStyle(inactiveHeader.querySelector('button')!).color).toBe(getComputedStyle(inactiveHeader).color);
        const divider = host.querySelector<HTMLElement>('[data-floe-split-divider]')!;
        expect(getComputedStyle(divider).backgroundColor).toBe(getComputedStyle(area).backgroundColor);
      }
    } finally { preferences.setUserTheme(originalTheme); document.documentElement.className = htmlClass; }
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
