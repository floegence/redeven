import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';

import { I18nProvider } from '../i18n';
import type { RedevenLocale } from '../i18n/localeMeta';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { ConnectionRecoveryView } from './ConnectionRecoveryView';
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

type Theme = 'light' | 'dark';

type RecoveryFixture = Readonly<{
  locale: RedevenLocale;
  theme: Theme;
  viewport: Readonly<{ width: number; height: number }>;
  snapshot: ConnectionRecoverySnapshot;
  onStop?: () => Promise<void>;
  onRetry?: () => Promise<void>;
}>;

const disposers: Array<() => void> = [];
const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    forcedColors?: null | 'active' | 'none';
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;

function recoveringSnapshot(withDesktopTransport = true): ConnectionRecoverySnapshot {
  const retryAt = Date.now() + 12_000;
  return {
    generation: 4,
    revision: 12,
    state: 'recovering',
    phase: withDesktopTransport ? 'desktop_transport' : 'protocol_connect',
    started_at_unix_ms: Date.now() - 18_000,
    next_retry_at_unix_ms: retryAt,
    protocol_attempt_count: 3,
    availability_status: withDesktopTransport ? 'unknown' : 'offline',
    protocol_connected: false,
    secure_session: 'pending',
    failure: {
      code: 'runtime_unavailable',
      retryable: true,
      technical_detail: 'HTTP 502 Bad Gateway',
      http_status: 502,
    },
    ...(withDesktopTransport ? {
      desktop_transport: {
        generation: 4,
        revision: 12,
        phase: 'waiting' as const,
        attempt_count: 7,
        started_at_unix_ms: Date.now() - 18_000,
        next_attempt_at_unix_ms: retryAt,
        actions: ['retry_now' as const],
      },
    } : {}),
  };
}

function succeededSnapshot(): ConnectionRecoverySnapshot {
  return {
    generation: 2,
    revision: 8,
    state: 'succeeded',
    phase: 'completed',
    started_at_unix_ms: Date.now() - 4_000,
    recovered_at_unix_ms: Date.now(),
    protocol_attempt_count: 1,
    availability_status: 'online',
    protocol_connected: true,
    secure_session: 'ready',
  };
}

function failedSnapshot(): ConnectionRecoverySnapshot {
  return {
    generation: 6,
    revision: 19,
    state: 'failed',
    phase: 'failed',
    started_at_unix_ms: Date.now() - 42_000,
    protocol_attempt_count: 2,
    availability_status: 'unknown',
    protocol_connected: false,
    secure_session: 'pending',
    failure: {
      code: 'transport_unavailable',
      retryable: false,
      technical_detail: 'HTTP 502 Bad Gateway',
      error_code: 'process_identity_changed',
      http_status: 502,
    },
    desktop_transport: {
      generation: 6,
      revision: 19,
      phase: 'failed',
      attempt_count: 5,
      started_at_unix_ms: Date.now() - 42_000,
      failure: {
        code: 'process_identity_changed',
        error_name: 'RuntimePlacementBridgeIdentityChangedError',
        technical_detail: 'HTTP 502 Bad Gateway',
      },
      actions: ['open_connection_center'],
    },
  };
}

async function settleFrames(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function mountFixture(fixture: RecoveryFixture): Promise<HTMLElement> {
  await page.viewport(fixture.viewport.width, fixture.viewport.height);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(fixture.theme);
  writeStoredLanguagePreference(fixture.locale);

  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    background: 'var(--background)',
  });
  document.body.appendChild(host);
  disposers.push(render(() => (
    <I18nProvider>
      <ConnectionRecoveryView onStop={fixture.onStop ?? (async () => undefined)}
        environmentName="Remote Build Environment with a deliberately long name"
        snapshot={fixture.snapshot}
        onRetry={fixture.onRetry ?? (async () => undefined)}
      />
    </I18nProvider>
  ), host));
  await expect.element(page.getByTestId('connection-recovery-view')).toBeVisible();
  await settleFrames(2);
  return host;
}

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('light', 'dark');
  writeStoredLanguagePreference('en-US');
  await mediaCommands.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
  await page.viewport(1280, 720);
});

