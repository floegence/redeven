import '../../index.css';
import axe from 'axe-core';
import './plugin-center.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { PluginCenterDrawer } from './PluginCenterDrawer';
import { PluginCenterView } from './PluginCenterView';
import type { PluginInventoryItem } from './pluginTypes';

const item: PluginInventoryItem = {
  inventoryKey: 'instance:weather', pluginID: 'com.example.weather', pluginInstanceID: 'weather',
  displayName: 'Weather', description: 'Local forecasts for your workspace.', publisher: 'Example',
  iconFallback: 'generic', category: 'utilities', searchKeywords: [], version: '1.0.0',
  managementRevision: 1, lifecycleState: 'enabled', sourceKind: 'community', pinned: false,
};
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY); document.documentElement.classList.remove('light', 'dark'); });
function mount(options: { canManage?: boolean; loading?: boolean; items?: PluginInventoryItem[] } = {}) {
  const host = document.createElement('div'); host.style.cssText = 'height:100vh;width:100%;min-width:0'; document.body.append(host);
  const onCreate = vi.fn(); const onHistory = vi.fn();
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCenterView projection={{ items: options.items ?? [item] }} loading={options.loading ?? false}
    canManagePlugins={options.canManage ?? true} canOpenPluginSurfaces onRefresh={vi.fn()} onCommand={vi.fn()}
    onCreatePlugin={onCreate} onOpenDrafts={onHistory} /></I18nProvider></FloeConfigProvider>, host);
  return { host, onCreate, onHistory };
}

it('opens creation from the grid with keyboard and restores focus on Escape', async () => {
  await page.viewport(1280, 800);
  const fixture = mount();
  const trigger = fixture.host.querySelector<HTMLElement>('.plugin-center-add-trigger')!;
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('menuitem', { name: 'Create a plugin', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.activeElement).toBe(trigger);
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(page.getByRole('menuitem', { name: 'Create a plugin', exact: true })).toBeVisible();
  await userEvent.keyboard('{Enter}');
  expect(fixture.onCreate).toHaveBeenCalledOnce();
  await page.getByRole('button', { name: 'Creation history', exact: true }).click();
  expect(fixture.onHistory).toHaveBeenCalledOnce();
});

it('opens the existing installation dialog and returns focus to the add card', async () => {
  const fixture = mount();
  await page.getByRole('button', { name: 'Add plugin', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Install from source', exact: true }).click();
  await expect.poll(() => document.querySelector('[data-floe-dialog-panel]')).not.toBeNull();
  expect(fixture.onCreate).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[data-floe-dialog-panel]')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(fixture.host.querySelector('.plugin-center-add-trigger'));
});

it.each([{ canManage: false }, { loading: true }])('does not offer add for $canManage permission and $loading loading', options => {
  const fixture = mount(options);
  expect(fixture.host.querySelector('[data-plugin-center-add]')).toBeNull();
});
it('keeps add out of filtered results and update-only views', async () => {
  const fixture = mount();
  await page.getByRole('searchbox').fill('missing');
  expect(fixture.host.querySelector('[data-plugin-center-add]')).toBeNull();
  await page.getByRole('searchbox').fill('');
  expect(fixture.host.querySelector('[data-plugin-center-add]')).not.toBeNull();
  await page.getByRole('tab', { name: /Updates/ }).click();
  await expect.poll(() => fixture.host.querySelector('[data-plugin-center-add]')).toBeNull();
});
it('provides a usable first card when no plugins are installed', async () => {
  const fixture = mount({ items: [] });
  await expect.element(page.getByRole('button', { name: 'Add plugin', exact: true })).toBeVisible();
  expect(fixture.host.textContent).not.toContain('No plugins in this view.');
});
it.each([
  { width: 1280, theme: 'light', locale: 'zh-CN' },
  { width: 1280, theme: 'dark', locale: 'en-US' },
  { width: 390, theme: 'light', locale: 'zh-CN' },
  { width: 320, theme: 'dark', locale: 'de-DE' },
])('fits the existing grid and toolbar at $width in $theme and $locale', async ({ width, theme, locale }) => {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme);
  await page.viewport(width, 800);
  const fixture = mount({ items: [item, { ...item, inventoryKey: 'instance:notes', displayName: 'Quick notes', description: 'Capture ideas without leaving your workspace.' }] });
  await expect.poll(() => fixture.host.querySelector('[data-plugin-center-add]')).not.toBeNull();
  const list = fixture.host.querySelector<HTMLElement>('[data-plugin-center-list]')!;
  const toolbar = fixture.host.querySelector<HTMLElement>('[data-plugin-center-toolbar]')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  if (width < 768) expect(fixture.host.querySelector('[data-plugin-center-search]')!.getBoundingClientRect().width).toBeGreaterThanOrEqual(width - 90);
  const card = fixture.host.querySelector<HTMLElement>('[data-plugin-directory-card]')!;
  const add = fixture.host.querySelector<HTMLElement>('.plugin-center-add-trigger')!;
  expect(Math.abs(card.getBoundingClientRect().width - add.getBoundingClientRect().width)).toBeLessThan(1);
  if (width >= 768) expect(Math.abs(card.getBoundingClientRect().height - add.getBoundingClientRect().height)).toBeLessThan(1);
  await expect.poll(() => getComputedStyle(fixture.host.querySelector('[data-plugin-center-view]')!).opacity).toBe('1');
  expect((await axe.run(add, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  await page.screenshot({ path: `__screenshots__/plugin-add-${width}-${theme}-${locale}.png` });
  await page.elementLocator(add).click();
  await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `__screenshots__/plugin-add-menu-${width}-${theme}-${locale}.png` });
});


it('keeps the drawer open across add-menu dismissal and nested installation', async () => {
  await page.viewport(1024, 800);
  const host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(true);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginCenterDrawer open={open()} onOpenChange={setOpen} title="Plugin Center">
    <PluginCenterView projection={{ items: [item] }} loading={false} canManagePlugins canOpenPluginSurfaces
      onRefresh={vi.fn()} onCommand={vi.fn()} onCreatePlugin={vi.fn()} onOpenDrafts={vi.fn()} onClose={() => setOpen(false)} />
  </PluginCenterDrawer></I18nProvider></FloeConfigProvider>, host);
  await expect.element(page.getByRole('button', { name: 'Add plugin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add plugin', exact: true }).click();
  await expect.element(page.getByRole('menuitem', { name: 'Create a plugin', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(open()).toBe(true);
  await expect.poll(() => document.activeElement?.classList.contains('plugin-center-add-trigger')).toBe(true);
  await page.getByRole('button', { name: 'Add plugin', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Install from source', exact: true }).click();
  await expect.poll(() => document.querySelectorAll('[data-floe-dialog-panel]').length).toBe(2);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelectorAll('[data-floe-dialog-panel]').length).toBe(1);
  expect(open()).toBe(true);
  await expect.poll(() => document.activeElement?.classList.contains('plugin-center-add-trigger')).toBe(true);
});

it('offers all three add paths and opens the marketplace in the existing center', async () => {
  const fixture = mount();
  await page.getByRole('button', { name: 'Add plugin', exact: true }).click();
  for (const name of ['Create a plugin', 'Install from marketplace', 'Install from source']) {
    await expect.element(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'Install from marketplace', exact: true }).click();
  await expect.element(page.getByRole('tab', { name: /Discover/ })).toHaveAttribute('aria-selected', 'true');
  expect(fixture.onCreate).not.toHaveBeenCalled();
  expect(document.querySelector('[data-floe-dialog-panel]')).toBeNull();
});
