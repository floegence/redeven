// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n';
import { AIReadinessBoundary } from './AIReadinessBoundary';
import type { AIReadinessController, AIReadinessSnapshot } from './aiReadiness';

function snapshot(
  reasonCode: AIReadinessSnapshot['reason_code'] = 'temporarily_blocked',
  overrides: Partial<AIReadinessSnapshot> = {},
): AIReadinessSnapshot {
  return {
    state: 'blocked',
    reason_code: reasonCode,
    retryable: reasonCode === 'temporarily_blocked',
    safe_to_retry: reasonCode === 'temporarily_blocked',
    committed: false,
    rolled_back: false,
    ...overrides,
  };
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mount(
  initial: AIReadinessSnapshot,
  retryResult?: ReturnType<typeof deferred<AIReadinessSnapshot>>,
  options: Readonly<{
    focusEnabled?: boolean;
    canRetryGeneration?: boolean;
    nextCheckAt?: number | null;
  }> = {},
) {
  const [current, setCurrent] = createSignal(initial);
  const [retryPending, setRetryPending] = createSignal(false);
  const retry = vi.fn(() => {
    setRetryPending(true);
    const pending = retryResult?.promise ?? Promise.resolve(current());
    return pending.then((next) => {
      setCurrent(next);
      setRetryPending(false);
      return next;
    });
  });
  const controller: AIReadinessController = {
    snapshot: current,
    loading: () => false,
    retryPending,
    nextCheckAt: () => options.nextCheckAt ?? null,
    refresh: async () => current(),
    retry,
    dispose: vi.fn(),
  };
  const openUpdate = vi.fn();
  const openPermissions = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <I18nProvider>
      <AIReadinessBoundary
        controller={controller}
        onOpenUpdate={openUpdate}
        onOpenPermissions={openPermissions}
        canRetryGeneration={options.canRetryGeneration ?? true}
        focusEnabled={options.focusEnabled ?? true}
      >
        <button type="button" data-testid="flower-child">Flower child</button>
      </AIReadinessBoundary>
    </I18nProvider>
  ), host);
  return { host, dispose, setCurrent, retry, openUpdate, openPermissions };
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
});

