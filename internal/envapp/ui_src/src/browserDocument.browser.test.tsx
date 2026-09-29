import './index.css';
import './styles/browserSources.css';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { BottomBarCompanion } from '@floegence/floe-webapp-core/layout';
import type { Session } from '@floegence/flowersec-core';
import { createBrowserWindow } from './ui/services/browserWindow';
import type { BrowserSourceService } from './ui/services/browserSourceContract';
import { commands, page } from 'vitest/browser';
import { captureBrowserDocumentTheme } from './ui/services/browserDocumentTheme';
import { browserSourceMessages } from './ui/i18n/browserSourceMessages';
import { browserMessages } from './ui/i18n/browserMessages';
import { createI18nHelpers } from './ui/i18n/createI18n';
import { enUS } from './ui/i18n/locales';
import type { BrowserDocumentConfiguration } from './ui/services/browserWindowProtocol';

let cleanup: (() => void) | undefined;
const sourceChoiceSelector = '.redeven-browser-notice-actions button[aria-describedby]';
afterEach(async () => { cleanup?.(); cleanup = undefined; document.documentElement.classList.remove('dark'); document.documentElement.removeAttribute('data-floe-surface-style'); await page.viewport(1280, 850); });

function mountDocument(failed = false, onInteraction?: () => void) {
  const events: Array<{ type: string }> = [];
  const theme = captureBrowserDocumentTheme();
  const copy = createI18nHelpers('en-US', enUS);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:min(900px, 100%);height:760px;border:0';
  frame.sandbox.add('allow-scripts', 'allow-same-origin');
  const nonce = crypto.randomUUID();
  const configuration: BrowserDocumentConfiguration = { ...(failed ? { failure: 'BROWSER_SOURCE_UNAVAILABLE' as const } : {}), type: 'redeven-browser-ports', nonce, title: 'Remote Browser', locale: 'en-US', messages: browserMessages(copy), theme,
    sources: { desktop: false, current: { label: 'Default', request: { managed_profile_id: 'browser-main' } }, messages: browserSourceMessages(copy) },
  };
  const ready = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.data?.nonce !== nonce || event.data?.type !== 'redeven-browser-ready') return;
    // Vitest transforms dynamic imports; child documents need its loader hook,
    // while all production modules still execute in the child realm.
    Object.assign(frame.contentWindow!, { __vitest_browser_runner__: (globalThis as unknown as { __vitest_browser_runner__: unknown }).__vitest_browser_runner__ });
    window.removeEventListener('message', ready);
  };
  window.addEventListener('message', ready);
  // No source/control authority is needed for outside interaction. Keep the
  // actual trusted document, host bridge and private handshake in this fixture.
  const host = createBrowserWindow({ session: {} as Session, child: () => frame.contentWindow, configuration,
    onReconnect: () => undefined,
    onInteraction: () => { events.push({ type: 'interaction' }); onInteraction?.(); },
    sources: { select: async () => undefined, service: {
      profiles: async () => [{ id: 'browser-main', name: 'Default' }],
      status: async () => ({ profiles: [], installations: [], platform: 'darwin', prepared: false }),
      preference: async () => ({ preference: null }),
      management: {},
    } as unknown as BrowserSourceService },
  });
  cleanup = () => { window.removeEventListener('message', ready); host.close(); frame.remove(); };
  frame.src = `/browser.html#${nonce}`;
  document.body.append(frame);
  return { frame, events };
}

