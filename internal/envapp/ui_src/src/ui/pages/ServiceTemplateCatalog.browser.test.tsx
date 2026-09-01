import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Dialog } from '@floegence/floe-webapp-core/ui';

import {
  ServiceTemplateCatalog,
  type ServiceTemplatePresentation,
} from './ServiceTemplateCatalog';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{ reducedMotion?: null | 'reduce' | 'no-preference' }>) => Promise<void>;
}>;

const template: ServiceTemplatePresentation = {
  id: 'deepseek-harness-host',
  name: 'DeepSeek Harness',
  description: 'Run DeepSeek Harness directly in the current Environment.',
  source: 'builtin',
  kind: 'host',
  brandIcon: 'deepseek-harness',
  deploymentLabel: 'Host',
  version: '0.1.1-rc.2',
  revision: 2,
  runtimeSpec: {
    schema_version: 1,
    kind: 'host',
    endpoint: { scheme: 'http', path: '/', health_path: '/', startup_timeout_sec: 45 },
    host: { runtime_bundle: 'deepseek-harness', start_script: 'exec "$REDEVEN_INSTALL_EXECUTABLE" web --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT" --no-open' },
  },
  hostLifecyclePlan: {
    schema_version: 1,
    driver: 'native',
    runtime_bundle: 'deepseek-harness',
    package: { reference: 'deepseek-runtime.tar.gz@sha256:1234', sha256: '1234', size_bytes: 536870912 },
    install: { ownership: 'redeven', steps: [
      { kind: 'prepare_verified_package', reference: 'deepseek-runtime.tar.gz@sha256:1234' },
      { kind: 'run_locked_dependency_install', command_template: '<managed-node> <managed-npm-cli> ci --omit=dev --legacy-peer-deps=false --no-audit --fund=false --progress=false --strict-allow-scripts' },
    ] },
    start: { ownership: 'redeven', steps: [{ kind: 'launch_managed_runtime', command_template: '<managed-launcher> web --host 127.0.0.1 --port <reserved-port> --no-open' }] },
    stop: { ownership: 'redeven', steps: [{ kind: 'terminate_managed_process_group' }] },
    uninstall: { ownership: 'redeven', steps: [{ kind: 'remove_managed_installation' }, { kind: 'remove_managed_logs' }, { kind: 'remove_managed_data_on_request' }] },
  },
  developerPreview: true,
  available: true,
  installed: false,
  duplicateable: true,
  editable: false,
};