describe('AIReadinessBoundary', () => {
  it('keeps terminal, files, and settings siblings operable while Flower is blocked', () => {
    const fixture = mount(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));
    const clicks = vi.fn();
    const siblings = ['Terminal', 'Files', 'Settings'].map((label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', clicks);
      fixture.host.prepend(button);
      return button;
    });

    for (const button of siblings) {
      button.focus();
      expect(document.activeElement).toBe(button);
      button.click();
    }
    expect(clicks).toHaveBeenCalledTimes(3);
    expect(document.body.hasAttribute('inert')).toBe(false);
    expect(document.body.hasAttribute('aria-hidden')).toBe(false);
    expect(fixture.host.hasAttribute('inert')).toBe(false);
    expect(fixture.host.hasAttribute('aria-hidden')).toBe(false);
    fixture.dispose();
  });

  it('shows the next-check countdown without making it a live region', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'));
    try {
      const fixture = mount(
        snapshot(),
        undefined,
        { nextCheckAt: Date.now() + 2_500 },
      );
      const countdown = fixture.host.querySelector<HTMLElement>('[data-ai-readiness-next-check]');
      expect(countdown?.textContent).toBe('Next check in 3s');
      expect(countdown?.hasAttribute('aria-live')).toBe(false);
      expect(countdown?.getAttribute('role')).toBeNull();
      fixture.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a unique diagnostics relationship for every mounted boundary', () => {
    const first = mount(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));
    const second = mount(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));
    const firstToggle = first.host.querySelector<HTMLButtonElement>('button[aria-controls^="ai-readiness-diagnostic-"]')!;
    const secondToggle = second.host.querySelector<HTMLButtonElement>('button[aria-controls^="ai-readiness-diagnostic-"]')!;

    expect(firstToggle.getAttribute('aria-controls')).not.toBe(secondToggle.getAttribute('aria-controls'));
    firstToggle.click();
    secondToggle.click();
    const firstTarget = firstToggle.getAttribute('aria-controls')!;
    const secondTarget = secondToggle.getAttribute('aria-controls')!;
    expect(first.host.querySelector(`[id="${firstTarget}"]`)).not.toBeNull();
    expect(second.host.querySelector(`[id="${secondTarget}"]`)).not.toBeNull();
    expect(document.querySelectorAll(`[id="${firstTarget}"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[id="${secondTarget}"]`)).toHaveLength(1);
    first.dispose();
    second.dispose();
  });

  it('does not flash a transient maintenance surface before 150ms', async () => {
    vi.useFakeTimers();
    try {
      const fixture = mount(snapshot('', {
        state: 'inspecting',
        retryable: false,
        safe_to_retry: false,
      }));
      expect(fixture.host.querySelector('.ai-readiness-surface')).toBeNull();

      await vi.advanceTimersByTimeAsync(149);
      expect(fixture.host.querySelector('.ai-readiness-surface')).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(fixture.host.querySelector('.ai-readiness-surface')).not.toBeNull();
      fixture.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes update and environment-access actions without exposing the Flower child', () => {
    const update = mount(snapshot('update_required', { retryable: false, safe_to_retry: false }));
    buttonWithText(update.host, 'Open runtime updates').click();
    expect(update.openUpdate).toHaveBeenCalledOnce();
    expect(update.host.querySelector('[data-ai-readiness-content]')?.hasAttribute('hidden')).toBe(true);
    update.dispose();

    const permission = mount(snapshot('environment_permission_error', { retryable: false, safe_to_retry: false }));
    buttonWithText(permission.host, 'Open environment access').click();
    expect(permission.openPermissions).toHaveBeenCalledOnce();
    expect(permission.host.querySelector('[data-ai-readiness-content]')?.hasAttribute('hidden')).toBe(true);
    permission.dispose();
  });

  it('exposes retry pending in the same event turn and preserves the child DOM identity when ready returns', async () => {
    const result = deferred<AIReadinessSnapshot>();
    const fixture = mount(snapshot(), result);
    const childBefore = fixture.host.querySelector('[data-testid="flower-child"]');
    const retryButton = buttonWithText(fixture.host, 'Check again');

    retryButton.click();
    expect(fixture.retry).toHaveBeenCalledOnce();
    expect(retryButton.disabled).toBe(true);
    expect(retryButton.dataset.pending).toBe('true');
    expect(retryButton.getAttribute('aria-busy')).toBe('true');
    expect(retryButton.textContent).toContain('Checking...');

    result.resolve(snapshot('', { state: 'ready', retryable: false, safe_to_retry: false }));
    await flushMicrotasks();
    const content = fixture.host.querySelector<HTMLElement>('[data-ai-readiness-content]');
    expect(content?.hasAttribute('hidden')).toBe(false);
    expect(fixture.host.querySelector('[data-testid="flower-child"]')).toBe(childBefore);
    expect(fixture.host.querySelector('.ai-readiness-surface')).toBeNull();
    fixture.dispose();
  });

  it('restores the same focused Flower node after a ready-blocked-ready transition', async () => {
    const fixture = mount(snapshot('', {
      state: 'ready',
      retryable: false,
      safe_to_retry: false,
    }));
    const child = fixture.host.querySelector<HTMLButtonElement>('[data-testid="flower-child"]')!;
    child.focus();
    expect(document.activeElement).toBe(child);

    fixture.setCurrent(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));
    await flushMicrotasks();
    expect(fixture.host.querySelector('[data-testid="flower-child"]')).toBe(child);
    expect(fixture.host.querySelector('[data-ai-readiness-content]')?.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(fixture.host.querySelector('h1'));

    fixture.setCurrent(snapshot('', {
      state: 'ready',
      retryable: false,
      safe_to_retry: false,
    }));
    await flushMicrotasks();
    expect(fixture.host.querySelector('[data-testid="flower-child"]')).toBe(child);
    expect(document.activeElement).toBe(child);
    fixture.dispose();
  });

  it('does not steal focus when the local Flower surface is not engaged', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const fixture = mount(
      snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }),
      undefined,
      { focusEnabled: false },
    );

    await flushMicrotasks();
    expect(document.activeElement).toBe(outside);
    fixture.dispose();
  });

  it('does not steal focus from a sibling tool even when the Flower placement is engaged', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'Terminal';
    document.body.appendChild(outside);
    outside.focus();
    const fixture = mount(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));

    await flushMicrotasks();
    expect(document.activeElement).toBe(outside);
    fixture.dispose();
  });

  it('does not restore Flower focus after the user moves to a sibling while retry is pending', async () => {
    const result = deferred<AIReadinessSnapshot>();
    const fixture = mount(snapshot(), result);
    const retry = buttonWithText(fixture.host, 'Check again');
    retry.focus();
    retry.click();

    const outside = document.createElement('button');
    outside.textContent = 'Files';
    document.body.appendChild(outside);
    outside.focus();
    result.resolve(snapshot('', { state: 'ready', retryable: false, safe_to_retry: false }));
    await flushMicrotasks();

    expect(document.activeElement).toBe(outside);
    fixture.dispose();
  });

  it('opens disclosure synchronously, copies only the displayed rows, and closes on Escape', async () => {
    const clipboard = deferred<void>();
    const writeText = vi.fn((_value: string) => clipboard.promise);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fixture = mount(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));
    const toggle = fixture.host.querySelector<HTMLButtonElement>('button[aria-controls^="ai-readiness-diagnostic-"]');
    expect(toggle).not.toBeNull();

    toggle!.click();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const rows = Array.from(fixture.host.querySelectorAll('.ai-readiness-diagnostics__row'))
      .map((row) => `${row.querySelector('dt')?.textContent}: ${row.querySelector('dd')?.textContent}`)
      .join('\n');
    const copy = buttonWithText(fixture.host, 'Copy diagnostics');
    copy.click();
    expect(copy.disabled).toBe(true);
    expect(copy.dataset.pending).toBe('true');
    expect(copy.getAttribute('aria-busy')).toBe('true');
    expect(writeText).toHaveBeenCalledWith(rows);
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('store_integrity_error');

    clipboard.resolve();
    await flushMicrotasks();
    expect(copy.disabled).toBe(false);
    expect(copy.textContent).toContain('Diagnostics copied');
    expect(fixture.host.querySelector('[role="status"]')?.textContent).toContain('Diagnostics copied');

    toggle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.host.querySelector('.ai-readiness-diagnostics__content')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    fixture.dispose();
  });

  it('clears copy pending and presents a recoverable state when clipboard access fails', async () => {
    const writeText = vi.fn(async (_value: string) => {
      throw new Error('clipboard denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fixture = mount(snapshot('store_integrity_error', { retryable: false, safe_to_retry: false }));
    const toggle = fixture.host.querySelector<HTMLButtonElement>('button[aria-controls^="ai-readiness-diagnostic-"]')!;
    toggle.click();
    const copy = buttonWithText(fixture.host, 'Copy diagnostics');

    copy.click();
    expect(copy.dataset.pending).toBe('true');
    await flushMicrotasks();

    expect(copy.disabled).toBe(false);
    expect(copy.dataset.pending).toBeUndefined();
    expect(copy.textContent).toContain('Copy unavailable');
    expect(fixture.host.querySelector('[role="status"]')?.textContent).toContain('Copy unavailable');
    fixture.dispose();
  });

  it('keeps maintenance local, non-modal, and explicit about interactive cursors', () => {
    const fixture = mount(snapshot());
    const boundary = fixture.host.querySelector<HTMLElement>('.ai-readiness-boundary');
    const surface = fixture.host.querySelector<HTMLElement>('.ai-readiness-surface');
    const content = fixture.host.querySelector<HTMLElement>('[data-ai-readiness-content]');
    const retry = buttonWithText(fixture.host, 'Check again');
    const diagnostics = fixture.host.querySelector<HTMLButtonElement>('button[aria-controls^="ai-readiness-diagnostic-"]');

    expect(boundary?.hasAttribute('inert')).toBe(false);
    expect(surface?.hasAttribute('inert')).toBe(false);
    expect(content?.hasAttribute('inert')).toBe(false);
    expect(surface?.getAttribute('role')).toBeNull();
    expect(surface?.getAttribute('aria-modal')).toBeNull();
    expect(`${boundary?.className} ${surface?.className}`).not.toContain('fixed');
    expect(retry.className).toContain('cursor-pointer');
    expect(retry.className).toContain('disabled:cursor-not-allowed');
    expect(diagnostics?.className).toContain('cursor-pointer');
    fixture.dispose();
  });
});