describe('ConnectionRecoveryView rendered layout', () => {
  it('keeps real recovery states readable across themes, locales, and desktop or mobile viewports', async () => {
    const cases: readonly RecoveryFixture[] = [
      { locale: 'en-US', theme: 'light', viewport: { width: 1440, height: 900 }, snapshot: { ...failedSnapshot(), desktop_transport: undefined, failure: { code: 'transport_unavailable', retryable: false, technical_detail: 'HTTP 502 Bad Gateway' } } },
      { locale: 'zh-CN', theme: 'dark', viewport: { width: 1280, height: 800 }, snapshot: { ...failedSnapshot(), desktop_transport: undefined, failure: { code: 'transport_unavailable', retryable: false, technical_detail: 'HTTP 502 Bad Gateway' } } },
      { locale: 'zh-CN', theme: 'dark', viewport: { width: 1280, height: 800 }, snapshot: recoveringSnapshot(false) },
      { locale: 'zh-CN', theme: 'dark', viewport: { width: 1280, height: 800 }, snapshot: { ...recoveringSnapshot(false), state: 'paused', phase: 'paused', next_retry_at_unix_ms: undefined } },
      {
        locale: 'en-US',
        theme: 'light',
        viewport: { width: 1440, height: 900 },
        snapshot: recoveringSnapshot(true),
      },
      {
        locale: 'en-US',
        theme: 'dark',
        viewport: { width: 1280, height: 720 },
        snapshot: succeededSnapshot(),
      },
      {
        locale: 'de-DE',
        theme: 'light',
        viewport: { width: 390, height: 844 },
        snapshot: failedSnapshot(),
      },
      {
        locale: 'ru-RU',
        theme: 'dark',
        viewport: { width: 390, height: 844 },
        snapshot: recoveringSnapshot(false),
      },
    ];

    for (const testCase of cases) {
      const host = await mountFixture(testCase);
      const view = host.querySelector<HTMLElement>('[data-testid="connection-recovery-view"]');
      const heading = host.querySelector<HTMLElement>('h1');
      const progress = host.querySelector<HTMLElement>('[role="progressbar"]');
      expect(view).not.toBeNull();
      expect(heading).not.toBeNull();
      expect(progress).toBeNull();
      expect(host.querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
      expect(view!.scrollWidth).toBeLessThanOrEqual(view!.clientWidth + 1);
      expect(heading!.scrollWidth).toBeLessThanOrEqual(heading!.clientWidth + 1);
      const diagnostic = host.querySelector<HTMLElement>('details pre');
      if (testCase.snapshot.state === 'failed') {
        expect(getComputedStyle(heading!).boxShadow).toBe('none');
        expect(host.querySelector('[data-recovery-activity]')).toBeNull();
        const action = host.querySelector<HTMLButtonElement>('[data-recovery-actions] button')!;
        const box = action.getBoundingClientRect();
        expect(box.height).toBeGreaterThanOrEqual(40);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(testCase.viewport.width);
        expect(action.disabled).toBe(false);
        expect(getComputedStyle(action).cursor).toBe('pointer');
        expect(host.querySelector<HTMLDetailsElement>('details')?.open).toBe(false);
        await expect.element(page.getByText('HTTP 502 Bad Gateway', { exact: false })).not.toBeVisible();
      } else {
        expect(diagnostic).toBeNull();
        expect(host.textContent).not.toContain('HTTP 502');
      }
      expect(view!.querySelectorAll('li').length).toBe(testCase.snapshot.desktop_transport ? 5 : 4);
      if (import.meta.env.VITE_CONNECTION_RECOVERY_SCREENSHOTS === '1') {
        await page.screenshot({ path: `__screenshots__/connection-${testCase.locale}-${testCase.theme}-${testCase.snapshot.state}.png` });
      } else {
        expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
      }

      disposers.pop()?.();
      host.remove();
      await settleFrames(1);
    }
  });

  it('keeps keyboard focus on the next recovery action when stopping and resuming', async () => {
    const [snapshot, setSnapshot] = createSignal(recoveringSnapshot(false));
    let stops = 0;
    let resumes = 0;
    await mountFixture({
      locale: 'en-US', theme: 'light', viewport: { width: 390, height: 844 },
      get snapshot() { return snapshot(); },
      onStop: async () => {
        stops += 1;
        setSnapshot({ ...snapshot(), state: 'paused', phase: 'paused', next_retry_at_unix_ms: undefined });
      },
      onRetry: async () => {
        resumes += 1;
        setSnapshot({ ...snapshot(), state: 'recovering', phase: 'protocol_connect' });
      },
    });
    await page.getByRole('button', { name: 'Stop retrying', exact: true }).click();
    await expect.element(page.getByRole('heading', { name: 'Reconnection stopped' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Resume connection', exact: true })).toHaveFocus();
    await page.getByRole('button', { name: 'Resume connection', exact: true }).click();
    await expect.element(page.getByText('Connecting now…', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Stop retrying', exact: true })).toHaveFocus();
    expect(stops).toBe(1);
    expect(resumes).toBe(1);
  });

  it('stops active-step motion for reduced motion and reveals diagnostics only on request', async () => {
    await mediaCommands.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'reduce' });
    const recoveringHost = await mountFixture({
      locale: 'en-US',
      theme: 'dark',
      viewport: { width: 1440, height: 900 },
      snapshot: recoveringSnapshot(true),
    });
    const animatedIcons = recoveringHost.querySelectorAll<HTMLElement>('[class*="motion-safe:animate"]');
    expect(animatedIcons.length).toBeGreaterThan(0);
    for (const icon of animatedIcons) {
      expect(getComputedStyle(icon).animationName).toBe('none');
    }

    disposers.pop()?.();
    recoveringHost.remove();
    const failedHost = await mountFixture({
      locale: 'en-US',
      theme: 'light',
      viewport: { width: 390, height: 844 },
      snapshot: failedSnapshot(),
    });
    const details = failedHost.querySelector<HTMLDetailsElement>('details');
    const heading = failedHost.querySelector<HTMLHeadingElement>('h1[role="alert"]');
    expect(details?.open).toBe(false);
    await expect.element(page.getByText('HTTP 502 Bad Gateway', { exact: false })).not.toBeVisible();
    expect(document.activeElement).toBe(heading);
    await page.getByText('Technical details', { exact: true }).click();
    expect(details?.open).toBe(true);
    await expect.element(page.getByText('HTTP 502 Bad Gateway', { exact: false })).toBeVisible();
    expect(failedHost.textContent).toContain('HTTP 502 Bad Gateway');
    const connectionCenterButton = failedHost.querySelector<HTMLButtonElement>('button');
    expect(connectionCenterButton && getComputedStyle(connectionCenterButton).cursor).toBe('pointer');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });
});
