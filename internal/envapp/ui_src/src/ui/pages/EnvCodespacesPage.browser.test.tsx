import '../../index.css';
import { Suspense, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { EnvCodespacesPage, type SpaceStatus } from './EnvCodespacesPage';
import { dictionaries, createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import type { RedevenLocale } from '../i18n/localeMeta';
import { CodespacesPageSkeleton } from './CodespacesPresentation';

const state = vi.hoisted(() => ({ locale: 'en-US' as RedevenLocale, scope: '', desktop: false, spaces: vi.fn(), runtime: vi.fn(), start: vi.fn() }));
vi.mock('../i18n', async () => {
  const { createTestI18nHelpers } = await import('../i18n/locales/testDictionaries');
  return { useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) };
});
vi.mock('@floegence/floe-webapp-core', async original => ({
  ...await original<object>(), useNotification: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  resourceCacheAccess: () => ({ phase: 'ready' as const, generation: 0, scope: state.scope }),
}) }));
vi.mock('../services/desktopShellBridge', async original => ({ ...await original<object>(), desktopShellCodespaceWindowOpenAvailable: () => state.desktop, openCodespaceWindowInDesktopShell: async () => ({ ok: true }) }));
vi.mock('../services/desktopCodeWorkspaceBridge', async original => ({ ...await original<object>(), desktopCodeWorkspacePrepareAvailable: () => state.desktop }));
vi.mock('../services/controlplaneApi', async original => ({ ...await original<object>(), getEnvPublicIDFromSession: () => 'env-test', getLocalRuntime: async () => ({}) }));
vi.mock('../services/filesystemPicker', () => ({ useEnvFilesystemPicker: () => ({}) }));
vi.mock('../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: (url: string) => {
  if (url.endsWith('/start')) return state.start();
  if (url.endsWith('/spaces')) return state.spaces();
  if (url.endsWith('/code-runtime/status')) return state.runtime();
  throw new Error(`Unexpected local API request: ${url}`);
} }));

