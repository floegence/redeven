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
import { DebianLogo, UbuntuLogo } from '../icons/DistributionBrandLogos';

export type ServiceTemplateCategory = 'host' | 'container';
export type ServiceTemplateKind = 'host' | 'container' | 'compose';

export type ServiceTemplatePresentation = Readonly<{
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  kind: ServiceTemplateKind;
  brandIcon?: 'deepseek-harness' | 'ubuntu' | 'debian';
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
  if (props.brandIcon === 'ubuntu') return <UbuntuLogo class={props.class} />;
  if (props.brandIcon === 'debian') return <DebianLogo class={props.class} />;
  if (props.kind === 'host') return <Cpu class={props.class} aria-hidden="true" />;
  if (props.kind === 'compose') return <Layers class={props.class} aria-hidden="true" />;
  return <Package class={props.class} aria-hidden="true" />;
}

function templateIconClass(brandIcon: ServiceTemplatePresentation['brandIcon'], compact = false): string {
  if (brandIcon === 'deepseek-harness') return compact ? 'h-auto w-6' : 'h-auto w-7';
  return compact ? 'h-5 w-5' : 'h-6 w-6';
}

export function ServiceTemplateIdentity(props: {
  template: ServiceTemplatePresentation;
  compact?: boolean;
}): JSX.Element {
  const i18n = useI18n();

  return (
    <div class={cn('service-template-identity flex min-w-0 items-start', props.compact ? 'service-template-identity--compact gap-2.5' : 'gap-3.5')}>
      <div
        class={cn('service-template-identity__icon flex shrink-0 items-center justify-center border', props.compact ? 'h-9 w-9 rounded-lg' : 'h-12 w-12 rounded-xl', props.template.brandIcon && 'service-template-identity__icon--brand')}
        data-template-kind={props.template.kind}
        data-template-brand={props.template.brandIcon}
      >
        <TemplateKindIcon kind={props.template.kind} brandIcon={props.template.brandIcon} class={templateIconClass(props.template.brandIcon)} />
      </div>
      <div class={cn('min-w-0 flex-1', !props.compact && 'pt-0.5')}>
        <div class={cn('flex min-w-0 items-center gap-x-2 gap-y-1', props.compact ? 'flex-nowrap' : 'flex-wrap')}>
          <h3 class={cn('min-w-0 text-sm font-semibold leading-5 text-foreground', props.compact && 'truncate')} dir="auto">{props.template.name}</h3>
          <Show when={!props.compact}>
            <span class="service-template-source-badge inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {props.template.source === 'builtin' ? i18n.t('webServices.managed.redevenBuiltIn') : i18n.t('webServices.managed.custom')}
            </span>
          </Show>
        </div>
        <Show when={!props.compact}>
          <p class="mt-1 text-xs leading-5 text-muted-foreground" dir="auto">{props.template.description}</p>
        </Show>
        <div class={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground', props.compact ? 'mt-0.5 leading-4' : 'mt-2')} data-template-metadata>
          <Show when={props.compact}>
            <span>{props.template.source === 'builtin' ? i18n.t('webServices.managed.builtIn') : i18n.t('webServices.managed.custom')}</span>
            <span aria-hidden="true">·</span>
          </Show>
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
  compact?: boolean;
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
        'service-template-status flex min-w-0 items-start',
        props.compact ? 'items-center gap-1.5 text-[11px] leading-4' : 'gap-2 text-xs leading-5',
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
          ? <span class={cn('service-template-status-dot shrink-0 rounded-full', props.compact ? 'h-1.5 w-1.5' : 'mt-[7px] h-1.5 w-1.5')} aria-hidden="true" />
          : <AlertTriangle class={cn('shrink-0', props.compact ? 'h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')} aria-hidden="true" />}
      >
        <CheckCircle class={cn('shrink-0', props.compact ? 'h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')} aria-hidden="true" />
      </Show>
      <span class="min-w-0">{label()}</span>
    </div>
  );
}

