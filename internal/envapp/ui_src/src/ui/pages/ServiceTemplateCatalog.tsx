import { For, Show, createMemo, type JSX } from 'solid-js';
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
import {
  redevenSegmentedItemClass,
  redevenSurfaceRoleClass,
} from '../utils/redevenSurfaceRoles';

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

export function ServiceTemplateCard(props: {
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
  const statusLabel = () => props.template.installed
    ? i18n.t('webServices.managed.templateInstalled')
    : props.template.available
      ? i18n.t('webServices.managed.availableToDeploy')
      : props.template.availabilityReason || i18n.t('webServices.managed.unavailableToDeploy');

  return (
    <article
      class={cn(
        'service-template-card min-w-0 rounded-xl border p-4 text-card-foreground',
        redevenSurfaceRoleClass('panelInteractive'),
        props.template.installed && 'service-template-card--installed',
        !props.template.available && 'service-template-card--unavailable',
      )}
      data-testid="service-template-card"
      data-template-id={props.template.id}
      data-template-state={props.template.installed ? 'installed' : props.template.available ? 'available' : 'unavailable'}
    >
      <ServiceTemplateIdentity template={props.template} />
      <div class="service-template-card__footer mt-4 flex min-w-0 items-center gap-3 border-t pt-3">
        <div
          class={cn(
            'service-template-card__status flex min-w-0 flex-1 items-start gap-2 text-xs leading-5',
            props.template.installed
              ? 'text-[var(--redeven-status-success-foreground)]'
              : props.template.available
                ? 'text-muted-foreground'
                : 'text-[var(--redeven-status-warning-foreground)]',
          )}
          role={props.template.available || props.template.installed ? 'status' : undefined}
        >
          <Show
            when={props.template.installed}
            fallback={props.template.available
              ? <span class="service-template-status-dot mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
              : <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          >
            <CheckCircle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          </Show>
          <span class="min-w-0">{statusLabel()}</span>
        </div>
        <div class="service-template-card__actions flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="default"
            class="service-template-primary min-h-11 min-w-[5.5rem] sm:min-h-8"
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
                class="service-template-more inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8 sm:min-w-0"
                data-testid="service-template-more"
                disabled={menuItems().every((item) => item.disabled)}
                title={i18n.t('webServices.managed.moreTemplateActions')}
              >
                <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
                <span class="hidden sm:inline">{i18n.t('webServices.managed.moreActions')}</span>
              </button>
            )}
          />
        </div>
      </div>
    </article>
  );
}

