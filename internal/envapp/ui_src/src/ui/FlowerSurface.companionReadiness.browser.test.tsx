import '../index.css';
import './flower-feature.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { BottomBarCompanion, type BottomBarCompanionPhase } from '@floegence/floe-webapp-core/layout';
import { FlowerSurface, createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import { AIReadinessBoundary } from './flower/AIReadinessBoundary';
import type { AIReadinessController, AIReadinessSnapshot } from './flower/aiReadiness';
import { I18nProvider, type RedevenLocale } from './i18n';
import { writeStoredLanguagePreference } from './i18n/storage';
import { adapter, deferred, waitFor } from './FlowerSurface.navigation.testHarness';

const preparing: AIReadinessSnapshot = { state: 'indexing', reason_code: '', stoppable: true, retryable: false, safe_to_retry: false };
const ready: AIReadinessSnapshot = { state: 'ready', reason_code: '', retryable: false, safe_to_retry: false };
const blocked: AIReadinessSnapshot = { state: 'blocked', reason_code: 'temporarily_blocked', retryable: true, safe_to_retry: true };

beforeEach(async () => { await page.viewport(1280, 800); });

function mountCompanion(initial: AIReadinessSnapshot, height = 32, failList = false, locale: RedevenLocale = 'en-US') {
  writeStoredLanguagePreference(locale);
  const runtime = document.createElement('div');
  const anchor = document.createElement('div');
  const overlay = document.createElement('div');
  Object.assign(anchor.style, { position: 'fixed', left: 'calc(50% - 180px)', bottom: '12px', width: '360px', height: height + 'px' });
  document.body.append(runtime, anchor, overlay);
  const [open, setOpen] = createSignal(false);
  const [phase, setPhase] = createSignal<BottomBarCompanionPhase>('collapsed');
  const [focusRequest, setFocusRequest] = createSignal(0);
  const [snapshot, setSnapshot] = createSignal(initial);
  const list = deferred<[]>();
  const listThreads = vi.fn(() => {
    if (failList && listThreads.mock.calls.length === 1) return Promise.reject(new Error('private diagnostic'));
    return list.promise;
  });
  const controller: AIReadinessController = {
    snapshot, loading: () => false, retryPending: () => false,
    busyStartedAt: () => null, startupElapsedMs: () => null, longStartupReadySequence: () => 0,
    stop: vi.fn(async () => { setSnapshot({ ...preparing, state: 'stopped', stoppable: false }); return snapshot(); }),
    retry: vi.fn(async () => { setSnapshot(preparing); return snapshot(); }),
    refresh: async () => snapshot(), pause: () => undefined, resume: async () => snapshot(), dispose: () => undefined,
  };
  const surfaceAdapter = { ...adapter(true), listThreads };
  const draftCoordinator = createFlowerComposerDraftCoordinator();
  const detailVisible = () => open() || phase() !== 'collapsed';
  const close = () => <button type="button" aria-label="Collapse Flower" onClick={() => setOpen(false)}>Close</button>;
  const dispose = render(() => (
    <I18nProvider><BottomBarCompanion retained visible open={open()} anchor={anchor} mount={overlay}
      id="readiness-companion" label="Flower" class="flower-activity-companion" expandedWidth={544}
      onPhaseChange={setPhase} onDismiss={reason => { setOpen(false); if (reason === 'escape') setFocusRequest(value => value + 1); }}>
      <AIReadinessBoundary controller={controller} presentation="companion"
        companionOpen={detailVisible()} companionRegionID="readiness-companion"
        onCompanionOpenRequest={() => setOpen(true)} headerTrailingActions={close()}
        focusComposerRequest={focusRequest()}
        focusEnabled={open()} canRetryGeneration onOpenUpdate={() => undefined}
        onOpenPermissions={() => undefined} onReviewIssues={() => undefined}
        renderContent={() => <FlowerSurface adapter={surfaceAdapter} draftCoordinator={draftCoordinator} notify={vi.fn()}
          presentation="companion" companionOpen={detailVisible()} companionRegionID="readiness-companion"
          engaged={open()} transcriptVisible={open()} onCompanionOpenRequest={() => setOpen(true)}
          headerTrailingActions={close()} focusComposerRequest={focusRequest()} />}
      />
    </BottomBarCompanion></I18nProvider>
  ), runtime);
  onTestFinished(() => { list.resolve([]); dispose(); runtime.remove(); anchor.remove(); overlay.remove(); document.documentElement.classList.remove('dark'); writeStoredLanguagePreference('en-US'); });
  return { overlay, open, setOpen, setSnapshot, list, listThreads, controller, phase };
}

async function compactEntry(fixture: ReturnType<typeof mountCompanion>, height: number) {
  await waitFor(() => fixture.phase() === 'collapsed' && Boolean(fixture.overlay.querySelector('.flower-companion-readiness')));
  const shell = fixture.overlay.querySelector<HTMLElement>('[data-floe-bottom-bar-companion]')!;
  await waitFor(() => shell.getBoundingClientRect().height === height);
  const entry = fixture.overlay.querySelector<HTMLButtonElement>('.flower-companion-readiness')!;
  const rect = entry.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  expect(rect.height).toBe(height - 2);
  expect(rect.top).toBeGreaterThanOrEqual(shellRect.top);
  expect(rect.bottom).toBeLessThanOrEqual(shellRect.bottom);
  expect(entry.scrollHeight).toBe(entry.clientHeight);
  expect(entry.scrollWidth).toBe(entry.clientWidth);
  const icon = entry.querySelector<SVGElement>('.redeven-flower-icon')!.getBoundingClientRect();
  expect(icon.top).toBeGreaterThanOrEqual(rect.top);
  expect(icon.bottom).toBeLessThanOrEqual(rect.bottom);
  expect(entry.getAttribute('aria-expanded')).toBe('false');
  expect(entry.getAttribute('aria-controls')).toBe('readiness-companion');
  expect(fixture.overlay.querySelector('.ai-readiness-surface, .flower-warmup')).toBeNull();
  return entry;
}

it.each([24, 32])('keeps runtime preparation and first conversation loading usable in a %ipx companion', async height => {
  document.documentElement.classList.add('dark');
  const fixture = mountCompanion(preparing, height);
  const entry = await compactEntry(fixture, height);
  expect(entry.textContent).toContain('Preparing conversation history');
  await page.screenshot({ element: entry, path: '__screenshots__/companion-readiness-' + height + '.png' });
  entry.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => fixture.phase() === 'expanded');
  await expect.element(page.getByRole('button', { name: 'Stop preparation', exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Collapse Flower', exact: true })).toBeVisible();
  expect(fixture.controller.stop).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button', { name: 'Collapse Flower', exact: true }));
  await compactEntry(fixture, height);

  fixture.setSnapshot(ready);
  const loading = await compactEntry(fixture, height);
  expect(loading.textContent).toContain('Loading');
  expect(fixture.overlay.querySelector('.flower-composer')).toBeNull();
  loading.focus();
  await userEvent.keyboard(' ');
  await waitFor(() => fixture.phase() === 'expanded' && Boolean(fixture.overlay.querySelector('.flower-warmup')));
  await userEvent.keyboard('{Escape}');
  const restored = await compactEntry(fixture, height);
  await waitFor(() => document.activeElement === restored);
  fixture.list.resolve([]);
  await waitFor(() => Boolean(fixture.overlay.querySelector('.flower-composer textarea')));
  expect(fixture.overlay.querySelector('.flower-companion-readiness')).toBeNull();
  expect(fixture.open()).toBe(false);
  expect(fixture.listThreads).toHaveBeenCalledTimes(1);
});

it('restores runtime status focus after Escape without expanding again', async () => {
  const fixture = mountCompanion(preparing);
  const entry = await compactEntry(fixture, 32);
  entry.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => fixture.phase() === 'expanded');
  await waitFor(() => document.activeElement === fixture.overlay.querySelector('.ai-readiness-title'));
  await userEvent.keyboard('{Escape}');
  const restored = await compactEntry(fixture, 32);
  await waitFor(() => document.activeElement === restored);
  expect(fixture.open()).toBe(false);
});

it('opens runtime failure details before explicit retry and remains compact after stopping', async () => {
  const fixture = mountCompanion(blocked);
  const entry = await compactEntry(fixture, 32);
  expect(entry.textContent).toContain('Agent is temporarily unavailable');
  await userEvent.click(entry);
  await waitFor(() => fixture.phase() === 'expanded');
  expect(fixture.controller.retry).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button', { name: 'Check again', exact: true }));
  await expect.element(page.getByRole('button', { name: 'Stop preparation', exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'Stop preparation', exact: true }));
  await userEvent.click(page.getByRole('button', { name: 'Collapse Flower', exact: true }));
  const stopped = await compactEntry(fixture, 32);
  expect(stopped.textContent?.toLowerCase()).toContain('stopped');
  expect(fixture.controller.stop).toHaveBeenCalledTimes(1);
  expect(fixture.controller.retry).toHaveBeenCalledTimes(1);
});

it('keeps initial conversation failure actionable without retrying on expand', async () => {
  const fixture = mountCompanion(ready, 32, true);
  await waitFor(() => fixture.overlay.querySelector('.flower-companion-readiness')?.getAttribute('data-busy') === 'false');
  const entry = await compactEntry(fixture, 32);
  expect(entry.textContent).not.toContain('private diagnostic');
  await userEvent.click(entry);
  await waitFor(() => fixture.phase() === 'expanded');
  expect(fixture.listThreads).toHaveBeenCalledTimes(1);
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  await waitFor(() => fixture.listThreads.mock.calls.length === 2);
  await userEvent.click(page.getByRole('button', { name: 'Collapse Flower', exact: true }));
  await compactEntry(fixture, 32);
  fixture.list.resolve([]);
  await waitFor(() => Boolean(fixture.overlay.querySelector('.flower-composer textarea')));
});

it('fits the collapsed status at enlarged text and reduced motion without losing keyboard focus', async () => {
  const media = commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference'; forcedColors: 'active' | 'none' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
  document.documentElement.style.fontSize = '200%';
  onTestFinished(async () => { document.documentElement.style.fontSize = ''; await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });
  const fixture = mountCompanion(preparing, 24);
  const entry = await compactEntry(fixture, 24);
  await userEvent.keyboard('{Tab}');
  entry.focus();
  expect(document.activeElement).toBe(entry);
  expect(getComputedStyle(entry).outlineStyle).not.toBe('none');
  expect(getComputedStyle(entry.querySelector('.flower-companion-readiness__icon')!).animationName).toBe('none');
});

it.each(['zh-CN', 'zh-TW'] as const)('keeps %s status and recovery controls available in a narrow companion', async locale => {
  document.documentElement.classList.toggle('dark', locale === 'zh-CN');
  const fixture = mountCompanion(preparing, 32, false, locale);
  const entry = await compactEntry(fixture, 32);
  expect(entry.textContent).not.toContain('Preparing');
  await page.screenshot({ element: entry, path: '__screenshots__/companion-readiness-' + locale + '.png' });
  await userEvent.click(entry);
  await waitFor(() => fixture.phase() === 'expanded');
  const surface = fixture.overlay.querySelector<HTMLElement>('.ai-readiness-surface')!;
  expect(surface.scrollWidth).toBe(surface.clientWidth);
  const stop = fixture.overlay.querySelector<HTMLButtonElement>('.ai-readiness-action--quiet')!;
  expect(stop.getBoundingClientRect().bottom).toBeLessThanOrEqual(surface.getBoundingClientRect().bottom);
  await userEvent.click(page.getByRole('button', { name: 'Collapse Flower', exact: true }));
  await compactEntry(fixture, 32);
});
