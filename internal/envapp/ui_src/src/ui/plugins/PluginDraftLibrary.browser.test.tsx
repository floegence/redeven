import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import { PluginDraftLibrary } from './PluginDraftLibrary';
import { bindSessionHTTP } from '../services/sessionHTTP';
let dispose: (() => void) | undefined;
let release: (() => void) | undefined;
afterEach(() => { dispose?.(); release?.(); document.body.replaceChildren(); });
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
