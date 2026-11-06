import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState } from '@floegence/floe-webapp-core/workbench';
import { I18nProvider } from '../../i18n';
import { redevenWorkbenchFilterBarWidgetTypes, redevenWorkbenchWidgets } from '../redevenWorkbenchWidgets';
import { RedevenWorkbenchSurface } from './RedevenWorkbenchSurface';
import { GlobalFlowerContextMenu } from '../../../../../../flower_ui/src/GlobalFlowerContextMenu';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

it('keeps Work Mode first, leads with Flower, Files, and Terminal, and places plugin actions before saved pins', async () => {
  await page.viewport(1440, 900);
  const host = document.createElement('div');
  host.style.height = '900px';
  document.body.append(host);
  const [state, setState] = createSignal(createDefaultWorkbenchState(redevenWorkbenchWidgets));
  const [pluginsOpen, setPluginsOpen] = createSignal(false);
  const onPlugins = vi.fn((trigger: HTMLButtonElement) => {
    setPluginsOpen(current => !current);
    expect(trigger.dataset.workbenchDockAction).toBe('plugins');
  });
  const onPin = vi.fn();
  dispose = render(() => <FloeConfigProvider config={{ storage: { enabled: false } }}>
    <ThemeProvider><I18nProvider><RedevenWorkbenchSurface
      state={state} setState={setState}
      widgetDefinitions={redevenWorkbenchWidgets}
      filterBarWidgetTypes={redevenWorkbenchFilterBarWidgetTypes}
      dockActions={[
        { id: 'tessiven', label: 'Tessiven', icon: () => null, dockPlacement: 'after-components', onActivate: () => {} },
        { id: 'plugins', label: 'Plugins', icon: () => null, dockPlacement: 'after-components', active: pluginsOpen(), onActivate: onPlugins },
      ]}
      dockItems={['pin:second', 'pin:first'].map(id => ({
        id, label: id, icon: () => null, dockPlacement: 'after-components', onActivate: onPin,
      }))}
    /></I18nProvider></ThemeProvider>
  </FloeConfigProvider>, host);

  await expect.poll(() => host.querySelectorAll('.workbench-dock button').length).toBe(15);
  const ids = Array.from(host.querySelectorAll<HTMLElement>('.workbench-dock button'))
    .map(button => button.dataset.workbenchDockComponent ?? button.dataset.workbenchDockAction
      ?? button.dataset.workbenchDockItem ?? 'mode');
  expect(ids).toEqual([
    'mode', 'redeven.ai', 'redeven.files', 'redeven.terminal', 'redeven.monitor',
    'redeven.codespaces', 'redeven.ports', 'redeven.remote-desktop', 'redeven.applications',
    'redeven.containers', 'sticky-note', 'tessiven', 'plugins', 'pin:second', 'pin:first',
  ]);

  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  expect(onPlugins).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-workbench-dock-action="plugins"]')?.getAttribute('aria-pressed')).toBe('true');
  host.querySelector<HTMLButtonElement>('[data-workbench-dock-action="plugins"]')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(onPlugins).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-workbench-dock-action="plugins"]')?.getAttribute('aria-pressed')).toBe('false');
  host.querySelector<HTMLButtonElement>('[data-workbench-dock-item="pin:second"]')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(onPin).toHaveBeenCalledTimes(1);
});

it('adds Ask Flower to the real canvas menu while retaining Workbench actions', async () => {
  await page.viewport(1280, 800);
  const host = document.createElement('div');
  host.style.height = '800px';
  document.body.append(host);
  const [state, setState] = createSignal(createDefaultWorkbenchState([]));
  const ask = vi.fn();
  dispose = render(() => <FloeConfigProvider config={{ storage: { enabled: false } }}>
    <ThemeProvider><I18nProvider>
      <GlobalFlowerContextMenu label="Ask Flower" onError={error => { throw error; }}
        editingLabels={{ undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', openLink: 'Open link', copyLink: 'Copy link' }}
        prepare={request => () => ask(request.target.closest('.workbench-canvas') !== null)}>
        <RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={[]} />
      </GlobalFlowerContextMenu>
    </I18nProvider></ThemeProvider>
  </FloeConfigProvider>, host);
  await expect.poll(() => host.querySelector('.workbench-canvas')).toBeTruthy();
  await userEvent.click(host.querySelector('.workbench-canvas')!, { button: 'right' });
  await expect.element(page.getByRole('menuitem', { name: 'Ask Flower', exact: true })).toBeVisible();
  expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
  expect(document.querySelectorAll('[role=menuitem]').length).toBeGreaterThan(1);
  await page.getByRole('menuitem', { name: 'Ask Flower', exact: true }).click();
  expect(ask).toHaveBeenCalledWith(true);
  await expect.poll(() => document.querySelector('[role=menu]')).toBeNull();
});