for (const failed of [false, true]) for (const [dark, surfaceStyle, width] of [[false, 'standard', 1280], [true, 'standard', 1280], [false, 'soft-neumorphic', 390], [true, 'soft-neumorphic', 390]] as const) it(`inherits the parent ${failed ? 'recovery' : 'live'} ${dark ? 'dark' : 'light'} ${surfaceStyle} dialog theme at ${width}px across the browser document boundary`, async () => {
  await page.viewport(width, 850);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.setAttribute('data-floe-surface-style', surfaceStyle);
  const theme = captureBrowserDocumentTheme();
  const { frame } = mountDocument(failed);
  if (failed) {
    await vi.waitFor(() => expect(frame.contentDocument?.querySelector(sourceChoiceSelector)).toBeTruthy());
    frame.contentDocument!.querySelector<HTMLButtonElement>(sourceChoiceSelector)!.click();
  } else {
    await vi.waitFor(() => expect(frame.contentDocument?.querySelector('[data-floe-ui="more"]')).toBeTruthy());
    const chrome = frame.contentDocument!.querySelector<HTMLElement>('.floe-browser')!;
    const strip = frame.contentDocument!.querySelector<HTMLElement>('.tab-strip')!;
    const expectedStrip = document.createElement('div');
    expectedStrip.style.cssText = 'background:var(--muted);color:var(--foreground)';
    document.body.append(expectedStrip);
    try {
      expect(frame.contentWindow!.getComputedStyle(strip).backgroundColor).toBe(getComputedStyle(expectedStrip).backgroundColor);
      expect(frame.contentWindow!.getComputedStyle(strip).color).toBe(getComputedStyle(expectedStrip).color);
      expect(frame.contentWindow!.getComputedStyle(chrome).fontFamily).toBe(getComputedStyle(document.body).fontFamily);
    } finally { expectedStrip.remove(); }
    frame.contentDocument!.querySelector<HTMLButtonElement>('[data-floe-ui="more"]')!.click();
    frame.contentDocument!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
  }
  await vi.waitFor(() => expect(frame.contentDocument?.querySelectorAll('.redeven-browser-source-card')).toHaveLength(2));
  await vi.waitFor(() => expect(frame.contentDocument!.querySelector<HTMLButtonElement>('.redeven-browser-source-card-action[title="Built-in browser"]')!.disabled).toBe(false));
  frame.contentDocument!.querySelector<HTMLButtonElement>('.redeven-browser-source-card-action[title="Built-in browser"]')!.click();
  await vi.waitFor(() => expect(Array.from(frame.contentDocument!.querySelectorAll('button')).find(button => button.textContent === 'Create profile')).toBeTruthy());
  Array.from(frame.contentDocument!.querySelectorAll('button')).find(button => button.textContent === 'Create profile')!.click();
  await vi.waitFor(() => expect(frame.contentDocument?.querySelector('.redeven-browser-sources-dialog input')).toBeTruthy());
  const child = frame.contentWindow!, doc = frame.contentDocument!;
  const dialog = doc.querySelector<HTMLElement>('.redeven-browser-sources-dialog')!;
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
  if (import.meta.env.VITE_REDEVEN_BROWSER_SOURCE_SCREENSHOTS === '1') await page.screenshot({ element: frame, path: `__screenshots__/browser-document-${failed ? 'recovery' : 'live'}-${dark ? 'dark' : 'light'}-${width}.png` });
});

for (const failed of [false, true]) it(`reports real pointer interaction from the ${failed ? 'recovery' : 'browser'} document without consuming its action`, async () => {
  await page.viewport(1280, 850);
  const [open, setOpen] = createSignal(true);
  const { frame, events } = mountDocument(failed, () => setOpen(false));
  const anchor = document.createElement('button');
  // Keep the outside-click target uncovered by the companion's reading surface.
  anchor.style.cssText = 'position:fixed;bottom:12px;right:12px;width:280px;height:28px';
  anchor.textContent = 'Flower'; document.body.append(anchor);
  const mount = document.createElement('div'); document.body.append(mount);
  const dispose = render(() => <BottomBarCompanion retained visible open={open()} anchor={anchor} mount={mount}
    id="browser-interaction-companion" label="Flower" expandedWidth={320} onDismiss={() => setOpen(false)}>
    <div style={{ height: '260px' }}><textarea aria-label="Flower draft">Preserved draft</textarea></div>
  </BottomBarCompanion>, mount);
  onTestFinished(() => { dispose(); mount.remove(); anchor.remove(); });
  await vi.waitFor(() => expect(document.querySelector('#browser-interaction-companion')?.getAttribute('data-companion-phase')).toBe('expanded'));
  const draft = mount.querySelector('textarea')!;
  const selector = failed ? sourceChoiceSelector : '[data-floe-ui="more"]';
  await vi.waitFor(() => expect(frame.contentDocument?.querySelector(selector)).toBeTruthy());
  const doc = frame.contentDocument!;
  const button = doc.querySelector<HTMLButtonElement>(selector)!;
  const clicked = vi.fn(); button.addEventListener('click', clicked);
  // Programmatic focus and synthetic events are not a user's outside click.
  button.focus();
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(events.filter(event => event.type === 'interaction')).toHaveLength(0);
  expect(open()).toBe(true);
  const input = commands as unknown as { clickBrowserDocument(selector: string, position?: { x: number; y: number }): Promise<void> };
  await input.clickBrowserDocument(selector);
  await vi.waitFor(() => expect(events.filter(event => event.type === 'interaction')).toHaveLength(1));
  expect(clicked).toHaveBeenCalledOnce();
  expect(open()).toBe(false);
  expect(mount.querySelector('textarea')).toBe(draft);
  expect(draft.value).toBe('Preserved draft');
  expect(document.activeElement).toBe(frame);
  if (failed) await vi.waitFor(() => expect(doc.querySelectorAll('.redeven-browser-source-card')).toHaveLength(2));
  else {
    expect(doc.querySelector('[role="menuitem"]')).toBeTruthy();
    setOpen(true);
    await vi.waitFor(() => expect(document.querySelector('#browser-interaction-companion')?.getAttribute('data-companion-phase')).toBe('expanded'));
    await input.clickBrowserDocument('.floe-browser', { x: 80, y: 300 });
    await vi.waitFor(() => expect(events.filter(event => event.type === 'interaction')).toHaveLength(2));
    expect(open()).toBe(false);
  }
});
