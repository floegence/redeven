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
    inventoryKey: 'instance:plugininst_metrics',
    pluginID: 'com.example.metrics',
    pluginInstanceID: 'plugininst_metrics',
    displayName: 'Metrics',
    description: 'Show neutral runtime metrics.',
    iconFallback: 'generic',
    category: 'infrastructure',
    searchKeywords: ['metrics', 'monitoring'],
    publisher: 'Redeven',
    version: '2.0.0',
    managementRevision: 23,
    lifecycleState: 'enabled',
    trustBadge: 'official',
    pinned: false,
    defaultLaunchTarget: {
      pluginID: 'com.example.metrics',
      pluginInstanceID: 'plugininst_metrics',
      surfaceID: 'metrics.dashboard',
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

function createWorkbenchTrigger(): { surface: HTMLDivElement; trigger: HTMLButtonElement } {
  const surface = document.createElement('div');
  surface.className = 'workbench-surface';
  surface.dataset.floeDialogSurfaceHost = 'true';
  surface.setAttribute('data-floe-surface-portal-layer', 'true');
  surface.style.position = 'relative';
  surface.getBoundingClientRect = vi.fn(() => ({
    x: 100, y: 50, left: 100, top: 50, right: 1100, bottom: 750,
    width: 1000, height: 700, toJSON: () => ({}),
  }));
  const trigger = document.createElement('button');
  trigger.textContent = 'Plugins';
  trigger.getBoundingClientRect = vi.fn(() => ({
    x: 560, y: 680, left: 560, top: 680, right: 600, bottom: 720,
    width: 40, height: 40, toJSON: () => ({}),
  }));
  surface.append(trigger);
  document.body.append(surface);
  return { surface, trigger };
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

describe('PluginPanel', () => {
  it('keeps the last-known-good tiles visible during a background refresh without a visible loading banner', async () => {
    const [loading, setLoading] = createSignal(false);
    const item = pluginItem();
    const model = () => ({ ...panelModel(item), loading: loading() });
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel open model={model()} onClose={vi.fn()} onOpenCenter={vi.fn()} onOpenPluginDetails={vi.fn()} onOpenPluginSurface={vi.fn()} />
    ), mount);

    const tileBefore = document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]');
    expect(tileBefore).not.toBeNull();
    setLoading(true);
    await Promise.resolve();

    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-launcher-grid]')?.textContent).toContain('Metrics');
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Loading plugins...');
  });

  it('keeps the initial pending layout stable without exposing loading or an empty state', () => {
    mountPanel({ model: { loading: true, tiles: [{ kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' }] } });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(dialog.textContent).not.toContain('Loading plugins...');
    expect(dialog.textContent).not.toContain('No installed plugins yet.');
  });

  it('stages the desktop modal from the Activity trigger before settling open', () => {
    const trigger = createTrigger();
    mountPanel({ trigger, placement: 'activity' });

    const backdrop = document.querySelector<HTMLElement>('[data-plugin-launcher-backdrop]')!;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(backdrop.dataset.pluginLauncherMotionState).toBe('entering');
    expect(dialog.dataset.pluginPanelMotionState).toBe('entering');
    expect(dialog.dataset.pluginPanelMotionKind).toBe('modal');
    expect(dialog.querySelector('[data-plugin-panel-content]')).not.toBeNull();
    expect(dialog.style.getPropertyValue('--redeven-plugin-panel-origin-x')).toBe('8%');
    expect(Number.parseFloat(dialog.style.getPropertyValue('--redeven-plugin-panel-enter-x'))).toBeLessThan(0);
    expect(Number.parseFloat(dialog.style.getPropertyValue('--redeven-plugin-panel-enter-y'))).toBeLessThan(0);
  });

  it('keeps the popup mounted while it closes downward', async () => {
    vi.useFakeTimers();
    const [open, setOpen] = createSignal(true);
    const { trigger } = createWorkbenchTrigger();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel open={open()} placement="workbench" trigger={trigger} model={panelModel()} onClose={() => setOpen(false)} onOpenCenter={vi.fn()} onOpenPluginDetails={vi.fn()} onOpenPluginSurface={vi.fn()} />
    ), mount);

    setOpen(false);
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-panel-motion-state="closing"]')).not.toBeNull();
    vi.advanceTimersByTime(160);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    vi.useRealTimers();
  });

  it('does not let an old close timer hide a rapidly reopened panel', async () => {
    vi.useFakeTimers();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel open={open()} model={panelModel()} onClose={() => setOpen(false)} onOpenCenter={vi.fn()} onOpenPluginDetails={vi.fn()} onOpenPluginSurface={vi.fn()} />
    ), mount);

    setOpen(false);
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-panel-motion-state="closing"]')).not.toBeNull();
    vi.advanceTimersByTime(75);
    setOpen(true);
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-panel-motion-state="open"]')).not.toBeNull();
    vi.advanceTimersByTime(100);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    vi.useRealTimers();
  });

  it('reopens through the stable Portal node after the close animation completes', async () => {
    vi.useFakeTimers();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel open={open()} model={panelModel()} onClose={() => setOpen(false)} onOpenCenter={vi.fn()} onOpenPluginDetails={vi.fn()} onOpenPluginSurface={vi.fn()} />
    ), mount);
    const backdrop = document.querySelector('[data-plugin-launcher-backdrop]');

    setOpen(false);
    await Promise.resolve();
    vi.advanceTimersByTime(160);
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-launcher-backdrop]')).toBeNull();

    setOpen(true);
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-panel-motion-state="open"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-launcher-backdrop]')).toBe(backdrop);
    vi.useRealTimers();
  });

  it('renders installed plugins with one market icon entry and no overflow menu', () => {
    const onOpenCenter = vi.fn();
    mountPanel({ onOpenCenter });

    const dialog = document.querySelector('[role="dialog"]')!;
    const plugin = dialog.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;
    const center = dialog.querySelectorAll<HTMLButtonElement>('[data-plugin-center-market-action]');
    expect(plugin.textContent).toContain('Metrics');
    const grid = dialog.querySelector('[data-plugin-launcher-grid]')!;
    expect(grid.tagName).toBe('UL');
    expect(plugin.tagName).toBe('BUTTON');
    expect(plugin.getAttribute('role')).toBeNull();
    expect(plugin.parentElement?.tagName).toBe('LI');
    expect(plugin.querySelector('[data-plugin-update-badge]')).toBeNull();
    expect(dialog.getAttribute('aria-describedby')).toBe('plugin-launcher-description');
    expect(center).toHaveLength(1);
    expect(center[0]?.getAttribute('aria-label')).toBe('Plugin Center');
    expect(center[0]?.title).toBe('Plugin Center');
    expect(dialog.querySelector('[data-plugin-panel-tile-menu]')).toBeNull();
    expect(dialog.querySelector('[data-floe-dropdown]')).toBeNull();
    center[0]?.click();
    expect(onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('opens the mode-specific Activity pin action without closing the panel', async () => {
    const onSetPluginPin = vi.fn();
    mountPanel({ placement: 'activity', onSetPluginPin });
    const tile = document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;

    tile.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 160,
    }));
    await Promise.resolve();

    const action = document.querySelector<HTMLButtonElement>('[data-floating-menu-item-id="plugin-pin-toggle"]')!;
    expect(tile.getAttribute('aria-haspopup')).toBe('menu');
    expect(action.textContent).toContain('Pin to Activity Bar');
    action.click();
    await Promise.resolve();
    expect(onSetPluginPin).toHaveBeenCalledWith('activity', 'instance:plugininst_metrics', true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('opens Plugin Center details for the selected plugin from the context menu', async () => {
    const onOpenPluginDetails = vi.fn();
    mountPanel({ placement: 'activity', onOpenPluginDetails, onSetPluginPin: vi.fn() });
    const tile = document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;

    tile.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 160,
    }));
    await Promise.resolve();

    const information = document.querySelector<HTMLButtonElement>('[data-floating-menu-item-id="plugin-information"]')!;
    expect(information.textContent).toContain('Plugin information');
    information.click();
    expect(onOpenPluginDetails).toHaveBeenCalledWith('instance:plugininst_metrics');
  });

  it('projects the Workbench Dock action through the owning surface floating layer', async () => {
    const { surface, trigger } = createWorkbenchTrigger();
    mountPanel({ placement: 'workbench', trigger, onSetPluginPin: vi.fn() });
    const tile = document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;

    tile.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 600,
      clientY: 620,
    }));
    await Promise.resolve();

    const menu = surface.querySelector<HTMLElement>('[data-context-menu-kind="plugin-pin"]')!;
    expect(menu).not.toBeNull();
    expect(menu.className).toContain('absolute');
    expect(menu.className).not.toContain('fixed');
    expect(menu.textContent).toContain('Pin to Workbench Dock');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('supports the keyboard menu key, arrows, Enter, Escape, and focus restoration', async () => {
    const onSetPluginPin = vi.fn();
    mountPanel({
      placement: 'activity',
      pinnedInventoryKeys: ['instance:plugininst_metrics'],
      onSetPluginPin,
    });
    const tile = document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;
    tile.focus();
    tile.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ContextMenu' }));
    await Promise.resolve();

    const information = document.querySelector<HTMLButtonElement>('[data-floating-menu-item-id="plugin-information"]')!;
    const action = document.querySelector<HTMLButtonElement>('[data-floating-menu-item-id="plugin-pin-toggle"]')!;
    expect(action.textContent).toContain('Unpin from Activity Bar');
    information.focus();
    information.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    expect(document.activeElement).toBe(action);
    action.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await Promise.resolve();
    expect(onSetPluginPin).toHaveBeenCalledWith('activity', 'instance:plugininst_metrics', false);

    tile.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F10', shiftKey: true }));
    await Promise.resolve();
    document.querySelector<HTMLElement>('[data-context-menu-kind="plugin-pin"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await Promise.resolve();
    expect(document.querySelector('[data-context-menu-kind="plugin-pin"]')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it('mounts the Workbench launcher in the local floating layer with the Dock material', async () => {
    const { surface, trigger } = createWorkbenchTrigger();
    mountPanel({ placement: 'workbench', trigger });
    await Promise.resolve();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const layer = surface.querySelector<HTMLElement>('[data-floe-surface-floating-layer="true"]')!;
    expect(dialog.dataset.pluginPanelMotionAxis).toBe('y');
    expect(dialog.dataset.pluginPanelMotionState).toBe('open');
    expect(layer).not.toBeNull();
    expect(layer.className).toContain('absolute');
    expect(layer.className).not.toContain('fixed');
    expect(dialog.className).toContain('workbench-dock-material');
    expect(dialog.className).not.toContain('bg-popover');
    expect(dialog.className).not.toContain('shadow-2xl');
    expect(dialog.className).not.toContain('rounded-lg');
    expect(dialog.querySelector('header')?.className).not.toContain('border-b');
    expect(dialog.querySelector('footer')).toBeNull();
    expect(dialog.textContent).not.toContain('1 installed · 0 need attention');
    expect(surface.querySelector('.workbench-dock-popover__arrow')).not.toBeNull();
    expect(document.querySelector('[data-plugin-workbench-popover-arrow]')).toBeNull();
    expect(dialog.className).not.toContain('zoom-in');
    expect(dialog.className).not.toContain('slide-in-from-left');
  });

  it('delegates canvas placement and Dock pinning to the unified Workbench drag transaction', () => {
    const { trigger } = createWorkbenchTrigger();
    const onDropPlugin = vi.fn();
    const onSetPluginPin = vi.fn();
    let dragItem: any;
    mountPanel({
      placement: 'workbench',
      trigger,
      onDropPlugin,
      onSetPluginPin,
      externalDockDragController: { begin: (_event, item) => { dragItem = item; } },
    });

    const tile = document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;
    tile.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(dragItem.dockPlacement).toBe('after-components');
    expect(dragItem.canvasPlacement.widgetType).toBe('redeven.plugin');
    const placement = {
      widgetType: 'redeven.plugin',
      centerWorld: { worldX: 820, worldY: 440 },
      frame: { x: 260, y: 60, width: 1120, height: 760 },
    } as const;
    dragItem.canvasPlacement.onDrop(placement);
    expect(onDropPlugin).toHaveBeenCalledWith(expect.objectContaining({
      pluginInstanceID: 'plugininst_metrics',
      preferredPlacement: 'workbench',
    }), placement);
    expect(document.querySelector('[data-plugin-workbench-drag-ghost]')).toBeNull();

    dragItem.onDropToDock();
    expect(onSetPluginPin).toHaveBeenCalledWith('workbench', 'instance:plugininst_metrics', true);
  });

  it('opens on the first normal click after a canvas drop and panel reopen', async () => {
    const { trigger } = createWorkbenchTrigger();
    const [open, setOpen] = createSignal(true);
    const onOpenPluginSurface = vi.fn();
    let dragItem: any;
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        placement="workbench"
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={onOpenPluginSurface}
        onDropPlugin={vi.fn()}
        externalDockDragController={{ begin: (_event, item) => { dragItem = item; } }}
      />
    ), mount);

    document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    dragItem.canvasPlacement.onDrop({
      widgetType: 'redeven.plugin',
      centerWorld: { worldX: 820, worldY: 440 },
      frame: { x: 260, y: 60, width: 1120, height: 760 },
    });
    expect(open()).toBe(false);

    setOpen(true);
    await Promise.resolve();
    (document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]') as HTMLButtonElement).click();
    expect(onOpenPluginSurface).toHaveBeenCalledOnce();
  });

  it('uses the installed manifest presentation instead of a newer market projection', () => {
    mountPanel({
      model: panelModel(pluginItem({
        displayName: 'Market Name',
        description: 'Market summary',
        officialCatalog: {
          ...pluginItem().officialCatalog,
          displayName: 'Market Name',
          description: 'Market summary',
        } as PluginInventoryItem['officialCatalog'],
        presentation: {
          default_locale: 'en-US',
          locales: [{
            locale: 'en-US',
            plugin_name: 'Installed Name',
            publisher_name: 'Installed Publisher',
            summary: 'Installed summary',
            description: ['Installed description'],
            highlights: [],
            keywords: ['installed'],
            surfaces: [],
            settings: [],
          }],
        },
      })),
    });

    const plugin = document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')!;
    expect(plugin.textContent).toContain('Installed Name');
    expect(plugin.textContent).not.toContain('Market Name');
  });

  it('keeps catalog-only plugins in Plugin Center and shows the installed-plugin empty state', () => {
    const catalogItem = pluginItem({
      inventoryKey: 'catalog:metrics',
      pluginInstanceID: undefined,
      lifecycleState: 'not_installed',
      managementRevision: undefined,
      defaultLaunchTarget: undefined,
    });
    mountPanel({ model: buildPluginPanelModel({ items: [catalogItem] }) });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[data-plugin-panel-tile="catalog:metrics"]')).toBeNull();
    expect(dialog.textContent).toContain('No installed plugins yet.');
    expect(dialog.querySelector('[data-plugin-center-market-action]')).not.toBeNull();
  });

  it('keeps a Host-authorized plugin visible when runtime recovery needs attention', () => {
    const recoveryFailure = pluginItem({
      lifecycleState: 'needs_attention',
      attentionReason: 'diagnostic_error',
    });
    const model = buildPluginPanelModel({ items: [recoveryFailure] });

    expect(model.tiles.filter((tile) => tile.kind === 'plugin')).toHaveLength(1);
    mountPanel({ model });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')).not.toBeNull();
    expect(dialog.textContent).not.toContain('No installed plugins yet.');
    expect(dialog.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')?.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('opens the plugin default surface from the primary tile action', () => {
    const onOpenPluginDetails = vi.fn();
    const onOpenPluginSurface = vi.fn();
    mountPanel({ onOpenPluginDetails, onOpenPluginSurface });

    (document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]') as HTMLButtonElement).click();
    expect(onOpenPluginSurface).toHaveBeenCalledWith(expect.objectContaining({
      pluginInstanceID: 'plugininst_metrics',
      surfaceID: 'metrics.dashboard',
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

    const tile = document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]') as HTMLButtonElement;
    const badge = tile.querySelector('[data-plugin-update-badge]');
    expect(badge?.textContent).toBe('New');
    tile.click();
    expect(onOpenPluginSurface).toHaveBeenCalledWith(update.defaultLaunchTarget);
    expect(onOpenPluginDetails).not.toHaveBeenCalled();
  });

  it('hides plugins without a Host-authorized launch target', () => {
    mountPanel({
      model: buildPluginPanelModel({
        items: [pluginItem({
          lifecycleState: 'disabled',
          attentionReason: 'disabled',
          defaultLaunchTarget: undefined,
        })],
      }),
    });

    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')).toBeNull();
  });

  it('renders the desktop launcher as an isolated centered modal', async () => {
    const trigger = createTrigger();
    mountPanel({ id: 'plugin-switcher', trigger });

    const dialog = document.querySelector('#plugin-switcher')!;
    expect(dialog.className).toContain('bg-popover');
    expect(dialog.className).not.toContain('backdrop-blur');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement?.className).toContain('justify-center');
    expect(dialog.querySelector('header')?.className).toContain('border-b');
    expect(dialog.querySelector('footer')?.className).toContain('border-t');
    expect(dialog.querySelector('footer')?.textContent).toContain('1 installed · 0 need attention');
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
    expect(document.activeElement).toBe(document.querySelector('[data-plugin-center-market-action]'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[data-plugin-panel-motion-state="closing"]')).not.toBeNull();
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
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')).toBeNull();

    search.value = '';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (document.querySelector('[data-plugin-launcher-category="infrastructure"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_metrics"]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-panel-tile="instance:plugininst_toolbox"]')).toBeNull();

  });

  it('clears search on the first Escape and closes on the second Escape', async () => {
    const onClose = vi.fn();
    mountPanel({ onClose });
    await Promise.resolve();
    const search = document.querySelector('[data-plugin-launcher-search]') as HTMLInputElement;
    search.value = 'metrics';
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
    expect(dialog.querySelector('header')?.className).toContain('border-b');
    expect(dialog.querySelector('footer')?.className).toContain('border-t');
    expect(dialog.querySelector('footer')?.textContent).toContain('1 installed · 0 need attention');
    const close = document.querySelector('[aria-label="Close plugins"]') as HTMLButtonElement;
    expect(close.className).toContain('h-[44px]');
    expect(close.className).toContain('w-[44px]');
    expect(document.activeElement).toBe(document.querySelector('[data-plugin-launcher-search]'));
    expect(trigger.inert).toBe(true);
    expect(shell.inert).toBe(true);
    expect(preExistingInert.inert).toBe(true);

    close.focus();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    const center = document.querySelector('[data-plugin-center-market-action]') as HTMLButtonElement;
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

});
