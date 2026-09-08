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

export type ServiceTemplateCategory = 'host' | 'container';
export type ServiceTemplateKind = 'host' | 'container' | 'compose';

export type ServiceTemplateIcon = Readonly<{
  media_type: 'image/svg+xml';
  data: string;
  sha256: string;
}>;

export type ServiceTemplateRuntimeSpec = Readonly<{
  schema_version: 6;
  kind: ServiceTemplateKind;
  endpoint: Readonly<{
    scheme: 'http' | 'https';
    container_port?: number;
    fixed_host_port?: number;
    path?: string;
    health_path?: string;
    health_protocol?: string;
    startup_timeout_sec?: number;
  }>;
  parameters?: ReadonlyArray<Readonly<{ name: string; label: string; description?: string; type: 'text' | 'number' | 'boolean' | 'secret' | 'path'; required?: boolean; default?: string }>>;
  host?: Readonly<{
    after_start_script?: string;
    open_script?: string;
    output_mode?: 'discard' | 'private_file';
    install_script?: string;
    start_script: string;
    stop_script?: string;
    uninstall_script?: string;
    environment?: Readonly<Record<string, string>>;
    artifact?: Readonly<{ download_url: string; size_bytes: number; sha256: string; executable_rel_path: string }>;
    npm?: Readonly<{ package_name: string; version: string; registry_url: string; auth_token_parameter?: string; executable: string }>;
  }>;
  container?: Readonly<{
    image: string;
    entrypoint?: ReadonlyArray<string>;
    command?: ReadonlyArray<string>;
    environment?: Readonly<Record<string, string>>;
    labels?: Readonly<Record<string, string>>;
    restart_policy?: string;
    network_mode?: string;
    pid_mode?: string;
    ipc_mode?: string;
    ports?: ReadonlyArray<Readonly<{ resource_id?: string; container_port: number; host_port?: number; host_ip?: string; protocol?: string }>>;
    mounts?: ReadonlyArray<Readonly<{ resource_id?: string; type: 'workspace' | 'bind' | 'volume' | 'tmpfs'; source?: string; target: string; read_only?: boolean; tmpfs_options?: ReadonlyArray<string> }>>;
    cap_add?: ReadonlyArray<string>;
    cap_drop?: ReadonlyArray<string>;
    devices?: ReadonlyArray<Readonly<{ resource_id?: string; host_path: string; container_path?: string; permissions?: string }>>;
    privileged?: boolean;
    security_opts?: ReadonlyArray<string>;
    user?: string;
    read_only_root: boolean;
    memory_bytes?: number;
    cpus?: number;
    pids_limit?: number;
    shm_size_bytes?: number;
    runtime_profile?: 'restricted' | 'interactive_desktop';
  }>;
  compose?: Readonly<{ yaml: string; main_service: string }>;
}>;

export type HostLifecycleStep = Readonly<{
	kind: 'run_after_start_hook' | 'prepare_managed_directories' | 'prepare_verified_package' | 'run_locked_dependency_install' | 'prepare_verified_node_runtime' | 'install_npm_package_without_scripts' | 'remove_temporary_registry_credentials' | 'run_npm_lifecycle_scripts' | 'verify_npm_release_identity' | 'run_template_script' | 'launch_managed_runtime' | 'terminate_managed_process_group' | 'remove_managed_installation' | 'remove_managed_logs' | 'remove_managed_data_on_request';
  reference?: string;
  command_template?: string;
}>;

export type HostLifecycleActionPlan = Readonly<{
  ownership: 'none' | 'redeven' | 'template' | 'redeven_with_template_hook';
  steps: ReadonlyArray<HostLifecycleStep>;
}>;

export type HostLifecyclePlan = Readonly<{
  schema_version: 1;
	driver: 'host_script' | 'npm_host';
  runtime_bundle?: string;
	package?: Readonly<{
    reference: string;
    sha256: string;
    size_bytes: number;
	}>;
	npm?: Readonly<{ package_name: string; version: string; registry_url: string; executable: string }>;
  install: HostLifecycleActionPlan;
  start: HostLifecycleActionPlan;
  open?: HostLifecycleActionPlan;
  output_mode?: 'discard' | 'private_file';
  stop: HostLifecycleActionPlan;
  uninstall: HostLifecycleActionPlan;
}>;

