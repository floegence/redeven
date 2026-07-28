// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { AIReadinessController, AIReadinessSnapshot } from '../../flower/aiReadiness';
import { AIReadinessSettingsSection } from './AIReadinessSettingsSection';

const fetchLocalApiJSON = vi.hoisted(() => vi.fn());
vi.mock('../../services/localApi', () => ({ fetchLocalApiJSON }));

function blockedSnapshot(): AIReadinessSnapshot {
  return {
    state: 'blocked',
    reason_code: 'store_integrity_error',
    retryable: false,
    safe_to_retry: false,
    committed: false,
    rolled_back: false,
  };
}

function degradedSnapshot(): AIReadinessSnapshot {
  return {
    state: 'degraded',
    reason_code: 'host_thread_settings_missing',
    issue_count: 1,
    retryable: false,
    safe_to_retry: false,
    committed: false,
    rolled_back: false,
  };
}

function orphanReview(threadID = 'thread_orphan') {
  return {
    issue_count: 1,
    items: [{ thread_id: threadID, phase: 'idle', status: 'idle', can_append_message: true, recoverable: false }],
  };
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mountSettings(refreshResult?: ReturnType<typeof deferred<AIReadinessSnapshot>>, initial = blockedSnapshot()) {
  const [snapshot, setSnapshot] = createSignal(initial);
  const [loading, setLoading] = createSignal(false);
  const [canAdmin, setCanAdmin] = createSignal(true);
  const refresh = vi.fn(() => {
    setLoading(true);
    const pending = refreshResult?.promise ?? Promise.resolve(snapshot());
    return pending.then((next) => {
      setSnapshot(next);
      return next;
    }).finally(() => setLoading(false));
  });
  const controller: AIReadinessController = {
    snapshot,
    loading,
    retryPending: () => false,
    nextCheckAt: () => null,
    refresh,
    retry: async () => snapshot(),
    pause: () => undefined,
    resume: async () => snapshot(),
    dispose: () => undefined,
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <I18nProvider>
      <AIReadinessSettingsSection
        controller={controller}
        canAdmin={canAdmin()}
        endpointID="env_a"
        namespacePublicID="ns_a"
        modelID="provider/model"
        permissionType="approval_required"
        workingDir="/workspace"
      />
    </I18nProvider>
  ), host);
  return { host, dispose, refresh, setCanAdmin };
}

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  fetchLocalApiJSON.mockReset();
});

