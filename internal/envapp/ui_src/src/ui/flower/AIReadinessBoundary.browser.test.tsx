import '../../index.css';
import '../flower-feature.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';

import { I18nProvider } from '../i18n';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { AIReadinessBoundary } from './AIReadinessBoundary';
import type { AIReadinessController, AIReadinessSnapshot } from './aiReadiness';

const disposers: Array<() => void> = [];
const mediaCommands = commands as unknown as Readonly<{
  auditReadinessAccessibility: () => Promise<readonly Readonly<{
    id: string;
    impact: string | null;
    description: string;
    targets: readonly string[];
  }>[]>;
  emulateMediaPreferences: (preferences: Readonly<{
    forcedColors?: null | 'active' | 'none';
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
  inspectReadinessScreenshot: () => Promise<Readonly<{
    width: number;
    height: number;
    opaquePixels: number;
    distinctColorBuckets: number;
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
  }>>;
  sizeReadinessFrame: (size: Readonly<{ width: number; height: number }>) => Promise<void>;
}>;

function blocked(): AIReadinessSnapshot {
  return {
    state: 'blocked',
    reason_code: 'temporarily_blocked',
    retryable: true,
    safe_to_retry: true,
    committed: false,
    rolled_back: false,
  };
}

function blockedReason(
  reason_code: AIReadinessSnapshot['reason_code'],
  overrides: Partial<AIReadinessSnapshot> = {},
): AIReadinessSnapshot {
  return {
    state: 'blocked',
    reason_code,
    retryable: false,
    safe_to_retry: false,
    committed: false,
    rolled_back: false,
    ...overrides,
  };
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mountHarness(
  initial = blocked(),
  pending = false,
  retryResult?: Promise<AIReadinessSnapshot>,
): Readonly<{ host: HTMLElement; setSnapshot: (snapshot: AIReadinessSnapshot) => void }> {
  writeStoredLanguagePreference('en-US');
  const [snapshot, setSnapshot] = createSignal(initial);
  const [retryPending, setRetryPending] = createSignal(pending);
  const controller: AIReadinessController = {
    snapshot,
    loading: () => false,
    retryPending,
    nextCheckAt: () => null,
    refresh: async () => snapshot(),
    retry: async () => {
      setRetryPending(true);
      performance.mark('ai-readiness-pending-committed');
      const next = await (retryResult ?? Promise.resolve(snapshot()));
      setSnapshot(next);
      setRetryPending(false);
      return next;
    },
    dispose: () => undefined,
  };
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
      <AIReadinessBoundary
        controller={controller}
        onOpenUpdate={() => undefined}
        onOpenPermissions={() => undefined}
        canRetryGeneration
        focusEnabled
      >
        <button type="button">Flower child</button>
      </AIReadinessBoundary>
    </I18nProvider>
  ), host));
  return { host, setSnapshot };
}

function mount(initial = blocked(), pending = false): HTMLElement {
  return mountHarness(initial, pending).host;
}

async function settleFrames(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function expectAuditedVisualEvidence(expectedWidth: number, expectedHeight: number): Promise<void> {
  expect(await mediaCommands.auditReadinessAccessibility()).toEqual([]);
  const screenshot = await mediaCommands.inspectReadinessScreenshot();
  expect(screenshot.cssWidth).toBe(expectedWidth);
  expect(screenshot.cssHeight).toBe(expectedHeight);
  expect(screenshot.width).toBeGreaterThanOrEqual(Math.min(expectedWidth, 300));
  expect(screenshot.height).toBeGreaterThanOrEqual(Math.min(expectedHeight, 300));
  expect(screenshot.devicePixelRatio).toBeGreaterThan(0);
  expect(screenshot.opaquePixels).toBeGreaterThan(screenshot.width * screenshot.height * 0.95);
  expect(screenshot.distinctColorBuckets).toBeGreaterThan(8);
}

async function sizeReadinessSurface(width: number, height: number): Promise<void> {
  await mediaCommands.sizeReadinessFrame({ width, height });
  await settleFrames(2);
}

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.style.fontSize = '';
  writeStoredLanguagePreference('en-US');
  await mediaCommands.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
  await page.viewport(1280, 720);
});

