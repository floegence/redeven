import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';

import {
  ServiceTemplateCatalog,
  ServiceTemplateNavigation,
  type ServiceTemplateCollection,
  type ServiceTemplatePresentation,
} from './ServiceTemplateCatalog';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{ reducedMotion?: null | 'reduce' | 'no-preference' }>) => Promise<void>;
}>;

const template: ServiceTemplatePresentation = {
  id: 'example-host',
  name: 'Example Service',
  description: 'Run Example Service directly in the current Environment.',
  source: 'builtin',
  kind: 'host',
  icon: { media_type: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="8"/></svg>', sha256: 'icon-sha' },
  deploymentLabel: 'Host',
  defaultReleaseLabel: '0.1.1-rc.2',
  revision: 3,
  runtimeSpec: {
    schema_version: 6,
    kind: 'host',
    endpoint: { scheme: 'http', path: '/', health_path: '/', startup_timeout_sec: 45 },
    host: { npm: { package_name: '@example/service-cli', version: '0.1.1-rc.2', registry_url: 'https://registry.npmjs.org/', executable: 'service-cli' }, start_script: 'exec "$REDEVEN_INSTALL_EXECUTABLE" web --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT" --no-open' },
  },
  hostLifecyclePlan: {
    schema_version: 1,
    driver: 'npm_host',
    runtime_bundle: 'node-24.19.0',
    npm: { package_name: '@example/service-cli', version: '0.1.1-rc.2', registry_url: 'https://registry.npmjs.org/', executable: 'service-cli' },
    package: { reference: 'example-runtime.tar.gz@sha256:1234', sha256: '1234', size_bytes: 536870912 },
    install: { ownership: 'redeven', steps: [
      { kind: 'prepare_verified_node_runtime', reference: 'node-24.19.0' },
      { kind: 'install_npm_package_without_scripts', command_template: '<managed-node> <managed-npm-cli> install @example/service-cli@0.1.1-rc.2 --package-lock=false --ignore-scripts' },
      { kind: 'remove_temporary_registry_credentials' },
      { kind: 'run_npm_lifecycle_scripts', command_template: '<managed-node> <managed-npm-cli> rebuild --dangerously-allow-all-scripts' },
      { kind: 'verify_npm_release_identity', reference: '@example/service-cli@0.1.1-rc.2' },
    ] },
    start: { ownership: 'template', steps: [{ kind: 'run_template_script', command_template: '<managed-executable> web --host <service-host> --port <service-port> --no-open' }] },
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
    schema_version: 6,
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
    localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
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

  it('identifies discovered official sources and keeps deployment review reachable', async () => {
    mount([{...template, id:'git_official', source:'git', classification:'official', marketplace:true, runtimeSpec:undefined, hostLifecyclePlan:undefined, duplicateable:false}]);
    await settle();
    await expect.element(page.getByTestId('service-template-details').getByText('Official', {exact:true})).toBeVisible();
    await expect.element(page.getByTestId('service-template-primary')).toBeEnabled();
    expect(document.querySelector('[data-testid="service-template-details"]')?.textContent).toContain('Official');
  });

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
        bodyDescription="Deploy a service in the current Environment."
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

  it('separates marketplace navigation from search and actions', async () => {
    const host = document.createElement('div');
    host.style.width = '1100px';
    document.body.appendChild(host);
    dispose = render(() => <ServiceTemplateCatalog
      toolbar={<div class="flex flex-wrap items-center justify-between gap-2" data-testid="market-navigation">
        <Button size="sm">Discover</Button><select class="h-8 rounded-md border px-2"><option>All sources</option></select>
      </div>}
      category="host" query="" hostCount={1} containerCount={0} templates={[template]}
      loading={false} canManage onCategoryChange={() => undefined} onQueryChange={() => undefined}
      onCreate={() => undefined} onImport={() => undefined} onDeploy={() => undefined}
      onOpen={() => undefined} onDuplicate={() => undefined} onEdit={() => undefined} onDelete={() => undefined}
    />, host);
    await settle();
    const navigation = host.querySelector('[data-testid="market-navigation"]')!.getBoundingClientRect();
    const search = host.querySelector('.service-template-search')!.getBoundingClientRect();
    expect(search.top - navigation.bottom).toBeGreaterThanOrEqual(12);
  });

  it.each([
    [1440, 'en-US'], [1100, 'zh-CN'], [900, 'de-DE'], [768, 'zh-TW'], [640, 'fr-FR'], [375, 'zh-CN'], [320, 'de-DE'],
  ] as const)('keeps market navigation and actions separate at %s in %s', async (width, locale) => {
    await page.viewport(width, 900);
    localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
    const host = document.createElement('div');document.body.appendChild(host);
    const remote = {...longContainerTemplate, id: 'git_desktop', source: 'git' as const, classification: 'official' as const, marketplace: true,
      name: 'LinuxServer Webtop · Ubuntu (KDE Plasma)', description: 'Run a persistent desktop in an isolated container with a reviewed application release.',
      defaultReleaseLabel: 'ubuntu-kde-7a396ff1-ls189', supportedPlatforms: ['linux-amd64','linux-arm64'], runtimeSpec: undefined};
    dispose = render(() => {
      const [collection, setCollection] = createSignal<ServiceTemplateCollection>('discover');
      return <I18nProvider><EnvAppDrawer open onOpenChange={() => undefined} class="service-template-explorer-drawer" bodyClass="h-full" title="Service templates">
        <div class="service-template-drawer-shell h-full min-h-0 p-1" data-view="catalog">
          <ServiceTemplateCatalog toolbar={<ServiceTemplateNavigation collection={collection()} onChange={setCollection} refreshing={false} canRefresh onRefresh={() => undefined} />}
            category="all" query="" hostCount={1} containerCount={1} composeCount={0} templates={[remote,{...remote,id:'git_host',kind:'host',deploymentLabel:'Host',name:'DeepSeek Harness'}]}
            loading={false} canManage onCategoryChange={() => undefined} onQueryChange={() => undefined} onCreate={() => undefined} onImport={() => undefined}
            onDeploy={() => undefined} onOpen={() => undefined} onDuplicate={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />
        </div>
      </EnvAppDrawer></I18nProvider>;
    },host);
    await expect.element(page.getByTestId('service-template-toolbar')).toBeVisible();
    await vi.waitFor(() => expect(document.querySelector('[data-floe-dialog-panel]')?.getAttribute('data-floating-presence')).toBe('open'));
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)));await settle();
    const navigation = document.querySelector('[data-testid="market-navigation"]')!.getBoundingClientRect();
    const search = document.querySelector('.service-template-search')!.getBoundingClientRect();
    const actions = document.querySelector('.service-template-search-actions')!.getBoundingClientRect();
    const categories = document.querySelector('.service-template-switcher')!.getBoundingClientRect();
    expect(search.top - navigation.bottom).toBeGreaterThanOrEqual(12);
    expect(categories.top - actions.bottom).toBeGreaterThanOrEqual(12);
    for (const control of document.querySelectorAll<HTMLElement>('.service-template-navigation button, .service-template-search-actions input, .service-template-search-actions button')) {
      const rect = control.getBoundingClientRect();expect(rect.left).toBeGreaterThanOrEqual(0);expect(rect.right).toBeLessThanOrEqual(width+1);
    }
    const controls = [...document.querySelectorAll<HTMLElement>('.service-template-toolbar button, .service-template-toolbar input')].filter(el => {
      const rect=el.getBoundingClientRect();return rect.width>0 && rect.left>=0 && rect.right<=width;
    });
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++) {
      const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();
      expect(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1).toBe(false);
    }
    expect(getComputedStyle(document.querySelector('.service-template-row__title')!).whiteSpace).toBe('normal');
    expect(document.querySelector('[data-testid="service-template-details"]')?.textContent).not.toContain('—');
    await page.screenshot({path:`__screenshots__/market-${width}-${locale}.png`});
  });

  it.each(['light', 'dark'])('keeps selected category text readable in %s mode', (mode) => {
    document.documentElement.classList.add(mode);
    mount();
    const tab = document.querySelector<HTMLElement>('[role=tab][aria-selected=true]')!;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const luminance = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    let background = tab;
    while (getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)' && background.parentElement) background = background.parentElement;
    const foreground = luminance(getComputedStyle(tab).color);
    const backdrop = luminance(getComputedStyle(background).backgroundColor);
    expect((Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('moves keyboard selection across official and community groups', async () => {
    mount([
      {...template,id:'official-host',source:'git',classification:'official',marketplace:true},
      {...template,id:'community-host',source:'git',classification:'community',marketplace:true},
    ]);
    await settle();
    document.querySelector<HTMLButtonElement>('[data-template-id="official-host"][role="option"]')!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('data-template-id')).toBe('community-host');
    expect(document.querySelector('[data-testid="service-template-details"]')?.getAttribute('data-template-id')).toBe('community-host');
    await userEvent.keyboard('{Home}');
    expect(document.activeElement?.getAttribute('data-template-id')).toBe('official-host');
  });

  it('uses aligned master-detail columns and lets a single template fill the list', async () => {
    await page.viewport(1280, 720);
    mount();

    const list = document.querySelector<HTMLElement>('[data-testid="service-template-list"]')!;
    const row = document.querySelector<HTMLElement>('[data-testid="service-template-row"]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    expect(row.getBoundingClientRect().width / list.getBoundingClientRect().width).toBeGreaterThan(0.95);
    expect(details.getBoundingClientRect().width / list.getBoundingClientRect().width).toBeGreaterThan(1.5);
    expect(details.getBoundingClientRect().width / list.getBoundingClientRect().width).toBeLessThan(1.9);
    expect(details.getBoundingClientRect().top).toBeCloseTo(list.getBoundingClientRect().top, 0);
    expect(details.getBoundingClientRect().left).toBeGreaterThan(list.getBoundingClientRect().right);
    expect(row.getAttribute('aria-selected')).toBe('true');

    await userEvent.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Search templates');
    expect(document.activeElement?.matches(':focus-visible')).toBe(true);
    const focusStyle = getComputedStyle(document.activeElement!);
    expect(focusStyle.outlineStyle !== 'none' || focusStyle.boxShadow !== 'none').toBe(true);
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
		expect(plan.textContent).toContain('--dangerously-allow-all-scripts');
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

  it.each(['host', 'container', 'compose'] as const)('keeps short %s template actions at the same drawer footer edge', async (kind) => {
    await page.viewport(1280, 720);
    document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '32px');
    mountInDrawer([{ ...template, kind, developerPreview: false, runtimeSpec: undefined }]);
    await settle();

    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    const details = document.querySelector<HTMLElement>('[data-testid="service-template-details"]')!;
    const body = details.querySelector<HTMLElement>('.service-template-details__body')!;
    const actions = details.querySelector<HTMLElement>('.service-template-details__actions')!;
    const panelRect = panel.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    expect(Math.abs(actionsRect.top - bodyRect.bottom)).toBeLessThanOrEqual(1);
    expect(panelRect.bottom - actionsRect.bottom).toBeGreaterThanOrEqual(10);
    expect(panelRect.bottom - actionsRect.bottom).toBeLessThanOrEqual(32);
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
    expect(openedTemplateID).toBe('example-host');
  });

  it('presents the selected category without moving its layout and honors reduced motion', async () => {
    const host = document.createElement('div');
    host.className = 'mx-auto w-[900px] max-w-full bg-card p-4';
    document.body.appendChild(host);
    const [category, setCategory] = createSignal<'host' | 'container'>('host');
    const containerTemplate: ServiceTemplatePresentation = {
      ...template,
      id: 'example-container',
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
    await expect.poll(() => category()).toBe('container');
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
    await expect.poll(() => category()).toBe('host');
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
          bodyDescription="Deploy a service in the current Environment."
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
    expect(nestedDialog).toHaveAttribute('data-floating-presence', 'open');
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
