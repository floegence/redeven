import '../../index.css';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import type { ContextMenuItem } from '@floegence/floe-webapp-core/file-browser';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

const cleanups: (() => void)[] = [];
async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
}
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); });

function mountFiles(options: { mobile?: boolean; cutout?: number; projected?: boolean; short?: boolean; longLabels?: boolean } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const [selected, setSelected] = createSignal('');
  const [navigation, setNavigation] = createSignal('');
  const [sidebarOpen, setSidebarOpen] = createSignal(Boolean(options.mobile));
  const items: ContextMenuItem[] = [
    { id: 'new', label: 'New', type: 'custom', children: [{ id: 'new-file', label: 'New file', type: 'custom', onAction: () => setSelected('new-file') }] },
    ...Array.from({ length: options.short ? 16 : 5 }, (_, i) => ({ id: `copy-${i}`, label: options.longLabels ? `Ausgewählten Dateipfad in die Zwischenablage kopieren ${i}` : `Copy ${i}`, type: 'custom' as const, onAction: () => setSelected(`copy-${i}`) })),
    { id: 'delete', label: 'Delete', type: 'delete' },
  ];
  cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
    <div data-test-portal data-floe-surface-portal-layer={options.projected ? 'true' : undefined} style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div data-test-files data-floe-dialog-surface-host={options.projected ? 'true' : undefined} style={{ position: 'absolute', inset: '36px 0 64px', height: options.short ? '240px' : undefined, transform: options.projected ? 'translate(24px, 16px) scale(0.7)' : undefined }}>
        <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[{ id: 'src', name: 'src', path: '/src', type: 'folder' }, { id: 'alpha', name: 'alpha.txt', path: '/alpha.txt', type: 'file' }]} currentPath="/" initialPath="/" instanceId="bounded-files" resetKey={0} width={200} open={sidebarOpen()} onClose={() => setSidebarOpen(false)} onNavigate={setNavigation} contextMenuBottomLimit={options.cutout} overrideContextMenuItems={items} contextMenuCallbacks={{ onDelete: () => setSelected('delete') }} />
      </div>
    </div>
    <div data-test-flower style={{ position: 'fixed', top: options.cutout === undefined ? 'calc(100vh - 64px)' : `${options.cutout}px`, bottom: '0', width: '100%', 'z-index': 2000, background: 'var(--background)' }}>Flower</div>
    <output data-test-selection>{selected()}</output>
    <output data-test-navigation>{navigation()}</output>
    <output data-test-sidebar>{String(sidebarOpen())}</output>
  </LayoutProvider></FloeConfigProvider>, host));
  return host;
}
async function openAtBottom(host: HTMLElement, tree = false) {
  const root = host.querySelector('[data-test-files]') as HTMLElement;
  const rect = root.getBoundingClientRect();
  const trigger = host.querySelector(tree ? '[data-tree-row-path="/src"]' : 'button[title="alpha.txt"]') as HTMLElement;
  expect(trigger).toBeTruthy();
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, pointerType: 'mouse', clientX: rect.right - 14, clientY: rect.bottom - 12 }));
  trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.right - 14, clientY: rect.bottom - 12 }));
  await settle();
  const menu = document.querySelector('[role="menu"]') as HTMLElement;
  expect(menu).toBeTruthy();
  return { menu, root, trigger };
}
function expectContained(menu: HTMLElement, root: HTMLElement, bottom = root.getBoundingClientRect().bottom) {
  const box = menu.getBoundingClientRect(); const boundary = root.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(boundary.left + 7);
  expect(box.top).toBeGreaterThanOrEqual(boundary.top + 7);
  expect(box.right).toBeLessThanOrEqual(boundary.right - 7);
  expect(box.bottom).toBeLessThanOrEqual(Math.min(boundary.bottom, bottom) - 7);
}

