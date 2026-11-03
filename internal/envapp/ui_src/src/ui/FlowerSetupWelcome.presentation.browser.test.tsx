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
import { SUPPORTED_LOCALES } from './i18n/localeMeta';

let dispose: (() => void) | undefined;
const frame = commands as unknown as {
  sizeReadinessFrame: (size: { width: number; height: number }) => Promise<void>;
  auditReadinessAccessibility: () => Promise<unknown[]>;
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
] as const)('presents one clear setup action in $theme theme at $width px', async ({ theme, width }) => {
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
      onAction={() => undefined} />
  </FloeProvider>, host);
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(BUILT_IN_SHELL_THEME_DEFAULTS[theme]);
  // Capture the product at its CSS viewport size, without the test runner's iframe transform.
  await frame.sizeReadinessFrame({ width, height: 900 });
  const card = host.querySelector<HTMLButtonElement>('.flower-setup-action')!;
  const label = card.querySelector<HTMLElement>('.flower-setup-action-label')!;
  const arrow = card.querySelector<SVGElement>('svg.flower-setup-action-arrow')!;
  expect(card.dataset.floeControl).toBe('button');
  expect(host.querySelectorAll('button')).toHaveLength(1);
  expect(host.querySelector('.flower-setup-refresh, .flower-setup-preview')).toBeNull();
  expect(host.querySelector('h2')?.textContent).toBe(copy.chat.setupNeeded);
  expect(parseFloat(getComputedStyle(host.querySelector('h2')!).fontSize)).toBeLessThanOrEqual(18);
  expect(Number(getComputedStyle(host.querySelector('h2')!).fontWeight)).toBeLessThanOrEqual(450);
  for (const element of host.querySelectorAll('.flower-setup-content, .flower-setup-brand, .flower-setup-action')) {
    expect(getComputedStyle(element).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  }
  expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
  expect(label.getBoundingClientRect().right).toBeLessThan(arrow.getBoundingClientRect().left);
  expect(card.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  const labelText = document.createRange();
  labelText.selectNodeContents(label);
  expect(Math.abs(label.getBoundingClientRect().width - labelText.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  expect(await frame.auditReadinessAccessibility()).toEqual([]);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
    await page.screenshot({ element: host, path: `__screenshots__/flower-local-setup-${theme}${width < 1280 ? '-narrow' : ''}.png` });
  }
  card.focus();
  await userEvent.keyboard('{Enter}');
  expect(openSettings).toHaveBeenCalledOnce();
  await userEvent.click(card);
  expect(openSettings).toHaveBeenCalledTimes(2);
});

it.each(SUPPORTED_LOCALES.flatMap(locale => ['light', 'dark'].map(theme => ({ locale, theme }))))(
  'keeps both $locale setup destinations readable and keyboard accessible in $theme at 360px',
  async ({ locale, theme }) => {
    await page.viewport(360, 760);
    const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
    const copy = createLocalizedFlowerSurfaceCopy({ locale,
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
    });
    const host = document.createElement('div');
    host.className = 'ai-readiness-boundary';
    host.style.height = '100%';
    document.body.append(host);
    const local = { label: copy.chat.setupDesktopSettings, run: vi.fn() };
    const remote = { label: copy.chat.setupEnvironmentSettings, run: vi.fn() };
    dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: {
      defaultTheme: theme as 'light' | 'dark', shellPresets: builtInShellThemePresets,
      defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS, defaultSurfaceStyle: 'soft-neumorphic',
    } }}>
      <FlowerSetupWelcome copy={copy} actions={[{ id: 'local_settings', action: local }, { id: 'remote_settings', action: remote }]}
        onOpenSettings={() => undefined} onAction={action => action.run()} />
    </FloeProvider>, host);
    await frame.sizeReadinessFrame({ width: 360, height: 760 });
    const welcome = host.querySelector<HTMLElement>('.flower-setup-welcome')!;
    expect(welcome.scrollWidth).toBeLessThanOrEqual(welcome.clientWidth);
    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(host.querySelector('.flower-setup-refresh, .flower-setup-preview')).toBeNull();
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'));
    for (const button of buttons) {
      const label = button.querySelector<HTMLElement>('.flower-setup-action-label')!;
      expect(label.scrollWidth, locale).toBeLessThanOrEqual(label.clientWidth + 1);
      expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(welcome.getBoundingClientRect().right);
    }
    buttons[0].focus();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(buttons[1]).boxShadow).not.toBe('none');
    await userEvent.keyboard('{Enter}');
    expect(remote.run).toHaveBeenCalledOnce();
    await userEvent.click(buttons[0]);
    expect(local.run).toHaveBeenCalledOnce();
    expect(await frame.auditReadinessAccessibility()).toEqual([]);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
      buttons[0].blur();
      await page.screenshot({ element: host, path: `__screenshots__/flower-setup-destinations-${locale}-${theme}.png` });
    }
  },
);
