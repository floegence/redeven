// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { EnvTerminalPage } from './EnvTerminalPage';
import { EnvContext } from './EnvContext';

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('../widgets/TerminalPanel', () => ({
  TerminalPanel: (props: any) => (
    <div
      data-testid="terminal-panel"
      data-variant={props.variant}
      data-target-mode={props.openSessionRequest?.targetMode ?? ''}
    />
  ),
}));

describe('EnvTerminalPage', () => {
  it('mounts the terminal panel with activity semantics so activity handoffs are accepted', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <EnvContext.Provider value={{
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
});
