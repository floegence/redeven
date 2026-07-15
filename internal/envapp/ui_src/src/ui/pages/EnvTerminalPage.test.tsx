// @vitest-environment jsdom

import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { EnvTerminalPage } from './EnvTerminalPage';
import { EnvContext, useEnvContext } from './EnvContext';
import {
  TerminalSessionCatalogContext,
  useTerminalSessionCatalog,
} from '../services/terminalSessionCatalog';
import { canLaunchProcess } from '../utils/permission';

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('../widgets/TerminalPanel', () => ({
  TerminalPanel: (props: any) => {
    const env = useEnvContext();
    const catalog = useTerminalSessionCatalog();
    return (
      <Show
        when={canLaunchProcess(env.env()?.permissions) && !catalog?.permissionDenied?.()}
        fallback={<div data-testid="terminal-permission-empty-state" />}
      >
          <div
            data-testid="terminal-panel"
            data-variant={props.variant}
            data-target-mode={props.openSessionRequest?.targetMode ?? ''}
          />
      </Show>
    );
  },
}));

function createEnvResource(initialPermissions = { can_write: true, can_execute: true }) {
  const [envValue, setEnvValue] = createSignal({ permissions: initialPermissions });
  const resource = envValue as any;
  Object.defineProperties(resource, {
    state: { get: () => 'ready' },
    loading: { get: () => false },
    error: { get: () => null },
  });
  return { resource, setEnvValue };
}

describe('EnvTerminalPage', () => {
  it('mounts the terminal panel with activity semantics so activity handoffs are accepted', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => ({
          requestId: 'request-activity',
          workingDir: '/workspace/repo',
          preferredName: 'repo',
          targetMode: 'activity',
        }),
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <EnvTerminalPage />
      </EnvContext.Provider>
    ), host);

    try {
      const panel = host.querySelector('[data-testid="terminal-panel"]') as HTMLElement | null;
      expect(panel?.dataset.variant).toBe('panel');
      expect(panel?.dataset.targetMode).toBe('activity');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('does not mount the activity terminal panel before the first catalog snapshot is ready', async () => {
    const [hydrated, setHydrated] = createSignal(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();
    const catalog = {
      hydrated,
      stale: () => false,
    } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="terminal-panel"]')).toBeNull();

      setHydrated(true);
      await Promise.resolve();

      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).toBeNull();
      expect(host.querySelector('[data-testid="terminal-panel"]')).not.toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('shows a debounced catalog loading curtain instead of leaving a long wait blank', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();
    const catalog = {
      hydrated: () => false,
      stale: () => false,
    } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      expect(host.querySelector('[data-testid="terminal-catalog-loading-curtain"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(149);
      expect(host.querySelector('[data-testid="terminal-catalog-loading-curtain"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(host.querySelector('[data-testid="terminal-catalog-loading-curtain"]')).not.toBeNull();
    } finally {
      dispose();
      host.remove();
      vi.useRealTimers();
    }
  });

  it('keeps the first activity frame gated when the initial catalog refresh is stale without a snapshot', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();
    const catalog = {
      hydrated: () => false,
      stale: () => true,
    } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="terminal-panel"]')).toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('shows the catalog error and retries without mounting an empty terminal panel', async () => {
    const [hydrated, setHydrated] = createSignal(false);
    const [catalogError, setCatalogError] = createSignal<string | null>('Catalog request failed');
    const [loading, setLoading] = createSignal(false);
    const refresh = vi.fn(async () => {
      setLoading(true);
      await Promise.resolve();
      setCatalogError(null);
      setHydrated(true);
      setLoading(false);
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();
    const catalog = {
      hydrated,
      stale: () => true,
      error: catalogError,
      loading,
      refresh,
    } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      expect(host.querySelector('[data-testid="terminal-catalog-error-state"]')?.textContent).toContain('Catalog request failed');
      expect(host.querySelector('[data-testid="terminal-panel"]')).toBeNull();

      const retry = [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('Refresh'));
      retry?.click();
      await vi.waitFor(() => expect(host.querySelector('[data-testid="terminal-panel"]')).not.toBeNull());

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-testid="terminal-catalog-error-state"]')).toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('mounts the panel permission state after process-launch permission is revoked', async () => {
    const [hydrated, setHydrated] = createSignal(true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env, setEnvValue } = createEnvResource();
    const catalog = {
      hydrated,
      stale: () => false,
    } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      expect(host.querySelector('[data-testid="terminal-panel"]')).not.toBeNull();

      setEnvValue({ permissions: { can_write: false, can_execute: false } });
      setHydrated(false);
      await Promise.resolve();

      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).toBeNull();
      expect(host.querySelector('[data-testid="terminal-permission-empty-state"]')).not.toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('mounts the panel permission state for a server-side denial before Env permissions refresh', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();
    const catalog = {
      hydrated: () => false,
      stale: () => false,
      permissionDenied: () => true,
    } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).toBeNull();
      expect(host.querySelector('[data-testid="terminal-permission-empty-state"]')).not.toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });

  it('keeps the panel mounted after a hydrated catalog becomes stale on disconnect', async () => {
    const [hydrated] = createSignal(true);
    const [stale, setStale] = createSignal(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { resource: env } = createEnvResource();
    const catalog = { hydrated, stale } as any;

    const dispose = render(() => (
      <EnvContext.Provider value={{
        env,
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    try {
      const panel = host.querySelector('[data-testid="terminal-panel"]');
      expect(panel).not.toBeNull();

      setStale(true);
      await Promise.resolve();

      expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).toBeNull();
      expect(host.querySelector('[data-testid="terminal-panel"]')).toBe(panel);
    } finally {
      dispose();
      host.remove();
    }
  });
});
