import '../../index.css';
import axe from 'axe-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { PluginDraftLibrary } from './PluginDraftLibrary';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { buildDesktopWindowChromeStyleText } from '../../../../../../desktop/src/shared/windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from '../../../../../../desktop/src/shared/windowChromePlatform';
let dispose: (() => void) | undefined;
let release: (() => void) | undefined;
afterEach(() => { dispose?.(); release?.(); document.body.replaceChildren(); localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY); document.documentElement.classList.remove('light', 'dark'); });
it.each(['darwin', 'win32', 'linux'] as const)('opens the library directly with one toolbar clear of %s window controls', async platform => {
  await page.viewport(1280, 800);
  const chrome = resolveDesktopWindowChromeSnapshot(platform, { fullScreen: false });
  const style = document.createElement('style');
  style.textContent = buildDesktopWindowChromeStyleText(chrome);
  document.head.append(style);
  try {
    const fetch = vi.fn(async () => Response.json({ ok: true, data: [] }));
    release = bindSessionHTTP({ fetch, events: async function* () {} });
    const host = document.createElement('div');
    host.style.cssText = 'height:800px;width:100%';
    document.body.append(host);
    dispose = render(() => <FloeConfigProvider><I18nProvider><PluginDraftLibrary onBack={vi.fn()} onOpen={vi.fn()} /></I18nProvider></FloeConfigProvider>, host);
    await expect.element(page.getByText('The plugins you create will appear here.', { exact: true })).toBeVisible();
    const toolbar = host.querySelector('header')!;
    expect(host.querySelectorAll('header')).toHaveLength(1);
    for (const button of toolbar.querySelectorAll('button')) {
      const rect = button.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(chrome.contentInsetStart);
      expect(rect.right).toBeLessThanOrEqual(1280 - chrome.contentInsetEnd);
    }
    expect(toolbar.getAttribute('data-redeven-desktop-titlebar-drag-region')).toBe('true');
    expect(toolbar.getBoundingClientRect().height).toBeGreaterThanOrEqual(chrome.titleBarHeight);
    expect(toolbar.getBoundingClientRect().height).toBeLessThanOrEqual(48);
  } finally { style.remove(); }
});
it('keeps the draft library and recovery action available when the list fails', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: false, error: 'offline' }, { status: 503 }))
    .mockImplementation(async () => Response.json({ ok: true, data: [] }));
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginDraftLibrary onBack={vi.fn()} onOpen={vi.fn()} /></I18nProvider></FloeConfigProvider>, host);
  await expect.element(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.element(page.getByText('The plugins you create will appear here.', { exact: true })).toBeVisible();
});

const timestamp = Date.UTC(2026, 10, 7, 10, 30);
const history = [
  { id: 'older', title: 'Focus timer', revision: 1, lifecycle: 'active' as const, created_at: timestamp, updated_at: timestamp - 86400000 },
  { id: 'latest', title: 'Workspace insights', revision: 2, lifecycle: 'active' as const, created_at: timestamp, updated_at: timestamp },
  { id: 'untitled', title: '', revision: 1, lifecycle: 'preparing' as const, created_at: timestamp, updated_at: timestamp - 2000 },
];

function mountHistory(fetch: typeof globalThis.fetch) {
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div');
  host.style.cssText = 'height:100vh;width:100%;min-width:0';
  document.body.append(host);
  const onOpen = vi.fn();
  const onBack = vi.fn();
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginDraftLibrary onBack={onBack} onOpen={onOpen} /></I18nProvider></FloeConfigProvider>, host);
  return { host, onOpen, onBack };
}