describe('AIReadinessSettingsSection', () => {
  it('loads the admin orphan review and submits every explicit host setting', async () => {
    fetchLocalApiJSON
      .mockResolvedValueOnce({ issue_count: 1, items: [{ thread_id: 'thread_orphan', phase: 'idle', status: 'idle', can_append_message: true, recoverable: false }] })
      .mockResolvedValueOnce({ issue_count: 0 })
      .mockResolvedValueOnce({ issue_count: 0, items: [] });
    const fixture = mountSettings(undefined, {
      state: 'degraded', reason_code: 'host_thread_settings_missing', issue_count: 1,
      retryable: false, safe_to_retry: false, committed: false, rolled_back: false,
    });
    buttonWithText(fixture.host, 'Review').click();
    await flushMicrotasks();
    expect(fixture.host.querySelector('[data-orphan-thread-id="thread_orphan"]')).not.toBeNull();
    buttonWithText(fixture.host, 'Adopt with these settings').click();
    await flushMicrotasks();
    expect(fetchLocalApiJSON).toHaveBeenNthCalledWith(2, '/_redeven_proxy/api/ai/maintenance/orphan_roots/adopt', {
      method: 'POST',
      body: JSON.stringify({
        thread_id: 'thread_orphan', endpoint_id: 'env_a', namespace_public_id: 'ns_a',
        model_id: 'provider/model', permission_type: 'approval_required', working_dir: '/workspace',
      }),
    });
    fixture.dispose();
  });

  it('clears loaded review state, drafts, and delete confirmation immediately when admin access is revoked', async () => {
    fetchLocalApiJSON
      .mockResolvedValueOnce(orphanReview())
      .mockResolvedValueOnce(orphanReview());
    const fixture = mountSettings(undefined, degradedSnapshot());

    buttonWithText(fixture.host, 'Review').click();
    await flushMicrotasks();
    const workingDirectory = fixture.host.querySelector<HTMLInputElement>('input:not([readonly])')!;
    workingDirectory.value = '/sensitive/draft';
    workingDirectory.dispatchEvent(new InputEvent('input', { bubbles: true }));
    buttonWithText(fixture.host, 'Delete').click();
    expect(buttonWithText(fixture.host, 'Confirm canonical delete')).not.toBeNull();

    fixture.setCanAdmin(false);
    expect(fixture.host.querySelector('[data-testid="ai-orphan-root-review"]')).toBeNull();
    expect(fixture.host.textContent).not.toContain('thread_orphan');

    fixture.setCanAdmin(true);
    expect(fixture.host.querySelector('[data-testid="ai-orphan-root-review"]')).toBeNull();
    buttonWithText(fixture.host, 'Review').click();
    await flushMicrotasks();
    expect(fixture.host.querySelector<HTMLInputElement>('input:not([readonly])')?.value).toBe('/workspace');
    expect(buttonWithText(fixture.host, 'Delete').textContent).not.toContain('Confirm canonical delete');
    fixture.dispose();
  });

  it('discards an in-flight review response after admin access is revoked', async () => {
    const pendingReview = deferred<ReturnType<typeof orphanReview>>();
    fetchLocalApiJSON.mockImplementationOnce(() => pendingReview.promise);
    const fixture = mountSettings(undefined, degradedSnapshot());

    buttonWithText(fixture.host, 'Review').click();
    fixture.setCanAdmin(false);
    pendingReview.resolve(orphanReview('thread_from_revoked_request'));
    await flushMicrotasks();
    fixture.setCanAdmin(true);

    expect(fixture.host.textContent).not.toContain('thread_from_revoked_request');
    expect(fixture.host.querySelector('[data-testid="ai-orphan-root-review"]')).toBeNull();
    expect(buttonWithText(fixture.host, 'Review').disabled).toBe(false);
    fixture.dispose();
  });

  it.each([
    { name: 'adopt', start: (host: HTMLElement) => buttonWithText(host, 'Adopt with these settings').click() },
    { name: 'delete', start: (host: HTMLElement) => { buttonWithText(host, 'Delete').click(); buttonWithText(host, 'Confirm canonical delete').click(); } },
  ])('does not restore sensitive state from an in-flight $name callback after admin access is revoked', async ({ start }) => {
    const pendingAction = deferred<unknown>();
    fetchLocalApiJSON
      .mockResolvedValueOnce(orphanReview())
      .mockImplementationOnce(() => pendingAction.promise)
      .mockResolvedValueOnce(orphanReview());
    const fixture = mountSettings(undefined, degradedSnapshot());
    buttonWithText(fixture.host, 'Review').click();
    await flushMicrotasks();

    start(fixture.host);
    fixture.setCanAdmin(false);
    pendingAction.resolve({ issue_count: 0 });
    await flushMicrotasks();
    expect(fixture.refresh).not.toHaveBeenCalled();

    fixture.setCanAdmin(true);
    expect(fixture.host.textContent).not.toContain('thread_orphan');
    buttonWithText(fixture.host, 'Review').click();
    await flushMicrotasks();
    expect(buttonWithText(fixture.host, 'Adopt with these settings').disabled).toBe(false);
    expect(buttonWithText(fixture.host, 'Delete').textContent).not.toContain('Confirm canonical delete');
    fixture.dispose();
  });

  it('clears admin review errors when access is revoked', async () => {
    fetchLocalApiJSON.mockRejectedValueOnce(new Error('sensitive maintenance failure'));
    const fixture = mountSettings(undefined, degradedSnapshot());

    buttonWithText(fixture.host, 'Review').click();
    await flushMicrotasks();
    expect(fixture.host.querySelector('[role="alert"]')?.textContent).toContain('sensitive maintenance failure');

    fixture.setCanAdmin(false);
    fixture.setCanAdmin(true);
    expect(fixture.host.querySelector('[role="alert"]')).toBeNull();
    fixture.dispose();
  });

  it('keeps three ownership groups distinct and marks non-Floret stores as not checked', () => {
    const fixture = mountSettings();
    const rows = fixture.host.querySelectorAll('.redeven-setting-row');

    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Floret Store');
    expect(rows[0]?.textContent).toContain('Floret owns admitted Agent conversations and lifecycle state.');
    expect(rows[1]?.textContent).toContain('Redeven product stores');
    expect(rows[1]?.textContent).toContain('This Flower check does not inspect Redeven-owned product stores.');
    expect(rows[2]?.textContent).toContain('Other upstream stores');
    expect(rows[2]?.textContent).toContain('Each upstream component keeps its own maintenance authority.');
    expect(Array.from(rows).filter((row) => row.textContent?.includes('Not checked here'))).toHaveLength(2);
    fixture.dispose();
  });

  it('copies exactly the displayed sanitized rows and exposes copy pending synchronously', async () => {
    const clipboard = deferred<void>();
    const writeText = vi.fn((_value: string) => clipboard.promise);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fixture = mountSettings();
    buttonWithText(fixture.host, 'View diagnostics').click();
    const diagnostics = fixture.host.querySelector<HTMLElement>('[data-testid="ai-readiness-settings-diagnostics"]')!;
    const displayedRows = Array.from(diagnostics.querySelectorAll('dl > div'))
      .map((row) => `${row.querySelector('dt')?.textContent}: ${row.querySelector('dd')?.textContent}`)
      .join('\n');
    const copy = buttonWithText(fixture.host, 'Copy diagnostics');

    copy.click();
    expect(copy.disabled).toBe(true);
    expect(copy.dataset.pending).toBe('true');
    expect(copy.getAttribute('aria-busy')).toBe('true');
    expect(writeText).toHaveBeenCalledWith(displayedRows);
    expect(displayedRows).not.toContain('store_integrity_error');

    clipboard.resolve();
    await flushMicrotasks();
    expect(copy.disabled).toBe(false);
    expect(copy.textContent).toContain('Diagnostics copied');
    expect(fixture.host.querySelector('[role="status"]')?.textContent).toContain('Diagnostics copied');
    fixture.dispose();
  });

  it('shows refresh pending synchronously and clears it after the request settles', async () => {
    const refreshResult = deferred<AIReadinessSnapshot>();
    const fixture = mountSettings(refreshResult);
    const refresh = buttonWithText(fixture.host, 'Refresh');

    refresh.click();
    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(refresh.disabled).toBe(true);
    expect(refresh.dataset.pending).toBe('true');
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(refresh.textContent).toContain('Refreshing...');

    refreshResult.resolve(blockedSnapshot());
    await flushMicrotasks();
    expect(refresh.disabled).toBe(false);
    expect(refresh.dataset.pending).toBeUndefined();
    expect(refresh.textContent).toContain('Refresh');
    fixture.dispose();
  });

  it('clears copy pending and exposes a retryable copy state after clipboard failure', async () => {
    const writeText = vi.fn(async (_value: string) => {
      throw new Error('clipboard denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fixture = mountSettings();
    buttonWithText(fixture.host, 'View diagnostics').click();
    const copy = buttonWithText(fixture.host, 'Copy diagnostics');

    copy.click();
    expect(copy.dataset.pending).toBe('true');
    await flushMicrotasks();

    expect(copy.disabled).toBe(false);
    expect(copy.dataset.pending).toBeUndefined();
    expect(copy.textContent).toContain('Copy unavailable');
    expect(fixture.host.querySelector('[role="status"]')?.textContent).toContain('Copy unavailable');
    copy.click();
    expect(writeText).toHaveBeenCalledTimes(2);
    fixture.dispose();
  });
});
