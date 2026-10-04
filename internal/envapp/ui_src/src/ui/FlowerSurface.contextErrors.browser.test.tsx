import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import './FlowerSurface.contextErrors.test.shared';
beforeEach(() => page.viewport(1280, 900));

import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => document.documentElement.classList.remove('dark'));

it.each([['zh-CN', 390], ['en-US', 1100]] as const)('keeps %s context diagnostics accessible at %s px', async (locale, width) => {
  await page.viewport(width, 900);
  document.documentElement.classList.add('dark');
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const failed = thread({ status: 'failed', error: { code: 'context_budget_invalid', message: 'budget error', detail: 'context_window_tokens=3891\nreserved_output_tokens=4096\nrequest_safe_limit=-205' } });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [failed]), loadThread: vi.fn(async () => liveBootstrap(failed)) }, { copy, focusThreadRequest: { request_id: "budget-layout", thread_id: failed.thread_id } });
  surface.style.cssText = `width:${width}px;height:850px;position:relative;`;
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
  const card = surface.querySelector<HTMLElement>('.flower-error-card')!;
  expect(card.querySelector('.flower-error-title')?.textContent).toBe(copy.chat.runContextErrorTitle);
  const disclosure = card.querySelector<HTMLDetailsElement>('details')!;
  disclosure.querySelector('summary')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(disclosure.open).toBe(true);
  expect(getComputedStyle(disclosure.querySelector('summary')!).cursor).toBe('pointer');
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  for (const button of card.querySelectorAll('button')) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right + 1);
    expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
  }
  await page.screenshot({ element: surface, path: `__screenshots__/redeven-context-errors-${locale}.png` });
});
