import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const protocolState = vi.hoisted(() => ({
  client: (() => null) as () => object | null,
  status: (() => 'connected') as () => string,
}));
const envState = vi.hoisted(() => ({
  viewMode: (() => 'activity') as () => 'activity' | 'workbench',
  setViewMode: (() => undefined) as (mode: 'activity' | 'workbench') => void,
}));
const rpcState = vi.hoisted(() => ({
  sessions: [] as any[],
  outputActivityHandler: null as ((event: any) => void) | null,
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
  useViewActivation: () => ({ id: 'terminal-test', active: () => true, activationSeq: () => 0 }),
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
      viewMode: envState.viewMode,
      setViewMode: envState.setViewMode,
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
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      onSessionsChanged: vi.fn(() => () => undefined),
      onForegroundCommandUpdate: vi.fn(() => () => undefined),
      onOutputActivityUpdate: vi.fn((handler: (event: any) => void) => {
        rpcState.outputActivityHandler = handler;
        return () => {
          if (rpcState.outputActivityHandler === handler) rpcState.outputActivityHandler = null;
        };
      }),
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
  createTerminalConnId: () => 'terminal-unread-browser',
  createRedevenTerminalLiveBundle: () => ({
    transport: {
      syncConnectionEpoch: vi.fn(),
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
  TerminalSessionRuntime: (props: Readonly<{
    session: Readonly<{ id: string }>;
    variant: 'panel' | 'workbench';
    viewActive: () => boolean;
  }>) => (
    <button
      type="button"
      data-terminal-runtime-focus={props.variant}
      data-terminal-runtime-session={props.session.id}
      data-terminal-runtime-view-active={props.viewActive() ? 'true' : 'false'}
    >
      Terminal surface
    </button>
  ),
}));

import {
  TerminalSessionCatalogProvider,
  useTerminalSessionCatalog,
} from '../services/terminalSessionCatalog';
import { TerminalPanel } from './TerminalPanel';

let latestCatalog: ReturnType<typeof useTerminalSessionCatalog> = null;
let disposeRendered: (() => void) | null = null;

function CatalogProbe() {
  const catalog = useTerminalSessionCatalog();
  createEffect(() => {
    latestCatalog = catalog;
  });
  return null;
}

function stockAgentSession(identity: 'pi' | 'claude' | 'codex') {
  const displayName = identity === 'pi' ? 'Pi' : identity === 'claude' ? 'Claude Code' : 'Codex';
  return {
    id: 'agent-session',
    name: displayName,
    workingDir: '/workspace',
    createdAtMs: 1,
    lastActiveAtMs: 2,
    isActive: true,
    foregroundCommand: { phase: 'running', displayName: identity, revision: 2, updatedAtMs: 20 },
    executionContext: {
      location: {
        kind: 'local', phase: 'ready', label: '', authority: '',
        workingDirectory: '/workspace', source: 'shell_integration',
      },
      application: { kind: 'agent_cli', identity, displayName },
      revision: 3,
      updatedAtMs: 30,
    },
    outputActivity: { phase: 'settled', revision: 1, updatedAtMs: 40 },
    workState: {
      phase: 'unknown', source: '', contextRevision: 0,
      foregroundCommandRevision: 0, revision: 0, updatedAtMs: 0,
    },
  };
}

function publishOutput(phase: 'streaming' | 'settled', revision: number) {
  rpcState.outputActivityHandler?.({
    sessionId: 'agent-session',
    outputActivity: { phase, revision, updatedAtMs: revision * 10 },
  });
}

describe('TerminalPanel stock Agent unread integration', () => {
  beforeEach(() => {
    const [client] = createSignal<object | null>({ id: 'client-1' });
    const [status] = createSignal('connected');
    const [viewMode, setViewMode] = createSignal<'activity' | 'workbench'>('activity');
    protocolState.client = client;
    protocolState.status = status;
    envState.viewMode = viewMode;
    envState.setViewMode = setViewMode;
    rpcState.sessions = [stockAgentSession('pi')];
    rpcState.outputActivityHandler = null;
    latestCatalog = null;
    sessionStorage.clear();
  });

  afterEach(() => {
    disposeRendered?.();
    disposeRendered = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['pi', 'Pi'],
    ['claude', 'Claude Code'],
    ['codex', 'Codex'],
  ] as const)(
    'drives the shared Activity and Workbench dot for stock %s from RPC 2014 and real reader focus',
    async (identity, displayName) => {
      rpcState.sessions = [stockAgentSession(identity)];
      const outside = document.createElement('button');
      outside.textContent = 'Outside terminal';
      document.body.append(outside);
      outside.focus();
      const host = document.createElement('div');
      document.body.append(host);
      disposeRendered = render(() => (
        <TerminalSessionCatalogProvider>
          <CatalogProbe />
          <div data-terminal-test-panel="activity">
            <TerminalPanel variant="panel" />
          </div>
          <div data-terminal-test-panel="workbench">
            <TerminalPanel variant="workbench" workbenchSelected />
          </div>
        </TerminalSessionCatalogProvider>
      ), host);

      await vi.waitFor(() => expect(rpcState.outputActivityHandler).not.toBeNull());
      await vi.waitFor(() => expect(
        host.querySelectorAll('[data-terminal-runtime-session="agent-session"]'),
      ).toHaveLength(2));
      expect(latestCatalog?.sessions()[0]).toMatchObject({
        executionContext: { application: { kind: 'agent_cli', identity, displayName }, revision: 3 },
        foregroundCommand: { revision: 2 },
        outputActivity: { phase: 'settled', revision: 1 },
      });
      expect(document.activeElement).toBe(outside);

      publishOutput('streaming', 2);
      await vi.waitFor(() => expect(
        host.querySelectorAll('[data-terminal-output-state="streaming"]'),
      ).toHaveLength(2));
      expect(host.querySelectorAll('[data-terminal-attention-state="unread"]')).toHaveLength(0);

      publishOutput('settled', 3);
      await vi.waitFor(() => expect(
        host.querySelectorAll('[data-terminal-attention-state="unread"]'),
      ).toHaveLength(2));
      expect(latestCatalog?.agentUnreadSessionIds()).toEqual(new Set(['agent-session']));

      const activitySurface = host.querySelector<HTMLButtonElement>(
        '[data-terminal-runtime-focus="panel"]',
      );
      activitySurface?.focus();
      await vi.waitFor(() => expect(
        host.querySelectorAll('[data-terminal-attention-state="unread"]'),
      ).toHaveLength(0));

      publishOutput('streaming', 4);
      publishOutput('settled', 5);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      expect(host.querySelectorAll('[data-terminal-attention-state="unread"]')).toHaveLength(0);

      outside.focus();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      publishOutput('streaming', 6);
      publishOutput('settled', 7);
      await vi.waitFor(() => expect(
        host.querySelectorAll('[data-terminal-attention-state="unread"]'),
      ).toHaveLength(2));

      const hiddenWorkbenchSurface = host.querySelector<HTMLButtonElement>(
        '[data-terminal-runtime-focus="workbench"]',
      );
      hiddenWorkbenchSurface?.focus();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      expect(host.querySelectorAll('[data-terminal-attention-state="unread"]')).toHaveLength(2);

      envState.setViewMode('workbench');
      await vi.waitFor(() => expect(
        host.querySelectorAll('[data-terminal-attention-state="unread"]'),
      ).toHaveLength(0));

      expect(latestCatalog?.sessions()[0]?.executionContext?.application).toMatchObject({
        kind: 'agent_cli', identity, displayName,
      });
    },
  );
});
