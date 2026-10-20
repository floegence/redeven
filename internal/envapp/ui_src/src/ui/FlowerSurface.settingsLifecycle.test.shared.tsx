import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import {
  adapter, deferred, flush, flowerSurfaceNotifications, launchReceipt,
  renderSurfaceWithAdapterProps, settingsSnapshot, thread, liveBootstrap, waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => vi.useRealTimers());

const fillDraft = (surface: HTMLElement) => {
  const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  editor.value = 'Preserve this unsent draft';
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return editor;
};
const submit = (surface: HTMLElement) => surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
const status = (surface: HTMLElement) => surface.querySelector<HTMLElement>('.flower-settings-read-status');
const retry = (surface: HTMLElement) => status(surface)!.querySelector<HTMLButtonElement>('button')!;

describe('Flower settings lifecycle', () => {
  it.each(['full', 'companion'] as const)('keeps %s failures visible through navigation and retries once without sending automatically', async presentation => {
    const pending = deferred<FlowerSettingsSnapshot>();
    const loadSettings = vi.fn().mockRejectedValueOnce(new Error('Preferences unavailable')).mockImplementation(() => pending.promise);
    const launchTurn = vi.fn(async input => launchReceipt('thread-new', 'turn-new', 'start', input.client_request_id));
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: async () => withModelDirectoryFixture(settingsSnapshot()).model_directory!, launchTurn }, { presentation, companionOpen: true, engaged: true });
    await waitFor(() => status(surface)?.textContent?.includes('Preferences unavailable') === true);
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')?.click();
    await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === 'thread-1');
    const editor = fillDraft(surface);
    expect(submit(surface).disabled).toBe(true);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(launchTurn).not.toHaveBeenCalled();
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-2"] button')?.click();
    await flush();
    expect(status(surface)?.textContent).toContain('Preferences unavailable');
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')?.click();
    await flush();
    expect(surface.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Preserve this unsent draft');
    retry(surface).click();
    status(surface)?.querySelector<HTMLButtonElement>('button')?.click();
    await waitFor(() => loadSettings.mock.calls.length === 2);
    pending.resolve(settingsSnapshot());
    await waitFor(() => status(surface) === null);
    expect(launchTurn).not.toHaveBeenCalled();
    expect(surface.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Preserve this unsent draft');
    submit(surface).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(flowerSurfaceNotifications().filter(item => item.tone === 'error').every(item => item.message === 'Preferences unavailable')).toBe(true);
  });

  it.each(['success', 'failure'] as const)('ignores an old %s after multiple revision changes and only confirms the latest read', async result => {
    const reads = [deferred<FlowerSettingsSnapshot>(), deferred<FlowerSettingsSnapshot>(), deferred<FlowerSettingsSnapshot>()];
    const signals: AbortSignal[] = [];
    const loadSettings = vi.fn((_refresh?: boolean, signal?: AbortSignal) => { signals.push(signal!); return reads[signals.length - 1].promise; });
    const [revision, setRevision] = createSignal('0:0');
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: async () => withModelDirectoryFixture(settingsSnapshot()).model_directory! }, { settingsRevision: revision });
    await waitFor(() => signals.length === 1);
    fillDraft(surface);
    setRevision('1:0'); await waitFor(() => signals.length === 2);
    setRevision('1:1'); await waitFor(() => signals.length === 3);
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(true);
    if (result === 'success') reads[0].resolve(settingsSnapshot()); else reads[0].reject(new Error('Old request failure'));
    await flush();
    expect(status(surface)?.getAttribute('aria-busy')).toBe('true');
    expect(submit(surface).disabled).toBe(true);
    reads[2].resolve(settingsSnapshot());
    await waitFor(() => status(surface) === null);
    reads[1].reject(new Error('Other old failure'));
    await flush();
    expect(status(surface)).toBeNull();
    expect(submit(surface).disabled).toBe(false);
    expect(surface.textContent).not.toContain('Old request failure');
  });

  it('shares initialization with opening settings and always allows closing the panel', async () => {
    const old = deferred<FlowerSettingsSnapshot>();
    const loadSettings = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(settingsSnapshot());
    const [revision] = createSignal(0);
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: async () => withModelDirectoryFixture(settingsSnapshot()).model_directory! }, { settingsRevision: revision });
    await waitFor(() => loadSettings.mock.calls.length === 1);
    fillDraft(surface);

    surface.querySelector<HTMLButtonElement>('button[aria-label="Flower settings"]')!.click();
    await flush();
    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click();
    await waitFor(() => document.querySelector('[role="dialog"]') === null);
    old.reject(new Error('Read failed'));
    await waitFor(() => status(surface)?.textContent?.includes('Read failed') === true);
    retry(surface).click();
    await waitFor(() => status(surface) === null);
    expect(surface.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Preserve this unsent draft');
    expect(loadSettings).toHaveBeenCalledTimes(2);
  });
});

it('releases a settings timeout and ignores its late success after manual retry', async () => {
  const pending = deferred<FlowerSettingsSnapshot>();
  const loadSettings = vi.fn().mockResolvedValueOnce(settingsSnapshot()).mockImplementationOnce(() => pending.promise).mockResolvedValue(settingsSnapshot());
  const [revision, setRevision] = createSignal(0);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: async () => withModelDirectoryFixture(settingsSnapshot()).model_directory! }, { settingsRevision: revision });
  await waitFor(() => status(surface) === null);
  fillDraft(surface);
  vi.useFakeTimers();
  setRevision(1);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(status(surface)?.textContent).toContain('15 seconds');
  expect(submit(surface).disabled).toBe(true);
  retry(surface).click();
  await vi.advanceTimersByTimeAsync(0);
  expect(loadSettings).toHaveBeenCalledTimes(3);
  expect(status(surface)).toBeNull();
  pending.resolve({ ...settingsSnapshot(), defaults: { permission_type: 'readonly' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(status(surface)).toBeNull();
  expect(submit(surface).disabled).toBe(false);
  expect(surface.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Preserve this unsent draft');
  vi.useRealTimers();
});

it('keeps recovery accessible in a collapsed companion', async () => {
  const loadSettings = vi.fn().mockRejectedValueOnce(new Error('Settings unavailable')).mockResolvedValue(settingsSnapshot());
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: async () => withModelDirectoryFixture(settingsSnapshot()).model_directory! }, { presentation: 'companion', companionOpen: false, engaged: true });
  await waitFor(() => status(surface)?.textContent?.includes('Settings unavailable') === true);
  expect(status(surface)!.closest('[inert], [aria-hidden="true"]')).toBeNull();
  retry(surface).click();
  await waitFor(() => status(surface) === null);
  expect(loadSettings).toHaveBeenCalledTimes(2);
});

it('keeps Stop available when settings fail independently of a running conversation', async () => {
  const running = thread({ thread_id: 'running-without-settings', status: 'running' });
  const stopThread = vi.fn(async () => {});
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings: async () => { throw new Error('Settings unavailable'); },
    listThreads: async () => [running], loadThread: async () => liveBootstrap(running, 1), stopThread }, {});
  await waitFor(() => !!surface.querySelector('[data-thread-id="running-without-settings"] button'));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="running-without-settings"] button')!.click();
  await waitFor(() => submit(surface).getAttribute('aria-label') === 'Stop');
  expect(status(surface)?.textContent).toContain('Settings unavailable');
  expect(submit(surface).disabled).toBe(false);
  submit(surface).click();
  await waitFor(() => stopThread.mock.calls.length === 1);
});