export function ServiceTemplateCatalog(props: ServiceTemplateCatalogProps): JSX.Element {
  const i18n = useI18n();
  const builtInTemplates = createMemo(() => props.templates.filter((template) => template.source === 'builtin'));
  const customTemplates = createMemo(() => props.templates.filter((template) => template.source === 'custom'));
  const createItems = (): DropdownItem[] => props.category === 'host'
    ? [{ id: 'host', label: i18n.t('webServices.managed.newHostTemplate'), disabled: !props.canManage }]
    : [
      { id: 'container', label: i18n.t('webServices.managed.newContainerTemplate'), disabled: !props.canManage },
      { id: 'compose', label: i18n.t('webServices.managed.newComposeTemplate'), disabled: !props.canManage },
    ];

  return (
    <section class="service-template-catalog min-h-0" data-testid="service-template-catalog">
      <div class="service-template-toolbar sticky top-0 z-10 -mx-1 flex flex-col gap-3 bg-card px-1 pb-4" data-testid="service-template-toolbar">
        <div class="flex flex-wrap items-center gap-2.5">
          <div class={cn('inline-flex min-h-10 items-center rounded-lg border p-1', redevenSurfaceRoleClass('segmented'))} role="tablist" aria-label={i18n.t('webServices.managed.templateCategories')}>
            <button
              type="button"
              role="tab"
              aria-selected={props.category === 'host'}
              class={cn('min-h-8 rounded-md px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1', redevenSegmentedItemClass(props.category === 'host'))}
              onClick={() => props.onCategoryChange('host')}
            >
              {i18n.t('webServices.managed.hostTemplates')} <span class="ml-1 tabular-nums text-muted-foreground">{props.hostCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.category === 'container'}
              class={cn('min-h-8 rounded-md px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1', redevenSegmentedItemClass(props.category === 'container'))}
              onClick={() => props.onCategoryChange('container')}
            >
              {i18n.t('webServices.managed.containerTemplates')} <span class="ml-1 tabular-nums text-muted-foreground">{props.containerCount}</span>
            </button>
          </div>
          <div class="relative min-w-[12rem] flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={props.query}
              onInput={(event) => props.onQueryChange(event.currentTarget.value)}
              placeholder={i18n.t('webServices.managed.searchTemplates')}
              class="min-h-10 pl-9"
              aria-label={i18n.t('webServices.managed.searchTemplates')}
            />
          </div>
          <Dropdown
            align="end"
            items={createItems()}
            onSelect={(id) => props.onCreate(id as ServiceTemplateKind)}
            triggerAriaLabel={i18n.t('webServices.managed.newTemplate')}
            triggerClass="shrink-0 rounded-md"
            trigger={(
              <Button size="sm" variant="outline" class={cn('min-h-10 gap-1.5', redevenSurfaceRoleClass('control'))} data-testid="service-template-create-menu" disabled={!props.canManage}>
                <Plus class="h-4 w-4" aria-hidden="true" />
                <span>{i18n.t('webServices.managed.newTemplate')}</span>
                <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Button>
            )}
          />
        </div>
      </div>

      <Show
        when={!props.loading}
        fallback={<div class="service-template-empty rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">{i18n.t('common.status.loading')}</div>}
      >
        <Show
          when={props.templates.length > 0}
          fallback={(
            <div class="service-template-empty rounded-xl border border-dashed px-5 py-12 text-center">
              <p class="text-sm font-medium text-foreground">{props.query.trim() ? i18n.t('webServices.managed.noTemplateMatches') : i18n.t('webServices.managed.noTemplates')}</p>
              <Show when={props.query.trim()}>
                <Button size="sm" variant="ghost" class="mt-2" onClick={() => props.onQueryChange('')}>{i18n.t('webServices.managed.clearTemplateSearch')}</Button>
              </Show>
            </div>
          )}
        >
          <div class="space-y-6">
            <TemplateGroup
              {...props}
              title={i18n.t('webServices.managed.builtInTemplates')}
              description={i18n.t('webServices.managed.builtInTemplatesDescription')}
              templates={builtInTemplates()}
            />
            <TemplateGroup
              {...props}
              title={i18n.t('webServices.managed.customTemplates')}
              description={i18n.t('webServices.managed.customTemplatesDescription')}
              templates={customTemplates()}
            />
          </div>
        </Show>
      </Show>
    </section>
  );
}

function TemplateGroup(props: ServiceTemplateCatalogProps & {
  title: string;
  description: string;
  templates: readonly ServiceTemplatePresentation[];
}): JSX.Element {
  return (
    <Show when={props.templates.length > 0}>
      <section class="service-template-group" data-testid="service-template-group">
        <div class="mb-2.5 flex items-end justify-between gap-3 px-0.5">
          <div class="min-w-0">
            <h2 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{props.title}</h2>
            <p class="mt-1 text-[11px] leading-4 text-muted-foreground">{props.description}</p>
          </div>
          <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">{props.templates.length}</span>
        </div>
        <div class="space-y-3">
          <For each={props.templates}>{(template) => (
            <ServiceTemplateCard
              template={template}
              canManage={props.canManage}
              onDeploy={() => props.onDeploy(template.id)}
              onDuplicate={() => props.onDuplicate(template.id)}
              onEdit={() => props.onEdit(template.id)}
              onDelete={() => props.onDelete(template.id)}
            />
          )}</For>
        </div>
      </section>
    </Show>
  );
}
