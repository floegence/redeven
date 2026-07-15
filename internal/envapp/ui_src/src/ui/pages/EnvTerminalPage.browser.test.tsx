import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalSessionCatalogContext } from '../services/terminalSessionCatalog';
import { EnvContext } from './EnvContext';
import { EnvTerminalPage } from './EnvTerminalPage';

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('../widgets/TerminalPanel', () => ({
  TerminalPanel: () => (
    <div data-testid="terminal-panel">
      <button type="button" data-terminal-session-id="session-1">Terminal 1</button>
      <button type="button" data-terminal-session-id="session-2">Terminal 2</button>
    </div>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EnvTerminalPage browser catalog gate', () => {
  it('mounts the first activity Terminal frame only after the complete catalog snapshot is available', async () => {
    const [hydrated, setHydrated] = createSignal(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const catalog = {
      hydrated,
      stale: () => false,
    } as any;

    render(() => (
      <EnvContext.Provider value={{
        openTerminalInDirectoryRequest: () => null,
        consumeOpenTerminalInDirectoryRequest: vi.fn(),
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
        env: Object.assign(
          () => ({ permissions: { can_write: true, can_execute: true } }),
          { state: 'ready', loading: false, error: null },
        ),
      } as any}
      >
        <TerminalSessionCatalogContext.Provider value={catalog}>
          <EnvTerminalPage />
        </TerminalSessionCatalogContext.Provider>
      </EnvContext.Provider>
    ), host);

    expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="terminal-panel"]')).toBeNull();
    expect(host.textContent).not.toContain('Loading terminal sessions');

    setHydrated(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).toBeNull();
    expect(host.querySelectorAll('button[data-terminal-session-id]')).toHaveLength(2);
    expect(host.textContent).not.toContain('Loading terminal sessions');
  });

  it('does not treat an initial stale refresh failure as a presentable catalog snapshot', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const catalog = {
      hydrated: () => false,
      stale: () => true,
    } as any;

    render(() => (
      <EnvContext.Provider value={{
        env: Object.assign(
          () => ({ permissions: { can_write: true, can_execute: true } }),
          { state: 'ready', loading: false, error: null },
        ),
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

    expect(host.querySelector('[data-terminal-catalog-gate="pending"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="terminal-panel"]')).toBeNull();
  });
});
