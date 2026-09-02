// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ServiceTemplateCatalog,
  type ServiceTemplatePresentation,
} from './ServiceTemplateCatalog';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: any) => <span class={props.class} aria-hidden={props['aria-hidden']} />;
  return {
    AlertTriangle: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    Cpu: Icon,
    LayoutDashboard: Icon,
    Layers: Icon,
    MoreHorizontal: Icon,
    Package: Icon,
    Plus: Icon,
    Search: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button type="button" class={props.class} disabled={props.disabled} data-testid={props['data-testid']} onClick={props.onClick}>{props.children}</button>,
  Dropdown: (props: any) => <div data-dropdown>{props.trigger}<div data-dropdown-items>{props.items.map((item: any) => <button type="button" disabled={item.disabled} onClick={() => props.onSelect(item.id)}>{item.label}</button>)}</div></div>,
  Input: (props: any) => <input value={props.value} class={props.class} aria-label={props['aria-label']} placeholder={props.placeholder} onInput={props.onInput} />,
  Tag: (props: any) => <span>{props.children}</span>,
}));

const builtIn: ServiceTemplatePresentation = {
  id: 'example-host',
  name: 'Example Service',
  description: 'Run Example Service directly in the current Environment.',
  source: 'builtin',
  kind: 'host',
  icon: { media_type: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="8"/></svg>', sha256: 'icon-sha' },
  deploymentLabel: 'Host',
  version: '0.1.1-rc.2',
  revision: 3,
  diskBytes: 536870912,
  dataLocation: '/srv/redeven/example/data',
  defaultWorkspacePath: '/workspace/example-service',
  defaultAccessMode: 'desktop_loopback',
  runtimeSpec: {
    schema_version: 3,
    kind: 'host',
    endpoint: { scheme: 'http', path: '/', health_path: '/health', startup_timeout_sec: 45 },
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

const custom: ServiceTemplatePresentation = {
  id: 'custom-host',
  name: 'Workspace dashboard',
  description: 'Serve the current build dashboard.',
  source: 'custom',
  kind: 'host',
  deploymentLabel: 'Host',
  revision: 1,
  developerPreview: false,
  available: true,
  installed: false,
  duplicateable: true,
  editable: true,
};

describe('ServiceTemplateCatalog', () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    host?.remove();
  });

  function mount(overrides: Partial<Parameters<typeof ServiceTemplateCatalog>[0]> = {}) {
    host = document.createElement('div');
    document.body.appendChild(host);
    const [category, setCategory] = createSignal<'host' | 'container'>('host');
    const [query, setQuery] = createSignal('');
    const onCategoryChange = vi.fn((next: 'host' | 'container') => setCategory(next));
    const onCreate = vi.fn();
    const onDeploy = vi.fn();
    const onOpen = vi.fn();
    const onDuplicate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onVersions = vi.fn();
    const onQueryChange = vi.fn((next: string) => setQuery(next));
    const props = {
      get category() { return category(); },
      get query() { return query(); },
      hostCount: 2,
      containerCount: 1,
      templates: [builtIn, custom],
      loading: false,
      canManage: true,
      onCategoryChange,
      onQueryChange,
      onCreate,
      onDeploy,
      onOpen,
      onDuplicate,
      onEdit,
      onDelete,
      onVersions,
      ...overrides,
    };
    dispose = render(() => <ServiceTemplateCatalog {...props} />, host);
    return { onCategoryChange, onCreate, onDeploy, onOpen, onDuplicate, onEdit, onDelete, onVersions, onQueryChange };
  }

  it('presents built-in and custom templates as a selectable list with a detail pane', () => {
    mount();

    expect(host.querySelectorAll('[data-testid="service-template-group"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="service-template-row"]')).toHaveLength(2);
    expect(host.querySelector('img[src^="data:image/svg+xml"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="service-template-list"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="service-template-details"]')).toBeTruthy();
    expect(host.querySelector('[data-template-id="example-host"]')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[data-testid="service-template-details"]')?.textContent).toContain('Example Service');
    expect(host.textContent).toContain('Built-in templates');
    expect(host.textContent).toContain('Custom templates');
    expect(host.textContent).toContain('Host templates 2');
    expect(host.textContent).toContain('Container templates 1');
  });

  it('keeps primary and secondary actions in the selected template detail pane', () => {
    const actions = mount();
    const builtInCard = host.querySelector<HTMLElement>('[data-template-id="example-host"]')!;
    const customCard = host.querySelector<HTMLElement>('[data-template-id="custom-host"]')!;

    expect(builtInCard.querySelector('[data-testid="service-template-primary"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-testid="service-template-details"] [data-dropdown-items] button')?.click();

    customCard.click();
    expect(customCard.getAttribute('aria-selected')).toBe('true');
    host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.click();
    const customItems = host.querySelectorAll<HTMLButtonElement>('[data-testid="service-template-details"] [data-dropdown-items] button');
    customItems.item(1).click();
    customItems.item(2).click();

    expect(actions.onDeploy).toHaveBeenCalledWith('example-host');
    expect(actions.onDeploy).toHaveBeenCalledWith('custom-host');
    expect(actions.onDuplicate).toHaveBeenCalledWith('example-host');
    expect(actions.onEdit).toHaveBeenCalledWith('custom-host');
    expect(actions.onDelete).toHaveBeenCalledWith('custom-host');
    expect(host.querySelector('[data-testid="service-template-details"]')?.textContent).toContain('More');
  });

  it('shows the effective host and container runtime definitions instead of repeating catalog metadata', () => {
    const container: ServiceTemplatePresentation = {
      ...builtIn,
      id: 'desktop-container',
      name: 'Desktop container',
      kind: 'container',
      deploymentLabel: 'Container',
      runtimeSpec: {
        schema_version: 3,
        kind: 'container',
        endpoint: { scheme: 'http', container_port: 3000, path: '/', health_path: '/ready', startup_timeout_sec: 180 },
        container: {
          image: 'registry.example/desktop@sha256:1234',
          environment: { PUID: '1000', PGID: '1000' },
          mounts: [{ type: 'workspace', target: '/workspace' }, { type: 'volume', source: 'config', target: '/config' }],
          restart_policy: 'no',
          network_mode: 'bridge',
          read_only_root: false,
          pids_limit: 2048,
          shm_size_bytes: 1073741824,
          runtime_profile: 'interactive_desktop',
        },
      },
    };
    mount({ category: 'container', templates: [container], hostCount: 0, containerCount: 1 });

    const details = host.querySelector('[data-testid="service-template-details"]')!;
    expect(details.textContent).toContain('registry.example/desktop@sha256:1234');
    expect(details.textContent).toContain('${WORKSPACE} → /workspace');
    expect(details.textContent).toContain('config → /config');
    expect(details.textContent).toContain('PGID, PUID');
    expect(details.textContent).toContain('1 GiB');
    const readOnlyRoot = Array.from(details.querySelectorAll('.service-template-detail-field')).find((field) => field.textContent?.includes('Read-only root filesystem'));
    expect(readOnlyRoot?.textContent).toContain('No');

    dispose?.();
    host.remove();
    mount({ templates: [builtIn] });
    const hostDetails = host.querySelector('[data-testid="service-template-details"]')!;
    expect(hostDetails.textContent).toContain('example-service');
    expect(hostDetails.textContent).toContain('<managed-node> <managed-npm-cli> install @example/service-cli@0.1.1-rc.2 --package-lock=false --ignore-scripts');
    expect(hostDetails.textContent).toContain('<managed-executable> web --host <service-host> --port <service-port> --no-open');
    expect(hostDetails.textContent).toContain('Terminate the managed process group');
    expect(hostDetails.textContent).toContain('Remove managed data only when the user requests it');
    expect(hostDetails.textContent).toContain('HTTP · /');
    expect(hostDetails.textContent).toContain('45s');
  });

  it('routes category and create-menu choices through the catalog toolbar', () => {
    const actions = mount();
    const createHost = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dropdown-items] button')).find((button) => button.textContent === 'New host template')!;
    createHost.click();
    const containerTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Container templates'))!;
    containerTab.click();

    expect(actions.onCategoryChange).toHaveBeenCalledWith('container');
    expect(actions.onCreate).toHaveBeenCalledWith('host');
    expect(host.querySelector('[data-testid="service-template-category-content"]')?.getAttribute('data-template-category')).toBe('container');
  });

  it('moves selection and the detail pane together with arrow keys', () => {
    mount();
    const builtInCard = host.querySelector<HTMLButtonElement>('[data-template-id="example-host"]')!;
    const customCard = host.querySelector<HTMLButtonElement>('[data-template-id="custom-host"]')!;

    builtInCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(customCard.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(customCard);
    expect(host.querySelector('[data-testid="service-template-details"]')?.getAttribute('aria-label')).toBe('Workspace dashboard');
  });

  it('keeps unavailable and installed rows readable while disabling deployment', () => {
    const unavailable = { ...builtIn, available: false, availabilityReason: 'Docker is unavailable.' };
    const installed = { ...custom, installed: true };
    mount({ templates: [unavailable, installed] });

    const unavailableCard = host.querySelector<HTMLElement>('[data-template-id="example-host"]')!;
    const installedCard = host.querySelector<HTMLElement>('[data-template-id="custom-host"]')!;
    expect(unavailableCard.className).not.toContain('opacity');
    expect(host.querySelector('[data-testid="service-template-details"]')?.textContent).toContain('Docker is unavailable.');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.disabled).toBe(true);
    expect(installedCard.getAttribute('data-template-state')).toBe('installed');
    installedCard.click();
    expect(host.querySelector('[data-testid="service-template-details"]')?.textContent).toContain('A service from this template is installed in this Environment');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.disabled).toBe(true);
  });

  it('opens the exact installed service from the template menu without starting it', () => {
    const installed = { ...builtIn, installed: true, openable: true };
    const actions = mount({ templates: [installed] });

    const openAction = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dropdown-items] button'))
      .find((button) => button.textContent?.trim() === 'Open');
    expect(openAction?.disabled).toBe(false);
    openAction?.click();

    expect(actions.onOpen).toHaveBeenCalledOnce();
    expect(actions.onDeploy).not.toHaveBeenCalled();
  });

  it('keeps the installed-service open action visible with its unavailable reason', () => {
    const installed = { ...builtIn, installed: true, openable: false, openUnavailableReason: 'The service is not running.' };
    mount({ templates: [installed] });

    const openAction = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dropdown-items] button'))
      .find((button) => button.textContent?.includes('Open'));
    expect(openAction?.disabled).toBe(true);
    expect(openAction?.textContent).toContain('The service is not running.');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="service-template-more"]')?.disabled).toBe(false);
  });

  it('shows a distinct no-results state and clears the search', () => {
    const { onQueryChange } = mount({ templates: [], query: 'missing' });
    expect(host.textContent).toContain('No templates match your search.');
    host.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      if (button.textContent === 'Clear search') button.click();
    });
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('distinguishes loading from an empty category', () => {
    mount({ templates: [], loading: true });
    expect(host.textContent).toContain('Loading');
    expect(host.textContent).not.toContain('No templates match this view.');
  });

  it('disables create and management actions without permission', () => {
    mount({ canManage: false });
    expect(host.querySelector<HTMLButtonElement>('[data-testid="service-template-create-menu"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.disabled).toBe(true);
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dropdown-items] button')).every((button) => button.disabled)).toBe(true);
    const versions = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Versions');
    expect(versions?.disabled).toBe(true);
  });
});
