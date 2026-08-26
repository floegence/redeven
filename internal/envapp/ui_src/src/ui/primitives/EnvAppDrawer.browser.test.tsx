import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { EnvAppDrawer } from './EnvAppDrawer';

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('EnvAppDrawer browser geometry', () => {
  let dispose: (() => void) | undefined;

  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    document.documentElement.style.removeProperty('--redeven-desktop-titlebar-height');
    await page.viewport(1280, 720);
  });

  it('slides from the right while preserving close and focus interactions', async () => {
    await page.viewport(1280, 720);
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '32px');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const [open, setOpen] = createSignal(true);
    dispose = render(() => (
      <EnvAppDrawer
        open={open()}
        onOpenChange={setOpen}
        title="Service templates"
        description="Deploy a service in the current Environment."
      >
        <div class="p-1">
          <label class="block">
            <span>Template name</span>
            <input aria-label="Template name" class="mt-1 w-full rounded border border-input px-2 py-1" />
          </label>
        </div>
      </EnvAppDrawer>
    ), host);
    await settle();

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]');
    const boundary = panel?.querySelector<HTMLElement>('[data-redeven-desktop-titlebar-no-drag="true"]');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Template name"]');
    expect(panel).toBeTruthy();
    expect(boundary).toBeTruthy();
    expect(input).toBeTruthy();

    const panelRect = panel!.getBoundingClientRect();
    const boundaryRect = boundary!.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel!);
    expect(panelStyle.position).toBe('fixed');
    expect(panelStyle.getPropertyValue('--floe-floating-enter-y').trim()).toBe('0');
    expect(panelStyle.getPropertyValue('--floe-floating-enter-scale').trim()).toBe('1');
    expect(panelStyle.getPropertyValue('--floe-floating-origin').trim()).toBe('right center');
    expect(panelRect.top).toBeCloseTo(32, 0);
    expect(panelRect.right).toBeCloseTo(window.innerWidth, 0);
    expect(panelRect.bottom).toBeCloseTo(window.innerHeight, 0);
    expect(Math.abs(boundaryRect.left - panelRect.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(boundaryRect.top - panelRect.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(boundaryRect.right - panelRect.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(boundaryRect.bottom - panelRect.bottom)).toBeLessThanOrEqual(1);

    await userEvent.click(input!);
    expect(document.activeElement).toBe(input);
    expect(input!.getBoundingClientRect().left - panelRect.left).toBeGreaterThanOrEqual(16);

    await userEvent.click(page.getByRole('button', { name: 'Close' }));
    expect(open()).toBe(false);
  });
});
