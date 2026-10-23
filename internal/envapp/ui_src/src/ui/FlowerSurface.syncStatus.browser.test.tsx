import '../index.css';
import './flower-feature.css';

import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => document.documentElement.classList.remove('dark'));

it.each([['zh-CN', 320, false], ['en-US', 1100, true], ['de-DE', 390, true]] as const)(
  'keeps %s sync status and keyboard recovery readable at %i pixels', async (locale, width, dark) => {
    await page.viewport(width, 900);
    document.documentElement.classList.toggle('dark', dark);
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({ locale,
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
    const running = thread({ status: 'running' });
    const failure = deferred<void>(); const ready = deferred<void>();
    let attempts = 0;
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true),
      loadThread: vi.fn(async () => liveBootstrap(running, attempts > 1 ? 10 : 9)),
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        const attempt = ++attempts;
        if (attempt > 1) await ready.promise;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [running] };
        if (attempt === 1) { await failure.promise; throw new Error('private application diagnostic'); }
        if (!input.signal.aborted) await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { copy, focusThreadRequest: { request_id: 'sync-layout', thread_id: running.thread_id } });
    surface.style.cssText = 'width:' + width + 'px;height:850px;position:relative;';
    await waitFor(() => Boolean(surface.querySelector('[data-flower-progress-kind]')));
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Preserved draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    failure.resolve();
    await waitFor(() => Boolean(surface.querySelector('[data-flower-progress-sync-state="failed"]')));
    const status = surface.querySelector<HTMLElement>('.flower-model-status-sync')!;
    expect(status.querySelector('[role="status"]')?.textContent).toBe(copy.chat.syncStatusFailed);
    expect(status.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(status.scrollWidth).toBeLessThanOrEqual(status.clientWidth + 1);
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(surface.textContent).not.toContain('private application diagnostic');
    expect(surface.querySelector('[data-flower-progress-kind]')).toBeNull();
    const retry = status.querySelector<HTMLButtonElement>('button')!;
    expect(retry.getBoundingClientRect().right).toBeLessThanOrEqual(status.getBoundingClientRect().right + 1);
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await page.screenshot({ element: surface, path: '__screenshots__/flower-sync-status-' + locale + '.png' });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => attempts === 2);
    expect(surface.querySelector('.flower-model-status-sync [role="status"]')?.textContent).toBe(copy.chat.syncStatusConnecting);
    expect(surface.querySelector('.flower-model-status-sync button')).toBeNull();
    ready.resolve();
    await waitFor(() => Boolean(surface.querySelector('[data-flower-progress-kind]')) && !surface.querySelector('.flower-workspace-sync'));
    expect(surface.querySelector('.flower-model-status-sync')).toBeNull();
    expect(surface.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Preserved draft');
  },
);