describe('Files menu collision and input', () => {
  it.each(['List', 'Grid'])('contains menus at every corner in %s view and on the directory background', async (view) => {
    await page.viewport(1000, 700);
    const host = mountFiles(); await settle();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === view)!.click();
    await settle();
    const root = host.querySelector<HTMLElement>('[data-browser-workspace]')!;
    const rect = root.getBoundingClientRect();
    const file = host.querySelector<HTMLElement>('[data-file-browser-item-path="/alpha.txt"]')!;
    const background = host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
    for (const target of [file, background]) {
      for (const x of [rect.left + 9, rect.right - 9]) {
        for (const y of [rect.top + 9, rect.bottom - 9]) {
          const point = { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y };
          target.dispatchEvent(new PointerEvent('pointerdown', { ...point, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('contextmenu', point));
          await settle();
          const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
          expectContained(menu, root);
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await settle();
        }
      }
    }
  });

  it('keeps bottom actions inside Files and above the Flower bar', async () => {
    await page.viewport(1000, 700);
    const host = mountFiles(); await settle();
    const { menu, root } = await openAtBottom(host);
    expectContained(menu, root);
    menu.querySelector<HTMLElement>('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const last = menu.querySelector<HTMLElement>('[data-file-menu-item="delete"]')!;
    await settle();
    const box = last.getBoundingClientRect();
    expect(last.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
    await userEvent.click(last); await settle();
    expect(host.querySelector('[data-test-selection]')?.textContent).toBe('delete');
  });

  it.each([320, 375, 390])('avoids the mobile Flower rail and sidebar scrim at %ipx', async (width) => {
    await page.viewport(width, 680);
    const host = mountFiles({ mobile: true, cutout: 560 }); await settle();
    const { menu, root, trigger } = await openAtBottom(host, true);
    expectContained(menu, root, 560);
    const first = menu.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(first.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const box = first.getBoundingClientRect();
    expect(first.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
    first.click(); await settle();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    const back = document.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(back.textContent).toContain('Back');
    back.click(); await settle();
    expect(host.querySelector('[data-test-sidebar]')?.textContent).toBe('true');
    document.querySelector<HTMLElement>('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(); expect(document.activeElement).toBe(trigger);
  });

  it('scrolls a short menu without closing it or scrolling the file viewport', async () => {
    await page.viewport(390, 500);
    const host = mountFiles({ short: true }); await settle();
    const { menu, root } = await openAtBottom(host);
    expectContained(menu, root);
    for (const [attribute, value] of Object.entries(REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS)) expect(menu.getAttribute(attribute)).toBe(value);
    menu.scrollTop = menu.scrollHeight; await settle();
    expect(menu.isConnected).toBe(true); expect(menu.scrollTop).toBeGreaterThan(0);
    expect((host.querySelector('[data-testid="file-browser-content-scroll-region"]') as HTMLElement).scrollTop).toBe(0);
  });

  it('uses the projected host layer while clamping to the Files body', async () => {
    await page.viewport(1000, 700);
    const host = mountFiles({ projected: true }); await settle();
    const { menu, root } = await openAtBottom(host);
    expectContained(menu, root);
    expect(menu.closest('[data-floe-surface-portal-layer]')).toBe(host.querySelector('[data-test-portal]'));
    expect(menu.classList.contains('fixed')).toBe(false);
    expect(menu.getAttribute('data-floe-local-interaction-surface')).toBe('true');
  });

  it('wraps long translations at enlarged text size in mobile landscape', async () => {
    await page.viewport(667, 320);
    const host = mountFiles({ longLabels: true }); await settle();
    const style = document.createElement('style');
    style.textContent = '[role="menuitem"] { font-size: 22px !important; }';
    document.head.append(style); cleanups.push(() => style.remove());
    const { menu, root } = await openAtBottom(host);
    expectContained(menu, root);
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1);
    menu.querySelector<HTMLElement>('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    const last = menu.querySelector<HTMLElement>('[data-file-menu-item="delete"]')!;
    expect(document.activeElement).toBe(last);
    await userEvent.click(last);
    await settle();
    expect(host.querySelector('[data-test-selection]')?.textContent).toBe('delete');
  });

  it('opens a directory by long press without navigating or executing on release', async () => {
    await page.viewport(375, 667);
    const host = mountFiles({ mobile: true, cutout: 550 }); await settle();
    const trigger = host.querySelector<HTMLElement>('[data-tree-row-path="/src"]')!;
    const box = trigger.getBoundingClientRect();
    const point = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: box.left + 30, clientY: box.top + 10 };
    trigger.dispatchEvent(new PointerEvent('pointerdown', point));
    await new Promise((resolve) => setTimeout(resolve, 650));
    trigger.dispatchEvent(new PointerEvent('pointerup', point));
    trigger.click(); await settle();
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    expect(host.querySelector('[data-test-navigation]')?.textContent).toBe('');
    expect(host.querySelector('[data-test-selection]')?.textContent).toBe('');
    expect(host.querySelector('[data-test-sidebar]')?.textContent).toBe('true');
  });

  it.each(['move', 'cancel', 'multitouch'])('cancels the directory long press on %s', async (gesture) => {
    await page.viewport(320, 640);
    const host = mountFiles({ mobile: true }); await settle();
    const trigger = host.querySelector<HTMLElement>('[data-tree-row-path="/src"]')!;
    const point = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 50, clientY: 130 };
    trigger.dispatchEvent(new PointerEvent('pointerdown', point));
    if (gesture === 'move') trigger.dispatchEvent(new PointerEvent('pointermove', { ...point, clientY: 180 }));
    if (gesture === 'cancel') trigger.dispatchEvent(new PointerEvent('pointercancel', point));
    if (gesture === 'multitouch') document.body.dispatchEvent(new PointerEvent('pointerdown', { ...point, pointerId: 2, isPrimary: false }));
    await new Promise((resolve) => setTimeout(resolve, 550));
    trigger.dispatchEvent(new PointerEvent('pointerup', point));
    trigger.click(); await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector('[data-test-navigation]')?.textContent).toBe('');
  });

  it('closes on size changes and reopens against current client geometry', async () => {
    await page.viewport(375, 667);
    const host = mountFiles({ cutout: 550 }); await settle();
    const { root } = await openAtBottom(host);
    root.style.height = '300px'; await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    root.style.transform = 'translateY(60px)'; await settle();
    const { menu } = await openAtBottom(host);
    expectContained(menu, root, 550);
  });

  it('keeps Files menus in the shared floating window layer and inside its body', async () => {
    await page.viewport(1000, 700);
    const host = document.createElement('div'); document.body.append(host);
    cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
      <PersistentFloatingWindow open onOpenChange={() => {}} title="Files" persistenceKey="files-menu-test" defaultSize={{ width: 760, height: 580 }} minSize={{ width: 420, height: 320 }}>
        <div data-test-files class="h-full min-h-0">
          <FileBrowserWorkspace mode="files" onModeChange={() => {}} currentPath="/" initialPath="/" instanceId="floating-files-menu" resetKey={0} open={false} files={[{ id: 'alpha', name: 'alpha.txt', path: '/alpha.txt', type: 'file' }]} contextMenuCallbacks={{ onDelete: () => {} }} />
        </div>
      </PersistentFloatingWindow>
    </LayoutProvider></FloeConfigProvider>, host));
    await settle();
    // Open only after the shared floating window has finished its entrance motion.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { menu, root } = await openAtBottom(document.body);
    expectContained(menu, root);
    expect(menu.closest('[data-floe-geometry-surface="floating-window"]')).toBeTruthy();
    expect(menu.classList.contains('fixed')).toBe(false);
    expect(menu.getAttribute('data-floe-local-interaction-surface')).toBe('true');
  });
});
