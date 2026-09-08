import '../../../index.css';
import '../../flower-feature.css';

import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import type { AIReadinessController, AIReadinessSnapshot } from '../../flower/aiReadiness';
import { FlowerStorageSettings } from './FlowerStorageSettings';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../services/localApi', () => ({ fetchLocalApiJSON: request }));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); request.mockReset(); });

it('keeps backup review readable at narrow width and requires explicit keyboard-safe confirmation', async () => {
  writeStoredLanguagePreference('en-US');
  const snapshot: AIReadinessSnapshot = { state: 'blocked', reason_code: 'store_integrity_error', retryable: false, safe_to_retry: false };
  const controller: AIReadinessController = {
    snapshot: () => snapshot, loading: () => false, retryPending: () => false,
    busyStartedAt: () => null, startupElapsedMs: () => null, longStartupReadySequence: () => 0,
    refresh: async () => snapshot, retry: async () => snapshot, pause: () => undefined, resume: async () => snapshot, dispose: () => undefined,
  };
  const id = 'a'.repeat(32);
  request.mockResolvedValueOnce({ snapshots: [
    { id, created_at: '2026-09-08T12:00:00Z', source_build: `v0.12.0:${'b'.repeat(64)}`, bytes: 15_000_000, kind: 'automatic', protected: true },
    { id: 'c'.repeat(32), unavailable: true, protected: true },
  ] });
  host = document.createElement('div');
  Object.assign(host.style, { width: '340px', maxWidth: '100%', padding: '16px', background: 'var(--background)', color: 'var(--foreground)' });
  document.body.appendChild(host);
  dispose = render(() => <I18nProvider><FlowerStorageSettings controller={controller} canAdmin /></I18nProvider>, host);
  await page.getByRole('button', { name: 'View backups', exact: true }).click();
  const review = page.getByRole('button', { name: 'Review restore', exact: true });
  await expect.element(review.nth(1)).toBeDisabled();
  await review.nth(0).click();
  await expect.element(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveFocus();
  expect(request).toHaveBeenCalledTimes(1);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
  expect(host.textContent).toContain('Commands');
  if (import.meta.env.VITE_FLOWER_RECOVERY_SCREENSHOT === '1') await page.screenshot();
  request.mockResolvedValueOnce({});
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click();
  expect(request).toHaveBeenLastCalledWith('/_redeven_proxy/api/ai/maintenance/restore', { method: 'POST', body: JSON.stringify({ snapshot_id: id, confirmed: true }) });
});
