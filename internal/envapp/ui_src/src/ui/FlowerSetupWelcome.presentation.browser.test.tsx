import '../index.css';
import './flower-feature.css';

import { BUILT_IN_SHELL_THEME_DEFAULTS, builtInShellThemePresets, FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerSetupWelcome } from '../../../../flower_ui/src/chat/FlowerSetupWelcome';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';

let dispose: (() => void) | undefined;
const frame = commands as unknown as {
  sizeReadinessFrame: (size: { width: number; height: number }) => Promise<void>;
};

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('light', 'dark');
});

it.each([
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 }, { theme: 'dark', width: 390 },
] as const)('keeps a compact settings card with real icons in $theme theme at $width px', async ({ theme, width }) => {
  await page.viewport(width, 900);
  const i18n = createI18nHelpers('zh-CN', await loadEnvAppDictionary('zh-CN'));
  const copy = createLocalizedFlowerSurfaceCopy({ locale: 'zh-CN',
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  });
  const host = document.createElement('div');
  host.className = 'ai-readiness-boundary';
  host.style.height = '100%';
  document.body.append(host);
  const openSettings = vi.fn();
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: {
    defaultTheme: theme, shellPresets: builtInShellThemePresets,
    defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS,
    defaultSurfaceStyle: 'soft-neumorphic',
  } }}>
    <FlowerSetupWelcome copy={copy} actions={[]} onOpenSettings={openSettings}
      onRefresh={() => undefined} refreshing={false} onAction={() => undefined} />
  </FloeProvider>, host);
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(`porcelain-${theme}`);
  // Capture the product at its CSS viewport size, without the test runner's iframe transform.
  await frame.sizeReadinessFrame({ width, height: 900 });
  const card = host.querySelector<HTMLButtonElement>('.flower-setup-action')!;
  const icon = card.querySelector<SVGElement>('svg.flower-setup-action-icon')!;
  const label = card.querySelector<HTMLElement>('.flower-setup-action-label')!;
  const arrow = card.querySelector<SVGElement>('svg.flower-setup-action-arrow')!;
  expect(icon).toBeTruthy();
  expect(getComputedStyle(card).textAlign).toBe('left');
  expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
  expect(label.getBoundingClientRect().left).toBeGreaterThan(icon.getBoundingClientRect().right);
  expect(label.getBoundingClientRect().right).toBeLessThan(arrow.getBoundingClientRect().left);
  expect(icon.getBoundingClientRect().width).toBeGreaterThanOrEqual(18);
  expect(card.getBoundingClientRect().height).toBeGreaterThanOrEqual(56);
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  const labelText = document.createRange();
  labelText.selectNodeContents(label);
  expect(label.getBoundingClientRect().width - labelText.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await page.screenshot({ element: host.querySelector<HTMLElement>('.flower-setup-welcome')!, path: `__screenshots__/flower-local-setup-${theme}${width < 1280 ? '-narrow' : ''}.png` });
  }
  await userEvent.click(card);
  expect(openSettings).toHaveBeenCalledOnce();
});