export function ServiceTemplateRow(props: {
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
        'service-template-row min-w-0 px-3 py-2.5 text-left text-card-foreground focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        props.selected && 'service-template-row--selected',
      )}
      data-testid="service-template-row"
      data-template-id={props.template.id}
      data-template-state={props.template.installed ? 'installed' : props.template.available ? 'available' : 'unavailable'}
      onClick={props.onSelect}
      onKeyDown={props.onKeyDown}
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          class={cn('service-template-identity__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', props.template.brandIcon && 'service-template-identity__icon--brand')}
          data-template-kind={props.template.kind}
          data-template-brand={props.template.brandIcon}
        >
          <TemplateKindIcon kind={props.template.kind} brandIcon={props.template.brandIcon} class={templateIconClass(props.template.brandIcon, true)} />
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold leading-5 text-foreground" dir="auto">{props.template.name}</h3>
          <p class="service-template-row__description mt-0.5 truncate text-xs leading-4 text-muted-foreground" dir="auto">{props.template.description}</p>
          <div class="mt-1 flex min-w-0 items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-1.5 truncate text-[10px] leading-4 text-muted-foreground" data-template-metadata>
              <span class="service-template-row__source truncate">
                {props.template.source === 'builtin' ? i18n.t('webServices.managed.builtIn') : i18n.t('webServices.managed.custom')}
              </span>
              <span aria-hidden="true">·</span>
              <span class="shrink-0">{props.template.deploymentLabel}</span>
              <Show when={props.template.version}>
                <span aria-hidden="true">·</span>
                <span class="shrink-0 font-mono">v{props.template.version}</span>
              </Show>
            </div>
            <ServiceTemplateStatus template={props.template} compact />
          </div>
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
      <div class="service-template-details__header flex min-w-0 items-start gap-3.5">
        <div
          class={cn('service-template-details__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', props.template.brandIcon && 'service-template-identity__icon--brand')}
          data-template-kind={props.template.kind}
          data-template-brand={props.template.brandIcon}
        >
          <TemplateKindIcon kind={props.template.kind} brandIcon={props.template.brandIcon} class={props.template.brandIcon ? 'h-auto w-7' : 'h-6 w-6'} />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
              {props.template.source === 'builtin' ? i18n.t('webServices.managed.redevenBuiltIn') : i18n.t('webServices.managed.custom')}
            </span>
            <Show when={props.template.developerPreview}>
              <Tag variant="warning" tone="soft" size="sm">{i18n.t('webServices.managed.developerPreview')}</Tag>
            </Show>
          </div>
          <h2 class="service-template-details__title mt-0.5 text-base font-semibold leading-6 text-foreground" dir="auto">{props.template.name}</h2>
          <p class="mt-1 text-xs leading-5 text-muted-foreground" dir="auto">{props.template.description}</p>
        </div>
      </div>

      <dl class="service-template-details__metadata mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y py-3 text-xs">
        <div class="min-w-0">
          <dt class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.deployment')}</dt>
          <dd class="mt-1 truncate font-medium text-foreground">{props.template.deploymentLabel}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.version')}</dt>
          <dd class="mt-1 truncate font-mono text-foreground">{props.template.version ? `v${props.template.version}` : i18n.t('webServices.managed.customVersion')}</dd>
        </div>
      </dl>

      <div class="mt-3.5">
        <ServiceTemplateStatus template={props.template} detailed />
      </div>

      <div class="service-template-details__actions mt-4 flex items-center gap-2">
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
    active: boolean;
  }>>((previous) => {
    const category = props.category;
    return { category, active: category !== previous.category };
  }, { category: props.category, active: false });
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
  const moveRowSelection: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const list = event.currentTarget.closest('[data-testid="service-template-list"]');
    const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const currentIndex = rows.indexOf(event.currentTarget);
    if (currentIndex < 0 || rows.length === 0) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (currentIndex - 1 + rows.length) % rows.length
          : (currentIndex + 1) % rows.length;
    rows[nextIndex]?.click();
    rows[nextIndex]?.focus();
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
            data-transition-active={presentation.active}
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
                    data-testid="service-template-list"
                  >
                    <div class="space-y-7">
                      <TemplateGroup
                        title={i18n.t('webServices.managed.builtInTemplates')}
                        description={i18n.t('webServices.managed.builtInTemplatesDescription')}
                        templates={builtInTemplates()}
                        selectedTemplateID={selectedTemplate()?.id}
                        onSelect={setRequestedTemplateID}
                        onKeyDown={moveRowSelection}
                      />
                      <TemplateGroup
                        title={i18n.t('webServices.managed.customTemplates')}
                        description={i18n.t('webServices.managed.customTemplatesDescription')}
                        templates={customTemplates()}
                        selectedTemplateID={selectedTemplate()?.id}
                        onSelect={setRequestedTemplateID}
                        onKeyDown={moveRowSelection}
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
        <div class="service-template-list grid">
          <For each={props.templates}>{(template) => (
            <ServiceTemplateRow
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
