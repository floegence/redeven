import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Cpu,
  Layers,
  MoreHorizontal,
  Package,
  Plus,
  Search,
} from '@floegence/floe-webapp-core/icons';
import { Button, Dropdown, Input, Tag, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import { DeepSeekHarnessLogo } from '../icons/DeepSeekHarnessLogo';

export type ServiceTemplateCategory = 'host' | 'container';
export type ServiceTemplateKind = 'host' | 'container' | 'compose';

export type ServiceTemplatePresentation = Readonly<{
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  kind: ServiceTemplateKind;
  brandIcon?: 'deepseek-harness';
  deploymentLabel: string;
  version?: string;
  developerPreview: boolean;
  available: boolean;
  availabilityReason?: string;
  installed: boolean;
  duplicateable: boolean;
  editable: boolean;
}>;

export type ServiceTemplateCatalogProps = Readonly<{
  category: ServiceTemplateCategory;
  query: string;
  hostCount: number;
  containerCount: number;
  templates: readonly ServiceTemplatePresentation[];
  loading: boolean;
  canManage: boolean;
  onCategoryChange: (category: ServiceTemplateCategory) => void;
  onQueryChange: (query: string) => void;
  onCreate: (kind: ServiceTemplateKind) => void;
  onDeploy: (templateID: string) => void;
  onDuplicate: (templateID: string) => void;
  onEdit: (templateID: string) => void;
  onDelete: (templateID: string) => void;
}>;

function TemplateKindIcon(props: { kind: ServiceTemplateKind; brandIcon?: ServiceTemplatePresentation['brandIcon']; class?: string }): JSX.Element {
  if (props.brandIcon === 'deepseek-harness') return <DeepSeekHarnessLogo class={props.class} />;
  if (props.kind === 'host') return <Cpu class={props.class} aria-hidden="true" />;
  if (props.kind === 'compose') return <Layers class={props.class} aria-hidden="true" />;
  return <Package class={props.class} aria-hidden="true" />;
}

export function ServiceTemplateIdentity(props: {
  template: ServiceTemplatePresentation;
  compact?: boolean;
}): JSX.Element {
  const i18n = useI18n();

  return (
    <div class={cn('service-template-identity flex min-w-0 items-start gap-3.5', props.compact && 'service-template-identity--compact')}>
      <div
        class={cn('service-template-identity__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border', props.template.brandIcon && 'service-template-identity__icon--brand')}
        data-template-kind={props.template.kind}
        data-template-brand={props.template.brandIcon}
      >
        <TemplateKindIcon kind={props.template.kind} brandIcon={props.template.brandIcon} class={props.template.brandIcon ? 'h-auto w-7' : 'h-5 w-5'} />
      </div>
      <div class="min-w-0 flex-1 pt-0.5">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="min-w-0 text-sm font-semibold leading-5 text-foreground" dir="auto">{props.template.name}</h3>
          <span class="service-template-source-badge inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            {props.template.source === 'builtin' ? i18n.t('webServices.managed.redevenBuiltIn') : i18n.t('webServices.managed.custom')}
          </span>
        </div>
        <p class="mt-1 text-xs leading-5 text-muted-foreground" dir="auto">{props.template.description}</p>
        <div class="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground" data-template-metadata>
          <span>{props.template.deploymentLabel}</span>
          <Show when={props.template.version}>
            <span aria-hidden="true">·</span>
            <span class="font-mono">v{props.template.version}</span>
          </Show>
          <Show when={props.template.developerPreview}>
            <span aria-hidden="true">·</span>
            <Tag variant="warning" tone="soft" size="sm">{i18n.t('webServices.managed.developerPreview')}</Tag>
          </Show>
        </div>
      </div>
    </div>
  );
}

function ServiceTemplateStatus(props: {
  template: ServiceTemplatePresentation;
  detailed?: boolean;
}): JSX.Element {
  const i18n = useI18n();
  const label = () => props.template.installed
    ? props.detailed
      ? i18n.t('webServices.managed.templateInstalled')
      : i18n.t('webServices.managed.installed')
    : props.template.available
      ? i18n.t('webServices.managed.availableToDeploy')
      : props.detailed
        ? props.template.availabilityReason || i18n.t('webServices.managed.unavailableToDeploy')
        : i18n.t('webServices.managed.unavailableToDeploy');

  return (
    <div
      class={cn(
        'service-template-status flex min-w-0 items-start gap-2 text-xs leading-5',
        props.template.installed
          ? 'service-template-status--installed text-[var(--redeven-status-success-foreground)]'
          : props.template.available
            ? 'service-template-status--available text-muted-foreground'
            : 'service-template-status--unavailable text-[var(--redeven-status-warning-foreground)]',
      )}
      role={props.detailed && (props.template.available || props.template.installed) ? 'status' : undefined}
    >
      <Show
        when={props.template.installed}
        fallback={props.template.available
          ? <span class="service-template-status-dot mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
          : <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      >
        <CheckCircle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      </Show>
      <span class="min-w-0">{label()}</span>
    </div>
  );
}

export function ServiceTemplateTile(props: {
  template: ServiceTemplatePresentation;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;
}): JSX.Element {
  const i18n = useI18n();

  return (
    <button
      type="button"
      role="option"
      aria-selected={props.selected}
      tabIndex={props.selected ? 0 : -1}
      class={cn(
        'service-template-card service-template-tile min-w-0 rounded-xl p-4 text-left text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        props.selected && 'service-template-card--selected',
        props.template.installed && 'service-template-card--installed',
        !props.template.available && 'service-template-card--unavailable',
      )}
      data-testid="service-template-card"
      data-template-id={props.template.id}
      data-template-state={props.template.installed ? 'installed' : props.template.available ? 'available' : 'unavailable'}
      onClick={props.onSelect}
      onKeyDown={props.onKeyDown}
    >
      <div class="flex min-w-0 items-start gap-3">
        <div
          class={cn('service-template-identity__icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', props.template.brandIcon && 'service-template-identity__icon--brand')}
          data-template-kind={props.template.kind}
          data-template-brand={props.template.brandIcon}
        >
          <TemplateKindIcon kind={props.template.kind} brandIcon={props.template.brandIcon} class={props.template.brandIcon ? 'h-auto w-6' : 'h-5 w-5'} />
        </div>
        <div class="min-w-0 flex-1 pt-0.5">
          <span class="service-template-tile__source block truncate text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
            {props.template.source === 'builtin' ? i18n.t('webServices.managed.redevenBuiltIn') : i18n.t('webServices.managed.custom')}
          </span>
          <h3 class="mt-0.5 truncate text-sm font-semibold leading-5 text-foreground" dir="auto">{props.template.name}</h3>
        </div>
      </div>
      <p class="service-template-tile__description mt-3 text-xs leading-5 text-muted-foreground" dir="auto">{props.template.description}</p>
      <div class="mt-3 flex min-w-0 items-end justify-between gap-3">
        <ServiceTemplateStatus template={props.template} />
        <div class="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground" data-template-metadata>
          <span>{props.template.deploymentLabel}</span>
          <Show when={props.template.version}>
            <span aria-hidden="true">·</span>
            <span class="font-mono">v{props.template.version}</span>
          </Show>
        </div>
      </div>
    </button>
  );
}

export function ServiceTemplateDetailsPane(props: {
  template: ServiceTemplatePresentation;
  canManage: boolean;
  onDeploy: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const menuItems = (): DropdownItem[] => [
    {
      id: 'duplicate',
      label: i18n.t('webServices.managed.duplicate'),
      disabled: !props.template.duplicateable || !props.canManage,
    },
    ...(props.template.editable ? [
      {
        id: 'edit',
        label: i18n.t('webServices.managed.editTemplate'),
        disabled: !props.canManage,
      },
      {
        id: 'delete',
        label: i18n.t('webServices.managed.deleteTemplate'),
        disabled: props.template.installed || !props.canManage,
      },
    ] : []),
  ];
  const selectMenuItem = (id: string) => {
    if (id === 'duplicate') props.onDuplicate();
    else if (id === 'edit') props.onEdit();
    else if (id === 'delete') props.onDelete();
  };
  return (
    <aside
      class="service-template-details min-w-0"
      data-testid="service-template-details"
      data-template-id={props.template.id}
      aria-label={props.template.name}
    >
      <div class="flex min-w-0 items-start justify-between gap-3">
        <div
          class={cn('service-template-details__icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', props.template.brandIcon && 'service-template-identity__icon--brand')}
          data-template-kind={props.template.kind}
          data-template-brand={props.template.brandIcon}
        >
          <TemplateKindIcon kind={props.template.kind} brandIcon={props.template.brandIcon} class={props.template.brandIcon ? 'h-auto w-8' : 'h-6 w-6'} />
        </div>
        <Show when={props.template.developerPreview}>
          <Tag variant="warning" tone="soft" size="sm">{i18n.t('webServices.managed.developerPreview')}</Tag>
        </Show>
      </div>

      <div class="mt-4 min-w-0">
        <span class="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
          {props.template.source === 'builtin' ? i18n.t('webServices.managed.redevenBuiltIn') : i18n.t('webServices.managed.custom')}
        </span>
        <h2 class="mt-1 text-base font-semibold leading-6 text-foreground" dir="auto">{props.template.name}</h2>
        <p class="mt-2 text-xs leading-5 text-muted-foreground" dir="auto">{props.template.description}</p>
      </div>

      <dl class="service-template-details__metadata mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-y py-4 text-xs">
        <div class="min-w-0">
          <dt class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.deployment')}</dt>
          <dd class="mt-1 truncate font-medium text-foreground">{props.template.deploymentLabel}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.version')}</dt>
          <dd class="mt-1 truncate font-mono text-foreground">{props.template.version ? `v${props.template.version}` : i18n.t('webServices.managed.customVersion')}</dd>
        </div>
      </dl>

      <div class="mt-4">
        <ServiceTemplateStatus template={props.template} detailed />
      </div>

      <div class="service-template-details__actions mt-5 flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          class="service-template-primary min-h-11 min-w-0 flex-1 sm:min-h-9"
          data-testid="service-template-primary"
          onClick={props.onDeploy}
          disabled={!props.template.available || props.template.installed || !props.canManage}
        >
          {props.template.installed ? i18n.t('webServices.managed.installed') : i18n.t('webServices.managed.deploy')}
        </Button>
        <Dropdown
          align="end"
          items={menuItems()}
          onSelect={selectMenuItem}
          triggerAriaLabel={`${props.template.name}: ${i18n.t('webServices.managed.moreTemplateActions')}`}
          triggerClass="shrink-0 rounded-md"
          trigger={(
            <button
              type="button"
              class="service-template-more inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
              data-testid="service-template-more"
              disabled={menuItems().every((item) => item.disabled)}
              title={i18n.t('webServices.managed.moreTemplateActions')}
            >
              <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
              <span>{i18n.t('webServices.managed.moreActions')}</span>
            </button>
          )}
        />
      </div>
    </aside>
  );
}

export function ServiceTemplateCatalog(props: ServiceTemplateCatalogProps): JSX.Element {
  const i18n = useI18n();
  const categoryPresentation = createMemo<Readonly<{
    category: ServiceTemplateCategory;
    direction: -1 | 0 | 1;
  }>>((previous) => {
    const category = props.category;
    const direction = category === previous.category ? 0 : category === 'container' ? 1 : -1;
    return { category, direction };
  }, { category: props.category, direction: 0 });
  const [requestedTemplateID, setRequestedTemplateID] = createSignal<string | null>(null);
  const builtInTemplates = createMemo(() => props.templates.filter((template) => template.source === 'builtin'));
  const customTemplates = createMemo(() => props.templates.filter((template) => template.source === 'custom'));
  const selectedTemplate = createMemo(() => {
    const requestedID = requestedTemplateID();
    return props.templates.find((template) => template.id === requestedID) ?? props.templates[0];
  });
  const createItems = (): DropdownItem[] => props.category === 'host'
    ? [{ id: 'host', label: i18n.t('webServices.managed.newHostTemplate'), disabled: !props.canManage }]
    : [
      { id: 'container', label: i18n.t('webServices.managed.newContainerTemplate'), disabled: !props.canManage },
      { id: 'compose', label: i18n.t('webServices.managed.newComposeTemplate'), disabled: !props.canManage },
    ];
  const moveTileSelection: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const gallery = event.currentTarget.closest('[data-testid="service-template-gallery"]');
    const tiles = Array.from(gallery?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const currentIndex = tiles.indexOf(event.currentTarget);
    if (currentIndex < 0 || tiles.length === 0) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tiles.length - 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (currentIndex - 1 + tiles.length) % tiles.length
          : (currentIndex + 1) % tiles.length;
    tiles[nextIndex]?.click();
    tiles[nextIndex]?.focus();
  };

  return (
    <section class="service-template-catalog min-h-0" data-testid="service-template-catalog">
      <div class="service-template-toolbar sticky top-0 z-10 -mx-1 px-1 pb-4" data-testid="service-template-toolbar">
        <div class="flex flex-wrap items-center gap-3">
          <div class="service-template-switcher inline-flex min-h-9 items-center gap-1" role="tablist" aria-label={i18n.t('webServices.managed.templateCategories')}>
            <button
              type="button"
              role="tab"
              aria-selected={props.category === 'host'}
              class="service-template-switcher__item min-h-9 rounded-lg px-3 text-xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => props.onCategoryChange('host')}
            >
              {i18n.t('webServices.managed.hostTemplates')} <span class="service-template-switcher__count ml-1.5 tabular-nums">{props.hostCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.category === 'container'}
              class="service-template-switcher__item min-h-9 rounded-lg px-3 text-xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => props.onCategoryChange('container')}
            >
              {i18n.t('webServices.managed.containerTemplates')} <span class="service-template-switcher__count ml-1.5 tabular-nums">{props.containerCount}</span>
            </button>
          </div>
          <div class="service-template-search relative min-w-[12rem] flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={props.query}
              onInput={(event) => props.onQueryChange(event.currentTarget.value)}
              placeholder={i18n.t('webServices.managed.searchTemplates')}
              class="min-h-9 pl-9"
              aria-label={i18n.t('webServices.managed.searchTemplates')}
            />
          </div>
          <Dropdown
            align="end"
            items={createItems()}
            onSelect={(id) => props.onCreate(id as ServiceTemplateKind)}
            triggerAriaLabel={i18n.t('webServices.managed.newTemplate')}
            triggerClass="service-template-create-trigger shrink-0 rounded-md"
            trigger={(
              <Button size="sm" variant="default" class="min-h-9 gap-1.5" data-testid="service-template-create-menu" disabled={!props.canManage}>
                <Plus class="h-4 w-4" aria-hidden="true" />
                <span>{i18n.t('webServices.managed.newTemplate')}</span>
                <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Button>
            )}
          />
        </div>
      </div>

      <div class="service-template-category-stage">
        <Show when={categoryPresentation()} keyed>{(presentation) => (
          <div
            class="service-template-category-transition"
            data-testid="service-template-category-content"
            data-template-category={presentation.category}
            data-transition-direction={presentation.direction}
          >
            <Show
              when={!props.loading}
              fallback={<div class="service-template-empty rounded-2xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">{i18n.t('common.status.loading')}</div>}
            >
              <Show
                when={props.templates.length > 0}
                fallback={(
                  <div class="service-template-empty rounded-2xl border border-dashed px-5 py-12 text-center">
                    <p class="text-sm font-medium text-foreground">{props.query.trim() ? i18n.t('webServices.managed.noTemplateMatches') : i18n.t('webServices.managed.noTemplates')}</p>
                    <Show when={props.query.trim()}>
                      <Button size="sm" variant="ghost" class="mt-2" onClick={() => props.onQueryChange('')}>{i18n.t('webServices.managed.clearTemplateSearch')}</Button>
                    </Show>
                  </div>
                )}
              >
                <div class="service-template-catalog__layout service-template-catalog__layout--with-details">
                  <div
                    class="service-template-catalog__canvas min-w-0"
                    role="listbox"
                    aria-label={i18n.t('webServices.managed.serviceTemplates')}
                    data-testid="service-template-gallery"
                  >
                    <div class="space-y-7">
                      <TemplateGroup
                        title={i18n.t('webServices.managed.builtInTemplates')}
                        description={i18n.t('webServices.managed.builtInTemplatesDescription')}
                        templates={builtInTemplates()}
                        selectedTemplateID={selectedTemplate()?.id}
                        onSelect={setRequestedTemplateID}
                        onKeyDown={moveTileSelection}
                      />
                      <TemplateGroup
                        title={i18n.t('webServices.managed.customTemplates')}
                        description={i18n.t('webServices.managed.customTemplatesDescription')}
                        templates={customTemplates()}
                        selectedTemplateID={selectedTemplate()?.id}
                        onSelect={setRequestedTemplateID}
                        onKeyDown={moveTileSelection}
                      />
                    </div>
                  </div>
                  <Show when={selectedTemplate()} keyed>{(template) => (
                    <ServiceTemplateDetailsPane
                      template={template}
                      canManage={props.canManage}
                      onDeploy={() => props.onDeploy(template.id)}
                      onDuplicate={() => props.onDuplicate(template.id)}
                      onEdit={() => props.onEdit(template.id)}
                      onDelete={() => props.onDelete(template.id)}
                    />
                  )}</Show>
                </div>
              </Show>
            </Show>
          </div>
        )}</Show>
      </div>
    </section>
  );
}

function TemplateGroup(props: {
  title: string;
  description: string;
  templates: readonly ServiceTemplatePresentation[];
  selectedTemplateID?: string;
  onSelect: (templateID: string) => void;
  onKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;
}): JSX.Element {
  return (
    <Show when={props.templates.length > 0}>
      <section class="service-template-group" role="group" aria-label={props.title} data-testid="service-template-group">
        <div class="mb-3 px-0.5">
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate text-sm font-semibold leading-5 text-foreground">{props.title}</h2>
              <span class="service-template-group__count shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">{props.templates.length}</span>
            </div>
            <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">{props.description}</p>
          </div>
        </div>
        <div class="service-template-grid grid gap-3">
          <For each={props.templates}>{(template) => (
            <ServiceTemplateTile
              template={template}
              selected={props.selectedTemplateID === template.id}
              onSelect={() => props.onSelect(template.id)}
              onKeyDown={props.onKeyDown}
            />
          )}</For>
        </div>
      </section>
    </Show>
  );
}
