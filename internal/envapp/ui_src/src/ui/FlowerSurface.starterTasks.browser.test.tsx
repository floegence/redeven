import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { EnvAppTranslationKey } from './i18n';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { adapter, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => document.documentElement.classList.remove('dark'));

describe('Flower starter task interaction', () => {
  it.each([
    ['zh-CN', 1100, true], ['zh-CN', 360, false], ['en-US', 360, true], ['de-DE', 360, false],
    ['zh-TW', 360, true], ['ja-JP', 360, false], ['ko-KR', 360, true], ['fr-FR', 360, false],
    ['es-ES', 360, true], ['pt-BR', 360, false], ['ru-RU', 360, true],
  ] as const)('keeps %s tasks readable and editable at %s px in dark=%s', async (locale, width, dark) => {
    await page.viewport(width, 1000);
    document.documentElement.classList.toggle('dark', dark);
    const i18n = createTestI18nHelpers(locale);
    const copy = createLocalizedFlowerSurfaceCopy({
      locale,
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
    });
    const surfaceAdapter = adapter();
    const surface = renderSurfaceWithAdapterProps(surfaceAdapter, { copy, layout: true });
    surface.style.cssText = `width:${width}px;height:950px;position:relative;`;
    await waitFor(() => surface.querySelectorAll('.flower-empty-suggestions button').length === 4);

    const composer = surface.querySelector<HTMLTextAreaElement>('textarea')!;
    const cards = Array.from(surface.querySelectorAll<HTMLButtonElement>('.flower-empty-suggestions button'));
    for (const [index, card] of cards.entries()) {
      const task = copy.emptyState.suggestions[index];
      expect(card.textContent).toContain(task.title);
      expect(card.textContent).toContain(task.description);
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      expect(getComputedStyle(card).cursor).toBe('pointer');
      expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(surface.getBoundingClientRect().right + 1);

      // Keyboard activation must fill the full prompt without submitting it.
      card.focus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => document.activeElement === composer);
      expect(composer.value).toBe(task.prompt);
      expect(composer.selectionStart).toBe(task.prompt.length);
      expect(composer.selectionEnd).toBe(task.prompt.length);
      expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(composer.scrollHeight).toBeGreaterThan(composer.clientHeight);
      await userEvent.keyboard(' ');
      expect(composer.value).toBe(`${task.prompt} `);
      expect(surfaceAdapter.launchTurn).not.toHaveBeenCalled();
    }

    // Pointer activation offers the same complete draft and focus handoff.
    await userEvent.click(cards[0]);
    await waitFor(() => document.activeElement === composer);
    expect(composer.value).toBe(copy.emptyState.suggestions[0].prompt);
    expect(surfaceAdapter.launchTurn).not.toHaveBeenCalled();
    if (import.meta.env.VITE_FLOWER_STARTER_SCREENSHOTS === '1') {
      await page.screenshot({ element: surface, path: `__screenshots__/flower-starter-${locale}-${width}.png` });
    }
  });
});
