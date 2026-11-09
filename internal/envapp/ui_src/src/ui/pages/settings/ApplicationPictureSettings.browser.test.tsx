import '../../../index.css';
import '../runtime-settings-compact.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { Dialog, Switch } from '@floegence/floe-webapp-core/ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { ApplicationPictureSettings } from './ApplicationPictureSettings';
import { SettingsList, SettingRow } from './SettingsPrimitives';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import type { SettingsTarget } from '../../../../../../settings_ui/src/settingsSession';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: api.request }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => ({ phase: 'ready', generation: 0 }) }) }));
const initial = { mode: 'auto', max_dimension: 0, frame_rate: 0 };
const media = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void>; emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
let dispose: (() => void) | undefined;
let setPresented!: (value: boolean) => void, setTarget!: (value: SettingsTarget) => void;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { api.request.mockResolvedValue(initial); });
afterEach(async () => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.resetAllMocks(); await media.emulateTouchInput(false); await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); });
async function mount(width: number, touch = false, failedRead = false) {
  await page.viewport(width, 850); await media.emulateTouchInput(touch); await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => {
    const [presented, updatePresented] = createSignal(true); setPresented = updatePresented;
    const [target, updateTarget] = createSignal<SettingsTarget>({ section: 'applications' }); setTarget = updateTarget;
    return <FloeProvider><SettingsPanelContext.Provider value={{ present: presented, target, open: updateTarget, close: () => updatePresented(false), register: () => () => {} }}>
      <Dialog open onOpenChange={() => {}} title="Applications" class="redeven-settings-shell" contentClass="redeven-settings-page">
        <ApplicationPictureSettings allowed macOS />
        <SettingsList class="picture-following-settings"><SettingRow title="Host access" control={<Switch aria-label="Host access" checked onChange={() => {}} />} /></SettingsList>
      </Dialog>
    </SettingsPanelContext.Provider></FloeProvider>;
  }, host);
  if (failedRead) await expect.poll(() => document.querySelector('[role=alert]')?.textContent?.length ?? 0).toBeGreaterThan(0);
  else await expect.element(page.getByRole('combobox', { name: 'Picture quality', exact: true })).toBeEnabled();
  const dialog = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
  await expect.poll(() => dialog.dataset.floatingPresence).toBe('open');
  await expect.poll(() => dialog.getAnimations().every(animation => animation.playState !== 'running')).toBe(true);
}
function geometry() {
  const picture = document.querySelector<HTMLElement>('[data-testid=application-picture-settings]')!, following = document.querySelector<HTMLElement>('.picture-following-settings')!;
  return { height: picture.getBoundingClientRect().height, following: following.getBoundingClientRect().top, width: picture.clientWidth, scrollWidth: picture.scrollWidth };
}
it.each([1440, 390, 320])('keeps following settings stable while saving, failing and recovering at %ipx', async width => {
  await mount(width, width < 600); const before = geometry();
  const pending = deferred<typeof initial>(); api.request.mockReturnValueOnce(pending.promise);
  await page.getByRole('combobox', { name: 'Picture quality', exact: true }).click();
  await page.getByRole('option', { name: 'Motion first', exact: true }).click();
  await expect.poll(() => api.request.mock.calls.length).toBe(2);
  expect(geometry().height).toBe(before.height); expect(geometry().following).toBe(before.following);
  pending.reject(new Error('uncertain transport result'));
  await expect.poll(() => document.querySelector('[role=alert]')?.textContent).toContain('Could not save');
  expect(geometry().height).toBe(before.height); expect(geometry().following).toBe(before.following);
  const indicator = document.querySelector<HTMLButtonElement>('[data-floe-status-indicator] > button')!;
  indicator.click(); await expect.element(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(geometry().following).toBe(before.following); expect(api.request).toHaveBeenCalledTimes(2);
  const recovery = deferred<typeof initial>(); api.request.mockReturnValueOnce(recovery.promise);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect(geometry().following).toBe(before.following); expect(api.request).toHaveBeenCalledTimes(3);
  recovery.resolve({ ...initial, mode: 'smooth' });
  await expect.poll(() => document.querySelector('[data-floe-status-indicator] > button')?.getAttribute('aria-hidden')).toBe('true');
  expect(geometry().height).toBe(before.height); expect(geometry().following).toBe(before.following);
  expect(geometry().scrollWidth).toBeLessThanOrEqual(geometry().width + 1);
  expect(document.activeElement).toBe(page.getByRole('combobox', { name: 'Picture quality', exact: true }).element());
  expect(document.querySelector('[data-floe-status-details]')).toBeNull();
});

it.each(['category', 'closed'] as const)('closes picture feedback and rejects a retained Retry after %s presentation changes', async change => {
  await mount(390, true); api.request.mockRejectedValueOnce(new Error('uncertain transport result'));
  await page.getByRole('combobox', { name: 'Picture quality', exact: true }).click();
  await page.getByRole('option', { name: 'Motion first', exact: true }).click();
  await expect.poll(() => document.querySelector('[role=alert]')?.textContent).toContain('Could not save');
  document.querySelector<HTMLButtonElement>('[data-floe-status-indicator] > button')!.click();
  const retry = page.getByRole('button', { name: 'Retry', exact: true }); await expect.element(retry).toBeVisible();
  const stale = retry.element() as HTMLButtonElement;
  if (change === 'category') setTarget({ section: 'logging' }); else setPresented(false);
  await expect.poll(() => document.querySelector('[data-floe-status-details]')).toBeNull();
  stale.click(); expect(api.request).toHaveBeenCalledTimes(2);
  if (change === 'category') setTarget({ section: 'applications' }); else setPresented(true);
  expect(api.request).toHaveBeenCalledTimes(2); expect(document.querySelector('[data-floe-status-details]')).toBeNull();
  await expect.element(page.getByRole('combobox', { name: 'Picture quality', exact: true })).toHaveTextContent('Motion first');
});

it('keeps failed-read Refresh available while selectors are disabled and restores focus on recovery', async () => {
  api.request.mockRejectedValueOnce(new Error('offline'));
  await mount(390, true, true);
  const indicator = document.querySelector<HTMLButtonElement>('[data-floe-status-indicator] > button')!; indicator.click();
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true }); await expect.element(refresh).toBeEnabled();
  await expect.element(page.getByRole('combobox', { name: 'Picture quality', exact: true })).toBeDisabled();
  const before = geometry(); await refresh.click();
  await expect.element(page.getByRole('combobox', { name: 'Picture quality', exact: true })).toBeEnabled();
  expect(api.request.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  expect(geometry().height).toBe(before.height); expect(geometry().following).toBe(before.following);
  expect(document.querySelector('[data-floe-status-details]')).toBeNull();
  expect(document.activeElement).toBe(page.getByRole('combobox', { name: 'Picture quality', exact: true }).element());
});