describe('AIReadinessBoundary browser layout', () => {
  it('remains usable at 320px with 200% text and no horizontal overflow', async () => {
    await page.viewport(320, 720);
    document.documentElement.style.fontSize = '200%';
    const host = mount();
    await sizeReadinessSurface(320, 720);
    await expect.element(page.getByText('Agent data is temporarily in use', { exact: true })).toBeVisible();
    await settleFrames();

    const boundary = host.querySelector<HTMLElement>('.ai-readiness-boundary')!;
    const surface = host.querySelector<HTMLElement>('.ai-readiness-surface')!;
    const inner = host.querySelector<HTMLElement>('.ai-readiness-surface__inner')!;
    const heading = host.querySelector<HTMLElement>('h1')!;
    expect(boundary.scrollWidth).toBeLessThanOrEqual(boundary.clientWidth + 1);
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(inner.scrollWidth).toBeLessThanOrEqual(inner.clientWidth + 1);
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth + 1);
    expect(getComputedStyle(surface).position).not.toBe('fixed');
    expect(surface.hasAttribute('inert')).toBe(false);
    await expectAuditedVisualEvidence(320, 720);

    const disclosure = host.querySelector<HTMLButtonElement>('button[aria-controls^="ai-readiness-diagnostic-"]')!;
    expect(getComputedStyle(disclosure).cursor).toBe('pointer');
    await page.getByText('View diagnostics', { exact: true }).click();
    await settleFrames();
    const diagnostics = host.querySelector<HTMLElement>('.ai-readiness-diagnostics__content')!;
    expect(diagnostics.scrollWidth).toBeLessThanOrEqual(diagnostics.clientWidth + 1);
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
  });

  it('honors forced colors, reduced motion, and the disabled cursor contract', async () => {
    await page.viewport(390, 720);
    await mediaCommands.emulateMediaPreferences({ forcedColors: 'active', reducedMotion: 'reduce' });
    const host = mount(blocked(), true);
    await sizeReadinessSurface(390, 720);
    await expect.element(page.getByText('Checking...', { exact: true })).toBeVisible();
    await settleFrames();

    expect(window.matchMedia('(forced-colors: active)').matches).toBe(true);
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const retry = host.querySelector<HTMLButtonElement>('.ai-readiness-action--primary')!;
    const statusIcon = host.querySelector<HTMLElement>('.ai-readiness-status-icon')!;
    const disclosureIcon = host.querySelector<HTMLElement>('button[aria-controls^="ai-readiness-diagnostic-"] svg')!;
    expect(retry.disabled).toBe(true);
    expect(getComputedStyle(retry).cursor).toBe('not-allowed');
    expect(getComputedStyle(retry).transitionDuration).toBe('0s');
    expect(getComputedStyle(disclosureIcon).transitionDuration).toBe('0s');
    expect(getComputedStyle(statusIcon).borderTopStyle).not.toBe('none');
    expect(getComputedStyle(retry).borderTopStyle).not.toBe('none');
    await expectAuditedVisualEvidence(390, 720);
  });

  it.each([
    [blockedReason('temporarily_blocked', { retryable: true, safe_to_retry: true }), 'Agent data is temporarily in use'],
    [blockedReason('update_required'), 'Redeven needs an update'],
    [blockedReason('unsupported_store'), 'This Agent data cannot be opened here'],
    [blockedReason('store_integrity_error'), 'Agent data needs attention'],
    [blockedReason('environment_permission_error'), 'Redeven cannot access Agent data'],
    [blockedReason('store_io_error'), 'Agent data is unavailable'],
    [blockedReason('configuration_error'), 'Agent storage configuration does not match'],
    [blockedReason('migration_rolled_back', { rolled_back: true }), 'The Agent data update was rolled back'],
    [blockedReason('post_commit_verification_error', { committed: true }), 'The Agent data update needs verification'],
    [blockedReason('cancelled'), 'The Agent data check was interrupted'],
    [blockedReason('contract_error'), 'Flower is unavailable'],
    [blockedReason('ai_service_startup_error'), 'Flower could not start'],
    [blockedReason('ai_readiness_contract_error'), 'Flower is unavailable'],
  ] as const)('renders a nonblank, non-overflowing desktop state for %s', async (snapshot, title) => {
    await page.viewport(1280, 720);
    const host = mount(snapshot);
    await sizeReadinessSurface(1280, 720);
    await expect.element(page.getByText(title, { exact: true })).toBeVisible();
    await settleFrames();

    const surface = host.querySelector<HTMLElement>('.ai-readiness-surface')!;
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    const titleRect = host.querySelector<HTMLElement>('.ai-readiness-title')!.getBoundingClientRect();
    const descriptionRect = host.querySelector<HTMLElement>('.ai-readiness-description')!.getBoundingClientRect();
    const dataRect = host.querySelector<HTMLElement>('.ai-readiness-data-statement')!.getBoundingClientRect();
    expect(titleRect.bottom).toBeLessThanOrEqual(descriptionRect.top + 1);
    expect(descriptionRect.bottom).toBeLessThanOrEqual(dataRect.top + 1);
    await expectAuditedVisualEvidence(1280, 720);
  });

  it.each([
    [blockedReason('', { state: 'inspecting' }), 'Checking Agent data'],
    [blockedReason('', { state: 'migrating' }), 'Updating Agent data'],
    [blockedReason('', { state: 'verifying' }), 'Verifying Agent data'],
  ] as const)('audits the %s busy phase without inventing progress', async (snapshot, title) => {
    await page.viewport(1280, 720);
    mount(snapshot);
    await sizeReadinessSurface(1280, 720);
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    await expect.element(page.getByText(title, { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\b\d+%/u);
    await expectAuditedVisualEvidence(1280, 720);
  });

  it('commits retry pending within the input turn and before the next animation frame', async () => {
    await page.viewport(1280, 720);
    const result = deferred<AIReadinessSnapshot>();
    const { host } = mountHarness(blocked(), false, result.promise);
    await sizeReadinessSurface(1280, 720);
    const retry = host.querySelector<HTMLButtonElement>('.ai-readiness-action--primary')!;
    performance.clearMarks('ai-readiness-input');
    performance.clearMarks('ai-readiness-pending-committed');
    retry.addEventListener('click', () => performance.mark('ai-readiness-input'), { capture: true, once: true });

    await page.getByText('Check again', { exact: true }).click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const inputMark = performance.getEntriesByName('ai-readiness-input').at(-1);
    const pendingMark = performance.getEntriesByName('ai-readiness-pending-committed').at(-1);
    expect(inputMark).toBeTruthy();
    expect(pendingMark).toBeTruthy();
    expect(pendingMark!.startTime - inputMark!.startTime).toBeLessThanOrEqual(32);
    expect(retry.disabled).toBe(true);
    expect(retry.dataset.pending).toBe('true');
    expect(retry.getAttribute('aria-busy')).toBe('true');

    result.resolve(blockedReason('', { state: 'ready' }));
    await settleFrames();
  });

  it('restores the same visible Flower DOM after a blocked-ready transition', async () => {
    await page.viewport(1280, 720);
    const ready = blockedReason('', { state: 'ready' });
    const { host, setSnapshot } = mountHarness(ready);
    await sizeReadinessSurface(1280, 720);
    const child = host.querySelector<HTMLButtonElement>('[data-ai-readiness-content] button')!;
    expect(child.textContent).toBe('Flower child');
    expect(child.offsetParent).not.toBeNull();

    setSnapshot(blockedReason('store_integrity_error'));
    await expect.element(page.getByText('Agent data needs attention', { exact: true })).toBeVisible();
    expect(child.offsetParent).toBeNull();
    setSnapshot(ready);
    await settleFrames();

    expect(host.querySelector('[data-ai-readiness-content] button')).toBe(child);
    expect(child.offsetParent).not.toBeNull();
    expect(host.querySelector('.ai-readiness-surface')).toBeNull();
    await expectAuditedVisualEvidence(1280, 720);
  });
});
