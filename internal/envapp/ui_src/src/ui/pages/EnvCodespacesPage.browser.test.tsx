import '../../index.css';
import { Suspense, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { EnvCodespacesPage, type SpaceStatus } from './EnvCodespacesPage';
import { CodespacesPageSkeleton } from './CodespacesPresentation';

const state = vi.hoisted(() => ({ locale: 'en-US' as 'en-US' | 'zh-CN', scope: '', spaces: vi.fn(), runtime: vi.fn() }));
vi.mock('../i18n', async () => {
  const { createTestI18nHelpers } = await import('../i18n/locales/testDictionaries');
  return { useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) };
});
vi.mock('@floegence/floe-webapp-core', async original => ({
  ...await original<object>(), useNotification: () => ({ error: vi.fn(), success: vi.fn() }),
}));
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  resourceCacheScope: () => state.scope,
}) }));
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
  state.locale = 'en-US'; state.scope = `codespaces-browser-${crypto.randomUUID()}`;
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
  const button = row.querySelector<HTMLButtonElement>('button')!; button.focus();
  const viewport = host.querySelector<HTMLElement>('.codespaces-content')!; viewport.scrollTop = 240;
  const scroll = viewport.scrollTop; expect(scroll).toBe(240);
  inventory.resolve({ spaces: items.map(item => ({ ...item, name: `${item.name} updated` })) });
  runtime.resolve(ready);
  await expect.poll(() => row.textContent).toContain('Workspace 0 updated');
  expect(host.querySelector('.codespace-card')).toBe(row);
  expect(document.activeElement).toBe(button);
  expect(viewport.scrollTop).toBe(scroll);
  expect(host.querySelector('header .animate-spin')).toBeNull();
});
