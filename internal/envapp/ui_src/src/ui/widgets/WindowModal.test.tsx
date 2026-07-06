// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WindowModal } from './WindowModal';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('WindowModal', () => {
  it('renders inside the provided floating host instead of the global page root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <WindowModal
        open
        host={host}
        title="Delete Stash"
        description="Scoped to the current floating window."
        onOpenChange={() => undefined}
      />
    ), document.createElement('div'));

    await Promise.resolve();

    const dialog = host.querySelector('[role="dialog"]') as HTMLDivElement | null;
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('Delete Stash');
    expect(document.body.querySelector('[role="dialog"]')).toBe(dialog);
  });

  it('closes through the scoped backdrop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpenChange = vi.fn();

    render(() => (
      <WindowModal
        open
        host={host}
        title="Discard changes"
        onOpenChange={onOpenChange}
      />
    ), document.createElement('div'));

    await Promise.resolve();

    const backdrop = host.querySelector('[data-testid="window-modal-backdrop"]') as HTMLDivElement | null;
    expect(backdrop).toBeTruthy();
    backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('only closes on Escape when focus is inside the current floating host', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    const onOpenChange = vi.fn();

    render(() => (
      <WindowModal
        open
        host={host}
        title="Discard changes"
        onOpenChange={onOpenChange}
        footer={<button type="button" data-testid="inside-action">Confirm</button>}
      />
    ), document.createElement('div'));

    await Promise.resolve();

    outsideButton.focus();
    outsideButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onOpenChange).not.toHaveBeenCalled();

    const insideAction = host.querySelector('[data-testid="inside-action"]') as HTMLButtonElement | null;
    expect(insideAction).toBeTruthy();
    insideAction?.focus();
    insideAction?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the modal mounted in an exiting state before unmounting', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      const handle = window.setTimeout(() => callback(16), 0);
      return handle;
    }) as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', ((handle: number) => {
      window.clearTimeout(handle);
    }) as typeof cancelAnimationFrame);

    const host = document.createElement('div');
    document.body.appendChild(host);
    let setOpen: ((open: boolean) => void) | undefined;

    function Harness() {
      const [open, setHarnessOpen] = createSignal(true);
      setOpen = setHarnessOpen;
      return (
        <WindowModal
          open={open()}
          host={host}
          title="Delete Stash"
          description="Scoped to the current floating window."
          onOpenChange={setHarnessOpen}
        >
          <button type="button">Confirm</button>
        </WindowModal>
      );
    }

    render(() => <Harness />, document.createElement('div'));
    await Promise.resolve();
    vi.runOnlyPendingTimers();
    await Promise.resolve();

    const overlay = host.querySelector('[data-testid="window-modal-overlay"]') as HTMLDivElement | null;
    const dialog = host.querySelector('[role="dialog"]') as HTMLDivElement | null;
    expect(overlay).toBeTruthy();
    expect(dialog).toBeTruthy();

    setOpen?.(false);
    await Promise.resolve();

    const exitingOverlay = host.querySelector('[data-testid="window-modal-overlay"]') as HTMLDivElement | null;
    const exitingDialog = host.querySelector('[role="dialog"]') as HTMLDivElement | null;
    expect(exitingOverlay).toBe(overlay);
    expect(exitingDialog).toBe(dialog);
    expect(exitingOverlay?.getAttribute('data-floating-presence')).toBe('exiting');
    expect(exitingOverlay?.getAttribute('aria-hidden')).toBe('true');
    expect(exitingOverlay?.classList.contains('pointer-events-none')).toBe(true);
    expect(exitingDialog?.getAttribute('data-floating-presence')).toBe('exiting');
    expect(exitingDialog?.getAttribute('aria-hidden')).toBe('true');

    vi.advanceTimersByTime(119);
    await Promise.resolve();
    expect(host.querySelector('[data-testid="window-modal-overlay"]')).toBeTruthy();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(host.querySelector('[data-testid="window-modal-overlay"]')).toBeNull();
  });
});
