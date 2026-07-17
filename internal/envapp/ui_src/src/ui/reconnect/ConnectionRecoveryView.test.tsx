// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';
import { ConnectionRecoveryView } from './ConnectionRecoveryView';
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

const bridgeMocks = vi.hoisted(() => ({
  openConnectionCenter: vi.fn(async () => undefined),
}));

vi.mock('../services/desktopShellBridge', () => ({
  openConnectionCenter: bridgeMocks.openConnectionCenter,
}));

vi.mock('../primitives/Tooltip', () => ({
  Tooltip: (props: any) => <span data-tooltip={String(props.content ?? '')}>{props.children}</span>,
}));

function failedSnapshot(): ConnectionRecoverySnapshot {
  return {
    generation: 2,
    revision: 9,
    state: 'failed',
    phase: 'failed',
    started_at_unix_ms: 100,
    runtime_probe_attempt_count: 1,
    protocol_attempt_count: 0,
    availability_status: 'unknown',
    protocol_connected: false,
    secure_session: 'pending',
    failure: {
      code: 'transport_unavailable',
      retryable: false,
      technical_detail: 'HTTP 502 Bad Gateway',
      http_status: 502,
      error_code: 'process_identity_changed',
    },
    desktop_transport: {
      generation: 2,
      revision: 9,
      phase: 'failed',
      attempt_count: 2,
      started_at_unix_ms: 100,
      failure: {
        code: 'process_identity_changed',
        error_name: 'RuntimePlacementBridgeIdentityChangedError',
        technical_detail: 'HTTP 502 Bad Gateway',
      },
      actions: ['open_connection_center'],
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ConnectionRecoveryView', () => {
  it('renders a real Desktop recovery attempt and retry action without exposing technical HTTP text', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const retry = vi.fn(async () => undefined);
    const dispose = render(() => (
      <I18nProvider>
        <ConnectionRecoveryView
          environmentName="Build Environment"
          onRetry={retry}
          snapshot={{
            generation: 1,
            revision: 4,
            state: 'recovering',
            phase: 'desktop_transport',
            started_at_unix_ms: 100,
            next_retry_at_unix_ms: Date.now() + 2_000,
            runtime_probe_attempt_count: 0,
            protocol_attempt_count: 0,
            availability_status: 'unknown',
            protocol_connected: false,
            secure_session: 'pending',
            failure: {
              code: 'transport_unavailable',
              retryable: true,
              technical_detail: 'HTTP 502 Bad Gateway',
            },
            desktop_transport: {
              generation: 1,
              revision: 4,
              phase: 'waiting',
              attempt_count: 2,
              started_at_unix_ms: 100,
              next_attempt_at_unix_ms: Date.now() + 2_000,
              actions: ['retry_now'],
            },
          }}
        />
      </I18nProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Restoring connection');
      expect(host.textContent).toContain('Build Environment');
      expect(host.textContent).toContain('2 attempts');
      expect(host.textContent).not.toContain('HTTP 502');
      const retryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Retry now'));
      retryButton?.click();
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      host.remove();
    }
  });

  it('does not offer an immediate retry while Desktop is already reconnecting', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <I18nProvider>
        <ConnectionRecoveryView
          environmentName="Build Environment"
          onRetry={async () => undefined}
          snapshot={{
            generation: 1,
            revision: 5,
            state: 'recovering',
            phase: 'desktop_transport',
            started_at_unix_ms: 100,
            runtime_probe_attempt_count: 0,
            protocol_attempt_count: 0,
            availability_status: 'unknown',
            protocol_connected: false,
            secure_session: 'pending',
            desktop_transport: {
              generation: 1,
              revision: 5,
              phase: 'connecting',
              attempt_count: 3,
              started_at_unix_ms: 100,
              actions: [],
            },
          }}
        />
      </I18nProvider>
    ), host);

    try {
      expect(host.textContent).toContain('3 attempts');
      expect(host.textContent).not.toContain('Retry now');
    } finally {
      dispose();
      host.remove();
    }
  });

  it('focuses the terminal failure, preserves technical details collapsed, and opens Connection Center', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const dispose = render(() => (
      <I18nProvider>
        <ConnectionRecoveryView
          environmentName="Remote Build"
          onRetry={async () => undefined}
          snapshot={failedSnapshot()}
        />
      </I18nProvider>
    ), host);
    await Promise.resolve();

    try {
      const heading = host.querySelector('h1[role="alert"]') as HTMLHeadingElement | null;
      expect(heading?.textContent).toContain('Connection could not be restored');
      expect(document.activeElement).toBe(heading);
      const details = host.querySelector('details');
      expect(details?.open).toBe(false);
      expect(host.textContent).toContain('cannot be rebound safely');
      const connectionCenterButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Open Connection Center'));
      connectionCenterButton?.click();
      expect(bridgeMocks.openConnectionCenter).toHaveBeenCalledTimes(1);

      const copyButton = host.querySelector('button[aria-label="Copy diagnostic"]') as HTMLButtonElement | null;
      copyButton?.click();
      await Promise.resolve();
      expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('HTTP 502 Bad Gateway'));
    } finally {
      dispose();
      host.remove();
    }
  });
});
