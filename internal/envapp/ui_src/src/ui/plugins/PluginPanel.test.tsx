// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginPanel } from './PluginPanel';
import { buildPluginPanelModel } from './pluginInventoryProjection';
import type { PluginInventoryItem, PluginPanelModel } from './pluginTypes';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function pluginItem(overrides: Partial<PluginInventoryItem> = {}): PluginInventoryItem {
  return {
    inventoryKey: 'instance:plugininst_containers',
    pluginID: 'com.redeven.official.containers',
    pluginInstanceID: 'plugininst_containers',
    displayName: 'Containers',
    description: 'Manage Docker and Podman resources.',
    iconFallback: 'containers',
    category: 'infrastructure',
    searchKeywords: ['docker', 'podman'],
    searchAliasesKey: 'uiCopy.plugin.containersSearchAliases',
    publisher: 'Redeven',
    version: '2.0.0',
    managementRevision: 23,
    lifecycleState: 'enabled',
    trustBadge: 'official',
    pinned: false,
    defaultLaunchTarget: {
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 23,
      preferredPlacement: 'activity',
    },
    ...overrides,
  };
}

function panelModel(item: PluginInventoryItem = pluginItem()): PluginPanelModel {
  return {
    loading: false,
    tiles: [
      { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
      { kind: 'plugin', item, action: item.lifecycleState === 'enabled' ? 'open_surface' : 'open_details' },
    ],
  };
}

function panelModelWithPluginCount(count: number): PluginPanelModel {
  return {
    loading: false,
    tiles: [
      { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
      ...Array.from({ length: count }, (_, index) => {
        const item = pluginItem({
          inventoryKey: `instance:plugininst_${index}`,
          pluginID: `com.example.plugin-${index}`,
          pluginInstanceID: `plugininst_${index}`,
          displayName: `Plugin ${index}`,
          category: index === 0 ? 'infrastructure' : 'development',
          defaultLaunchTarget: {
            pluginID: `com.example.plugin-${index}`,
            pluginInstanceID: `plugininst_${index}`,
            surfaceID: `plugin-${index}.main`,
            expectedManagementRevision: 23,
            preferredPlacement: 'activity' as const,
          },
        });
        return { kind: 'plugin' as const, item, action: 'open_surface' as const };
      }),
    ],
  };
}

function createTrigger(): HTMLButtonElement {
  const trigger = document.createElement('button');
  trigger.textContent = 'Plugins';
  trigger.getBoundingClientRect = vi.fn(() => ({
    x: 8,
    y: 96,
    left: 8,
    top: 96,
    right: 48,
    bottom: 136,
    width: 40,
    height: 40,
    toJSON: () => ({}),
  }));
  document.body.append(trigger);
  return trigger;
}

function mountPanel(props: Partial<Parameters<typeof PluginPanel>[0]> = {}) {
  const mount = document.createElement('div');
  document.body.append(mount);
  dispose = render(() => (
    <PluginPanel
      open
      model={panelModel()}
      onClose={vi.fn()}
      onOpenCenter={vi.fn()}
      onOpenPluginDetails={vi.fn()}
      onOpenPluginSurface={vi.fn()}
      {...props}
    />
  ), mount);
}

function findDocumentButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

describe('PluginPanel', () => {
  it('renders installed plugins in an application grid with Plugin Center in a separate footer', () => {
    const onOpenCenter = vi.fn();
    mountPanel({ onOpenCenter });

    const dialog = document.querySelector('[role="dialog"]')!;
    const plugin = dialog.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')!;
    const center = dialog.querySelector('[data-plugin-panel-tile="plugin-center"]')!;
    expect(plugin.textContent).toContain('Containers');
    const grid = dialog.querySelector('[data-plugin-launcher-grid]')!;
    expect(grid.tagName).toBe('UL');
    expect(plugin.tagName).toBe('BUTTON');
    expect(plugin.getAttribute('role')).toBeNull();
    expect(plugin.parentElement?.tagName).toBe('LI');
    expect(plugin.querySelector('[data-plugin-update-badge]')).toBeNull();
    expect(dialog.getAttribute('aria-describedby')).toBe('plugin-launcher-description');
    expect(center.textContent).toContain('Plugin Center');
    expect(plugin.compareDocumentPosition(center) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    (center as HTMLButtonElement).click();
    expect(onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('keeps catalog-only plugins in Plugin Center and shows the installed-plugin empty state', () => {
    const catalogItem = pluginItem({
      inventoryKey: 'catalog:containers',
      pluginInstanceID: undefined,
      lifecycleState: 'not_installed',
      managementRevision: undefined,
      defaultLaunchTarget: undefined,
    });
    mountPanel({ model: buildPluginPanelModel({ items: [catalogItem] }) });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[data-plugin-panel-tile="catalog:containers"]')).toBeNull();
    expect(dialog.textContent).toContain('No installed plugins yet.');
    expect(dialog.querySelector('[data-plugin-panel-tile="plugin-center"]')).not.toBeNull();
  });

  it('opens the plugin default surface from the primary tile action', () => {
    const onOpenPluginDetails = vi.fn();
    const onOpenPluginSurface = vi.fn();
    mountPanel({ onOpenPluginDetails, onOpenPluginSurface });

    (document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement).click();
    expect(onOpenPluginSurface).toHaveBeenCalledWith(expect.objectContaining({
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      preferredPlacement: 'activity',
    }));
    expect(onOpenPluginDetails).not.toHaveBeenCalled();
  });

  it('shows only the New update badge and still opens the plugin surface', () => {
    const onOpenPluginDetails = vi.fn();
    const onOpenPluginSurface = vi.fn();
    const update = pluginItem({
      lifecycleState: 'update_available',
      attentionReason: 'update_required',
    });
    mountPanel({
      model: buildPluginPanelModel({ items: [update] }, undefined, { canOpenSurfaces: true }),
      onOpenPluginDetails,
      onOpenPluginSurface,
    });

    const tile = document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement;
    const badge = tile.querySelector('[data-plugin-update-badge]');
    expect(badge?.textContent).toBe('New');
    tile.click();
    expect(onOpenPluginSurface).toHaveBeenCalledWith(update.defaultLaunchTarget);
    expect(onOpenPluginDetails).not.toHaveBeenCalled();
  });

  it('offers real Activity, Workbench, and detail secondary actions', async () => {
    const onOpenPluginSurface = vi.fn();
    const onOpenPluginDetails = vi.fn();
    mountPanel({ onOpenPluginSurface, onOpenPluginDetails });

    (document.querySelector('[data-plugin-panel-tile-menu="instance:plugininst_containers"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Open in Activity')).not.toBeNull();
    expect(findDocumentButton('Technical details')).not.toBeNull();
    findDocumentButton('Open in Workbench').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onOpenPluginSurface).toHaveBeenCalledWith(expect.objectContaining({
      pluginInstanceID: 'plugininst_containers',
      preferredPlacement: 'workbench',
    }));
    expect(onOpenPluginDetails).not.toHaveBeenCalled();
  });

  it('keeps the secondary action trigger positioned inside its plugin tile', () => {
    mountPanel();

    const trigger = document.querySelector('[data-plugin-panel-tile-menu="instance:plugininst_containers"]') as HTMLButtonElement;
    const tile = trigger.closest('li');
    const triggerHost = trigger.closest('[data-floe-dropdown-trigger]');
    const dropdown = trigger.closest('[data-floe-dropdown]');
    expect(tile).not.toBeNull();
    expect(dropdown?.parentElement).toBe(tile);
    expect(dropdown?.className).toContain('absolute');
    expect(dropdown?.className).toContain('right-1');
    expect(dropdown?.className).toContain('top-1');
    expect(triggerHost?.className).not.toContain('absolute');
  });

  it.each([
    ['right click', () => document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')
      ?.parentElement?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))],
    ['ContextMenu', () => document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }))],
    ['Shift+F10', () => document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))],
  ])('opens the secondary action menu with %s', async (_name, openMenu) => {
    const onOpenPluginSurface = vi.fn();
    mountPanel({ onOpenPluginSurface });

    openMenu();
    await Promise.resolve();
    findDocumentButton('Open in Activity').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onOpenPluginSurface).toHaveBeenCalledWith(expect.objectContaining({
      pluginInstanceID: 'plugininst_containers',
      preferredPlacement: 'activity',
    }));
  });

  it('shows lifecycle state and routes disabled plugins to details', () => {
    const onOpenPluginDetails = vi.fn();
    mountPanel({
      model: panelModel(pluginItem({ lifecycleState: 'disabled', attentionReason: 'disabled' })),
      onOpenPluginDetails,
    });

    const row = document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement;
    expect(row.parentElement?.textContent).toContain('Disabled');
    expect(row.getAttribute('aria-describedby')).toBeTruthy();
    row.click();
    expect(onOpenPluginDetails).toHaveBeenCalledWith('instance:plugininst_containers');
  });

  it('renders the desktop launcher as an isolated centered modal', async () => {
    const trigger = createTrigger();
    mountPanel({ id: 'plugin-switcher', trigger });

    const dialog = document.querySelector('#plugin-switcher')!;
    expect(dialog.className).toContain('bg-popover');
    expect(dialog.className).not.toContain('backdrop-blur');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement?.className).toContain('justify-center');
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector('[data-plugin-launcher-search]'));
  });

  it('traps focus and restores trigger focus after Escape', async () => {
    const trigger = createTrigger();
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    await Promise.resolve();
    const search = document.querySelector('[data-plugin-launcher-search]') as HTMLInputElement;
    expect(document.activeElement).toBe(search);

    const close = document.querySelector('[aria-label="Close plugins"]') as HTMLButtonElement;
    close.focus();
    const previous = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(previous);
    expect(previous.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-plugin-panel-tile="plugin-center"]'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('hides category filters below six installed plugins', () => {
    mountPanel({ model: panelModelWithPluginCount(5) });

    expect(document.querySelector('[data-plugin-launcher-category="all"]')).toBeNull();
  });

  it('filters installed plugins by normalized search and explicit category at the disclosure threshold', () => {
    const toolbox = pluginItem({
      inventoryKey: 'instance:plugininst_toolbox',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugininst_toolbox',
      displayName: 'Toolbox',
      description: 'Developer utilities.',
      iconFallback: 'generic',
      category: 'development',
      searchKeywords: ['terminal'],
      defaultLaunchTarget: {
        pluginID: 'com.example.toolbox',
        pluginInstanceID: 'plugininst_toolbox',
        surfaceID: 'toolbox.main',
        expectedManagementRevision: 23,
        preferredPlacement: 'activity',
      },
    });
    const model = panelModelWithPluginCount(6);
    model.tiles[1] = { kind: 'plugin', item: pluginItem(), action: 'open_surface' };
    model.tiles[2] = { kind: 'plugin', item: toolbox, action: 'open_surface' };
    mountPanel({ model });

    const search = document.querySelector('[data-plugin-launcher-search]') as HTMLInputElement;
    search.value = 'ＴＥＲＭＩＮＡＬ';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_toolbox"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')).toBeNull();

    search.value = '';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (document.querySelector('[data-plugin-launcher-category="infrastructure"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_toolbox"]')).toBeNull();

  });

  it('clears search on the first Escape and closes on the second Escape', async () => {
    const onClose = vi.fn();
    mountPanel({ onClose });
    await Promise.resolve();
    const search = document.querySelector('[data-plugin-launcher-search]') as HTMLInputElement;
    search.value = 'docker';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(search.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside click, restores focus, and lets the trigger own its toggle', () => {
    const trigger = createTrigger();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(open()).toBe(true);
    document.querySelector('[data-plugin-launcher-backdrop]')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('uses a modal mobile sheet with 44px controls and restores focus after backdrop dismiss', async () => {
    const trigger = createTrigger();
    const shell = document.createElement('main');
    const preExistingInert = document.createElement('aside');
    preExistingInert.inert = true;
    document.body.append(shell, preExistingInert);
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        mobile
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);
    await Promise.resolve();

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = document.querySelector('[aria-label="Close plugins"]') as HTMLButtonElement;
    expect(close.className).toContain('h-[44px]');
    expect(close.className).toContain('w-[44px]');
    expect(document.activeElement).toBe(document.querySelector('[data-plugin-launcher-search]'));
    expect(trigger.inert).toBe(true);
    expect(shell.inert).toBe(true);
    expect(preExistingInert.inert).toBe(true);

    close.focus();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    const center = document.querySelector('[data-plugin-panel-tile="plugin-center"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(center);
    center.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);

    const backdrop = dialog.parentElement!;
    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(Boolean(trigger.inert)).toBe(false);
    expect(Boolean(shell.inert)).toBe(false);
    expect(preExistingInert.inert).toBe(true);
  });

  it('does not steal focus back after opening Activity from the secondary menu', async () => {
    const trigger = createTrigger();
    const target = document.createElement('button');
    document.body.append(target);
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={() => target.focus()}
      />
    ), mount);

    (document.querySelector('[data-plugin-panel-tile-menu="instance:plugininst_containers"]') as HTMLButtonElement).click();
    await Promise.resolve();
    findDocumentButton('Open in Activity').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(target);
  });
});
