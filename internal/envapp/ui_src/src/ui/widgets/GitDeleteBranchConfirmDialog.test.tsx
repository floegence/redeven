// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { GitDeleteBranchConfirmDialog } from './GitDeleteBranchConfirmDialog';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

async function flushPositioning() {
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
}

describe('GitDeleteBranchConfirmDialog', () => {
  let anchorRect = makeRect(420, 420, 120, 28);
  let tooltipRect = makeRect(0, 0, 160, 40);

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.stubGlobal('queueMicrotask', (callback: VoidFunction) => callback());
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
      const element = this as HTMLElement;
      if (element.hasAttribute('data-redeven-tooltip-anchor')) return anchorRect;
      if (element.getAttribute('role') === 'tooltip') return tooltipRect;
      return makeRect(0, 0, 320, 200);
    });
    vi.stubGlobal('requestAnimationFrame', (((callback: FrameRequestCallback) => window.setTimeout(() => callback(16), 0)) as unknown as typeof requestAnimationFrame));
    vi.stubGlobal('cancelAnimationFrame', (((handle: number) => window.clearTimeout(handle)) as unknown as typeof cancelAnimationFrame));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders the force-delete confirmation tooltip outside the dialog container', async () => {
    const blockedReason = 'Branch is not fully merged into HEAD.';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <GitDeleteBranchConfirmDialog
          open
          branch={{
            name: 'backup/main-before-protocol-hardening-cleanup-20260308',
            fullName: 'refs/heads/backup/main-before-protocol-hardening-cleanup-20260308',
            kind: 'local',
          }}
          preview={{
            repoRootPath: '/workspace/repo',
            name: 'backup/main-before-protocol-hardening-cleanup-20260308',
            fullName: 'refs/heads/backup/main-before-protocol-hardening-cleanup-20260308',
            kind: 'local',
            requiresWorktreeRemoval: false,
            requiresDiscardConfirmation: false,
            safeDeleteAllowed: false,
            safeDeleteReason: blockedReason,
            forceDeleteAllowed: true,
            forceDeleteRequiresConfirm: true,
            planFingerprint: 'plan-1',
          }}
          onClose={() => {}}
        />
      </LayoutProvider>
    ), host);

    try {
      await flushPositioning();

      const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(dialog).toBeTruthy();
      expect(dialog?.textContent).toContain('Force delete consequences');

      const confirmButton = Array.from(document.body.querySelectorAll('button')).find(
        (node) => node.textContent?.trim() === 'Force Delete Branch',
      ) as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);

      const confirmationInput = document.body.querySelector('input[type="text"]') as HTMLInputElement | null;
      expect(confirmationInput?.placeholder).toBe('backup/main-before-protocol-hardening-cleanup-20260308');

      const anchor = confirmButton?.closest('[data-redeven-tooltip-anchor]') as HTMLElement | null;
      expect(anchor).toBeTruthy();

      anchor!.dispatchEvent(new MouseEvent('mouseenter'));
      await flushPositioning();

      const tooltip = document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
      expect(tooltip?.textContent).toContain('Type backup/main-before-protocol-hardening-cleanup-20260308 to enable force delete.');
      expect(dialog?.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      dispose();
    }
  });
});
