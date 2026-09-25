import './index.css';
import './styles/browserSources.css';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { captureBrowserDocumentTheme } from './ui/services/browserDocumentTheme';
import { browserSourceMessages } from './ui/i18n/browserSourceMessages';
import { browserMessages } from './ui/i18n/browserMessages';
import { createI18nHelpers } from './ui/i18n/createI18n';
import { enUS } from './ui/i18n/locales';
import type { BrowserDocumentConfiguration } from './ui/services/browserWindowProtocol';

let cleanup: (() => void) | undefined;
afterEach(async () => { cleanup?.(); cleanup = undefined; document.documentElement.classList.remove('dark'); document.documentElement.removeAttribute('data-floe-surface-style'); await page.viewport(1280, 850); });

for (const [dark, surfaceStyle, width] of [[false, 'standard', 1280], [true, 'standard', 1280], [false, 'soft-neumorphic', 390], [true, 'soft-neumorphic', 390]] as const) it(`inherits the parent ${dark ? 'dark' : 'light'} ${surfaceStyle} dialog theme at ${width}px across the browser document boundary`, async () => {
  await page.viewport(width, 850);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.setAttribute('data-floe-surface-style', surfaceStyle);
  const theme = captureBrowserDocumentTheme();
  const copy = createI18nHelpers('en-US', enUS);
  const channels = Array.from({ length: 3 }, () => new MessageChannel());
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:min(900px, 100%);height:760px;border:0';
  frame.sandbox.add('allow-scripts', 'allow-same-origin');
  const nonce = crypto.randomUUID();
  const configuration: BrowserDocumentConfiguration = { type: 'redeven-browser-ports', nonce, title: 'Remote Browser', locale: 'en-US', messages: browserMessages(copy), theme,
    failure: 'BROWSER_SOURCE_UNAVAILABLE',
    sources: { desktop: false, current: { label: 'Default', request: { managed_profile_id: 'browser-main' } }, messages: browserSourceMessages(copy) },
  };
  const ready = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.nonce !== nonce || event.data?.type !== 'redeven-browser-ready') return;
    // Vitest transforms dynamic imports; child documents need its loader hook,
    // while all production modules still execute in the child realm.
    Object.assign(frame.contentWindow!, { __vitest_browser_runner__: (globalThis as unknown as { __vitest_browser_runner__: unknown }).__vitest_browser_runner__ });
    frame.contentWindow!.postMessage(configuration, location.origin, channels.map(channel => channel.port2));
    window.removeEventListener('message', ready);
  };
  window.addEventListener('message', ready);
  channels[2]!.port1.onmessage = ({ data }) => {
    if (data?.type !== 'request') return;
    const value = data.operation.method === 'source.profiles' ? [{ id: 'browser-main', name: 'Default' }]
      : data.operation.method === 'source.status' ? { profiles: [], platform: 'darwin', prepared: false } : undefined;
    channels[2]!.port1.postMessage({ type: 'result', id: data.id, ok: true, value });
  };
  cleanup = () => { window.removeEventListener('message', ready); frame.remove(); channels.forEach(channel => { channel.port1.close(); channel.port2.close(); }); };
  frame.src = `/browser.html#${nonce}`;
  document.body.append(frame);
  await vi.waitFor(() => expect(frame.contentDocument?.querySelector('.redeven-browser-notice-actions button')).toBeTruthy());
  frame.contentDocument!.querySelector<HTMLButtonElement>('.redeven-browser-notice-actions button')!.click();
  await vi.waitFor(() => expect(frame.contentDocument?.querySelector('[role="dialog"] input')).toBeTruthy());
  const child = frame.contentWindow!, doc = frame.contentDocument!;
  const dialog = doc.querySelector<HTMLElement>('[role="dialog"]')!;
  await vi.waitFor(() => expect(child.getComputedStyle(dialog).opacity).toBe('1'));
  // Compare the same surface and controls in both realms, including material
  // styles applied by the design system rather than assuming a flat token.
  const reference = dialog.cloneNode(true) as HTMLElement;
  document.body.append(reference);
  try {
    for (const selector of ['', 'input[maxlength]', '[data-floe-dialog-header]', '[data-floe-dialog-footer] button', '[data-floe-dialog-body] p']) {
      const projected = selector ? dialog.querySelector<HTMLElement>(selector)! : dialog;
      const original = selector ? reference.querySelector<HTMLElement>(selector)! : reference;
      for (const property of ['background-color', 'color', 'border-color', 'font-family']) {
        expect(child.getComputedStyle(projected).getPropertyValue(property), `${selector || 'dialog'} ${property}`).toBe(getComputedStyle(original).getPropertyValue(property));
      }
    }
  } finally { reference.remove(); }
  expect(doc.documentElement.classList.contains('dark')).toBe(dark);
  expect(child.getComputedStyle(doc.body).fontFamily).toBe(getComputedStyle(document.body).fontFamily);
  for (const token of ['--primary-foreground', '--secondary-foreground', '--popover', '--input', '--ring', '--floe-window-muted-foreground']) {
    expect(child.getComputedStyle(doc.documentElement).getPropertyValue(token).trim()).toBe(theme.tokens[token]);
  }
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  if (import.meta.env.VITE_REDEVEN_BROWSER_SOURCE_SCREENSHOTS === '1') await page.screenshot({ element: frame, path: `__screenshots__/browser-document-${dark ? 'dark' : 'light'}-${width}.png` });
});