const longContainerTemplate: ServiceTemplatePresentation = {
  ...template,
  id: 'container-details',
  kind: 'container',
  deploymentLabel: 'Container',
  runtimeSpec: {
    schema_version: 1,
    kind: 'container',
    endpoint: { scheme: 'http', container_port: 3000, path: '/', health_path: '/', startup_timeout_sec: 180 },
    container: {
      image: 'registry.example/desktop@sha256:1234567890',
      environment: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`SETTING_${index}`, `${index}`])),
      mounts: Array.from({ length: 12 }, (_, index) => ({ type: 'volume' as const, source: `volume-${index}`, target: `/data/${index}` })),
      restart_policy: 'no',
      network_mode: 'bridge',
      read_only_root: true,
      pids_limit: 512,
    },
  },
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('ServiceTemplateCatalog browser presentation', () => {
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    await page.viewport(1280, 720);
  });

  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.style.removeProperty('--redeven-desktop-titlebar-height');
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    await page.viewport(1280, 720);
  });

  function mount(
    templates: readonly ServiceTemplatePresentation[] = [template],
    onOpen: (templateID: string) => void = () => undefined,
  ): void {
    const host = document.createElement('div');
    host.className = 'mx-auto w-[900px] max-w-full bg-card p-4';
    document.body.appendChild(host);
    dispose = render(() => (
      <ServiceTemplateCatalog
        category="host"
        query=""
        hostCount={1}
        containerCount={0}
        templates={templates}
        loading={false}
        canManage
        onCategoryChange={() => undefined}
        onQueryChange={() => undefined}
        onCreate={() => undefined}
        onDeploy={() => undefined}
        onOpen={onOpen}
        onDuplicate={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />
    ), host);
  }

  function mountInDrawer(templates: readonly ServiceTemplatePresentation[]): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => (
      <EnvAppDrawer
        open
        onOpenChange={() => undefined}
        class="service-template-explorer-drawer"
        bodyClass="h-full"
        title="Service templates"
        description="Deploy a service in the current Environment."
      >
        <div class="service-template-drawer-shell h-full min-h-0 p-1" data-view="catalog" data-testid="service-template-drawer">
          <ServiceTemplateCatalog
            category="container"
            query=""
            hostCount={0}
            containerCount={templates.length}
            templates={templates}
            loading={false}
            canManage
            onCategoryChange={() => undefined}
            onQueryChange={() => undefined}
            onCreate={() => undefined}
            onDeploy={() => undefined}
            onOpen={() => undefined}
            onDuplicate={() => undefined}
            onEdit={() => undefined}
            onDelete={() => undefined}
          />
        </div>
      </EnvAppDrawer>
    ), host);
  }

  it('uses aligned master-detail columns and lets a single template fill the list', async () => {
    await page.viewport(1280, 720);
    mount();

    const list = document.querySelector<HTMLElement>('[data-testid="service-template-list"]')!;
    const row = document.querySelector<HTMLElement>('[data-testid="service-template-row"]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    expect(row.getBoundingClientRect().width / list.getBoundingClientRect().width).toBeGreaterThan(0.95);
    expect(details.getBoundingClientRect().width / list.getBoundingClientRect().width).toBeGreaterThan(0.72);
    expect(details.getBoundingClientRect().width / list.getBoundingClientRect().width).toBeLessThan(0.9);
    expect(details.getBoundingClientRect().top).toBeCloseTo(list.getBoundingClientRect().top, 0);
    expect(details.getBoundingClientRect().left).toBeGreaterThan(list.getBoundingClientRect().right);
    expect(row.getAttribute('aria-selected')).toBe('true');

    await userEvent.tab();
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect((document.activeElement as HTMLElement).className).toContain('focus-visible');
  });

  it('keeps the catalog and details flat while preserving a themed interactive row', () => {
    document.documentElement.classList.add('light');
    mount();
    const catalogSurface = document.querySelector<HTMLElement>('.service-template-catalog__canvas')!;
    const row = document.querySelector<HTMLElement>('[data-testid="service-template-row"]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const lightBackground = getComputedStyle(row).backgroundColor;
    const lightCatalogBackground = getComputedStyle(catalogSurface).backgroundColor;
    const lightDetailsBackground = getComputedStyle(details).backgroundColor;
    const catalogStyle = getComputedStyle(catalogSurface);
    const detailsStyle = getComputedStyle(details);

    document.documentElement.classList.replace('light', 'dark');
    const darkBackground = getComputedStyle(row).backgroundColor;

    expect(lightBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(lightBackground).not.toBe(lightCatalogBackground);
    expect(lightCatalogBackground).toBe('rgba(0, 0, 0, 0)');
    expect(lightDetailsBackground).toBe(lightCatalogBackground);
    expect(catalogStyle.boxShadow).toBe('none');
    expect(detailsStyle.borderTopWidth).toBe('0px');
    expect(detailsStyle.borderRightWidth).toBe('0px');
    expect(detailsStyle.borderBottomWidth).toBe('0px');
    expect(detailsStyle.borderLeftWidth).toBe('1px');
    expect(darkBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(darkBackground).not.toBe(lightBackground);
  });

  it('uses compact neutral rows and reserves emphasis for the current selection', () => {
    document.documentElement.classList.add('dark');
    mount([
      { ...template, id: 'selected-template', name: 'Selected template' },
      { ...template, id: 'installed-template', name: 'Installed template', installed: true },
      { ...template, id: 'available-template', name: 'Available template' },
    ]);

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="service-template-row"]'));
    const [selected, installed, available] = rows;
    const description = installed!.querySelector<HTMLElement>('.service-template-row__description')!;
    const installedStatus = installed!.querySelector<HTMLElement>('.service-template-status')!;
    const detailsIcon = document.querySelector<HTMLElement>('.service-template-details__icon')!;
    const detailsTitle = document.querySelector<HTMLElement>('.service-template-details__title')!;

    expect(rows).toHaveLength(3);
    expect(installed!.getBoundingClientRect().height).toBeLessThanOrEqual(92);
    expect(available!.getBoundingClientRect().height).toBeCloseTo(installed!.getBoundingClientRect().height, 0);
    expect(description.getBoundingClientRect().height).toBeLessThanOrEqual(20);
    expect(getComputedStyle(installed!).backgroundColor).toBe(getComputedStyle(available!).backgroundColor);
    expect(getComputedStyle(selected!).backgroundColor).not.toBe(getComputedStyle(available!).backgroundColor);
    expect(getComputedStyle(installedStatus).color).not.toBe(getComputedStyle(installed!).color);
    expect(Math.abs(
      (detailsIcon.getBoundingClientRect().top + detailsIcon.getBoundingClientRect().height / 2)
      - (detailsTitle.getBoundingClientRect().top + detailsTitle.getBoundingClientRect().height / 2),
    )).toBeLessThan(18);
  });

  it('keeps detailed runtime information scrollable while actions remain attached to the pane', () => {
    mount([longContainerTemplate]);

    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const body = details.querySelector<HTMLElement>('.service-template-details__body')!;
    const actions = details.querySelector<HTMLElement>('.service-template-details__actions')!;
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(actions.getBoundingClientRect().bottom).toBeLessThanOrEqual(details.getBoundingClientRect().bottom + 1);
    expect(actions.getBoundingClientRect().top).toBeGreaterThan(body.getBoundingClientRect().top);
  });

  it('keeps lifecycle commands readable without widening the detail pane', async () => {
    await page.viewport(390, 760);
    mount();
    await settle();

    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const plan = details.querySelector<HTMLElement>('[data-testid="host-lifecycle-plan"]')!;
    const commands = Array.from(plan.querySelectorAll<HTMLElement>('.service-template-lifecycle-step__command'));
    expect(plan.textContent).toContain('--strict-allow-scripts');
    expect(plan.textContent).toContain('--no-open');
    expect(commands.length).toBeGreaterThanOrEqual(2);
    for (const command of commands) {
      expect(command.getBoundingClientRect().right).toBeLessThanOrEqual(details.getBoundingClientRect().right + 1);
    }
    expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth + 1);
  });

  it('keeps long-detail actions inside the visible drawer footer edge', async () => {
    await page.viewport(1280, 720);
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '32px');
    mountInDrawer([longContainerTemplate]);
    await settle();

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const body = details.querySelector<HTMLElement>('.service-template-details__body')!;
    const actions = details.querySelector<HTMLElement>('.service-template-details__actions')!;
    const primary = details.querySelector<HTMLElement>('[data-testid="service-template-primary"]')!;
    const panelRect = panel.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expect(actionsRect.bottom).toBeLessThanOrEqual(panelRect.bottom - 10);
    expect(primary.getBoundingClientRect().bottom).toBeLessThanOrEqual(panelRect.bottom - 10);
    expect(details.getBoundingClientRect().bottom).toBeLessThanOrEqual(panelRect.bottom - 10);
  });

  it('keeps short-detail actions directly after the content instead of forcing them to the drawer bottom', async () => {
    await page.viewport(1280, 720);
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '32px');
    mountInDrawer([{ ...template, developerPreview: false, runtimeSpec: undefined }]);
    await settle();

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const body = details.querySelector<HTMLElement>('.service-template-details__body')!;
    const actions = details.querySelector<HTMLElement>('.service-template-details__actions')!;
    const panelRect = panel.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    expect(Math.abs(actionsRect.top - bodyRect.bottom)).toBeLessThanOrEqual(1);
    expect(panelRect.bottom - actionsRect.bottom).toBeGreaterThan(80);
  });

  it('stacks the selected template detail pane with touchable actions on narrow screens', async () => {
    await page.viewport(390, 760);
    mount();

    const layout = document.querySelector<HTMLElement>('.service-template-catalog__layout')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const deploy = document.querySelector<HTMLElement>('[data-testid="service-template-primary"]')!;
    const more = document.querySelector<HTMLElement>('[data-testid="service-template-more"]')!;
    expect(getComputedStyle(layout).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(details.getBoundingClientRect().top).toBeGreaterThan(document.querySelector<HTMLElement>('[data-testid="service-template-row"]')!.getBoundingClientRect().bottom);
    expect(getComputedStyle(details).borderLeftWidth).toBe('0px');
    expect(getComputedStyle(details).borderTopWidth).toBe('1px');
    expect(deploy.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('keeps long-detail actions visible at the drawer edge on narrow screens', async () => {
    await page.viewport(700, 640);
    mountInDrawer([longContainerTemplate]);
    await settle();

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    const shell = document.querySelector<HTMLElement>('[data-testid="service-template-drawer"]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const actions = details.querySelector<HTMLElement>('.service-template-details__actions')!;
    details.scrollIntoView({ block: 'start' });
    await settle();

    const panelRect = panel.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    expect(getComputedStyle(actions).position).toBe('sticky');
    expect(actionsRect.top).toBeGreaterThanOrEqual(shellRect.top);
    expect(actionsRect.bottom).toBeLessThanOrEqual(shellRect.bottom + 1);
    expect(actionsRect.bottom).toBeLessThanOrEqual(panelRect.bottom - 10);
  });

  it('removes decorative row and icon motion when reduced motion is requested', async () => {
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    mount();

    const row = document.querySelector<HTMLElement>('[data-testid="service-template-row"]')!;
    const icon = document.querySelector<HTMLElement>('.service-template-identity__icon')!;
    expect(getComputedStyle(row).transitionDuration).toBe('0s');
    expect(getComputedStyle(icon).transitionDuration).toBe('0s');
  });

  it('uses pointer cursors for actions while preserving text input affordance', () => {
    mount();

    const tab = document.querySelector<HTMLElement>('[role="tab"]')!;
    const row = document.querySelector<HTMLElement>('[data-testid="service-template-row"]')!;
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search templates"]')!;
    expect(getComputedStyle(tab).cursor).toBe('pointer');
    expect(getComputedStyle(row).cursor).toBe('pointer');
    expect(getComputedStyle(search).cursor).toBe('text');
  });

  it('opens an installed service from the template menu with the keyboard', async () => {
    let openedTemplateID = '';
    mount([{ ...template, installed: true, openable: true }], (templateID) => { openedTemplateID = templateID; });

    const more = document.querySelector<HTMLElement>('[data-testid="service-template-more"]')!;
    const trigger = more.closest<HTMLElement>('[data-floe-dropdown-trigger]')!;
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await settle();
    const open = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.trim() === 'Open')!;
    expect(document.activeElement).toBe(open);

    await userEvent.keyboard('{Enter}');
    await settle();
    expect(openedTemplateID).toBe('deepseek-harness-host');
  });

  it('presents the selected category without moving its layout and honors reduced motion', async () => {
    const host = document.createElement('div');
    host.className = 'mx-auto w-[900px] max-w-full bg-card p-4';
    document.body.appendChild(host);
    const [category, setCategory] = createSignal<'host' | 'container'>('host');
    const containerTemplate: ServiceTemplatePresentation = {
      ...template,
      id: 'deepseek-harness-container',
      kind: 'container',
      deploymentLabel: 'Container',
    };
    dispose = render(() => (
      <ServiceTemplateCatalog
        category={category()}
        query=""
        hostCount={1}
        containerCount={1}
        templates={category() === 'host' ? [template] : [containerTemplate]}
        loading={false}
        canManage
        onCategoryChange={setCategory}
        onQueryChange={() => undefined}
        onCreate={() => undefined}
        onDeploy={() => undefined}
        onOpen={() => undefined}
        onDuplicate={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />
    ), host);

    const containerTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.includes('Container templates'))!;
    const hostContent = document.querySelector<HTMLElement>('[data-testid="service-template-category-content"]')!;
    const hostRect = hostContent.getBoundingClientRect();
    await userEvent.click(containerTab);
    const content = document.querySelector<HTMLElement>('[data-testid="service-template-category-content"]')!;
    expect(content.dataset.templateCategory).toBe('container');
    expect(content.dataset.transitionActive).toBe('true');
    const categoryAnimation = content.getAnimations().find((animation) => (
      (animation.effect as KeyframeEffect | null)?.target === content
    ));
    expect(categoryAnimation).toBeDefined();
    const keyframes = (categoryAnimation!.effect as KeyframeEffect).getKeyframes();
    expect(keyframes.every((frame) => frame.transform === undefined || frame.transform === 'none')).toBe(true);
    const opacityKeyframes = keyframes
      .map((frame) => Number.parseFloat(String(frame.opacity)))
      .filter((opacity) => Number.isFinite(opacity));
    expect(opacityKeyframes.length).toBeGreaterThan(0);
    expect(Math.min(...opacityKeyframes)).toBeGreaterThanOrEqual(0.94);
    expect(Math.max(...opacityKeyframes)).toBe(1);
    const containerRect = content.getBoundingClientRect();
    expect(containerRect.left).toBe(hostRect.left);
    expect(containerRect.top).toBe(hostRect.top);
    expect(containerRect.width).toBe(hostRect.width);

    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    const hostTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.includes('Host templates'))!;
    await userEvent.click(hostTab);
    const reducedContent = document.querySelector<HTMLElement>('[data-testid="service-template-category-content"]')!;
    const reducedAnimations = reducedContent.getAnimations().filter((animation) => (
      (animation.effect as KeyframeEffect | null)?.target === reducedContent
    ));
    expect(reducedContent.dataset.templateCategory).toBe('host');
    expect(reducedAnimations).toHaveLength(0);
  });

  it('keeps catalog menus above the drawer and closes from the outside backdrop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [open, setOpen] = createSignal(true);
    const [action, setAction] = createSignal('');
    dispose = render(() => (
      <>
        <EnvAppDrawer
          open={open()}
          onOpenChange={setOpen}
          title="Service templates"
          description="Deploy a service in the current Environment."
        >
          <ServiceTemplateCatalog
            category="host"
            query=""
            hostCount={1}
            containerCount={0}
            templates={[template]}
            loading={false}
            canManage
            onCategoryChange={() => undefined}
            onQueryChange={() => undefined}
            onCreate={(kind) => setAction(`create:${kind}`)}
            onDeploy={() => undefined}
            onOpen={() => undefined}
            onDuplicate={() => setAction('duplicate')}
            onEdit={() => undefined}
            onDelete={() => undefined}
          />
        </EnvAppDrawer>
        <Dialog
          open={action() === 'duplicate'}
          onOpenChange={(nextOpen) => { if (!nextOpen) setAction(''); }}
          title="Duplicate service template"
        >
          <p>Choose a name for the copy.</p>
        </Dialog>
      </>
    ), host);
    await settle();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="service-template-more"]')!);
    await settle();
    const duplicate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Duplicate'))!;
    const duplicateRect = duplicate.getBoundingClientRect();
    const duplicateTopLayer = document.elementFromPoint(
      duplicateRect.left + duplicateRect.width / 2,
      duplicateRect.top + duplicateRect.height / 2,
    );
    expect(duplicate.contains(duplicateTopLayer) || duplicate === duplicateTopLayer).toBe(true);
    await userEvent.click(duplicate);
    await settle();
    expect(action()).toBe('duplicate');
    const nestedDialog = Array.from(document.querySelectorAll<HTMLElement>('[data-floe-dialog-panel]'))
      .find((dialog) => dialog.textContent?.includes('Duplicate service template'))!;
    const nestedRect = nestedDialog.getBoundingClientRect();
    const nestedTopLayer = document.elementFromPoint(
      nestedRect.left + nestedRect.width / 2,
      nestedRect.top + nestedRect.height / 2,
    );
    expect(nestedDialog.contains(nestedTopLayer) || nestedDialog === nestedTopLayer).toBe(true);
    setAction('');
    await settle();

    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="service-template-create-menu"]')!);
    await settle();
    const createHost = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('New host template'))!;
    const createRect = createHost.getBoundingClientRect();
    const createTopLayer = document.elementFromPoint(
      createRect.left + createRect.width / 2,
      createRect.top + createRect.height / 2,
    );
    expect(createHost.contains(createTopLayer) || createHost === createTopLayer).toBe(true);
    await userEvent.click(createHost);
    await settle();
    expect(action()).toBe('create:host');

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    const panelRect = panel.getBoundingClientRect();
    const outsideTarget = document.elementFromPoint(Math.max(1, panelRect.left / 2), window.innerHeight / 2) as HTMLElement | null;
    expect(outsideTarget?.hasAttribute('data-floe-dialog-backdrop')).toBe(true);
    outsideTarget!.click();
    await settle();
    expect(open()).toBe(false);
  });
});
