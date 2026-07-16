import '../../../index.css';

import { page } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import type { BrowserEditorInstallMethod, CodeRuntimeStatus } from '../../services/codeRuntimeApi';
import { CodeRuntimeSettingsCard } from './CodeRuntimeSettingsCard';

function readyStatus(): CodeRuntimeStatus {
  const sharedRoot = '/Users/test/.redeven/shared/code-server/darwin-arm64';
  return {
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
    },
    managed_prefix: '/Users/test/.redeven/local-environment/apps/code/runtime/managed',
    shared_runtime_root: sharedRoot,
    managed_runtime_version: '4.109.1',
    managed_runtime_source: 'managed',
    installed_versions: [
      {
        version: '4.109.1',
        binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
        selected_by_local_environment: true,
        removable: false,
        detection_state: 'ready',
      },
    ],
    operation: {
      state: 'idle',
      log_tail: [],
    },
    updated_at_unix_ms: 1,
  };
}

function mountReadyCard(width: string, desktopTransferAvailable: boolean) {
  const host = document.createElement('div');
  host.style.width = width;
  host.style.margin = '24px auto';
  document.body.appendChild(host);
  const [installMethod, setInstallMethod] = createSignal<BrowserEditorInstallMethod>(
    desktopTransferAvailable ? 'desktop_transfer' : 'remote_download',
  );
  const dispose = render(
    () => (
      <CodeRuntimeSettingsCard
        status={readyStatus()}
        loading={false}
        canInteract
        canManage
        actionLoading={false}
        cancelLoading={false}
        selectionLoadingVersion={null}
        removeVersionLoading={null}
        installMethod={installMethod()}
        desktopTransferAvailable={desktopTransferAvailable}
        onInstallMethodChange={setInstallMethod}
        onRefresh={() => undefined}
        onPrepare={() => undefined}
        onSelectVersion={() => undefined}
        onRemoveVersion={() => undefined}
        onCancel={() => undefined}
      />
    ),
    host,
  );
  return { host, dispose, installMethod };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('CodeRuntimeSettingsCard rendered update method flow', () => {
  let cleanup: (() => void) | undefined;

  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
    document.documentElement.classList.remove('dark', 'light');
    await page.viewport(1280, 720);
  });

  it('chooses both methods inside the ready-state update dialog', async () => {
    await page.viewport(1440, 900);
    const { host, dispose, installMethod } = mountReadyCard('920px', true);
    cleanup = dispose;
    await settle();

    const updateButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Update Browser Editor');
    expect(updateButton).toBeTruthy();
    updateButton?.click();
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const radios = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    expect(dialog).toBeTruthy();
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(getComputedStyle(radios[0]).cursor).toBe('pointer');

    radios[1].click();
    await settle();

    expect(installMethod()).toBe('remote_download');
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(dialog?.textContent).toContain('Environment network → Redeven package service');
    expect(dialog?.textContent).toContain('Workspace files stay in that environment. Setup starts only after you confirm.');
    expect(dialog?.textContent).not.toContain('/Users/test/.redeven');
    expect(dialog?.scrollWidth).toBeLessThanOrEqual((dialog?.clientWidth ?? 0) + 1);
    expect(dialog?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(window.innerWidth);

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });

  it('keeps the unavailable Desktop method visible and stable on mobile', async () => {
    document.documentElement.classList.add('dark');
    await page.viewport(390, 844);
    const { host, dispose, installMethod } = mountReadyCard('calc(100vw - 16px)', false);
    cleanup = dispose;
    await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Update Browser Editor')
      ?.click();
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const radios = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    expect(dialog).toBeTruthy();
    expect(radios).toHaveLength(2);
    expect(radios[0].disabled).toBe(true);
    expect(radios[0].tabIndex).toBe(-1);
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(radios[1].tabIndex).toBe(0);
    expect(installMethod()).toBe('remote_download');
    expect(dialog?.textContent).toContain('Desktop transfer is unavailable because this session does not include the Desktop package bridge.');
    expect(dialog?.scrollWidth).toBeLessThanOrEqual((dialog?.clientWidth ?? 0) + 1);
    expect(dialog?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(window.innerWidth);

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });
});
