import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { PluginDraftLibrary } from './PluginDraftLibrary';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { buildDesktopWindowChromeStyleText } from '../../../../../../desktop/src/shared/windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from '../../../../../../desktop/src/shared/windowChromePlatform';
let dispose: (() => void) | undefined;
let release: (() => void) | undefined;
afterEach(() => { dispose?.(); release?.(); document.body.replaceChildren(); });
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
    await expect.element(page.getByText('Your plugin drafts will appear here.', { exact: true })).toBeVisible();
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
  await expect.element(page.getByText('Your plugin drafts will appear here.', { exact: true })).toBeVisible();
});
