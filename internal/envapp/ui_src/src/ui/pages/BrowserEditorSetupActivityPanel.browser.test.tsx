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

function uploadActivity(): BrowserEditorSetupActivity {
  return {
    ...missingActivity(),
    state: 'preparing',
    presentation: 'progress',
    badge_label: 'Preparing',
    badge_variant: 'info',
    summary: 'Sending Browser Editor to this environment...',
    steps: [
      { id: 'lookup', label: 'Check latest editor', state: 'done' },
      { id: 'cache', label: 'Download to Desktop', state: 'done' },
      { id: 'upload', label: 'Send to environment', state: 'active' },
      { id: 'verify', label: 'Verify editor', state: 'pending' },
    ],
    active_step_index: 3,
    can_cancel: true,
    progress: {
      operation_id: 'browser-editor:1',
      phase: 'upload',
      state: 'running',
      completed_bytes: 96 * 1024 * 1024,
      total_bytes: 188 * 1024 * 1024,
      updated_at_unix_ms: Date.now(),
    },
  };
}

function awaitingConfirmationActivity(): BrowserEditorSetupActivity {
  const activity = uploadActivity();
  return {
    ...activity,
    progress: {
      ...activity.progress!,
      completed_bytes: activity.progress!.total_bytes,
      state: 'running',
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function cssColorRgba(value: string): [number, number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context is unavailable');
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue, alpha];
}

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground: readonly number[], background: readonly number[]): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mountPanel(
  activity: BrowserEditorSetupActivity,
  width: string,
  layout: 'wide' | 'compact' = 'wide',
) {
  const host = document.createElement('div');
  host.style.width = width;
  host.style.margin = '24px auto';
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <BrowserEditorSetupActivityPanel
        activity={activity}
        layout={layout}
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
    document.documentElement.classList.remove('dark', 'light');
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

  it('renders exact transfer progress without reusing the stage stepper as a percentage', async () => {
    await page.viewport(1440, 900);
    const { host, dispose } = mountPanel(uploadActivity(), '1180px');
    cleanup = dispose;
    await settle();

    const progressbar = host.querySelector<HTMLElement>('.browser-editor-setup__stage-progress-track');
    expect(host.textContent).toContain('Sent 96 MiB of 188 MiB');
    expect(host.textContent).toContain('51%');
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('51');
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(host.querySelector<HTMLElement>('.browser-editor-setup__progress')?.getAttribute('role')).toBeNull();
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });

  it('shows the completion handshake after all bytes are confirmed', async () => {
    await page.viewport(1440, 900);
    const { host, dispose } = mountPanel(awaitingConfirmationActivity(), '1180px');
    cleanup = dispose;
    await settle();

    expect(host.textContent).toContain('Sent 188 MiB of 188 MiB');
    expect(host.textContent).toContain('Transfer complete. Waiting for the environment to confirm receipt.');
    expect(host.querySelector<HTMLElement>('.browser-editor-setup__stage-progress-track')?.getAttribute('aria-valuenow')).toBe('100');
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
    const detailsContent = host.querySelector<HTMLElement>('.browser-editor-setup__details-content');
    const comparison = host.querySelector<HTMLElement>('.browser-editor-setup__comparison');
    const comparisonLabel = host.querySelector<HTMLElement>('.browser-editor-setup__comparison-row dt');
    const detailList = host.querySelector<HTMLElement>('.browser-editor-setup__detail-list');
    const detailLabel = host.querySelector<HTMLElement>('.browser-editor-setup__detail-row dt');
    expect(detailsContent).toBeTruthy();
    expect(getComputedStyle(comparison!).borderTopWidth).toBe('1px');
    expect(getComputedStyle(comparison!).borderRightWidth).toBe('1px');
    expect(getComputedStyle(comparisonLabel!).borderRightWidth).toBe('1px');
    expect(getComputedStyle(comparisonLabel!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(detailList!).borderTopWidth).toBe('1px');
    expect(getComputedStyle(detailList!).borderLeftWidth).toBe('1px');
    expect(getComputedStyle(detailLabel!).borderRightWidth).toBe('1px');
    expect(getComputedStyle(detailLabel!).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });

  it('keeps the dark frame and major section dividers distinct across layouts', async () => {
    document.documentElement.classList.add('dark');
    await page.viewport(1440, 900);

    const wide = mountPanel(unsupportedActivity(), '1180px');
    await settle();
    const widePanel = wide.host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]')!;
    const wideSecondary = wide.host.querySelector<HTMLElement>('.browser-editor-setup__secondary')!;
    const widePanelStyle = getComputedStyle(widePanel);
    const wideSecondaryStyle = getComputedStyle(wideSecondary);
    const panelBackground = cssColorRgba(widePanelStyle.backgroundColor);
    const frameBorder = cssColorRgba(widePanelStyle.borderTopColor);
    const wideDivider = cssColorRgba(wideSecondaryStyle.borderLeftColor);

    expect(widePanelStyle.borderTopWidth).toBe('1px');
    expect(wideSecondaryStyle.borderLeftWidth).toBe('1px');
    expect(frameBorder[3]).toBe(255);
    expect(wideDivider[3]).toBe(255);
    expect(contrastRatio(frameBorder, panelBackground)).toBeGreaterThanOrEqual(2.2);
    expect(contrastRatio(wideDivider, panelBackground)).toBeGreaterThanOrEqual(1.8);
    expect(widePanel.scrollWidth).toBeLessThanOrEqual(widePanel.clientWidth + 1);
    wide.dispose();
    wide.host.remove();

    await page.viewport(1023, 768);
    const responsive = mountPanel(unsupportedActivity(), 'calc(100vw - 24px)');
    await settle();
    const responsivePanel = responsive.host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]')!;
    const responsiveBody = responsive.host.querySelector<HTMLElement>('.browser-editor-setup__body')!;
    const responsiveSecondary = responsive.host.querySelector<HTMLElement>('.browser-editor-setup__secondary')!;
    const responsiveSecondaryStyle = getComputedStyle(responsiveSecondary);
    const responsiveDivider = cssColorRgba(responsiveSecondaryStyle.borderTopColor);

    expect(getComputedStyle(responsiveBody).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(responsiveSecondaryStyle.borderTopWidth).toBe('1px');
    expect(responsiveSecondaryStyle.borderLeftWidth).toBe('0px');
    expect(responsiveDivider[3]).toBe(255);
    expect(contrastRatio(
      responsiveDivider,
      cssColorRgba(getComputedStyle(responsivePanel).backgroundColor),
    )).toBeGreaterThanOrEqual(1.8);
    expect(responsivePanel.scrollWidth).toBeLessThanOrEqual(responsivePanel.clientWidth + 1);
    responsive.dispose();
    responsive.host.remove();

    const compact = mountPanel(unsupportedActivity(), '640px', 'compact');
    cleanup = compact.dispose;
    await settle();
    const compactPanel = compact.host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]')!;
    const compactSecondary = compact.host.querySelector<HTMLElement>('.browser-editor-setup__secondary')!;
    const compactSecondaryStyle = getComputedStyle(compactSecondary);
    const compactDivider = cssColorRgba(compactSecondaryStyle.borderTopColor);

    expect(compactPanel.dataset.layout).toBe('compact');
    expect(compactSecondaryStyle.borderTopWidth).toBe('1px');
    expect(compactSecondaryStyle.borderLeftWidth).toBe('0px');
    expect(compactDivider[3]).toBe(255);
    expect(contrastRatio(compactDivider, cssColorRgba(getComputedStyle(compactPanel).backgroundColor)))
      .toBeGreaterThanOrEqual(1.8);
    expect(compactPanel.scrollWidth).toBeLessThanOrEqual(compactPanel.clientWidth + 1);

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });

  it('collapses the wide panel and stepper without overflow on a narrow viewport', async () => {
    await page.viewport(390, 844);
    const { host, dispose } = mountPanel(uploadActivity(), 'calc(100vw - 24px)');
    cleanup = dispose;
    await settle();

    const panel = host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]');
    const body = panel?.querySelector<HTMLElement>('.browser-editor-setup__body');
    const stepsElement = panel?.querySelector<HTMLElement>('.browser-editor-setup__steps');
    expect(body && getComputedStyle(body).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(stepsElement && getComputedStyle(stepsElement).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(panel?.scrollWidth).toBeLessThanOrEqual((panel?.clientWidth ?? 0) + 1);
    expect((panel?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(window.innerWidth);
    expect(panel?.querySelector<HTMLElement>('.browser-editor-setup__stage-progress-meta')?.scrollWidth)
      .toBeLessThanOrEqual((panel?.querySelector<HTMLElement>('.browser-editor-setup__stage-progress-meta')?.clientWidth ?? 0) + 1);

    const screenshot = await page.screenshot({ save: false });
    expect(screenshot.length).toBeGreaterThan(1_000);
  });
});
