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
  id: 'deepseek-harness-host',
  name: 'DeepSeek Harness',
  description: 'Run DeepSeek Harness directly in the current Environment.',
  source: 'builtin',
  kind: 'host',
  brandIcon: 'deepseek-harness',
  deploymentLabel: 'Host',
  version: '0.1.1-rc.2',
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
    const onDuplicate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
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
      onDuplicate,
      onEdit,
      onDelete,
      ...overrides,
    };
    dispose = render(() => <ServiceTemplateCatalog {...props} />, host);
    return { onCategoryChange, onCreate, onDeploy, onDuplicate, onEdit, onDelete, onQueryChange };
  }

  it('groups built-in and custom templates into full-width cards with category counts', () => {
    mount();

    expect(host.querySelectorAll('[data-testid="service-template-group"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="service-template-card"]')).toHaveLength(2);
    expect(host.querySelector('[data-testid="deepseek-harness-logo"]')).toBeTruthy();
    expect(host.querySelector('.grid')).toBeNull();
    expect(host.textContent).toContain('Built-in templates');
    expect(host.textContent).toContain('Custom templates');
    expect(host.textContent).toContain('Host templates 2');
    expect(host.textContent).toContain('Container templates 1');
  });

  it('keeps deploy visible and moves duplicate, edit, and delete into the labeled menu', () => {
    const actions = mount();
    const builtInCard = host.querySelector<HTMLElement>('[data-template-id="deepseek-harness-host"]')!;
    const customCard = host.querySelector<HTMLElement>('[data-template-id="custom-host"]')!;

    builtInCard.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.click();
    builtInCard.querySelector<HTMLButtonElement>('[data-dropdown-items] button')?.click();
    const customItems = customCard.querySelectorAll<HTMLButtonElement>('[data-dropdown-items] button');
    customItems.item(1).click();
    customItems.item(2).click();

    expect(actions.onDeploy).toHaveBeenCalledWith('deepseek-harness-host');
    expect(actions.onDuplicate).toHaveBeenCalledWith('deepseek-harness-host');
    expect(actions.onEdit).toHaveBeenCalledWith('custom-host');
    expect(actions.onDelete).toHaveBeenCalledWith('custom-host');
    expect(builtInCard.textContent).toContain('More');
  });

  it('routes category and create-menu choices through the catalog toolbar', () => {
    const actions = mount();
    const createHost = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-dropdown-items] button')).find((button) => button.textContent === 'New host template')!;
    createHost.click();
    const containerTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent?.includes('Container templates'))!;
    containerTab.click();

    expect(actions.onCategoryChange).toHaveBeenCalledWith('container');
    expect(actions.onCreate).toHaveBeenCalledWith('host');
  });

  it('keeps unavailable and installed cards readable while disabling deployment', () => {
    const unavailable = { ...builtIn, available: false, availabilityReason: 'Docker is unavailable.' };
    const installed = { ...custom, installed: true };
    mount({ templates: [unavailable, installed] });

    const unavailableCard = host.querySelector<HTMLElement>('[data-template-id="deepseek-harness-host"]')!;
    const installedCard = host.querySelector<HTMLElement>('[data-template-id="custom-host"]')!;
    expect(unavailableCard.className).not.toContain('opacity');
    expect(unavailableCard.textContent).toContain('Docker is unavailable.');
    expect(unavailableCard.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.disabled).toBe(true);
    expect(installedCard.getAttribute('data-template-state')).toBe('installed');
    expect(installedCard.textContent).toContain('This service family already has an instance');
    expect(installedCard.querySelector<HTMLButtonElement>('[data-testid="service-template-primary"]')?.disabled).toBe(true);
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
  });
});
