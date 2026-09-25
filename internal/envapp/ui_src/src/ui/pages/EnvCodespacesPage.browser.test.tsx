import '../../index.css';
import { Suspense, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { EnvCodespacesPage, type SpaceStatus } from './EnvCodespacesPage';
import { CodespacesPageSkeleton } from './CodespacesPresentation';

const state = vi.hoisted(() => ({ locale: 'en-US' as 'en-US' | 'zh-CN', scope: '', desktop: false, spaces: vi.fn(), runtime: vi.fn() }));
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
vi.mock('../services/desktopShellBridge', async original => ({ ...await original<object>(), desktopShellCodespaceWindowOpenAvailable: () => state.desktop }));
vi.mock('../services/filesystemPicker', () => ({ useEnvFilesystemPicker: () => ({}) }));
vi.mock('../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: (url: string) => {
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
  state.spaces.mockReset(); state.runtime.mockReset().mockResolvedValue(ready);
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
  await page.viewport(1440, 900);
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
    expect.soft(action.getBoundingClientRect().width).toBeLessThanOrEqual(card.getBoundingClientRect().width * .5);
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

it.each([false, true].flatMap(desktop => (['en-US', 'zh-CN'] as const).map(locale => ({ desktop, locale }))))(
  'keeps card actions adjacent in $locale with desktop=$desktop', async ({ desktop, locale }) => {
    state.desktop = desktop; state.locale = locale;
    await page.viewport(1440, 900);
    state.spaces.mockResolvedValue({ spaces: [space, { ...space, code_space_id: 'stopped', running: false }] });
    dispose = render(() => <EnvCodespacesPage />, host);
    await expect.poll(() => host.querySelectorAll('.codespace-card-actions').length).toBe(2);
    await document.fonts.ready;
    await page.screenshot({ element: host, path: `__screenshots__/adjacent-actions-${desktop ? 'desktop' : 'web'}-${locale}.png` });
    for (const footer of host.querySelectorAll<HTMLElement>('.codespace-card-actions')) {
      const [primary, secondary] = [...footer.children] as HTMLElement[];
      const first = primary.getBoundingClientRect(), second = secondary.getBoundingClientRect();
      console.info('Card action gap', JSON.stringify({ desktop, locale, gap: second.left - first.right }));
      expect(second.top).toBe(first.top);
      expect(second.left - first.right).toBeGreaterThanOrEqual(8);
      expect(second.left - first.right).toBeLessThanOrEqual(9);
      for (const button of footer.querySelectorAll('button')) expect(getComputedStyle(button).fontSize).toBe('12px');
    }
  },
);
