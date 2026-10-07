import '../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { SUPPORTED_LOCALES, type RedevenLocale } from '../ui/i18n/localeMeta';
import { createTestI18nHelpers } from '../ui/i18n/locales/testDictionaries';
import { EnvHostApplicationsPage } from '../ui/pages/EnvHostApplicationsPage';

const state = vi.hoisted(() => {
  const app = { id: 'fixture', name: 'A host application with a long display name', description: '', categories: [], icon: '', custom: false };
  return { locale: 'en-US' as RedevenLocale, backend: 'macos', app, running: [{ application_id: app.id, instances: ['fixture-generation'] }] };
});
vi.mock('../ui/i18n', () => ({ useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) }));
vi.mock('../ui/pages/EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'fixture', localRuntime: () => ({}),
}) }));
vi.mock('../ui/services/hostApplicationsApi', async importOriginal => ({
  ...await importOriginal<object>(),
  listHostApplications: async () => ({ availability: { backend: state.backend, supported: true, ready: true, native_ready: true }, applications: [state.app], sessions: [], running: state.running }),
  listHostApplicationSessions: async () => [],
  listRunningHostApplications: async () => state.running,
}));
let dispose: (() => void) | undefined;
afterEach(() => { state.locale = 'en-US'; dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('dark'); delete document.documentElement.dataset.floeShellTheme; });

it.each([360,1100].flatMap(width => ['macos','linux'].flatMap(backend => ['light','dark'].map(mode => ({width,backend,mode})))))('keeps $backend controls readable at $width px in $mode', async ({width,backend,mode}) => {
  state.backend=backend;
  document.documentElement.classList.toggle('dark',mode==='dark');
  await page.viewport(width,800);
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:680px;background:var(--background)`;
  document.body.append(host);
  dispose = render(() => <EnvHostApplicationsPage />, host);
  await expect.poll(() => host.querySelector('.host-app-quit')).toBeTruthy();
  const row = host.querySelector<HTMLElement>('.host-app-process-row')!;
  const open = row.querySelector<HTMLButtonElement>('.host-app-session-open')!;
  const quit = row.querySelector<HTMLButtonElement>('.host-app-quit')!;
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  expect(open.getBoundingClientRect().right).toBeLessThanOrEqual(quit.getBoundingClientRect().left);
  expect(quit.getBoundingClientRect().height).toBeGreaterThan(24);
  expect(getComputedStyle(quit).cursor).toBe('pointer');
  await userEvent.click(quit);
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(dialog.textContent).toContain(state.app.name);
  expect(dialog.textContent).toContain(backend === 'macos' ? 'all of its windows' : 'Close all windows in this application session.');
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(500);
  await userEvent.click([...dialog.querySelectorAll('button')].find(button => button.textContent === 'Force quit…')!);
  expect(dialog.textContent).toContain('Unsaved work will be lost.');
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await page.screenshot({element:dialog,path:`__screenshots__/force-quit-${backend}-${mode}-${width}.png`});
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(quit);
});

it.each(SUPPORTED_LOCALES)('keeps ordinary and forced Linux close confirmations readable in %s', async locale => {
  state.locale=locale; state.backend='linux';
  await page.viewport(390,850);
  const host=document.createElement('div');document.body.append(host);
  dispose=render(() => <EnvHostApplicationsPage />,host);
  await expect.poll(() => host.querySelector('.host-app-quit')).toBeTruthy();
  await userEvent.click(host.querySelector<HTMLButtonElement>('.host-app-quit')!);
  const dialog=document.querySelector<HTMLElement>('[role=dialog]')!;
  const copy=createTestI18nHelpers(locale);
  expect(dialog.textContent).toContain(copy.t('hostApplications.closeAllWindowsTitle',{name:state.app.name}));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  await userEvent.click([...dialog.querySelectorAll('button')].find(button => button.textContent===copy.t('hostApplications.forceQuitSwitch'))!);
  expect(dialog.textContent).toContain(copy.t('hostApplications.forceQuitDescription'));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  for (const button of dialog.querySelectorAll('button')) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right);
  }
});
