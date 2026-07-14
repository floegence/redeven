import '../../index.css';

import { page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import type { BrowserEditorSetupActivity } from '../services/browserEditorSetupActivity';
import { BrowserEditorSetupActivityPanel } from './BrowserEditorSetupActivityPanel';

const steps: BrowserEditorSetupActivity['steps'] = [
  { id: 'lookup', label: 'Check latest editor', state: 'active' },
  { id: 'cache', label: 'Download to Desktop', state: 'pending' },
  { id: 'upload', label: 'Send to environment', state: 'pending' },
  { id: 'verify', label: 'Verify editor', state: 'pending' },
];

function missingActivity(): BrowserEditorSetupActivity {
  return {
    state: 'missing',
    presentation: 'idle',
    title: 'Browser Editor',
    badge_label: 'Not ready',
    badge_variant: 'neutral',
    summary: 'Install the managed Browser Editor before opening a codespace in this environment.',
    steps,
    active_step_index: 1,
    step_count: 4,
    progress_percent: 14,
    can_retry: false,
    can_cancel: false,
    can_continue: false,
    show_log: false,
    log_tail: [],
  };
}

function unsupportedActivity(): BrowserEditorSetupActivity {
  return {
    ...missingActivity(),
    state: 'failed',
    presentation: 'result',
    badge_label: 'Unsupported environment',
    badge_variant: 'warning',
    summary: 'This environment is not supported by the managed Browser Editor.',
    detail: undefined,
    can_retry: false,
    error_code: 'unsupported_libc',
    platform_diagnosis: {
      code: 'unsupported_libc',
      detected: {
        os: 'linux',
        arch: 'amd64',
        libc: 'musl',
        platform_id: 'linux-amd64-musl',
        supported: false,
        unsupported_code: 'unsupported_libc',
      },
      requirement: 'linux_glibc',
      detected_label: 'Linux / amd64 / musl',
      required_label: 'Linux with glibc on amd64 or arm64',
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function mountPanel(activity: BrowserEditorSetupActivity, width: string) {
  const host = document.createElement('div');
  host.style.width = width;
  host.style.margin = '24px auto';
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <BrowserEditorSetupActivityPanel
        activity={activity}
        layout="wide"
        actionLabel="Set up Browser Editor"
        runningLabel="Setting up..."
        onPrepare={() => undefined}
        onDismiss={() => undefined}
        extraDetails={(
          <dl class="browser-editor-setup__detail-list">
            <div class="browser-editor-setup__detail-row">
              <dt>Environment platform</dt>
              <dd data-mono="true">linux-amd64-musl</dd>
            </div>
            <div class="browser-editor-setup__detail-row">
              <dt>Error code</dt>
              <dd data-mono="true">unsupported_libc</dd>
            </div>
          </dl>
        )}
      />
    ),
    host,
  );
  return { host, dispose };
}

describe('BrowserEditorSetupActivityPanel rendered layout', () => {
  let cleanup: (() => void) | undefined;

  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
    await page.viewport(1280, 720);
  });

  it('keeps the idle wide layout balanced on desktop', async () => {
    await page.viewport(1440, 900);
    const { host, dispose } = mountPanel(missingActivity(), '1180px');
    cleanup = dispose;
    await settle();

    const panel = host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]');
    const body = panel?.querySelector<HTMLElement>('.browser-editor-setup__body');
    const primary = panel?.querySelector<HTMLElement>('.browser-editor-setup__primary');
    const secondary = panel?.querySelector<HTMLElement>('.browser-editor-setup__secondary');
    expect(panel?.dataset.layout).toBe('wide');
    expect(body && getComputedStyle(body).gridTemplateColumns.split(' ')).toHaveLength(2);

    const primaryWidth = primary?.getBoundingClientRect().width ?? 0;
    const secondaryWidth = secondary?.getBoundingClientRect().width ?? 0;
    const ratio = primaryWidth / (primaryWidth + secondaryWidth);
    expect(ratio).toBeGreaterThan(0.515);
    expect(ratio).toBeLessThan(0.525);
    expect(Math.abs((primary?.getBoundingClientRect().height ?? 0) - (secondary?.getBoundingClientRect().height ?? 0))).toBeLessThanOrEqual(1);
    expect(panel?.scrollWidth).toBeLessThanOrEqual((panel?.clientWidth ?? 0) + 1);
    expect(host.textContent).not.toContain('Step 1 of 4');

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });

  it('stays within 1920x1080 and 1024x768 desktop viewports', async () => {
    for (const [width, height, panelWidth] of [
      [1920, 1080, '1600px'],
      [1024, 768, 'calc(100vw - 24px)'],
    ] as const) {
      await page.viewport(width, height);
      const { host, dispose } = mountPanel(missingActivity(), panelWidth);
      await settle();

      const panel = host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]');
      const body = panel?.querySelector<HTMLElement>('.browser-editor-setup__body');
      expect(body && getComputedStyle(body).gridTemplateColumns.split(' ')).toHaveLength(2);
      expect(panel?.scrollWidth).toBeLessThanOrEqual((panel?.clientWidth ?? 0) + 1);
      expect(panel?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(window.innerWidth);

      const screenshot = await page.screenshot({ save: false });
      expect(screenshot.length).toBeGreaterThan(1_000);
      dispose();
      host.remove();
    }
  });

  it('shows terminal platform diagnosis without retry and expands technical details', async () => {
    await page.viewport(1440, 900);
    const { host, dispose } = mountPanel(unsupportedActivity(), '1180px');
    cleanup = dispose;
    await settle();

    expect(host.textContent).toContain('Detected');
    expect(host.textContent).toContain('Linux / amd64 / musl');
    expect(host.textContent).toContain('Linux with glibc on amd64 or arm64');
    expect(host.textContent).not.toContain('Set up Browser Editor');

    const detailsTrigger = host.querySelector<HTMLButtonElement>('.browser-editor-setup__details-trigger');
    expect(detailsTrigger?.getAttribute('aria-expanded')).toBe('false');
    detailsTrigger?.click();
    await settle();
    expect(detailsTrigger?.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('unsupported_libc');
    expect(host.querySelector<HTMLElement>('.browser-editor-setup__details-content')).toBeTruthy();

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });

  it('collapses the wide panel and stepper without overflow on a narrow viewport', async () => {
    await page.viewport(390, 844);
    const { host, dispose } = mountPanel(missingActivity(), 'calc(100vw - 24px)');
    cleanup = dispose;
    await settle();

    const panel = host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]');
    const body = panel?.querySelector<HTMLElement>('.browser-editor-setup__body');
    const stepsElement = panel?.querySelector<HTMLElement>('.browser-editor-setup__steps');
    expect(body && getComputedStyle(body).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(stepsElement && getComputedStyle(stepsElement).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(panel?.scrollWidth).toBeLessThanOrEqual((panel?.clientWidth ?? 0) + 1);
    expect((panel?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(window.innerWidth);

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });
});