export type ServiceTemplatePresentation = Readonly<{
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  kind: ServiceTemplateKind;
  icon?: ServiceTemplateIcon;
  deploymentLabel: string;
  defaultReleaseLabel?: string;
  revision: number;
  diskBytes?: number;
  dataLocation?: string;
  sourceURL?: string;
  dockerSourceURL?: string;
  defaultWorkspacePath?: string;
  defaultAccessMode?: string;
  runtimeSpec?: ServiceTemplateRuntimeSpec;
  hostLifecyclePlan?: HostLifecyclePlan;
  developerPreview: boolean;
  available: boolean;
  availabilityReason?: string;
  installed: boolean;
  openable?: boolean;
  openUnavailableReason?: string;
  duplicateable: boolean;
  editable: boolean;
}>;

function formatTemplateBytes(value: number | undefined, locale: string): string {
  if (!value || value <= 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(amount)} ${units[unit]}`;
}

function DetailField(props: { label: string; value: JSX.Element | string | number | undefined; mono?: boolean; wide?: boolean }): JSX.Element {
  const value = () => props.value === undefined || props.value === '' ? '—' : props.value;
  return (
    <div class={cn('service-template-detail-field min-w-0', props.wide && 'service-template-detail-field--wide')}>
      <dt class="text-[10px] font-medium leading-4 text-muted-foreground">{props.label}</dt>
      <dd class={cn('mt-0.5 min-w-0 break-words text-xs leading-5 text-foreground', props.mono && 'font-mono text-[11px]')} title={typeof props.value === 'string' ? props.value : undefined}>
        {value()}
      </dd>
    </div>
  );
}

function DetailSection(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="service-template-detail-section" data-testid="service-template-detail-section">
      <h3 class="text-[11px] font-semibold leading-5 text-foreground">{props.title}</h3>
      <dl class="service-template-detail-grid mt-2">{props.children}</dl>
    </section>
  );
}

function endpointAddress(spec: ServiceTemplateRuntimeSpec): string {
  const endpoint = spec.endpoint;
  const port = endpoint.container_port || endpoint.fixed_host_port;
  return `${endpoint.scheme.toUpperCase()}${port ? ` · ${port}` : ''} · ${endpoint.path || '/'}`;
}

function commandLine(parts: readonly string[] | undefined): string {
  return parts?.filter(Boolean).join(' ') || '—';
}

type ServiceTemplateMount = NonNullable<NonNullable<ServiceTemplateRuntimeSpec['container']>['mounts']>[number];

function mountLine(mount: ServiceTemplateMount): string {
  const source = mount.type === 'workspace'
    ? '${WORKSPACE}'
    : mount.type === 'tmpfs'
      ? 'tmpfs'
      : mount.source || mount.resource_id || mount.type;
  return `${source} → ${mount.target}${mount.read_only ? ' · ro' : ''}`;
}

function EndpointTemplateDetails(props: { spec: ServiceTemplateRuntimeSpec }): JSX.Element {
  const i18n = useI18n();
  return (
    <DetailSection title={i18n.t('webServices.managed.endpointSettings')}>
      <DetailField label={i18n.t('webServices.managed.details.endpoint')} value={endpointAddress(props.spec)} mono wide />
      <DetailField label={i18n.t('webServices.managed.healthPath')} value={`${props.spec.endpoint.health_protocol || props.spec.endpoint.scheme} ${props.spec.endpoint.health_path || '/'}`} mono />
      <DetailField label={i18n.t('webServices.managed.details.startupTimeout')} value={props.spec.endpoint.startup_timeout_sec ? `${props.spec.endpoint.startup_timeout_sec}s` : '—'} />
    </DetailSection>
  );
}

function ContainerTemplateDetails(props: { spec: ServiceTemplateRuntimeSpec }): JSX.Element {
  const i18n = useI18n();
  const container = () => props.spec.container;
  const environmentNames = () => Object.keys(container()?.environment ?? {}).sort();
  return (
    <>
      <EndpointTemplateDetails spec={props.spec} />
      <DetailSection title={i18n.t('webServices.managed.serviceRuntimeSettings')}>
        <DetailField label={i18n.t('webServices.managed.containerImage')} value={container()?.image} mono wide />
        <DetailField label={i18n.t('webServices.managed.entrypoint')} value={commandLine(container()?.entrypoint)} mono />
        <DetailField label={i18n.t('webServices.managed.commandArguments')} value={commandLine(container()?.command)} mono />
        <DetailField label={i18n.t('webServices.managed.settings.containerUser')} value={container()?.user || 'root'} mono />
        <DetailField label={i18n.t('webServices.managed.settings.restartPolicy')} value={container()?.restart_policy} mono />
        <DetailField label={i18n.t('webServices.managed.details.runtimeProfile')} value={container()?.runtime_profile || 'restricted'} mono />
        <DetailField label={i18n.t('webServices.managed.environmentVariables')} value={environmentNames().join(', ') || '—'} mono wide />
        <Show when={Object.keys(container()?.labels ?? {}).length > 0}>
          <DetailField label={i18n.t('webServices.managed.settings.labels')} value={Object.keys(container()?.labels ?? {}).sort().join(', ')} mono wide />
        </Show>
      </DetailSection>
      <Show when={(container()?.mounts?.length ?? 0) > 0}>
        <DetailSection title={i18n.t('webServices.managed.settings.section.storage')}>
          <For each={container()?.mounts ?? []}>{(mount) => (
            <DetailField label={mount.type} value={mountLine(mount)} mono wide />
          )}</For>
        </DetailSection>
      </Show>
      <DetailSection title={i18n.t('webServices.managed.settings.section.resources')}>
        <DetailField label={i18n.t('webServices.managed.settings.cpus')} value={container()?.cpus || '—'} />
        <DetailField label={i18n.t('webServices.managed.settings.memoryBytes')} value={formatTemplateBytes(container()?.memory_bytes, i18n.locale())} />
        <DetailField label={i18n.t('webServices.managed.settings.pidsLimit')} value={container()?.pids_limit || '—'} />
        <DetailField label={i18n.t('webServices.managed.settings.sharedMemoryBytes')} value={formatTemplateBytes(container()?.shm_size_bytes, i18n.locale())} />
      </DetailSection>
      <DetailSection title={i18n.t('webServices.managed.settings.section.network')}>
        <DetailField label={i18n.t('webServices.managed.settings.networkMode')} value={container()?.network_mode} mono />
        <Show when={container()?.pid_mode}>
          <DetailField label={i18n.t('webServices.managed.settings.pidMode')} value={container()?.pid_mode} mono />
        </Show>
        <Show when={container()?.ipc_mode}>
          <DetailField label={i18n.t('webServices.managed.settings.ipcMode')} value={container()?.ipc_mode} mono />
        </Show>
        <Show when={(container()?.ports?.length ?? 0) > 0}>
          <DetailField
            label={i18n.t('webServices.managed.settings.additionalPorts')}
            value={(container()?.ports ?? []).map((port) => `${port.host_ip || '127.0.0.1'}:${port.host_port || 0} → ${port.container_port}/${port.protocol || 'tcp'}`).join(' · ')}
            mono
            wide
          />
        </Show>
      </DetailSection>
      <DetailSection title={i18n.t('webServices.managed.settings.section.security')}>
        <DetailField label={i18n.t('webServices.managed.settings.readOnlyRoot')} value={container()?.read_only_root ? i18n.t('common.actions.yes') : i18n.t('common.actions.no')} />
        <DetailField label={i18n.t('webServices.managed.settings.privileged')} value={container()?.privileged ? i18n.t('common.actions.yes') : i18n.t('common.actions.no')} />
        <Show when={(container()?.cap_add?.length ?? 0) > 0}>
          <DetailField label={i18n.t('webServices.managed.settings.capAdd')} value={container()?.cap_add?.join(', ')} mono wide />
        </Show>
        <Show when={(container()?.cap_drop?.length ?? 0) > 0}>
          <DetailField label={i18n.t('webServices.managed.settings.capDrop')} value={container()?.cap_drop?.join(', ')} mono wide />
        </Show>
        <Show when={(container()?.devices?.length ?? 0) > 0}>
          <DetailField
            label={i18n.t('webServices.managed.settings.devices')}
            value={(container()?.devices ?? []).map((device) => `${device.host_path} → ${device.container_path || device.host_path}${device.permissions ? ` · ${device.permissions}` : ''}`).join(' · ')}
            mono
            wide
          />
        </Show>
        <DetailField label={i18n.t('webServices.managed.settings.securityOptions')} value={container()?.security_opts?.join(', ')} mono wide />
      </DetailSection>
    </>
  );
}

type HostLifecycleAction = 'open' | 'install' | 'start' | 'stop' | 'uninstall';

function lifecycleActionLabel(action: HostLifecycleAction, i18n: ReturnType<typeof useI18n>): string {
  if (action === 'open') return i18n.t('webServices.managed.openScript');
  return i18n.t(`webServices.managed.lifecycleAction.${action}` as Parameters<typeof i18n.t>[0]);
}

function lifecycleOwnershipLabel(ownership: HostLifecycleActionPlan['ownership'], i18n: ReturnType<typeof useI18n>): string {
  return i18n.t(`webServices.managed.lifecycleOwnership.${ownership}` as Parameters<typeof i18n.t>[0]);
}

function lifecycleStepLabel(step: HostLifecycleStep, action: HostLifecycleAction, managedInstall: boolean, i18n: ReturnType<typeof useI18n>): string {
  if (step.kind === 'run_after_start_hook') return i18n.t('webServices.managed.afterStartScript');
  if (step.kind === 'run_template_script') {
    if (action === 'open') return i18n.t('webServices.managed.openScript');
    if (action === 'install') return i18n.t(managedInstall ? 'webServices.managed.lifecycleStep.afterInstallHook' : 'webServices.managed.lifecycleStep.installScript');
    if (action === 'start') return i18n.t('webServices.managed.lifecycleStep.startScript');
    if (action === 'stop') return i18n.t('webServices.managed.lifecycleStep.beforeStopHook');
    return i18n.t('webServices.managed.lifecycleStep.beforeUninstallHook');
  }
  return i18n.t(`webServices.managed.lifecycleStep.${step.kind}` as Parameters<typeof i18n.t>[0]);
}

function actionPlan(plan: HostLifecyclePlan, action: HostLifecycleAction): HostLifecycleActionPlan {
  return plan[action] ?? { ownership: 'none', steps: [] };
}

export function HostLifecyclePlanDetails(props: {
  plan: HostLifecyclePlan;
  templateCommands?: 'show' | 'reference';
}): JSX.Element {
  const i18n = useI18n();
  const actions = (): readonly HostLifecycleAction[] => ['install', 'start', ...(props.plan.open ? ['open' as const] : []), 'stop', 'uninstall'];
  const managedInstall = () => props.plan.install.steps.some((step) => step.kind === 'prepare_verified_package');
  const templateCommands = () => props.templateCommands ?? 'show';

  return (
    <section class="service-template-lifecycle-plan" data-testid="host-lifecycle-plan">
      <div class="service-template-lifecycle-plan__heading">
        <h3 class="text-[11px] font-semibold leading-5 text-foreground">{i18n.t('webServices.managed.managedLifecycle')}</h3>
        <p class="mt-1 text-[11px] leading-4 text-muted-foreground">{i18n.t('webServices.managed.managedLifecycleDescription')}</p>
      </div>
      <dl class="service-template-detail-grid mt-3">
        <DetailField label={i18n.t('webServices.managed.details.lifecycleDriver')} value={props.plan.driver} mono />
        <Show when={props.plan.runtime_bundle}>
          <DetailField label={i18n.t('webServices.managed.details.runtimeBundle')} value={props.plan.runtime_bundle} mono />
        </Show>
        <Show when={props.plan.package}>{(pkg) => (
          <>
            <DetailField label={i18n.t('webServices.managed.softwarePackage')} value={pkg().reference} mono wide />
            <DetailField label="SHA-256" value={pkg().sha256} mono wide />
            <DetailField label={i18n.t('webServices.managed.disk')} value={formatTemplateBytes(pkg().size_bytes, i18n.locale())} />
          </>
        )}</Show>
      </dl>
      <div class="service-template-lifecycle-plan__actions mt-3 grid gap-2">
        <For each={actions()}>{(action) => {
          const current = () => actionPlan(props.plan, action);
          return (
            <div class="service-template-lifecycle-action rounded-md border px-3 py-2.5" data-lifecycle-action={action}>
              <div class="flex min-w-0 items-center justify-between gap-3">
                <h4 class="text-xs font-medium text-foreground">{lifecycleActionLabel(action, i18n)}</h4>
                <span class="shrink-0 text-[10px] font-medium text-muted-foreground">{lifecycleOwnershipLabel(current().ownership, i18n)}</span>
              </div>
              <Show when={current().steps.length > 0} fallback={<p class="mt-1.5 text-[11px] leading-4 text-muted-foreground">{i18n.t('webServices.managed.noAdditionalCommand')}</p>}>
                <ol class="mt-2 grid gap-2">
                  <For each={current().steps}>{(step, index) => (
                    <li class="service-template-lifecycle-step min-w-0 text-[11px] leading-4 text-muted-foreground">
                      <div class="flex min-w-0 gap-2">
                        <span class="service-template-lifecycle-step__index flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] tabular-nums">{index() + 1}</span>
                        <div class="min-w-0 flex-1">
                          <span>{lifecycleStepLabel(step, action, managedInstall(), i18n)}</span>
                          <Show when={step.reference}>
                            <code class="mt-1 block break-all text-[10px] leading-4 text-foreground">{step.reference}</code>
                          </Show>
                          <Show when={step.command_template && (step.kind !== 'run_template_script' || templateCommands() === 'show')}>
                            <code class="service-template-lifecycle-step__command mt-1 block whitespace-pre-wrap break-words rounded px-2 py-1.5 text-[10px] leading-4 text-foreground">{step.command_template}</code>
                          </Show>
                          <Show when={step.kind === 'run_template_script' && templateCommands() === 'reference'}>
                            <span class="mt-1 block text-[10px] leading-4 text-muted-foreground">{i18n.t('webServices.managed.editableCommandBelow')}</span>
                          </Show>
                        </div>
                      </div>
                    </li>
                  )}</For>
                </ol>
              </Show>
            </div>
          );
        }}</For>
      </div>
    </section>
  );
}

function HostTemplateDetails(props: { spec: ServiceTemplateRuntimeSpec; plan?: HostLifecyclePlan }): JSX.Element {
  return (
    <>
      <EndpointTemplateDetails spec={props.spec} />
      <Show when={props.plan}>{(plan) => <HostLifecyclePlanDetails plan={plan()} />}</Show>
    </>
  );
}

function ComposeTemplateDetails(props: { spec: ServiceTemplateRuntimeSpec }): JSX.Element {
  const i18n = useI18n();
  return (
    <>
      <EndpointTemplateDetails spec={props.spec} />
      <DetailSection title={i18n.t('webServices.managed.serviceRuntimeSettings')}>
        <DetailField label={i18n.t('webServices.managed.composeMainService')} value={props.spec.compose?.main_service} mono />
        <DetailField label={i18n.t('webServices.managed.composeYAML')} value={props.spec.compose?.yaml.split('\n').length ?? 0} mono />
      </DetailSection>
    </>
  );
}

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
	onOpen: (templateID: string) => void;
	onVersions?: (templateID: string) => void;
  onDuplicate: (templateID: string) => void;
  onEdit: (templateID: string) => void;
  onDelete: (templateID: string) => void;
}>;

function templateIconSource(icon: ServiceTemplateIcon | undefined): string | undefined {
  if (!icon || icon.media_type !== 'image/svg+xml') return undefined;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.data)}`;
}