it('sorts recent projects, searches titles and opens the exact project with the keyboard', async () => {
  const fixture = mountHistory(vi.fn(async () => Response.json({ ok: true, data: history })));
  await expect.element(page.getByRole('heading', { name: 'Creation history' })).toBeVisible();
  await expect.poll(() => fixture.host.querySelectorAll('[data-plugin-history-entry]').length).toBe(3);
  expect([...fixture.host.querySelectorAll('[data-plugin-history-entry]')].map(element => element.getAttribute('data-plugin-history-entry'))).toEqual(['latest', 'untitled', 'older']);
  const search = page.getByRole('searchbox', { name: 'Search creation history' });
  await search.fill(' FOCUS ');
  await expect.poll(() => fixture.host.querySelectorAll('[data-plugin-history-entry]').length).toBe(1);
  const entry = fixture.host.querySelector<HTMLButtonElement>('[data-plugin-history-entry="older"]')!;
  entry.focus();
  await userEvent.keyboard('{Enter}');
  expect(fixture.onOpen).toHaveBeenCalledWith('older');
  expect(entry.querySelector('time')?.getAttribute('datetime')).toBe(new Date(timestamp - 86400000).toISOString());
  await search.fill('unmatched');
  await expect.element(page.getByText('No matching projects.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect.poll(() => fixture.host.querySelectorAll('[data-plugin-history-entry]').length).toBe(3);
  expect(document.activeElement).toBe(fixture.host.querySelector('input[type=search]'));
  await page.getByRole('button', { name: 'Create a plugin', exact: true }).click();
  expect(fixture.onOpen).toHaveBeenLastCalledWith('new');
  await page.getByRole('button', { name: 'Back to Plugin Center', exact: true }).click();
  expect(fixture.onBack).toHaveBeenCalledOnce();
});

it('preserves history and search after refresh fails and retries without replacing records', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, data: history }))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'offline' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true, data: history }));
  const fixture = mountHistory(fetch);
  await expect.element(page.getByRole('searchbox')).toBeVisible();
  await page.getByRole('searchbox').fill('Focus');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.element(page.getByRole('alert')).toBeVisible();
  expect(fixture.host.querySelector('[data-plugin-history-entry="older"]')).not.toBeNull();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => fixture.host.querySelector('[role="alert"]')).toBeNull();
  await expect.element(page.getByRole('searchbox')).toHaveValue('Focus');
});

it('shows loading geometry until the read completes and never displays a false empty state', async () => {
  let resolve!: (response: Response) => void;
  const fixture = mountHistory(vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  await expect.poll(() => fixture.host.querySelector('.plugin-history-skeleton')).not.toBeNull();
  expect(fixture.host.querySelector('.plugin-history-empty')).toBeNull();
  resolve(Response.json({ ok: true, data: [] }));
  await expect.element(page.getByText('The plugins you create will appear here.', { exact: true })).toBeVisible();
  await page.elementLocator(fixture.host.querySelector('.plugin-history-empty button')!).click();
  expect(fixture.onOpen).toHaveBeenCalledWith('new');
});

it.each([
  { width: 1280, theme: 'light', locale: 'zh-CN' },
  { width: 1280, theme: 'dark', locale: 'en-US' },
  { width: 390, theme: 'light', locale: 'zh-CN' },
  { width: 320, theme: 'dark', locale: 'de-DE' },
])('keeps history readable at $width in $theme and $locale', async ({ width, theme, locale }) => {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme);
  await page.viewport(width, 800);
  const chinese = locale === 'zh-CN';
  const data = history.map((draft, index) => ({ ...draft, title: chinese ? ['专注计时器', '工作空间概览', ''][index] : draft.title }));
  data.push({ ...history[0], id: 'long', title: chinese ? '用于多环境部署监控与资源管理的工作空间助手，包含运行状态和历史统计' : 'A workspace assistant with deployment monitoring and resource history across all environments', updated_at: timestamp - 3600000 });
  const fixture = mountHistory(vi.fn(async () => Response.json({ ok: true, data })));
  await expect.poll(() => fixture.host.querySelectorAll('[data-plugin-history-entry]').length).toBe(4);
  const toolbar = fixture.host.querySelector<HTMLElement>('header')!;
  const content = fixture.host.querySelector<HTMLElement>('.plugin-history-content')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
  expect(content.clientWidth).toBeLessThanOrEqual(800);
  for (const entry of fixture.host.querySelectorAll<HTMLElement>('[data-plugin-history-entry]')) {
    expect(entry.clientHeight).toBeGreaterThanOrEqual(44);
    expect(entry.scrollWidth).toBeLessThanOrEqual(entry.clientWidth);
  }
  if (chinese) await expect.element(page.getByRole('heading', { name: '创建历史', exact: true })).toBeVisible();
  expect((await axe.run(fixture.host, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  await page.screenshot({ path: `__screenshots__/creation-history-${width}-${theme}-${locale}.png` });
});