const space: SpaceStatus = {
  code_space_id: 'space-1', name: 'Workspace', description: 'Workspace description', workspace_path: '/workspace/project',
  running: true, pid: 4242, code_port: 13337, created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 1,
};
const ready = { active_runtime: { detection_state: 'ready', present: true }, operation: { state: 'idle' } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
beforeEach(() => {
  state.locale = 'en-US'; state.desktop = false; state.scope = `codespaces-browser-${crypto.randomUUID()}`;
  state.start.mockReset(); state.spaces.mockReset(); state.runtime.mockReset().mockResolvedValue(ready);
  host = document.createElement('div'); host.style.height = '600px'; document.body.append(host);
});
afterEach(async () => {
  dispose?.(); dispose = undefined; document.body.replaceChildren(); await page.viewport(1280, 720);
});

const geometry = () => ['header', '.codespaces-grid', '.codespace-card', '.codespace-card > div > :nth-child(1)', '.codespace-card > div > :nth-child(2)', '.codespace-card > div > :nth-child(3)'].map(selector => {
  const rect = host.querySelector(selector)!.getBoundingClientRect();
  return { selector, top: rect.top, left: rect.left, width: rect.width, height: rect.height };
});

it.each([390, 900, 1440].flatMap(width => (['en-US', 'zh-CN'] as const).map(locale => ({ width, locale }))))(
  'preserves exact skeleton geometry through lazy module and data loading at $width px in $locale', async ({ width, locale }) => {
    state.locale = locale; await page.viewport(width, 900);
    const inventory = deferred<{ spaces: SpaceStatus[] }>(); state.spaces.mockReturnValue(inventory.promise);
    const module = deferred<{ default: typeof EnvCodespacesPage }>();
    const LazyPage = lazy(() => module.promise);
    dispose = render(() => <Suspense fallback={<CodespacesPageSkeleton />}><LazyPage /></Suspense>, host);
    await expect.poll(() => host.querySelector('[data-codespace-skeleton]')).toBeTruthy();
    await document.fonts.ready;
    const fallbackGeometry = geometry();
    module.resolve({ default: EnvCodespacesPage });
    await expect.poll(() => host.querySelector('[data-testid="codespaces-list-region"]')).toBeTruthy();
    expect(geometry()).toEqual(fallbackGeometry);
    if (width === 1440 && locale === 'en-US') await page.screenshot({ element: host, path: '__screenshots__/codespaces-skeleton.png' });
    // Running/stopped and absent descriptions occupy the same card rows.
    inventory.resolve({ spaces: Array.from({ length: width < 768 ? 1 : width < 1024 ? 2 : 3 }, (_, index) => ({
      ...space, code_space_id: `space-${index}`, description: index % 2 ? '' : space.description, running: index % 2 === 0,
    })) });
    await expect.poll(() => host.querySelector('[data-codespace-skeleton]')).toBeNull();
    expect(geometry()).toEqual(fallbackGeometry);
    const heights = [...host.querySelectorAll('.codespace-card')].map(card => card.getBoundingClientRect().height);
    expect(new Set(heights).size).toBe(1);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    if (width === 1440 && locale === 'en-US') await page.screenshot({ element: host, path: '__screenshots__/codespaces-ready.png' });
  },
);

it('restores IndexedDB after a new cache instance and preserves row, focus and scroll while both network checks are delayed', async () => {
  const { createResourceCache, createIndexedDBResourceCacheStorage } = await import('@floegence/floe-webapp-core/resource-cache');
  const { codespaceSnapshot } = await import('../services/envResourceSnapshots');
  await page.viewport(900, 720);
  const items = Array.from({ length: 12 }, (_, index) => ({ ...space, code_space_id: `space-${index}`, name: `Workspace ${index}` }));
  const writer = createResourceCache({ storage: createIndexedDBResourceCacheStorage('redeven-resource-cache') });
  writer.resource({ scope: state.scope, key: 'codespaces', version: 1, decode: codespaceSnapshot }).set(items);
  await writer.flush(); writer.dispose();
  const inventory = deferred<{ spaces: SpaceStatus[] }>(); state.spaces.mockReturnValue(inventory.promise);
  const runtime = deferred<unknown>(); state.runtime.mockReturnValue(runtime.promise);
  dispose = render(() => <Suspense fallback={<div data-generic-fallback />}><EnvCodespacesPage /></Suspense>, host);
  await expect.poll(() => host.querySelectorAll('.codespace-card').length).toBe(12);
  expect(host.querySelector('[data-generic-fallback], [data-codespace-skeleton], [data-testid="browser-editor-readiness-inline-status"]')).toBeNull();
  expect(host.querySelector('header .animate-spin')).toBeTruthy();
  const row = host.querySelector<HTMLElement>('.codespace-card')!;
  const details = row.querySelector('details')!; details.open = true;
  const button = row.querySelector<HTMLButtonElement>('button')!; button.focus();
  const viewport = host.querySelector<HTMLElement>('.codespaces-content')!; viewport.scrollTop = 240;
  const scroll = viewport.scrollTop; expect(scroll).toBe(240);
  inventory.resolve({ spaces: items.map(item => ({ ...item, name: `${item.name} updated` })) });
  runtime.resolve(ready);
  await expect.poll(() => row.textContent).toContain('Workspace 0 updated');
  expect(host.querySelector('.codespace-card')).toBe(row);
  expect(row.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(button);
  expect(viewport.scrollTop).toBe(scroll);
  expect(host.querySelector('header .animate-spin')).toBeNull();
});

it.each(['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark'])('uses the common main canvas and a quiet bounded card in %s', async preset => {
  state.locale = 'zh-CN'; state.desktop = true;
  await page.viewport(1077, 900);
  const original = document.documentElement.className;
  const theme = document.documentElement.dataset.floeShellTheme;
  const material = document.documentElement.dataset.floeSurfaceStyle;
  onTestFinished(() => {
  document.documentElement.className = original;
  if (theme) document.documentElement.dataset.floeShellTheme = theme; else delete document.documentElement.dataset.floeShellTheme;
  if (material) document.documentElement.dataset.floeSurfaceStyle = material; else delete document.documentElement.dataset.floeSurfaceStyle;
  });
  document.documentElement.classList.toggle('dark', preset.endsWith('dark'));
  document.documentElement.dataset.floeShellTheme = preset;
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const stopped = { ...space, name: 'cdk-files (2)', running: false, code_port: 0, workspace_path: '/Users/developer/Downloads/cdk-files (2)', description: 'codespace at /Users/developer/Downloads/cdk-files (2)' };
  state.spaces.mockResolvedValue({ spaces: [stopped, { ...space, name: 'Project dashboard', code_space_id: 'running-project' }] });
  dispose = render(() => <EnvCodespacesPage />, host);
  await expect.poll(() => host.querySelectorAll('.codespace-card').length).toBe(2);
  await document.fonts.ready;
  const panel = host.querySelector('.codespaces-page') as HTMLElement;
  const cards = [...host.querySelectorAll<HTMLElement>('.codespace-card')];
  await page.screenshot({ element: host, path: `__screenshots__/resource-codespaces-${preset}.png` });
  const background = document.createElement('div'); background.style.backgroundColor = 'var(--redeven-surface-main)'; panel.append(background);
  console.info('Codespace geometry', JSON.stringify({ preset, background: getComputedStyle(panel).backgroundColor, expected: getComputedStyle(background).backgroundColor, height: cards[0].getBoundingClientRect().height }));
  expect.soft(getComputedStyle(panel).backgroundColor).toBe(getComputedStyle(background).backgroundColor);
  background.remove();
  for (const card of cards) {
    expect.soft(card.getBoundingClientRect().height).toBeLessThanOrEqual(172);
    expect.soft(card.querySelector('details')!.open).toBe(false);
    expect.soft(getComputedStyle(card.querySelector('h3')!).fontSize).toBe('13px');
    expect.soft(getComputedStyle(card.querySelector('.codespace-path')!).fontSize).toBe('12px');
    expect.soft(card.querySelector('.codespace-path')!.textContent).toMatch(/^\/workspace|^\/Users/);
    expect.soft(getComputedStyle(card.querySelector('button')!).fontSize).toBe('12px');
    expect.soft(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    const action = card.querySelector<HTMLButtonElement>('button')!;
    expect.soft(action.getBoundingClientRect().height).toBe(28);
    card.querySelectorAll('button').forEach(assertButtonText);
  }

});

it.each([320, 544].flatMap(width => [false, true].map(desktop => ({ width, desktop }))))('keeps long card details, actions, and disclosure identity usable at $width px with desktop=$desktop', async ({ width, desktop }) => {
  state.desktop = desktop; state.locale = 'zh-CN';
  await page.viewport(1280, 800);
  host.style.width = `${width}px`;
  const longPath = `/workspace/${'long-project-directory/'.repeat(12)}`;
  state.spaces.mockResolvedValue({ spaces: [{ ...space, name: 'Workspace with a complete long title', workspace_path: longPath, description: 'Complete workspace description. '.repeat(12) }, { ...space, code_space_id: 'other', running: false }] });
  dispose = render(() => <EnvCodespacesPage />, host);
  await expect.poll(() => host.querySelectorAll('.codespace-card').length).toBe(2);
  const card = host.querySelector<HTMLElement>('.codespace-card')!;
  const details = card.querySelector('details')!;
  const summary = card.querySelector('summary')!;
  expect(card.querySelector('.codespace-path')!.getAttribute('title')).toBe(longPath);
  summary.focus(); await userEvent.keyboard('{Enter}');
  expect(details.open).toBe(true);
  expect(card.querySelector('.codespace-details-content')!.textContent).toContain(longPath);
  expect(card.querySelector('.codespace-details-content')!.textContent).toContain('13337');
  for (const currentWidth of [width, 900, width]) {
    host.style.width = `${currentWidth}px`;
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    expect(card.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
  }
  const media = commands as unknown as { emulateTouchInput: (value: boolean) => Promise<void> };
  try {
    await media.emulateTouchInput(true);
    expect(summary.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    for (const button of card.querySelectorAll('button')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    const [primary, secondary] = [...card.querySelector('.codespace-card-actions')!.children].map(element => element.getBoundingClientRect());
    if (secondary.top > primary.top) expect(secondary.top - primary.bottom).toBeGreaterThanOrEqual(8);
    else expect(secondary.left - primary.right).toBe(8);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  } finally { await media.emulateTouchInput(false); }
  summary.focus(); await userEvent.keyboard('{Enter}');
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
  expect(card.getBoundingClientRect().height).toBeLessThanOrEqual(172);
});

it.each([320, 544, 1077, 1440].flatMap(width => [false, true].flatMap(desktop => (['en-US', 'zh-CN'] as const).map(locale => ({ width, desktop, locale })))))(
  'balances the full card action row at $width px in $locale with desktop=$desktop', async ({ width, desktop, locale }) => {
    state.desktop = desktop; state.locale = locale;
    await page.viewport(width, 900);
    state.spaces.mockResolvedValue({ spaces: [space, { ...space, code_space_id: 'stopped', running: false }] });
    dispose = render(() => <EnvCodespacesPage />, host);
    await expect.poll(() => host.querySelectorAll('.codespace-card-actions').length).toBe(2);
    await document.fonts.ready;
    await page.screenshot({ element: host, path: `__screenshots__/balanced-actions-${width}-${desktop ? 'desktop' : 'web'}-${locale}.png` });
    for (const footer of host.querySelectorAll<HTMLElement>('.codespace-card-actions')) {
      const [primary, secondary] = [...footer.children] as HTMLElement[];
      const first = primary.getBoundingClientRect(), second = secondary.getBoundingClientRect();
      const bounds = footer.getBoundingClientRect(), css = getComputedStyle(footer);
      const leadingInset = first.left - bounds.left, trailingInset = bounds.right - second.right;
      console.info('Card action balance', JSON.stringify({ width, desktop, locale, leadingInset, trailingInset }));
      expect(leadingInset).toBeCloseTo(parseFloat(css.paddingLeft), 0);
      expect(trailingInset).toBeCloseTo(parseFloat(css.paddingRight), 0);
      expect(primary.querySelector('button')!.getBoundingClientRect().width).toBeGreaterThan(secondary.querySelector('button')!.getBoundingClientRect().width);
      for (const button of secondary.querySelectorAll('button')) expect(button.getBoundingClientRect().width).toBeLessThan(primary.getBoundingClientRect().width);
      expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth);
      expect(second.top).toBe(first.top);
      expect(second.left - first.right).toBeGreaterThanOrEqual(8);
      expect(second.left - first.right).toBeLessThanOrEqual(9);
      const buttons = [...footer.querySelectorAll('button')];
      for (const [index, button] of buttons.entries()) {
        expect(getComputedStyle(button).fontSize).toBe('12px');
        expect(button.getBoundingClientRect().height).toBe(28);
        assertButtonText(button);
        if (index > 0) {
          const gap = button.getBoundingClientRect().left - buttons[index - 1].getBoundingClientRect().right;
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThanOrEqual(8);
        }
      }
    }
  },
);

function assertButtonText(button: HTMLButtonElement) {
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement!;
    if (!node.textContent?.trim() || getComputedStyle(parent).visibility !== 'visible' || !parent.getClientRects().length) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    expect.soft(new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.top)).size, `${node.textContent} must stay on one line`).toBe(1);
    const text = range.getBoundingClientRect(), bounds = button.getBoundingClientRect();
    const icon = button.querySelector(':scope > svg, :scope > span[aria-hidden="true"]')?.getBoundingClientRect();
    if (icon) expect.soft(Math.abs(text.top + text.height / 2 - icon.top - icon.height / 2), `${node.textContent} must align with its icon`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(text.top + text.height / 2 - bounds.top - bounds.height / 2), `${node.textContent} must remain vertically centered`).toBeLessThanOrEqual(2);
    expect.soft(text.top, `${node.textContent} must fit vertically`).toBeGreaterThanOrEqual(bounds.top);
    expect.soft(text.bottom, `${node.textContent} must fit vertically`).toBeLessThanOrEqual(bounds.bottom);
    expect.soft(text.left, `${node.textContent} must fit horizontally`).toBeGreaterThanOrEqual(bounds.left);
    expect.soft(text.right, `${node.textContent} must fit horizontally`).toBeLessThanOrEqual(bounds.right);
  }
}

it.each([320, 544, 1077].flatMap(width => (Object.keys(dictionaries) as RedevenLocale[]).flatMap(locale => [false, true].flatMap(preparing => [false, true].map(running => ({ width, locale, preparing, running }))))))(
  'centers complete pending labels without moving card actions at $width px in $locale with preparing=$preparing and running=$running', async ({ width, locale, preparing, running }) => {
    state.locale = locale; state.desktop = true;
    await page.viewport(width, 900);
    state.spaces.mockResolvedValue({ spaces: [{ ...space, running }] });
    const pending = deferred<SpaceStatus>(); state.start.mockReturnValue(pending.promise);
    if (preparing) state.runtime.mockResolvedValue({
      active_runtime: { detection_state: 'missing', present: false },
      managed_runtime: { detection_state: 'missing', present: false },
      managed_runtime_source: 'none', installed_versions: [],
      operation: { action: 'prepare_workspace_engine', state: 'running', stage: 'downloading', install_method: 'remote_download' },
    });
    dispose = render(() => <EnvCodespacesPage />, host);
    await expect.poll(() => host.querySelector('.codespace-card')).toBeTruthy();
    await document.fonts.ready;
    const footer = host.querySelector<HTMLElement>('.codespace-card-actions')!;
    const buttons = [...footer.querySelectorAll('button')];
    const dimensions = () => [footer.closest('.codespace-card')!, footer, ...buttons].map(element => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return { left, top, width, height };
    });
    const idle = dimensions();
    buttons.forEach(assertButtonText);
    const row = footer.getBoundingClientRect();
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      expect.soft(rect.left).toBeGreaterThanOrEqual(row.left);
      expect.soft(rect.right).toBeLessThanOrEqual(row.right);
      expect.soft(rect.height).toBe(28);
      for (const other of buttons) {
        const peer = other.getBoundingClientRect();
        if (peer.top < rect.bottom && peer.bottom > rect.top) expect.soft(Math.abs(peer.top + peer.height / 2 - rect.top - rect.height / 2), 'Controls in each row stay centered').toBeLessThanOrEqual(1);
      }
    }
    buttons[0].click();
    const copy = createTestI18nHelpers(locale);
    const label = copy.t(preparing ? 'codespaces.status.settingUpEditor' : running ? 'codespaces.actions.opening' : 'codespaces.actions.starting');
    await expect.element(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    expect(buttons[0].getAttribute('aria-busy')).toBe('true');
    buttons.forEach(assertButtonText);
    expect(dimensions()).toEqual(idle);
    if ((width === 1077 && locale === 'zh-CN') || (width === 320 && locale === 'fr-FR')) await page.screenshot({ element: footer.closest('.codespace-card')!, path: `__screenshots__/aligned-pending-${locale}-${width}-${preparing ? 'setup' : 'start'}-${running ? 'running' : 'stopped'}.png` });
    if (!preparing) {
      pending.resolve(space);
      await expect.poll(() => buttons[0].disabled).toBe(false);
      expect(dimensions()).toEqual(idle);
      buttons.forEach(assertButtonText);
    }
  },
);

it('keeps compact Open menus named and keyboard accessible at intermediate desktop widths', async () => {
  state.desktop = true;
  await page.viewport(1077, 900);
  state.spaces.mockResolvedValue({ spaces: [{ ...space, running: false }] });
  dispose = render(() => <EnvCodespacesPage />, host);
  const open = page.getByTitle('Open', { exact: true });
  await expect.element(open).toBeVisible();
  const button = open.element() as HTMLButtonElement;
  expect(button.title).toBe('Open');
  expect(getComputedStyle(button.querySelector('.codespace-open-label')!).display).toBe('none');
  const trigger = button.closest<HTMLElement>('[data-floe-dropdown-trigger]')!;
  expect(trigger.getAttribute('aria-label')).toBe('Open');
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('menuitem', { name: 'Open in Desktop' })).toBeVisible();
  await expect.element(page.getByRole('menuitem', { name: 'Open in Browser' })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
});

it('keeps the compact inventory flush with its content padding', async () => {
  state.spaces.mockResolvedValue({ spaces: [space] });
  dispose = render(() => <EnvCodespacesPage />, host);
  await expect.poll(() => host.querySelector('.codespace-card')).toBeTruthy();
  const content = host.querySelector<HTMLElement>('.codespaces-content')!;
  const list = host.querySelector<HTMLElement>('.codespaces-grid')!;
  expect(list.getBoundingClientRect().top - content.getBoundingClientRect().top).toBe(parseFloat(getComputedStyle(content).paddingTop));
});


it.each([390, 900, 1440])('retains codespace geometry, selection and scroll through refresh failure and recovery at %ipx', async width => {
  await page.viewport(width, 800);
  const items = Array.from({ length: 15 }, (_, index) => ({ ...space, code_space_id: `retained-${index}`, name: `Workspace ${index}` }));
  state.spaces.mockResolvedValue({ spaces: items });
  dispose = render(() => <EnvCodespacesPage />, host);
  await expect.poll(() => host.querySelectorAll('.codespace-card').length).toBe(15);
  await document.fonts.ready;
  const viewport = host.querySelector<HTMLElement>('.codespaces-content')!;
  const card = host.querySelector<HTMLElement>('.codespace-card')!;
  const anchor = card.querySelector<HTMLButtonElement>('button')!;
  anchor.focus();
  const range = document.createRange(); range.selectNodeContents(card.querySelector('h3')!);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  const selection = window.getSelection()!.toString();
  viewport.scrollTop = 120;
  const scroll = viewport.scrollTop;
  const before = geometry();
  let reject!: (error: Error) => void;
  state.spaces.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
  refresh.click();
  await expect.poll(() => Boolean(reject)).toBe(true);
  expect(geometry()).toEqual(before);
  const error = 'Connection interrupted. ' + 'Diagnostic detail remains readable. '.repeat(80);
  reject(new Error(error));
  const trigger = host.querySelector<HTMLButtonElement>('[data-floe-status-indicator] button')!;
  await expect.poll(() => trigger.getAttribute('aria-hidden')).toBeNull();
  expect(document.activeElement).toBe(anchor);
  expect(window.getSelection()!.toString()).toBe(selection);
  expect(viewport.scrollTop).toBe(scroll);
  expect(host.querySelector('.codespace-card')).toBe(card);
  expect(geometry()).toEqual(before);
  await userEvent.click(trigger);
  const details = () => document.querySelector<HTMLElement>('[data-floe-status-details]');
  await expect.poll(() => details()?.textContent).toContain(error);
  expect(details()!.scrollHeight).toBeGreaterThan(details()!.clientHeight);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => details()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-hidden')).toBeNull();
  state.spaces.mockResolvedValue({ spaces: items });
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole('button', { name: 'Retry', exact: true }));
  await expect.poll(() => trigger.getAttribute('aria-hidden')).toBe('true');
  expect(details()).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('h1'));
  expect(host.querySelector('.codespace-card')).toBe(card);
  expect(viewport.scrollTop).toBe(scroll);
  expect(geometry()).toEqual(before);
});