function TemplateKindIcon(props: { kind: ServiceTemplateKind; icon?: ServiceTemplateIcon; class?: string }): JSX.Element {
  const source = () => templateIconSource(props.icon);
  if (source()) return <img src={source()} class={props.class} alt="" aria-hidden="true" />;
  if (props.kind === 'host') return <Cpu class={props.class} aria-hidden="true" />;
  if (props.kind === 'compose') return <Layers class={props.class} aria-hidden="true" />;
  return <Package class={props.class} aria-hidden="true" />;
}

function templateIconClass(icon: ServiceTemplatePresentation['icon'], compact = false): string {
  if (icon) return compact ? 'h-6 w-6 object-contain' : 'h-7 w-7 object-contain';
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
        class={cn('service-template-identity__icon flex shrink-0 items-center justify-center border', props.compact ? 'h-9 w-9 rounded-lg' : 'h-12 w-12 rounded-xl', props.template.icon && 'service-template-identity__icon--brand')}
        data-template-kind={props.template.kind}
      >
        <TemplateKindIcon kind={props.template.kind} icon={props.template.icon} class={templateIconClass(props.template.icon)} />
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
          <Show when={props.template.defaultReleaseLabel}>
            <span aria-hidden="true">·</span>
            <span class="font-mono">v{props.template.defaultReleaseLabel}</span>
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
          class={cn('service-template-identity__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', props.template.icon && 'service-template-identity__icon--brand')}
          data-template-kind={props.template.kind}
        >
          <TemplateKindIcon kind={props.template.kind} icon={props.template.icon} class={templateIconClass(props.template.icon, true)} />
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
              <Show when={props.template.defaultReleaseLabel}>
                <span aria-hidden="true">·</span>
                <span class="shrink-0 font-mono">v{props.template.defaultReleaseLabel}</span>
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
	onOpen: () => void;
	onVersions?: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const menuItems = (): DropdownItem[] => [
    ...(props.template.installed ? [{
      id: 'open',
      label: props.template.openUnavailableReason
        ? `${i18n.t('webServices.actions.open')} · ${props.template.openUnavailableReason}`
        : i18n.t('webServices.actions.open'),
      disabled: !props.template.openable,
    }] : []),
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
    if (id === 'open') props.onOpen();
    else if (id === 'duplicate') props.onDuplicate();
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
          class={cn('service-template-details__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', props.template.icon && 'service-template-identity__icon--brand')}
          data-template-kind={props.template.kind}
        >
          <TemplateKindIcon kind={props.template.kind} icon={props.template.icon} class={templateIconClass(props.template.icon)} />
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

      <div class="service-template-details__body">
        <DetailSection title={i18n.t('webServices.managed.deploymentInformation')}>
          <DetailField label={i18n.t('webServices.managed.deployment')} value={props.template.deploymentLabel} />
          <DetailField
            label={i18n.t(props.template.source === 'builtin' ? 'webServices.managed.recommendedVersion' : 'webServices.managed.defaultVersion')}
            value={props.template.defaultReleaseLabel ? `v${props.template.defaultReleaseLabel}` : i18n.t('webServices.managed.customVersion')}
            mono
          />
          <DetailField label={i18n.t('webServices.managed.details.templateRevision')} value={props.template.revision} />
          <DetailField label={i18n.t('webServices.managed.settings.accessMode')} value={props.template.defaultAccessMode || '—'} mono />
          <Show when={(props.template.runtimeSpec?.parameters?.length ?? 0) > 0}>
            <DetailField label={i18n.t('webServices.managed.settings.templateParameters')} value={props.template.runtimeSpec?.parameters?.map((parameter) => parameter.name).join(', ')} mono wide />
          </Show>
          <Show when={props.template.diskBytes}>
            <DetailField label={i18n.t('webServices.managed.disk')} value={formatTemplateBytes(props.template.diskBytes, i18n.locale())} />
          </Show>
          <Show when={props.template.defaultWorkspacePath}>
            <DetailField label={i18n.t('webServices.managed.defaultWorkspace')} value={props.template.defaultWorkspacePath} mono wide />
          </Show>
          <Show when={props.template.dataLocation}>
            <DetailField label={i18n.t('webServices.managed.dataLocation')} value={props.template.dataLocation} mono wide />
          </Show>
        </DetailSection>

        <Show when={props.template.runtimeSpec}>{(spec) => (
          <Show when={spec().kind === 'container'} fallback={(
            <Show when={spec().kind === 'host'} fallback={<ComposeTemplateDetails spec={spec()} />}>
              <HostTemplateDetails spec={spec()} plan={props.template.hostLifecyclePlan} />
            </Show>
          )}>
            <ContainerTemplateDetails spec={spec()} />
          </Show>
        )}</Show>

        <Show when={props.template.sourceURL || props.template.dockerSourceURL}>
          <div class="service-template-detail-links flex flex-wrap gap-x-4 gap-y-2">
            <Show when={props.template.sourceURL}>
              <a href={props.template.sourceURL} target="_blank" rel="noreferrer" class="text-xs font-medium text-primary hover:underline">{i18n.t('webServices.managed.sourceCode')}</a>
            </Show>
            <Show when={props.template.dockerSourceURL}>
              <a href={props.template.dockerSourceURL} target="_blank" rel="noreferrer" class="text-xs font-medium text-primary hover:underline">{i18n.t('webServices.managed.containerImageSource')}</a>
            </Show>
          </div>
        </Show>

        <div class="service-template-details__status">
          <ServiceTemplateStatus template={props.template} detailed />
        </div>
      </div>

      <div class="service-template-details__actions flex items-center gap-2">
		<Show when={props.template.kind === 'container' || Boolean(props.template.runtimeSpec?.host?.npm)}>
			<Button size="sm" variant="outline" class="min-h-11 shrink-0 px-3 sm:min-h-9" onClick={() => props.onVersions?.()} disabled={!props.canManage}>
				<Package class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{i18n.t('webServices.managed.versions')}
			</Button>
		</Show>
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
              disabled={!props.template.installed && menuItems().every((item) => item.disabled)}
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
					  onOpen={() => props.onOpen(template.id)}
					  onVersions={() => props.onVersions?.(template.id)}
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
