import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { KeepAliveStack, Shell } from '@floegence/floe-webapp-core/layout';
import { Button, Dialog, DialogPlacementProvider, type DialogProps } from '@floegence/floe-webapp-core/ui';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); document.body.style.zoom = ''; document.documentElement.style.removeProperty('--redeven-desktop-titlebar-height'); });

function mount(surface: 'desktop' | 'env', presentation: DialogProps['presentation'], local = false, hideHeader = false, retainHiddenShell = false) {
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS;
  document.head.append(style);
  if (surface === 'desktop') document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
  host = document.createElement('div');
  host.style.cssText = 'height:100dvh;width:100%';
  document.body.append(host);
  const [open, setOpen] = createSignal(false);
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false } }}>
    {retainHiddenShell && <KeepAliveStack activeId="current" lazyMount={false} views={[
      { id: 'hidden', render: () => <Shell fillParent><p>Retained shell</p></Shell> },
      { id: 'current', render: () => null },
    ]} />}
    <Shell fillParent topBarMobileMode={hideHeader ? 'hidden' : 'visible'}>
      <DialogPlacementProvider mode={local ? 'auto' : 'global'}>
        <div data-floe-dialog-surface-host={local ? 'true' : undefined} style={{ position: 'relative', height: '100%' }}>
          <Button onClick={() => setOpen(true)}>Open settings</Button>
          <Dialog open={open()} onOpenChange={setOpen} title="Settings" presentation={presentation}
            class={presentation === 'side-drawer' ? 'env-app-drawer-panel' : undefined}
            footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
            <For each={Array.from({ length: 50 }, (_, i) => i)}>{i => <p style={{ padding: '16px' }}>Setting {i + 1}</p>}</For>
          </Dialog>
        </div>
      </DialogPlacementProvider>
    </Shell>
  </FloeProvider>, host);
}

for (const surface of ['desktop', 'env'] as const) for (const presentation of ['dialog', 'bottom-drawer', 'side-drawer'] as const) {
  it(`reserves the shell header for ${surface} ${presentation} and keeps actions reachable after resize`, async () => {
    await page.viewport(1100, 500);
    mount(surface, presentation);
    const trigger = page.getByRole('button', { name: 'Open settings', exact: true });
    await userEvent.click(trigger);
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect.element(dialog).toBeVisible();
    await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe('1');
    for (const [width, height] of [[1100, 500], [390, 420], [1100, 300]]) {
      await page.viewport(width, height);
      const header = host.querySelector<HTMLElement>('[data-floe-shell-slot=top-bar]')!;
      const overlay = dialog.element().closest<HTMLElement>('[data-floe-dialog-overlay-root]')!;
      const gap = presentation === 'side-drawer' ? 0 : presentation === 'bottom-drawer' ? (width < 640 ? 12 : 20) : 16;
      await expect.poll(() => dialog.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom + gap - 1);
      await expect.poll(() => overlay.getBoundingClientRect().height).toBe(height);
      const bounds = dialog.element().getBoundingClientRect();
      expect(bounds.bottom).toBeLessThanOrEqual(height - gap + 1);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      const body = dialog.element().querySelector<HTMLElement>('[data-floe-dialog-body]')!;
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
      body.scrollTop = body.scrollHeight;
      expect(body.scrollTop).toBeGreaterThan(0);
      const action = dialog.getByRole('button', { name: 'Done', exact: true }).element();
      const rect = action.getBoundingClientRect();
      expect(action.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))).toBe(true);
    }
    await userEvent.click(dialog.getByRole('button', { name: 'Done', exact: true }));
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });
}

it('keeps surface-local drawers inside their host without applying the header offset twice', async () => {
  await page.viewport(1100, 500);
  mount('desktop', 'side-drawer', true);
  await userEvent.click(page.getByRole('button', { name: 'Open settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe('1');
  const overlay = dialog.element().closest<HTMLElement>('[data-floe-dialog-overlay-root]')!;
  expect(overlay.dataset.floeDialogMode).toBe('surface');
  expect(dialog.element().getBoundingClientRect().top).toBeCloseTo(overlay.getBoundingClientRect().top, 0);
  expect(dialog.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(overlay.getBoundingClientRect().bottom);
});

it.each([false, true])('does not reserve a nonexistent header in the mobile Env shell (retained=%s)', async retained => {
  await page.viewport(390, 420);
  mount('env', 'dialog', false, true, retained);
  await userEvent.click(page.getByRole('button', { name: 'Open settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe('1');
  expect(host.querySelector('[data-floe-shell-slot=top-bar]:not([data-floe-keep-alive-view][aria-hidden=true] *)')).toBeNull();
  if (retained) expect(host.querySelector('[data-floe-keep-alive-view][aria-hidden=true] [data-floe-shell-slot=top-bar]')).not.toBeNull();
  expect(dialog.element().getBoundingClientRect().top).toBeCloseTo(16, 0);
});

it('honors native titlebar height and viewport safe insets', async () => {
  await page.viewport(1100, 500);
  mount('desktop', 'dialog');
  document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '64px');
  await userEvent.click(page.getByRole('button', { name: 'Open settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe('1');
  expect(dialog.element().getBoundingClientRect().top).toBeCloseTo(80, 0);
  const overlay = dialog.element().closest<HTMLElement>('[data-floe-dialog-overlay-root]')!;
  // Exercise the published viewport safe-area variables, including a top notch.
  overlay.style.setProperty('--floe-dialog-safe-top', '44px');
  overlay.style.setProperty('--floe-dialog-safe-bottom', '34px');
  expect(dialog.element().getBoundingClientRect().top).toBeCloseTo(101, 0);
  expect(dialog.element().getBoundingClientRect().bottom).toBeCloseTo(466, 0);
});

it('keeps the header and footer clear at 200 percent page zoom', async () => {
  await page.viewport(1100, 700);
  document.body.style.zoom = '2';
  mount('env', 'dialog');
  await userEvent.click(page.getByRole('button', { name: 'Open settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => getComputedStyle(dialog.element()).opacity).toBe('1');
  expect(dialog.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(host.querySelector('[data-floe-shell-slot=top-bar]')!.getBoundingClientRect().bottom);
  expect(dialog.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(700);
  const action = dialog.getByRole('button', { name: 'Done', exact: true }).element();
  const bounds = action.getBoundingClientRect();
  expect(action.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))).toBe(true);
});