it('keeps first-load codespace failure visible with a direct retry', async () => {
  state.spaces.mockRejectedValue(new Error('Inventory unavailable'));
  dispose = render(() => <EnvCodespacesPage />, host);
  await expect.poll(() => host.textContent).toContain('Inventory unavailable');
  expect(host.querySelector('[data-floe-status-indicator] button')?.getAttribute('aria-hidden')).toBe('true');
  expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeDefined();
});

it.each([390, 900, 1440])('keeps installation confirmation next to its method choices at %s px', async width => {
  state.locale = 'zh-CN'; state.desktop = true;
  await page.viewport(width, 900);
  host.style.height = '850px';
  state.spaces.mockResolvedValue({ spaces: [] });
  state.runtime.mockResolvedValue({ active_runtime: { detection_state: 'missing', present: false }, operation: { state: 'idle' } });
  dispose = render(() => <EnvCodespacesPage />, host);
  const install = page.getByRole('button', { name: '下载并安装', exact: true });
  await expect.element(install).toBeVisible();
  await document.fonts.ready;
  const panel = host.querySelector<HTMLElement>('[data-testid="browser-editor-setup-activity"]')!;
  const methods = panel.querySelector<HTMLElement>('.browser-editor-setup__method-section')!;
  const actions = panel.querySelector<HTMLElement>('.browser-editor-setup__actions')!;
  const button = actions.querySelector<HTMLButtonElement>('button')!;
  const methodRect = methods.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  expect(buttonRect.top - methodRect.bottom).toBeGreaterThanOrEqual(0);
  expect(buttonRect.top - methodRect.bottom).toBeLessThanOrEqual(16);
  expect(buttonRect.left).toBeCloseTo(methodRect.left, 0);
  expect(buttonRect.width).toBeCloseTo(methodRect.width, 0);
  if (width < 1024) {
    expect(buttonRect.bottom).toBeLessThan(panel.querySelector('.browser-editor-setup__secondary')!.getBoundingClientRect().top);
  }
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  assertButtonText(button);
  await page.screenshot({ element: host, path: `__screenshots__/codespaces-install-${width}.png` });
});
