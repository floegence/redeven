import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';

const state = vi.hoisted(() => ({ locale: 'en-US' as 'en-US' | 'zh-CN', detach: vi.fn() }));
vi.mock('../i18n', async () => {
  const { createTestI18nHelpers } = await import('../i18n/locales/testDictionaries');
  return { useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) };
});
vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'host', localRuntime: () => ({}),
}) }));
vi.mock('../services/hostApplicationsApi', async importOriginal => {
  const app = { id: 'editor.app', name: 'Text Editor', description: '', categories: [], icon: '', custom: false };
  const session = { id: 'shared', application: app, state: 'running', backend: 'macos' };
  return {
    ...await importOriginal<object>(),
    listHostApplications: async () => ({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [app], sessions: [session], running: [{ application_id: app.id, instances: ['instance'] }] }),
    listHostApplicationSessions: async () => [session],
    listRunningHostApplications: async () => [{ application_id: app.id, instances: ['instance'] }],
    detachHostApplication: state.detach,
  };
});

let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  state.detach.mockClear();
  await page.viewport(1280, 720);
});

it.each([390, 1440].flatMap(width => (['en-US', 'zh-CN'] as const).map(locale => ({ width, locale }))))(
  'shows stop-sharing guidance in the body at $width px in $locale', async ({ width, locale }) => {
    state.locale = locale;
    await page.viewport(width, 900);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <EnvHostApplicationsPage />, host);
    const title = locale === 'zh-CN' ? '停止共享' : 'Stop sharing';
    await userEvent.click(page.getByRole('button', { name: `${title} · Text Editor`, exact: true }));
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeTruthy();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
    const header = dialog.querySelector<HTMLElement>('[data-floe-dialog-header]')!;
    const body = dialog.querySelector<HTMLElement>('[data-floe-dialog-body]')!;
    const footer = dialog.querySelector<HTMLElement>('[data-floe-dialog-footer]')!;
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!)!;
    expect(header.textContent).toBe(title);
    expect(description.parentElement).toBe(body);
    expect(body.children).toHaveLength(1);
    expect(description.textContent).toContain(locale === 'zh-CN' ? '应用窗口和未保存的工作会保留在 Mac 上。' : 'Its windows and unsaved work will remain open on the Mac.');
    expect(description.getBoundingClientRect().top).toBeGreaterThan(header.getBoundingClientRect().bottom);
    expect(description.getBoundingClientRect().bottom).toBeLessThan(footer.getBoundingClientRect().top);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    await page.screenshot({ element: dialog, path: `__screenshots__/stop-sharing-${locale}-${width}.png` });
    await userEvent.click(page.getByRole('button', { name: locale === 'zh-CN' ? '取消' : 'Cancel', exact: true }));
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    expect(state.detach).not.toHaveBeenCalled();
  },
);
