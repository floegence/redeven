// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WindowModal } from './WindowModal';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

afterEach(() => {
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
});
