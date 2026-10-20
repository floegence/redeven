import '../index.css';
import './flower-feature.css';
import './FlowerSurface.boundedWait.test.shared';

import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([['zh-CN', 390], ['en-US', 1100]] as const)('keeps %s loop failure and keyboard recovery accessible at %s pixels', async (locale, width) => {
  await page.viewport(width, 900);
  const i18n = createTestI18nHelpers(locale);
  const copy = createLocalizedFlowerSurfaceCopy({ locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
  const failed = thread({ status: 'failed', error: { code: 'floret_repeated_tool_calls', message: 'private engine detail', detail: '{"reason":"repeated_tool_calls","thread_id":"thread-1"}' } });
  const retryThread = vi.fn(async () => {});
  const surface = renderSurfaceWithAdapterProps({...adapter(),listThreads:async()=>[failed],loadThread:async()=>liveBootstrap(failed),retryThread},{copy,focusThreadRequest:{request_id:'localized-loop',thread_id:failed.thread_id}});
  surface.style.cssText='width:100%;height:850px;position:relative';
  await waitFor(()=>surface.querySelector('.flower-run-error')!==null);
  const card=surface.querySelector<HTMLElement>('.flower-run-error')!;
  expect(card.querySelector('.flower-error-message')?.textContent).toBe(copy.chat.runErrors.repeatedToolCalls);
  const details=card.querySelector<HTMLDetailsElement>('details')!;
  details.querySelector('summary')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(details.open).toBe(true);
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth+1);
  const retry=[...card.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===copy.chat.retryReply)!;
  expect(retry.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  retry.focus();await userEvent.keyboard('{Enter}');
  await waitFor(()=>retryThread.mock.calls.length===1);
});
