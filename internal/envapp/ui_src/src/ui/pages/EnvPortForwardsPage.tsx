import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { AlertTriangle, ExternalLink, FileText, FolderOpen, Globe, MoreHorizontal, Plus, RefreshIcon, Save, Search, ShieldCheck, Trash, Play, Stop, Refresh } from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dropdown,
  Input,
  Textarea,
  Tag,
  type DropdownItem,
  type TagProps,
} from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import { LazyMountedDirectoryPicker } from '../primitives/LazyMountedPickers';

import {
  getEnvPublicIDFromSession,
  getLocalRuntime,
  mintEnvEntryTicketForApp,
  type LocalRuntimeInfo,
} from '../services/controlplaneApi';
import {
  readDesktopSessionContextSnapshot,
  type DesktopSessionContextSnapshot,
} from '../services/desktopSessionContext';
import { FLOE_APP_PORT_FORWARD } from '../services/floeproxyContract';
import { fetchLocalApi, fetchLocalApiJSON } from '../services/localApi';
import { readUIStorageJSON, removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';
import { trustedLauncherOriginFromSandboxLocation } from '../services/sandboxOrigins';
import { registerSandboxWindow } from '../services/sandboxWindowRegistry';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { Tooltip } from '../primitives/Tooltip';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { useI18n, type EnvAppTranslationKey, type I18nHelpers } from '../i18n';
import { useEnvContext } from './EnvContext';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { EnvCollectionLoadingSkeleton } from './EnvCollectionLoadingSkeleton';
import { createDirectoryPickerDataSource } from '../../../../../flower_ui/src/filePicker/createDirectoryPickerDataSource';
import {
  ServiceTemplateCatalog,
  ServiceTemplateIdentity,
  type ServiceTemplateCategory,
  type ServiceTemplateKind,
  type ServiceTemplatePresentation,
} from './ServiceTemplateCatalog';
import {
  desktopShellWebServiceWindowOpenAvailable,
  openWebServiceWindowInDesktopShell,
} from '../services/desktopShellBridge';

// ============================================================================
// Types
// ============================================================================

type Health = Readonly<{
  status: 'healthy' | 'unreachable' | 'unknown';
  last_checked_at_unix_ms: number;
  latency_ms: number;
  last_error: string;
}>;

type PortForward = Readonly<{
  forward_id: string;
  target_url: string;
  name: string;
  description: string;
  health_path: string;
  insecure_skip_verify: boolean;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  last_opened_at_unix_ms: number;
  health: Health;
}>;

type ForwardSession = Readonly<{
  forward: PortForward;
  app_path: string;
  ephemeral: boolean;
}>;

type ManagedService = Readonly<{
  service_id: string;
  template_id: string;
  service_family_id: string;
  name: string;
  description?: string;
  template_source: 'builtin' | 'custom';
  deployment: ManagedDeployment;
  workspace_path: string;
  version: string;
  desired_state: string;
  observed_state: string;
  forward_id: string;
  runtime_port: number;
  last_error_code?: string;
  last_error_message?: string;
  brand_icon?: ManagedBrandIcon;
  localization_key?: string;
  update_available: boolean;
  target_revision?: number;
  target_version?: string;
  update_notices?: ReadonlyArray<ManagedTemplateNotice>;
  active_operation?: ManagedOperation;
  container_resource?: Readonly<{
    engine: 'docker';
    endpoint_id?: string;
    view: 'containers' | 'compose-projects';
    identity: string;
  }>;
}>;

type ManagedDeployment = 'native' | 'docker' | 'host' | 'container' | 'compose';
type ManagedBrandIcon = 'deepseek-harness' | 'interactive-desktop';
type ManagedTemplateNotice = Readonly<{
  id: string;
  revision: number;
  severity: 'info' | 'warning';
  title_key: string;
  description_key: string;
  acknowledgement_required: boolean;
}>;

type ManagedTemplateSpec = Readonly<{
  schema_version: 1;
  kind: 'host' | 'container' | 'compose';
  endpoint: Readonly<{ scheme: 'http' | 'https'; container_port?: number; fixed_host_port?: number; path?: string; health_path?: string; startup_timeout_sec?: number }>;
  parameters?: ReadonlyArray<Readonly<{ name: string; label: string; description?: string; type: 'text' | 'number' | 'boolean' | 'secret' | 'path'; required?: boolean; default?: string }>>;
  host?: Readonly<{ install_script?: string; start_script: string; stop_script?: string; uninstall_script?: string; artifact?: Readonly<{ download_url: string; size_bytes: number; sha256: string; executable_rel_path: string }>; runtime_bundle?: string }>;
  container?: Readonly<{ image: string; entrypoint?: ReadonlyArray<string>; command?: ReadonlyArray<string>; environment?: Readonly<Record<string, string>>; mounts?: ReadonlyArray<Readonly<{ type: 'workspace' | 'bind' | 'volume' | 'tmpfs'; source?: string; target: string; read_only?: boolean }>>; user?: string; read_only_root: boolean; memory_bytes?: number; cpus?: number; pids_limit?: number; runtime_profile?: 'restricted' | 'interactive_desktop' }>;
  compose?: Readonly<{ yaml: string; main_service: string }>;
}>;

type ManagedCatalogTemplate = Readonly<{
  template_id: string;
  name: string;
  description: string;
  version: string;
  developer_preview: boolean;
  disk_bytes: number;
  data_location: string;
  source_url: string;
  docker_source_url: string;
  brand_icon?: ManagedBrandIcon;
  localization_key?: string;
  notices?: ReadonlyArray<ManagedTemplateNotice>;
  source: 'builtin' | 'custom';
  deployment: ManagedDeployment;
  container_mode?: 'single' | 'compose';
  revision: number;
  editable: boolean;
  duplicateable: boolean;
  derived_from_template_id?: string;
  service_family_id: string;
  available: boolean;
  reason_code?: string;
  reason?: string;
  deployments: ReadonlyArray<{ deployment: ManagedDeployment; available: boolean; reason_code?: string; reason?: string }>;
  default_workspace_path: string;
  workspace_roots: ReadonlyArray<{ id: string; label: string; path: string }>;
  spec?: ManagedTemplateSpec;
}>;

type ManagedOperation = Readonly<{ operation_id: string; service_id: string; state: string; stage: string; progress_current: number; progress_total: number; error_message?: string }>;
type ManagedUninstallRequest = Readonly<{ service: ManagedService; deleteData: boolean }>;
type TemplateDrawerView = 'catalog' | 'install' | 'editor';
type TemplateEditorDraft = {
  templateID?: string;
  name: string;
  description: string;
  version: string;
  kind: 'host' | 'container' | 'compose';
  scheme: 'http' | 'https';
  path: string;
  healthPath: string;
  containerPort: string;
  installScript: string;
  startScript: string;
  stopScript: string;
  uninstallScript: string;
  image: string;
  entrypoint: string;
  command: string;
  environment: string;
  composeYAML: string;
  mainService: string;
  originalSpec?: ManagedTemplateSpec;
};

function emptyTemplateDraft(kind: 'host' | 'container' | 'compose'): TemplateEditorDraft {
  return {
    name: '', description: '', version: '', kind, scheme: 'http', path: '/', healthPath: '/', containerPort: '3000',
    installScript: '', startScript: kind === 'host' ? 'exec your-server --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT"' : '', stopScript: '', uninstallScript: '',
    image: '', entrypoint: '', command: '', environment: '',
    composeYAML: 'services:\n  web:\n    image: nginx:stable-alpine\n', mainService: 'web',
  };
}

function draftFromTemplate(template: ManagedCatalogTemplate): TemplateEditorDraft {
  const spec = template.spec;
  const kind = spec?.kind ?? (template.deployment === 'native' ? 'host' : template.deployment === 'docker' ? 'container' : template.deployment as 'host' | 'container' | 'compose');
  const draft = emptyTemplateDraft(kind);
  return {
    ...draft,
    templateID: template.template_id,
    name: template.name,
    description: template.description ?? '',
    version: template.version ?? '',
    scheme: spec?.endpoint.scheme ?? 'http',
    path: spec?.endpoint.path ?? '/',
    healthPath: spec?.endpoint.health_path ?? '/',
    containerPort: String(spec?.endpoint.container_port ?? 3000),
    installScript: spec?.host?.install_script ?? '',
    startScript: spec?.host?.start_script ?? draft.startScript,
    stopScript: spec?.host?.stop_script ?? '',
    uninstallScript: spec?.host?.uninstall_script ?? '',
    image: spec?.container?.image ?? '',
    entrypoint: spec?.container?.entrypoint?.[0] ?? '',
    command: spec?.container?.command?.join('\n') ?? '',
    environment: Object.entries(spec?.container?.environment ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    composeYAML: spec?.compose?.yaml ?? draft.composeYAML,
    mainService: spec?.compose?.main_service ?? draft.mainService,
    originalSpec: spec,
  };
}

function parseTemplateEnvironment(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('TEMPLATE_ENV_INVALID');
    result[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return result;
}

function templateRequestFromDraft(draft: TemplateEditorDraft, requestID: string) {
  const original = draft.originalSpec;
  const endpoint = {
    ...(original?.endpoint ?? {}),
    scheme: draft.scheme,
    path: draft.path.trim() || '/',
    health_path: draft.healthPath.trim() || '/',
    startup_timeout_sec: original?.endpoint.startup_timeout_sec || 60,
    ...(draft.kind === 'host' ? {} : { container_port: Number(draft.containerPort) }),
  };
  const common = { schema_version: 1 as const, kind: draft.kind, endpoint, parameters: original?.parameters ?? [] };
  const spec: ManagedTemplateSpec = draft.kind === 'host'
    ? { ...common, host: { install_script: draft.installScript, start_script: draft.startScript, stop_script: draft.stopScript, uninstall_script: draft.uninstallScript, ...(original?.host?.artifact ? { artifact: original.host.artifact } : {}), ...(original?.host?.runtime_bundle ? { runtime_bundle: original.host.runtime_bundle } : {}) } }
    : draft.kind === 'container'
      ? { ...common, container: { image: draft.image.trim(), entrypoint: draft.entrypoint.trim() ? [draft.entrypoint.trim()] : [], command: draft.command.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean), environment: parseTemplateEnvironment(draft.environment), mounts: original?.container?.mounts ?? [{ type: 'workspace', target: '/workspace' }, { type: 'volume', source: 'data', target: '/data' }, { type: 'tmpfs', target: '/tmp' }], user: original?.container?.user ?? '', read_only_root: true, memory_bytes: original?.container?.memory_bytes, cpus: original?.container?.cpus, pids_limit: original?.container?.pids_limit || 512 } }
      : { ...common, compose: { yaml: draft.composeYAML, main_service: draft.mainService.trim() } };
  return { request_id: requestID, name: draft.name.trim(), description: draft.description.trim(), version: draft.version.trim(), spec };
}

export type WebServiceOpenRoute =
  | Readonly<{ kind: 'browser_direct'; url: string; label: 'Direct' }>
  | Readonly<{ kind: 'local_proxy'; url: string; label: 'Local proxy' }>
  | Readonly<{ kind: 'e2ee_tunnel'; forward_id: string; label: 'Secure tunnel' }>;

type BrowserLocationLike = Pick<Location, 'hostname' | 'href' | 'origin'>;
type WebServicesI18n = Pick<I18nHelpers, 'formatDateTime' | 'formatRelativeTime' | 't'>;

// ============================================================================
// Utility Functions
// ============================================================================

function fmtRelativeTime(ms: number, i18n: WebServicesI18n): string {
  if (!ms) return i18n.t('webServices.time.never');
  try {
    return i18n.formatRelativeTime(ms);
  } catch {
    return String(ms);
  }
}

function fmtTime(ms: number, i18n: WebServicesI18n): string {
  if (!ms) return i18n.t('webServices.time.never');
  try {
    return i18n.formatDateTime(ms);
  } catch {
    return String(ms);
  }
}

function portForwardOrigin(forwardID: string): string {
  return trustedLauncherOriginFromSandboxLocation(window.location, 'pf', forwardID);
}

function base64UrlEncode(raw: string): string {
  const b64 = btoa(raw);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function parseSupportedWebServiceTarget(raw: string): URL | null {
  const trimmed = compact(raw);
  if (!trimmed) return null;
  const portMatch = trimmed.match(/^(\d{1,5})([/?#].*)?$/u);
  const shorthand = portMatch ? `localhost:${portMatch[1]}${portMatch[2] ?? ''}` : trimmed.startsWith(':') ? `localhost${trimmed}` : trimmed;
  const candidate = shorthand.includes('://') ? shorthand : `http://${shorthand}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!isLoopbackHostname(parsed.hostname)) return null;
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return parsed;
}

export function isSupportedWebServiceTarget(raw: string): boolean {
  return parseSupportedWebServiceTarget(raw) !== null;
}

function normalizedHostname(hostname: string): string {
  return compact(hostname).toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
}

function hasSameDeviceBrowserConfidence(desktopContext: DesktopSessionContextSnapshot | null | undefined): boolean {
  if (!desktopContext?.target_kind) return true;
  return desktopContext.target_kind === 'local_environment' && desktopContext.target_route === 'local_host';
}

function normalizeAppPath(value: string | undefined): string {
  const raw = compact(value) || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function localWebServiceProxyURL(forwardID: string, appPath: string, locationLike: BrowserLocationLike): string {
  const navigation = new URL(normalizeAppPath(appPath), 'http://redeven.invalid');
  const base = new URL(`/pf/${encodeURIComponent(forwardID)}/`, locationLike.origin || locationLike.href);
  base.pathname += navigation.pathname.replace(/^\//u, '');
  base.search = navigation.search;
  base.hash = navigation.hash;
  return base.toString();
}

export function resolveWebServiceOpenRoute(args: Readonly<{
  forwardID: string;
  targetURL: string;
  localRuntime: LocalRuntimeInfo | null;
  desktopContext?: DesktopSessionContextSnapshot | null;
  browserLocation?: BrowserLocationLike;
  appPath?: string;
  preferIsolatedDesktop?: boolean;
}>): WebServiceOpenRoute {
  const forwardID = compact(args.forwardID);
  if (!args.localRuntime) {
    return { kind: 'e2ee_tunnel', forward_id: forwardID, label: 'Secure tunnel' };
  }

  const locationLike = args.browserLocation ?? window.location;
  const targetURL = parseSupportedWebServiceTarget(args.targetURL);
  if (
    targetURL
    && !args.preferIsolatedDesktop
    && hasSameDeviceBrowserConfidence(args.desktopContext)
    && isLoopbackHostname(locationLike.hostname)
    && isLoopbackHostname(targetURL.hostname)
  ) {
    return {
      kind: 'browser_direct',
      url: normalizeAppPath(args.appPath) === '/' ? targetURL.origin : new URL(normalizeAppPath(args.appPath), targetURL.origin).toString(),
      label: 'Direct',
    };
  }

  return { kind: 'local_proxy', url: localWebServiceProxyURL(forwardID, normalizeAppPath(args.appPath), locationLike), label: 'Local proxy' };
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * InlineButtonSnakeLoading - A compact snake loader for button loading states
 */
function InlineButtonSnakeLoading(props: { class?: string }) {
  return (
    <span class={cn('relative inline-flex w-4 h-4 shrink-0', props.class)} aria-hidden="true">
      <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.66] origin-center">
        <SnakeLoader size="sm" />
      </span>
    </span>
  );
}

/**
 * HealthBadge - Displays the health status with appropriate styling and animation
 */
function HealthBadge(props: { health?: Health }) {
  const status = () => props.health?.status ?? 'unknown';
  const latency = () => props.health?.latency_ms;
  const lastError = () => props.health?.last_error;
  const i18n = useI18n();

  const badgeVariant = (): TagProps['variant'] => {
    switch (status()) {
      case 'healthy':
        return 'success';
      case 'unreachable':
        return 'error';
      default:
        return 'neutral';
    }
  };

  const label = () => {
    switch (status()) {
      case 'healthy':
        return i18n.t('webServices.health.healthy');
      case 'unreachable':
        return i18n.t('webServices.health.unreachable');
      default:
        return i18n.t('webServices.health.unknown');
    }
  };

  const tooltipContent = () => {
    const parts: string[] = [];
    if (status() === 'healthy' && latency()) {
      parts.push(i18n.t('webServices.health.latency', { latency: latency() ?? 0 }));
    }
    if (lastError()) {
      parts.push(`${i18n.t('webServices.health.error')}: ${lastError()}`);
    }
    return parts.length > 0 ? parts.join('\n') : i18n.t('webServices.health.status', { status: label() });
  };

  return (
    <Tooltip content={tooltipContent()} placement="top">
      <Tag variant={badgeVariant()} tone="soft" size="sm" dot class="cursor-default">
        {label()}
      </Tag>
    </Tooltip>
  );
}

/**
 * EmptyState - Displayed when no web services exist
 */
function EmptyState(props: { onCreateClick: () => void; disabled?: boolean }) {
  const i18n = useI18n();

  return (
    <div class="flex flex-col items-center justify-center py-12 px-4">
      <div class="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Globe class="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 class="text-sm font-medium text-foreground mb-1">{i18n.t('webServices.empty.title')}</h3>
      <p class="text-xs text-muted-foreground text-center max-w-xs mb-4">
        {i18n.t('webServices.empty.description')}
      </p>
      <Button size="sm" variant="default" onClick={props.onCreateClick} disabled={props.disabled}>
        {i18n.t('webServices.actions.addService')}
      </Button>
    </div>
  );
}

/**
 * PortForwardCard - A single registered web service card with status, info, and actions
 */
function PortForwardCard(props: {
  forward: PortForward;
  busy: boolean;
  busyText?: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const isHealthy = () => props.forward.health?.status === 'healthy';
  const i18n = useI18n();

  return (
    <Card
      class={cn(
        'border transition-all duration-200',
        isHealthy()
          ? 'border-[var(--redeven-status-success-border)] bg-[var(--redeven-status-success-soft)] hover:border-[var(--redeven-status-success)]'
          : props.forward.health?.status === 'unreachable'
            ? 'border-destructive/30 bg-destructive/[0.02] hover:border-destructive/50'
            : redevenSurfaceRoleClass('panelInteractive')
      )}
    >
      <CardHeader class="pb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <CardTitle class="text-sm truncate">{props.forward.name || i18n.t('webServices.card.fallbackName', { id: props.forward.forward_id })}</CardTitle>
            <CardDescription class="text-xs truncate mt-0.5 font-mono" title={props.forward.target_url}>
              {props.forward.target_url}
            </CardDescription>
          </div>
          <HealthBadge health={props.forward.health} />
        </div>
      </CardHeader>

      <Show when={props.forward.description}>
        <CardContent class="pb-2 pt-0">
          <p class="text-xs text-muted-foreground line-clamp-2">{props.forward.description}</p>
        </CardContent>
      </Show>

      <CardContent class={cn('pb-2', !props.forward.description && 'pt-0')}>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <div class="text-muted-foreground">{i18n.t('webServices.fields.lastOpened')}</div>
          <Tooltip content={fmtTime(props.forward.last_opened_at_unix_ms, i18n)} placement="top">
            <div class="text-right cursor-default">{fmtRelativeTime(props.forward.last_opened_at_unix_ms, i18n)}</div>
          </Tooltip>

          <Show when={isHealthy() && props.forward.health?.latency_ms}>
            <div class="text-muted-foreground">{i18n.t('webServices.fields.latency')}</div>
            <div class="text-right font-mono">{props.forward.health?.latency_ms}ms</div>
          </Show>

          <Show when={props.forward.health?.last_checked_at_unix_ms}>
            <div class="text-muted-foreground">{i18n.t('webServices.fields.lastCheck')}</div>
            <Tooltip content={fmtTime(props.forward.health?.last_checked_at_unix_ms ?? 0, i18n)} placement="top">
              <div class="text-right cursor-default">{fmtRelativeTime(props.forward.health?.last_checked_at_unix_ms ?? 0, i18n)}</div>
            </Tooltip>
          </Show>
        </div>
      </CardContent>

      <CardFooter class={cn('pt-2 flex items-center justify-between gap-2 border-t', redevenDividerRoleClass())}>
        <Tooltip content={props.busyText || i18n.t('webServices.actions.openServiceTooltip')} placement="top">
          <Button size="sm" variant="default" onClick={props.onOpen} disabled={props.busy} class="flex-1">
            <Show when={props.busy} fallback={<ExternalLink class="w-3.5 h-3.5 mr-1" />}>
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            {i18n.t('webServices.actions.open')}
          </Button>
        </Tooltip>
        <Tooltip content={i18n.t('webServices.actions.deleteServiceTooltip')} placement="top">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onDelete}
            disabled={props.busy}
            class="px-2 text-muted-foreground hover:text-destructive"
          >
            <Trash class="w-4 h-4" />
          </Button>
        </Tooltip>
      </CardFooter>
    </Card>
  );
}

function managedStatusLabel(status: string, i18n: WebServicesI18n): string {
  switch (status) {
    case 'installing': return i18n.t('webServices.managed.status.installing');
    case 'running': return i18n.t('webServices.managed.status.running');
    case 'stopped': return i18n.t('webServices.managed.status.stopped');
    case 'error': return i18n.t('webServices.managed.status.error');
    default: return i18n.t('webServices.managed.status.unknown');
  }
}

function managedStageLabel(stage: string, i18n: WebServicesI18n): string {
  switch (stage) {
    case 'environment_check': return i18n.t('webServices.managed.stages.environmentCheck');
    case 'downloading': return i18n.t('webServices.managed.stages.downloading');
    case 'pulling': return i18n.t('webServices.managed.stages.pulling');
    case 'verifying': return i18n.t('webServices.managed.stages.verifying');
    case 'installing': return i18n.t('webServices.managed.stages.installing');
    case 'starting': return i18n.t('webServices.managed.stages.starting');
    case 'health_check': return i18n.t('webServices.managed.stages.healthCheck');
    case 'stopping': return i18n.t('webServices.managed.stages.stopping');
    case 'uninstalling': return i18n.t('webServices.managed.stages.uninstalling');
    case 'update_preparing': return i18n.t('webServices.managed.stages.updatePreparing');
    case 'cancelled': return i18n.t('webServices.managed.stages.cancelled');
    case 'interrupted': return i18n.t('webServices.managed.stages.interrupted');
    case 'failed': return i18n.t('webServices.managed.stages.failed');
    default: return i18n.t('webServices.managed.stages.completed');
  }
}

function managedDeploymentLabel(deployment: ManagedDeployment, i18n: WebServicesI18n): string {
  switch (deployment) {
    case 'native':
    case 'host': return i18n.t('webServices.managed.hostDeployment');
    case 'compose': return i18n.t('webServices.managed.composeDeployment');
    default: return i18n.t('webServices.managed.containerDeployment');
  }
}

function managedTemplateKind(template: ManagedCatalogTemplate): ServiceTemplateKind {
  if (template.deployment === 'native' || template.deployment === 'host') return 'host';
  if (template.deployment === 'compose' || template.container_mode === 'compose') return 'compose';
  return 'container';
}

function managedTemplateLocalizedIdentity(template: ManagedCatalogTemplate, i18n: WebServicesI18n): Readonly<{ name: string; description: string }> {
  if (!template.localization_key) return { name: template.name, description: template.description };
  return {
    name: localizedManagedCopy(i18n, `webServices.managed.templates.${template.localization_key}.name`, template.name),
    description: localizedManagedCopy(i18n, `webServices.managed.templates.${template.localization_key}.description`, template.description),
  };
}

function managedServiceLocalizedIdentity(service: ManagedService, i18n: WebServicesI18n): Readonly<{ name: string; description: string }> {
  if (!service.localization_key) return { name: service.name || service.template_id, description: service.description ?? '' };
  return {
    name: localizedManagedCopy(i18n, `webServices.managed.templates.${service.localization_key}.name`, service.name || service.template_id),
    description: localizedManagedCopy(i18n, `webServices.managed.templates.${service.localization_key}.description`, service.description ?? ''),
  };
}

function localizedManagedCopy(i18n: WebServicesI18n, key: string, fallback: string): string {
  const translated = i18n.t(key as EnvAppTranslationKey);
  return translated === key ? fallback : translated;
}

function managedNoticeCopy(notice: ManagedTemplateNotice, i18n: WebServicesI18n): Readonly<{ title: string; description: string }> {
  return {
    title: localizedManagedCopy(i18n, notice.title_key, notice.title_key),
    description: localizedManagedCopy(i18n, notice.description_key, notice.description_key),
  };
}

function acceptedNoticeRevisions(notices: readonly ManagedTemplateNotice[] | undefined, accepted: Readonly<Record<string, boolean>>): Record<string, number> {
  return Object.fromEntries((notices ?? []).filter((notice) => accepted[notice.id]).map((notice) => [notice.id, notice.revision]));
}

function requiredNoticesAccepted(notices: readonly ManagedTemplateNotice[] | undefined, accepted: Readonly<Record<string, boolean>>): boolean {
  return (notices ?? []).every((notice) => !notice.acknowledgement_required || accepted[notice.id]);
}

export function ManagedTemplateNotices(props: {
  notices: readonly ManagedTemplateNotice[];
  accepted: Readonly<Record<string, boolean>>;
  disabled: boolean;
  onAcceptedChange: (noticeID: string, accepted: boolean) => void;
}) {
  const i18n = useI18n();
  return (
    <div class="space-y-2" data-testid="managed-template-notices">
      <For each={props.notices}>{(notice) => {
        const copy = () => managedNoticeCopy(notice, i18n);
        return (
          <div class={cn('rounded-lg border p-3 text-xs', notice.severity === 'warning' ? 'border-warning/30 bg-warning/[0.07]' : 'border-border bg-muted/25')} data-notice-id={notice.id}>
            <div class="flex items-start gap-2.5">
              <span class={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', notice.severity === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')} aria-hidden="true">
                <Show when={notice.severity === 'warning'} fallback={<ShieldCheck class="h-3.5 w-3.5" />}><AlertTriangle class="h-3.5 w-3.5" /></Show>
              </span>
              <div class="min-w-0 flex-1">
                <div class="font-medium text-foreground">{copy().title}</div>
                <p class="mt-1 leading-5 text-muted-foreground">{copy().description}</p>
                <Show when={notice.acknowledgement_required}>
                  <div class="mt-3 flex items-start border-t border-warning/20 pt-3">
                    <Checkbox
                      checked={Boolean(props.accepted[notice.id])}
                      onChange={(checked) => props.onAcceptedChange(notice.id, Boolean(checked))}
                      label={i18n.t('webServices.managed.noticeAcceptance')}
                      size="sm"
                      disabled={props.disabled}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </div>
        );
      }}</For>
    </div>
  );
}

function managedServicePresentation(service: ManagedService, i18n: WebServicesI18n): ServiceTemplatePresentation {
  const identity = managedServiceLocalizedIdentity(service, i18n);
  const kind = service.deployment === 'native' || service.deployment === 'host'
    ? 'host'
    : service.deployment === 'compose'
      ? 'compose'
      : 'container';
  return {
    id: service.template_id,
    name: identity.name,
    description: identity.description,
    source: service.template_source === 'custom' ? 'custom' : 'builtin',
    kind,
    brandIcon: service.brand_icon,
    deploymentLabel: managedDeploymentLabel(service.deployment, i18n),
    version: service.version,
    developerPreview: false,
    available: true,
    installed: true,
    duplicateable: false,
    editable: false,
  };
}

export function ManagedServiceCard(props: { service: ManagedService; busy: boolean; canOpen: boolean; canManage: boolean; onOpen: () => void; onOpenContainers?: () => void; onAction: (action: 'start' | 'stop' | 'restart' | 'retry_install') => void; onUpdate: () => void; onLogs: () => void; onUninstall: () => void }) {
  const i18n = useI18n();
  const presentation = () => managedServicePresentation(props.service, i18n);
  const running = () => props.service.observed_state === 'running';
  const failed = () => props.service.observed_state === 'error';
  const primaryAction = () => failed() ? 'retry_install' as const : running() ? 'stop' as const : 'start' as const;
  const primaryLabel = () => failed() ? i18n.t('webServices.managed.retryInstall') : running() ? i18n.t('webServices.managed.stop') : i18n.t('webServices.managed.start');
  const moreItems = (): DropdownItem[] => [
    ...(props.onOpenContainers ? [{
      id: 'containers',
      label: i18n.t('shell.nav.containers'),
    }] : []),
    ...(props.service.update_available ? [{
      id: 'update',
      label: i18n.t('webServices.managed.update'),
      disabled: props.busy || !props.canManage,
    }] : []),
    {
      id: 'restart',
      label: i18n.t('webServices.managed.restart'),
      disabled: props.busy || !props.canManage || !running(),
    },
    {
      id: 'logs',
      label: i18n.t('webServices.managed.logs'),
      disabled: props.busy,
    },
    {
      id: 'uninstall',
      label: i18n.t('webServices.managed.uninstall'),
      disabled: props.busy || !props.canManage,
    },
  ];
  const selectMoreItem = (id: string) => {
    if (id === 'containers') props.onOpenContainers?.();
    else if (id === 'update') props.onUpdate();
    else if (id === 'restart') props.onAction('restart');
    else if (id === 'logs') props.onLogs();
    else if (id === 'uninstall') props.onUninstall();
  };
  return (
    <Card class={cn('min-w-0 overflow-hidden border px-3 py-2.5 transition-colors duration-200', running() ? 'border-[var(--redeven-status-success-border)] bg-[var(--redeven-status-success-soft)] hover:border-[var(--redeven-status-success)]' : redevenSurfaceRoleClass('panelInteractive'))} data-testid="managed-service-card" data-managed-service-id={props.service.service_id}>
      <div class="flex min-w-0 items-start gap-3">
        <div class="min-w-0 flex-1"><ServiceTemplateIdentity template={presentation()} compact /></div>
        <div class="flex shrink-0 flex-col items-end gap-1 pt-0.5" data-testid="managed-service-status">
          <Tag variant={running() ? 'success' : props.service.observed_state === 'error' ? 'error' : 'neutral'} tone="soft" size="sm">{managedStatusLabel(props.service.observed_state, i18n)}</Tag>
          <Show when={props.service.update_available}><Tag variant="warning" tone="soft" size="sm">{i18n.t('webServices.managed.updateAvailable')}</Tag></Show>
        </div>
      </div>
      <Show when={props.service.last_error_code}><p class="mt-1.5 text-xs text-destructive">{i18n.t('webServices.managed.stages.failed')}</p></Show>
      <div class={cn('mt-2 flex min-w-0 items-center gap-2 border-t pt-2', redevenDividerRoleClass())} data-testid="managed-service-footer">
        <div class="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
          <FolderOpen class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate font-mono leading-5 text-foreground/80" title={props.service.workspace_path} data-testid="managed-service-workspace">{props.service.workspace_path}</span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5" data-testid="managed-service-actions">
          <Button size="sm" variant="default" class="h-8 px-3" onClick={props.onOpen} disabled={!running() || props.busy || !props.canOpen}><ExternalLink class="mr-1.5 h-3.5 w-3.5" />{i18n.t('webServices.actions.open')}</Button>
          <Button size="sm" variant="outline" class="h-8 px-3" onClick={() => props.onAction(primaryAction())} disabled={props.busy || !props.canManage}><Show when={running()} fallback={failed() ? <Refresh class="mr-1.5 h-3.5 w-3.5" /> : <Play class="mr-1.5 h-3.5 w-3.5" />}><Stop class="mr-1.5 h-3.5 w-3.5" /></Show>{primaryLabel()}</Button>
          <Dropdown
            align="end"
            items={moreItems()}
            onSelect={selectMoreItem}
            triggerAriaLabel={`${props.service.name}: ${i18n.t('webServices.managed.moreActions')}`}
            triggerClass="shrink-0 rounded-md"
            trigger={(
              <button
                type="button"
                class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="managed-service-more"
                title={i18n.t('webServices.managed.moreActions')}
              >
                <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * CreateForwardDialog - Dialog for registering a new runtime web service
 */
export function CreateForwardDialog(props: {
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (target: string, name: string, description: string) => void;
}) {
  const [target, setTarget] = createSignal('');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const i18n = useI18n();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTarget('');
      setName('');
      setDescription('');
    }
    props.onOpenChange(open);
  };

  const handleCreate = () => {
    const targetVal = target().trim();
    if (!targetVal || !isSupportedWebServiceTarget(targetVal)) return;
    props.onCreate(targetVal, name().trim(), description().trim());
  };

  const isValid = () => {
    const val = target().trim();
    return val.length > 0 && isSupportedWebServiceTarget(val);
  };

  const showScopeRestriction = () => target().trim().length > 0 && !isSupportedWebServiceTarget(target());

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={i18n.t('webServices.dialog.addTitle')}
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenChange(false)} disabled={props.loading} class={outlineControlClass}>
            {i18n.t('webServices.actions.cancel')}
          </Button>
          <Button size="sm" variant="default" onClick={handleCreate} disabled={props.loading || !isValid()}>
            <Show when={props.loading}>
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            {i18n.t('webServices.actions.addService')}
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1">
            {i18n.t('webServices.fields.target')} <span class="text-destructive">*</span>
          </label>
          <Input
            value={target()}
            onInput={(e) => setTarget(e.currentTarget.value)}
            placeholder={i18n.t('webServices.dialog.targetPlaceholder')}
            aria-invalid={showScopeRestriction() ? 'true' : undefined}
            aria-describedby="web-service-dialog-target-guidance"
            size="sm"
            class={cn(
              'w-full font-mono',
              showScopeRestriction() && 'border-warning/45 focus-visible:border-warning/60 focus-visible:ring-warning/20',
            )}
            data-testid="web-service-dialog-target"
          />
          <div
            id="web-service-dialog-target-guidance"
            class={cn(
              'mt-1.5 text-[11px]',
              showScopeRestriction()
                ? 'flex items-start gap-2 rounded-md border border-warning/25 bg-warning/[0.06] px-2.5 py-2 text-foreground'
                : 'leading-4 text-muted-foreground',
            )}
            role={showScopeRestriction() ? 'alert' : undefined}
            data-testid="web-service-dialog-target-guidance"
          >
            <Show
              when={showScopeRestriction()}
              fallback={i18n.t('webServices.dialog.targetHelp')}
            >
              <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-warning/12 text-warning" aria-hidden="true">
                <AlertTriangle class="h-3 w-3" />
              </span>
              <span class="min-w-0">
                <span class="block font-medium leading-4">{i18n.t('webServices.address.invalidTitle')}</span>
                <span class="block leading-4 text-muted-foreground">{i18n.t('webServices.address.invalid')}</span>
                <span class="mt-0.5 block font-mono text-[10px] leading-4 text-foreground/80">{i18n.t('webServices.address.examples')}</span>
              </span>
            </Show>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t('webServices.fields.name')}</label>
          <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder={i18n.t('webServices.dialog.namePlaceholder')} size="sm" class="w-full" />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t('webServices.dialog.nameHelp')}</p>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t('webServices.fields.description')}</label>
          <Input
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder={i18n.t('webServices.dialog.descriptionPlaceholder')}
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t('webServices.dialog.descriptionHelp')}</p>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// Open web service logic
// ============================================================================

type OpenWebServiceCopy = Readonly<{
  missingEnvContext: string;
  opening: string;
  openingDirectly: string;
  openingLocalProxy: string;
  requestingEntryTicket: string;
  updating: string;
  desktopWindowFailed: string;
  popupBlocked: string;
}>;

async function touchWebService(forwardID: string, setStatus: (s: string) => void, copy: Pick<OpenWebServiceCopy, 'updating'>): Promise<void> {
  setStatus(copy.updating);
  await fetchLocalApiJSON(`/_redeven_proxy/api/forwards/${encodeURIComponent(forwardID)}/touch`, { method: 'POST' });
}

async function preparePortForwardTunnel(
  forwardID: string,
  appPath: string,
  setStatus: (s: string) => void,
  copy: OpenWebServiceCopy,
): Promise<Readonly<{ origin: string; url: string }>> {
  const envPublicID = getEnvPublicIDFromSession();
  if (!envPublicID) throw new Error(copy.missingEnvContext);

  const origin = portForwardOrigin(forwardID);
  const bootURL = `${origin}/_redeven_boot/?env=${encodeURIComponent(envPublicID)}`;

  await touchWebService(forwardID, setStatus, copy);
  setStatus(copy.requestingEntryTicket);
  const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_PORT_FORWARD, codeSpaceId: forwardID });
  const init = {
    v: 2,
    env_public_id: envPublicID,
    floe_app: FLOE_APP_PORT_FORWARD,
    code_space_id: forwardID,
    app_path: normalizeAppPath(appPath),
    entry_ticket: entryTicket,
  };
  return { origin, url: `${bootURL}#redeven=${base64UrlEncode(JSON.stringify(init))}` };
}

async function openWebServiceRoute(
  route: WebServiceOpenRoute,
  forwardID: string,
  serviceTargetURL: string,
  appPath: string,
  useDesktopWindow: boolean,
  setStatus: (s: string) => void,
  copy: OpenWebServiceCopy,
  win?: Window | null,
): Promise<void> {
  let browserTargetURL: string;
  if (route.kind === 'e2ee_tunnel') {
    const prepared = await preparePortForwardTunnel(forwardID, appPath, setStatus, copy);
    browserTargetURL = prepared.url;
    if (win) registerSandboxWindow(win, { origin: prepared.origin, floe_app: FLOE_APP_PORT_FORWARD, code_space_id: forwardID, app_path: normalizeAppPath(appPath) });
  } else {
    await touchWebService(forwardID, setStatus, copy);
    setStatus(route.kind === 'browser_direct' ? copy.openingDirectly : copy.openingLocalProxy);
    browserTargetURL = route.url;
  }

  if (useDesktopWindow) {
    setStatus(copy.opening);
    const response = await openWebServiceWindowInDesktopShell({
      url: browserTargetURL,
      forward_id: forwardID,
      target_url: serviceTargetURL,
    });
    if (!response?.ok) throw new Error(response?.message || copy.desktopWindowFailed);
    return;
  }
  if (!win) throw new Error(copy.popupBlocked);
  win.location.assign(browserTargetURL);
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvPortForwardsPage() {
  const ctx = useEnvContext();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notify = useNotification();
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const i18n = useI18n();
  const initialFocus = readUIStorageJSON<{ version?: number; serviceID?: string }>('webServices:focus', {});
  const [focusedManagedServiceID, setFocusedManagedServiceID] = createSignal(String(initialFocus.serviceID ?? '').trim());

  // Permission checks
  const permissionReady = () => ctx.env.state === 'ready';
  const canRead = () => Boolean(ctx.env()?.permissions?.can_read);
  const canExecute = () => Boolean(ctx.env()?.permissions?.can_execute);
  const canManageManagedService = () => Boolean(ctx.env()?.permissions?.can_read && ctx.env()?.permissions?.can_write && ctx.env()?.permissions?.can_execute);

  // Search/filter state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [addressValidationVisible, setAddressValidationVisible] = createSignal(false);
  const [recentSession, setRecentSession] = createSignal<ForwardSession | null>(null);
  const [savingSession, setSavingSession] = createSignal(false);

  // Web services resource
  const [refreshSeq, setRefreshSeq] = createSignal(0);
  const bumpRefresh = () => setRefreshSeq((n) => n + 1);

  const [forwards] = createResource<PortForward[], number | null>(
    () => {
      if (!permissionReady()) return null;
      if (!canExecute()) return null;
      return refreshSeq();
    },
    async () => {
      const out = await fetchLocalApiJSON<{ forwards: PortForward[] }>('/_redeven_proxy/api/forwards', { method: 'GET' });
      return Array.isArray(out?.forwards) ? out.forwards : [];
    }
  );
  const initialForwardsLoading = () => forwards.state === 'pending';
  const forwardsRefreshing = () => forwards.state === 'refreshing';
  const forwardsRenderable = () => forwards.state === 'ready' || forwards.state === 'refreshing';

  const [managedState, setManagedState] = createSignal<ManagedService[]>([]);
  const [managedTemplates, setManagedTemplates] = createSignal<ManagedCatalogTemplate[]>([]);
  const [managedLoading, setManagedLoading] = createSignal(false);
  const [managedLoadError, setManagedLoadError] = createSignal(false);
  const [managedBusy, setManagedBusy] = createSignal(false);
  const [managedOperation, setManagedOperation] = createSignal<ManagedOperation | null>(null);
  const [workspacePath, setWorkspacePath] = createSignal('');
  const [workspacePickerOpen, setWorkspacePickerOpen] = createSignal(false);
  const [templateDrawerOpen, setTemplateDrawerOpen] = createSignal(false);
  const [templateDrawerView, setTemplateDrawerView] = createSignal<TemplateDrawerView>('catalog');
  const [templateCategory, setTemplateCategory] = createSignal<ServiceTemplateCategory>('host');
  const [templateSearch, setTemplateSearch] = createSignal('');
  const [selectedTemplateID, setSelectedTemplateID] = createSignal<string | null>(null);
  const [installNoticeAcceptances, setInstallNoticeAcceptances] = createSignal<Record<string, boolean>>({});
  const [templateDraft, setTemplateDraft] = createSignal<TemplateEditorDraft | null>(null);
  const [templateSaving, setTemplateSaving] = createSignal(false);
  const [templateDuplicate, setTemplateDuplicate] = createSignal<ManagedCatalogTemplate | null>(null);
  const [templateDuplicateName, setTemplateDuplicateName] = createSignal('');
  const [templateDelete, setTemplateDelete] = createSignal<ManagedCatalogTemplate | null>(null);
  const [managedLogs, setManagedLogs] = createSignal<string[] | null>(null);
  const [managedUpdate, setManagedUpdate] = createSignal<ManagedService | null>(null);
  const [updateNoticeAcceptances, setUpdateNoticeAcceptances] = createSignal<Record<string, boolean>>({});
  let managedStreamAbort: AbortController | null = null;
  let resumedOperationID: string | null = null;

  const workspacePicker = createDirectoryPickerDataSource({
    homePath: () => '/',
    listDirectory: async (absolutePath) => {
      if (!protocol.session?.()) return [];
      const response = await rpc.fs.list({ path: absolutePath, showHidden: false });
      return response.entries ?? [];
    },
  });

  const openWorkspacePicker = () => {
    workspacePicker.reset();
    setWorkspacePickerOpen(true);
    void workspacePicker.ensureRootLoaded();
  };

  createEffect(() => {
    ctx.env_id();
    protocol.session?.();
    workspacePicker.reset();
  });

  const loadManaged = async (refreshCatalog = true) => {
    if (!permissionReady() || !canRead()) return;
    setManagedLoading(true);
    try {
      const [catalog, services] = await Promise.all([
        refreshCatalog || managedTemplates().length === 0
          ? fetchLocalApiJSON<{ templates: ManagedCatalogTemplate[] }>('/_redeven_proxy/api/managed-web-services/catalog', { method: 'GET' })
          : Promise.resolve({ templates: managedTemplates() }),
        fetchLocalApiJSON<{ services: ManagedService[] }>('/_redeven_proxy/api/managed-web-services', { method: 'GET' }),
      ]);
      const templates = Array.isArray(catalog.templates) ? catalog.templates : [];
      setManagedTemplates(templates);
      const nextServices = Array.isArray(services.services) ? services.services : [];
      setManagedState(nextServices);
      setManagedLoadError(false);
      const activeOperation = nextServices.find((service) => service.active_operation)?.active_operation;
      if (activeOperation && resumedOperationID !== activeOperation.operation_id) {
        resumedOperationID = activeOperation.operation_id;
        setManagedBusy(true);
        setManagedOperation(activeOperation);
        void waitManagedOperation(activeOperation.operation_id)
          .then(() => loadManaged(false))
          .catch((error) => notify.error(i18n.t('webServices.managed.operationStreamFailed'), error instanceof Error ? error.message : String(error)))
          .finally(() => {
            resumedOperationID = null;
            setManagedBusy(false);
            setManagedOperation(null);
          });
      }
    } catch {
      setManagedLoadError(true);
    } finally { setManagedLoading(false); }
  };

  const openManagedContainerResource = (service: ManagedService) => {
    const link = service.container_resource;
    if (!link) return;
    writeUIStorageJSON('containers:activity', {
      version: 1,
      engine: link.engine,
      endpointID: link.endpoint_id ?? '',
      view: link.view,
      selectedIdentity: link.identity,
    });
    ctx.goActivity('containers');
  };

  const waitManagedOperation = async (operationID: string) => {
    const controller = new AbortController();
    managedStreamAbort?.abort();
    managedStreamAbort = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30 * 60_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await fetchLocalApi(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operationID)}/events`, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(i18n.t('webServices.managed.operationStreamFailed'));
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? '';
        for (const event of events) {
          const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (!data) continue;
          try {
            const operation = JSON.parse(data) as ManagedOperation;
            setManagedOperation(operation);
            if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.state)) return operation;
          } catch { /* keep reading until a complete snapshot arrives */ }
        }
      }
      throw new Error(i18n.t('webServices.managed.operationStreamFailed'));
    } catch (error) {
      if (controller.signal.aborted) throw new Error(i18n.t('webServices.managed.operationTimedOut'));
      throw error;
    } finally {
      window.clearTimeout(timeout);
      if (managedStreamAbort === controller) managedStreamAbort = null;
      await reader?.cancel().catch(() => undefined);
    }
  };

  const managedRequestID = () => `envapp-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

  const selectedTemplate = createMemo(() => managedTemplates().find((template) => template.template_id === selectedTemplateID()) ?? null);

  const resolveManagedForwardSession = async (service: ManagedService): Promise<ForwardSession> => {
    let forward = forwards()?.find((item) => item.forward_id === service.forward_id);
    if (!forward) {
      const refreshed = await fetchLocalApiJSON<{ forwards: PortForward[] }>('/_redeven_proxy/api/forwards', { method: 'GET' });
      forward = refreshed.forwards?.find((item) => item.forward_id === service.forward_id);
    }
    if (!forward) throw new Error(i18n.t('webServices.errors.loadFailedPrefix'));
    return fetchLocalApiJSON<ForwardSession>('/_redeven_proxy/api/forward-sessions', {
      method: 'POST',
      body: JSON.stringify({ target: forward.target_url }),
    });
  };

  const installManaged = async () => {
    const template = selectedTemplate();
    if (!template || !template.available || !requiredNoticesAccepted(template.notices, installNoticeAcceptances()) || managedState().some((service) => service.service_family_id === template.service_family_id) || !canManageManagedService()) return;
    setManagedBusy(true);
    setManagedOperation(null);
    const useDesktopWindow = desktopShellWebServiceWindowOpenAvailable();
    const reservedWindow = useDesktopWindow ? null : window.open('about:blank', `redeven_managed_${template.template_id}`);
    try {
      const result = await fetchLocalApiJSON<{ service: ManagedService; operation: ManagedOperation }>('/_redeven_proxy/api/managed-web-services', { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), template_id: template.template_id, deployment: template.deployment, workspace_path: workspacePath().trim(), accepted_notice_revisions: acceptedNoticeRevisions(template.notices, installNoticeAcceptances()) }) });
      setManagedOperation(result.operation);
      const operation = await waitManagedOperation(result.operation.operation_id);
      if (operation.state !== 'succeeded') throw new Error(operation.error_message || i18n.t('webServices.notifications.failedToAddTitle'));
      setTemplateDrawerView('catalog');
      setSelectedTemplateID(null);
      setInstallNoticeAcceptances({});
      setTemplateDrawerOpen(false);
      await loadManaged(true);
      bumpRefresh();
      notify.success(i18n.t('webServices.notifications.serviceAddedTitle'), i18n.t('webServices.notifications.serviceAddedMessage'));
      if (useDesktopWindow || reservedWindow) {
        setBusyID(`managed:${result.service.service_id}`);
        try {
          const session = await resolveManagedForwardSession(result.service);
          await performOpen(session.forward, session.app_path, useDesktopWindow, reservedWindow);
        } finally {
          setBusyID(null);
          setBusyText('');
        }
      } else if (!useDesktopWindow && !reservedWindow) {
        notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), i18n.t('webServices.errors.popupBlocked'));
      }
    } catch (error) {
      try { reservedWindow?.close(); } catch { /* ignore */ }
      notify.error(i18n.t('webServices.notifications.failedToAddTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setManagedBusy(false);
      setManagedOperation(null);
    }
  };

  const managedAction = async (serviceID: string, action: 'start' | 'stop' | 'restart' | 'retry_install' | 'update', noticeRevisions: Readonly<Record<string, number>> = {}) => {
    if (!canManageManagedService()) return;
    setManagedBusy(true);
    setManagedOperation(null);
    try {
      const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(serviceID)}/operations`, { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), action, accepted_notice_revisions: noticeRevisions }) });
      setManagedOperation(result);
      const operation = await waitManagedOperation(result.operation_id);
      if (operation.state !== 'succeeded') throw new Error(operation.error_message || i18n.t('webServices.notifications.failedToOpenTitle'));
      await loadManaged(false);
      if (action === 'update') {
        setManagedUpdate(null);
        setUpdateNoticeAcceptances({});
        notify.success(i18n.t('webServices.managed.updateComplete'), i18n.t('webServices.managed.updateCompleteMessage'));
      }
    } catch (error) { notify.error(action === 'update' ? i18n.t('webServices.managed.updateFailed') : i18n.t('webServices.notifications.failedToOpenTitle'), error instanceof Error ? error.message : String(error)); }
    finally { setManagedBusy(false); setManagedOperation(null); }
  };

  const updateManagedService = () => {
    const service = managedUpdate();
    if (!service || !service.update_available || !requiredNoticesAccepted(service.update_notices, updateNoticeAcceptances())) return;
    void managedAction(service.service_id, 'update', acceptedNoticeRevisions(service.update_notices, updateNoticeAcceptances()));
  };

  const openManaged = async (service: ManagedService) => {
    await runOpenTransaction(
      `managed:${service.service_id}`,
      `redeven_managed_${service.service_id}`,
      i18n.t('webServices.status.opening'),
      async () => {
        const session = await resolveManagedForwardSession(service);
        return { forward: session.forward, appPath: session.app_path };
      },
    );
  };

  const uninstallManaged = async (request: ManagedUninstallRequest) => {
    if (!canManageManagedService()) return;
    setManagedBusy(true);
    setManagedOperation(null);
    try {
      const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(request.service.service_id)}/operations`, { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), action: 'uninstall', delete_data: request.deleteData }) });
      setManagedOperation(result);
      const operation = await waitManagedOperation(result.operation_id);
      if (operation.state !== 'succeeded') throw new Error(operation.error_message || i18n.t('webServices.notifications.failedToDeleteTitle'));
      await loadManaged(false);
      bumpRefresh();
      notify.success(i18n.t('webServices.managed.uninstallComplete'), i18n.t('webServices.managed.uninstallCompleteMessage'));
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToDeleteTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setManagedBusy(false);
      setManagedOperation(null);
      setManagedUninstall(null);
      setManagedDeleteConfirm(false);
    }
  };

  const cancelManagedOperation = async () => {
    if (!canManageManagedService()) return;
    const operation = managedOperation();
    if (!operation || !['pending', 'running', 'cancelling'].includes(operation.state)) return;
    try {
      const updated = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-service-operations/${encodeURIComponent(operation.operation_id)}/cancel`, { method: 'POST' });
      setManagedOperation(updated);
    } catch (error) {
      notify.error(i18n.t('webServices.managed.cancelFailed'), error instanceof Error ? error.message : String(error));
    }
  };

  const templateUnavailableReason = (template: ManagedCatalogTemplate | null | undefined) => {
    switch (template?.reason_code) {
      case 'PLATFORM_UNSUPPORTED': return i18n.t('webServices.managed.unavailable.platform');
      case 'CATALOG_TRUST_UNAVAILABLE': return i18n.t('webServices.managed.unavailable.catalogTrust');
      case 'CATALOG_UNAVAILABLE': return i18n.t('webServices.managedCatalogUnavailable');
      case 'NESTED_DOCKER_UNSUPPORTED': return i18n.t('webServices.managed.unavailable.nestedDocker');
      case 'DOCKER_UNAVAILABLE': return i18n.t('webServices.managed.unavailable.docker');
      case 'COMPOSE_UNAVAILABLE': return i18n.t('webServices.managed.unavailable.compose');
      default: return template?.reason ?? '';
    }
  };

  const templateInstalled = (template: ManagedCatalogTemplate) => managedState().some((service) => service.service_family_id === template.service_family_id);
  const templatePresentation = (template: ManagedCatalogTemplate): ServiceTemplatePresentation => {
    const identity = managedTemplateLocalizedIdentity(template, i18n);
    return {
      id: template.template_id,
      name: identity.name,
      description: identity.description,
      source: template.source,
      kind: managedTemplateKind(template),
      brandIcon: template.brand_icon,
      deploymentLabel: managedDeploymentLabel(template.deployment, i18n),
      version: template.version,
      developerPreview: template.developer_preview,
      available: template.available,
      availabilityReason: templateUnavailableReason(template),
      installed: templateInstalled(template),
      duplicateable: template.duplicateable,
      editable: template.editable,
    };
  };
  const templatePresentations = createMemo(() => managedTemplates().map(templatePresentation));
  const templateCounts = createMemo(() => templatePresentations().reduce(
    (counts, template) => {
      counts[template.kind === 'host' ? 'host' : 'container'] += 1;
      return counts;
    },
    { host: 0, container: 0 },
  ));
  const filteredTemplates = createMemo(() => {
    const query = templateSearch().trim().toLowerCase();
    return templatePresentations().filter((template) => {
      const isHost = template.kind === 'host';
      if ((templateCategory() === 'host') !== isHost) return false;
      if (!query) return true;
      return `${template.name}\n${template.description}\n${template.version ?? ''}\n${template.deploymentLabel}`.toLowerCase().includes(query);
    });
  });
  const selectedTemplatePresentation = createMemo(() => {
    const template = selectedTemplate();
    return template ? templatePresentation(template) : null;
  });
  const workspaceUsesRecommendedPath = createMemo(() => {
    const template = selectedTemplate();
    return Boolean(template?.default_workspace_path) && workspacePath() === template?.default_workspace_path;
  });
  const templateByID = (templateID: string) => managedTemplates().find((template) => template.template_id === templateID);

  const openTemplateCatalog = () => {
    setTemplateDrawerView('catalog');
    setSelectedTemplateID(null);
    setTemplateDraft(null);
    setInstallNoticeAcceptances({});
    setTemplateDrawerOpen(true);
  };

  const beginTemplateInstall = (template: ManagedCatalogTemplate) => {
    if (!template.available || templateInstalled(template)) return;
    setSelectedTemplateID(template.template_id);
    setWorkspacePath(template.default_workspace_path);
    setInstallNoticeAcceptances({});
    setTemplateDrawerView('install');
  };

  const beginTemplateCreate = (kind: 'host' | 'container' | 'compose') => {
    setTemplateDraft(emptyTemplateDraft(kind));
    setTemplateDrawerView('editor');
  };

  const beginTemplateDuplicate = (template: ManagedCatalogTemplate) => {
    const identity = managedTemplateLocalizedIdentity(template, i18n);
    setTemplateDuplicate(template);
    setTemplateDuplicateName(i18n.t('webServices.managed.copyName', { name: identity.name }));
  };

  const beginTemplateEdit = (template: ManagedCatalogTemplate) => {
    if (!template.editable) return;
    setTemplateDraft(draftFromTemplate(template));
    setTemplateDrawerView('editor');
  };

  const saveTemplate = async () => {
    const draft = templateDraft();
    if (!draft || !canManageManagedService()) return;
    setTemplateSaving(true);
    try {
      const body = templateRequestFromDraft(draft, managedRequestID());
      if (draft.templateID) {
        await fetchLocalApiJSON(`/_redeven_proxy/api/managed-web-service-templates/${encodeURIComponent(draft.templateID)}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await fetchLocalApiJSON('/_redeven_proxy/api/managed-web-service-templates', { method: 'POST', body: JSON.stringify(body) });
      }
      await loadManaged(true);
      setTemplateDraft(null);
      setTemplateDrawerView('catalog');
      notify.success(i18n.t('webServices.managed.templateSaved'), i18n.t('webServices.managed.templateSavedMessage'));
    } catch (error) {
      const message = error instanceof Error && error.message === 'TEMPLATE_ENV_INVALID' ? i18n.t('webServices.managed.environmentInvalid') : error instanceof Error ? error.message : String(error);
      notify.error(i18n.t('webServices.managed.templateSaveFailed'), message);
    } finally { setTemplateSaving(false); }
  };

  const duplicateTemplate = async () => {
    const source = templateDuplicate();
    if (!source || !templateDuplicateName().trim() || !canManageManagedService()) return;
    setTemplateSaving(true);
    try {
      await fetchLocalApiJSON(`/_redeven_proxy/api/managed-web-service-templates/${encodeURIComponent(source.template_id)}/duplicate`, { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), name: templateDuplicateName().trim() }) });
      setTemplateDuplicate(null);
      setTemplateDuplicateName('');
      await loadManaged(true);
      notify.success(i18n.t('webServices.managed.templateDuplicated'), i18n.t('webServices.managed.templateDuplicatedMessage'));
    } catch (error) {
      notify.error(i18n.t('webServices.managed.templateDuplicateFailed'), error instanceof Error ? error.message : String(error));
    } finally { setTemplateSaving(false); }
  };

  const deleteTemplate = async () => {
    const target = templateDelete();
    if (!target || !canManageManagedService()) return;
    setTemplateSaving(true);
    try {
      await fetchLocalApiJSON(`/_redeven_proxy/api/managed-web-service-templates/${encodeURIComponent(target.template_id)}`, { method: 'DELETE' });
      setTemplateDelete(null);
      await loadManaged(true);
      notify.success(i18n.t('webServices.managed.templateDeleted'), i18n.t('webServices.managed.templateDeletedMessage'));
    } catch (error) {
      notify.error(i18n.t('webServices.managed.templateDeleteFailed'), error instanceof Error ? error.message : String(error));
    } finally { setTemplateSaving(false); }
  };

  const confirmManagedUninstall = () => {
    const request = managedUninstall();
    if (!request) return;
    if (request.deleteData) {
      setManagedDeleteConfirm(true);
      return;
    }
    void uninstallManaged(request);
  };

  const loadManagedLogs = async (serviceID: string) => {
    try { const result = await fetchLocalApiJSON<{ lines: string[] }>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(serviceID)}/logs`, { method: 'GET' }); setManagedLogs(result.lines ?? []); }
    catch (error) { notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), error instanceof Error ? error.message : String(error)); }
  };

  // Filtered and sorted services
  const unmanagedForwards = createMemo(() => {
    const managedForwardIDs = new Set(managedState().map((service) => service.forward_id));
    return (forwards() ?? []).filter((forward) => !managedForwardIDs.has(forward.forward_id));
  });

  const filteredForwards = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const list = unmanagedForwards();

    // Filter by search query
    const filtered = query
      ? list.filter((f) => {
          const hay = `${f.name ?? ''}\n${f.description ?? ''}\n${f.target_url ?? ''}\n${f.forward_id ?? ''}`.toLowerCase();
          return hay.includes(query);
        })
      : list;

    // Sort: healthy first, then by last opened
    return [...filtered].sort((a, b) => {
      const aHealthy = a.health?.status === 'healthy' ? 1 : 0;
      const bHealthy = b.health?.status === 'healthy' ? 1 : 0;
      if (aHealthy !== bHealthy) return bHealthy - aHealthy;
      return (b.last_opened_at_unix_ms || 0) - (a.last_opened_at_unix_ms || 0);
    });
  });

  const filteredManagedServices = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    return managedState().filter((service) => !query || `${service.name}\n${service.description ?? ''}\n${service.workspace_path}\n${service.template_id}`.toLowerCase().includes(query));
  });

  createEffect(() => {
    const serviceID = focusedManagedServiceID();
    if (!serviceID) return;
    const service = managedState().find((item) => item.service_id === serviceID);
    if (!service) return;
    setSearchQuery(service.name);
    removeUIStorageItem('webServices:focus');
    setFocusedManagedServiceID('');
    window.requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-managed-service-id]'))
        .find((item) => item.dataset.managedServiceId === serviceID);
      card?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  });

  // Busy state for individual operations
  const [busyID, setBusyID] = createSignal<string | null>(null);
  const [busyText, setBusyText] = createSignal<string>('');

  // Create dialog state
  const [createOpen, setCreateOpen] = createSignal(false);
  const [createLoading, setCreateLoading] = createSignal(false);

  // Delete dialog state
  const [deleteID, setDeleteID] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  const [managedUninstall, setManagedUninstall] = createSignal<ManagedUninstallRequest | null>(null);
  const [managedDeleteConfirm, setManagedDeleteConfirm] = createSignal(false);

  createEffect(() => { if (permissionReady() && canRead()) void loadManaged(); });
  onCleanup(() => managedStreamAbort?.abort());

  // Create service handler
  const doCreate = async (target: string, name: string, description: string) => {
    if (!target) {
      notify.error(i18n.t('webServices.notifications.missingTargetTitle'), i18n.t('webServices.notifications.missingTargetMessage'));
      return;
    }
    setCreateLoading(true);
    try {
      await fetchLocalApiJSON('/_redeven_proxy/api/forwards', {
        method: 'POST',
        body: JSON.stringify({ target, name, description }),
      });
      setCreateOpen(false);
      bumpRefresh();
      notify.success(
        i18n.t('webServices.notifications.serviceAddedTitle'),
        name ? i18n.t('webServices.notifications.serviceAddedMessageWithName', { name }) : i18n.t('webServices.notifications.serviceAddedMessage'),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('webServices.notifications.failedToAddTitle'), msg);
    } finally {
      setCreateLoading(false);
    }
  };

  // Delete service handler
  const doDelete = async (id: string) => {
    const fid = String(id ?? '').trim();
    if (!fid) return;
    setDeleting(true);
    try {
      await fetchLocalApiJSON(`/_redeven_proxy/api/forwards/${encodeURIComponent(fid)}`, { method: 'DELETE' });
      bumpRefresh();
      notify.success(i18n.t('webServices.notifications.serviceDeletedTitle'), i18n.t('webServices.notifications.serviceDeletedMessage'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('webServices.notifications.failedToDeleteTitle'), msg);
    } finally {
      setDeleting(false);
      setDeleteID(null);
    }
  };

  const performOpen = async (
    f: PortForward,
    appPath: string,
    useDesktopWindow: boolean,
    win: Window | null,
  ) => {
    const fid = String(f.forward_id).trim();
    setBusyText(i18n.t('webServices.status.resolvingRoute'));
    const localRuntime = await getLocalRuntime().catch(() => null);
    const desktopContext = readDesktopSessionContextSnapshot();
    const route = resolveWebServiceOpenRoute({
      forwardID: fid,
      targetURL: f.target_url,
      localRuntime,
      desktopContext,
      appPath,
      preferIsolatedDesktop: useDesktopWindow,
    });
    await openWebServiceRoute(route, fid, f.target_url, appPath, useDesktopWindow, (s) => setBusyText(s), {
      missingEnvContext: i18n.t('webServices.errors.missingEnvContext'),
      opening: i18n.t('webServices.status.opening'),
      openingDirectly: i18n.t('webServices.status.openingDirectly'),
      openingLocalProxy: i18n.t('webServices.status.openingLocalProxy'),
      requestingEntryTicket: i18n.t('webServices.status.requestingEntryTicket'),
      updating: i18n.t('webServices.status.updating'),
      desktopWindowFailed: i18n.t('webServices.errors.desktopWindowFailed'),
      popupBlocked: i18n.t('webServices.errors.popupBlocked'),
    }, win);
    bumpRefresh();
  };

  const runOpenTransaction = async (
    transactionID: string,
    popupName: string,
    initialStatus: string,
    resolveTarget: () => Promise<Readonly<{ forward: PortForward; appPath: string }>>,
  ) => {
    if (busyID()) return;
    setBusyID(transactionID);
    setBusyText(initialStatus);
    const useDesktopWindow = desktopShellWebServiceWindowOpenAvailable();
    const win = useDesktopWindow ? null : window.open('about:blank', popupName);
    if (!useDesktopWindow && !win) {
      setBusyID(null);
      setBusyText('');
      notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), i18n.t('webServices.errors.popupBlocked'));
      return;
    }

    try {
      const target = await resolveTarget();
      await performOpen(target.forward, target.appPath, useDesktopWindow, win);
    } catch (e) {
      try {
        win?.close();
      } catch {
        // ignore
      }
      const msg = e instanceof Error ? e.message : String(e);
      notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), msg);
    } finally {
      setBusyID(null);
      setBusyText('');
    }
  };

  // Open service handler
  const doOpen = async (f: PortForward, appPath = '/') => {
    const fid = String(f?.forward_id ?? '').trim();
    if (!fid) return;
    await runOpenTransaction(
      fid,
      `redeven_web_service_${fid}`,
      i18n.t('webServices.status.opening'),
      async () => ({ forward: f, appPath }),
    );
  };

  const doOpenAddress = async () => {
    const target = address().trim();
    if (busyID()) return;
    if (!isSupportedWebServiceTarget(target)) {
      setAddressValidationVisible(true);
      return;
    }
    setAddressValidationVisible(false);
    await runOpenTransaction(
      'new-session',
      '_blank',
      i18n.t('webServices.status.creatingSession'),
      async () => {
        const session = await fetchLocalApiJSON<ForwardSession>('/_redeven_proxy/api/forward-sessions', {
          method: 'POST',
          body: JSON.stringify({ target }),
        });
        setRecentSession(session);
        setAddress(new URL(session.app_path, session.forward.target_url).toString());
        return { forward: session.forward, appPath: session.app_path };
      },
    );
  };

  const doSaveRecentSession = async () => {
    const current = recentSession();
    if (!current?.ephemeral || savingSession()) return;
    setSavingSession(true);
    try {
      const name = new URL(current.forward.target_url).host;
      const forward = await fetchLocalApiJSON<PortForward>(`/_redeven_proxy/api/forward-sessions/${encodeURIComponent(current.forward.forward_id)}/save`, {
        method: 'POST',
        body: JSON.stringify({ name, description: '' }),
      });
      setRecentSession({ ...current, forward, ephemeral: false });
      bumpRefresh();
      notify.success(i18n.t('webServices.notifications.sessionSavedTitle'), i18n.t('webServices.notifications.sessionSavedMessage', { name }));
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToSaveTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSession(false);
    }
  };

  // Find the service being deleted for the confirmation dialog
  const deleteTarget = createMemo(() => {
    const id = deleteID();
    if (!id) return null;
    return forwards()?.find((f) => f.forward_id === id) ?? null;
  });

  return (
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class={cn('h-full min-h-0 overflow-auto', redevenSurfaceRoleClass('main'))}>
      <Panel class={cn('overflow-hidden', redevenSurfaceRoleClass('panelStrong'))} data-testid="web-services-panel">
        <PanelContent class="p-4 space-y-4">
          {/* Page header */}
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Globe class="w-5 h-5 text-primary" />
              </div>
              <div class="space-y-1">
                <div class="text-sm font-semibold">{i18n.t('webServices.title')}</div>
                <div class="text-xs text-muted-foreground">
                  {i18n.t('webServices.description')}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { bumpRefresh(); void loadManaged(true); }}
                disabled={!!busyID() || forwards.loading || managedLoading()}
                aria-label={i18n.t('webServices.actions.refresh')}
                aria-busy={forwardsRefreshing() ? 'true' : undefined}
                title={i18n.t('webServices.actions.refresh')}
                class={outlineControlClass}
              >
                <RefreshIcon class={cn('w-3.5 h-3.5 sm:mr-1', forwardsRefreshing() && 'animate-spin motion-reduce:animate-none')} />
                <span class="hidden sm:inline">{i18n.t('webServices.actions.refresh')}</span>
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setCreateOpen(true)}
                disabled={!!busyID() || (permissionReady() && !canExecute())}
                aria-label={i18n.t('webServices.actions.addService')}
                title={i18n.t('webServices.actions.addService')}
              >
                <Plus class="w-3.5 h-3.5 sm:mr-1" />
                <span class="hidden sm:inline">{i18n.t('webServices.actions.addService')}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={openTemplateCatalog}
                disabled={managedLoading() || (permissionReady() && !canRead())}
                class={outlineControlClass}
                data-testid="service-templates-button"
              >
                <FileText class="w-3.5 h-3.5 sm:mr-1" />
                <span class="hidden sm:inline">{i18n.t('webServices.managed.serviceTemplates')}</span>
              </Button>
            </div>
          </div>

          <form
            class={cn('border-y py-4', redevenDividerRoleClass())}
            onSubmit={(event) => {
              event.preventDefault();
              void doOpenAddress();
            }}
            data-testid="web-service-address-form"
          >
            <div class="mx-auto w-full max-w-3xl">
              <div class="flex flex-col gap-2 sm:flex-row">
                <div class="relative min-w-0 flex-1">
                  <Globe class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={address()}
                    onInput={(event) => {
                      setAddress(event.currentTarget.value);
                      setAddressValidationVisible(false);
                    }}
                    onBlur={() => {
                      if (address().trim() && !isSupportedWebServiceTarget(address())) setAddressValidationVisible(true);
                    }}
                    placeholder={i18n.t('webServices.address.placeholder')}
                    aria-label={i18n.t('webServices.address.label')}
                    aria-invalid={addressValidationVisible() ? 'true' : undefined}
                    aria-describedby="web-service-address-guidance"
                    autocomplete="url"
                    spellcheck={false}
                    size="sm"
                    class={cn(
                      'h-10 w-full pl-9 font-mono text-sm',
                      addressValidationVisible() && 'border-warning/45 focus-visible:border-warning/60 focus-visible:ring-warning/20',
                    )}
                    disabled={!canExecute() || !!busyID()}
                    data-testid="web-service-address-input"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  class="h-10 shrink-0 px-4"
                  disabled={!canExecute() || !!busyID() || !address().trim()}
                  data-testid="web-service-address-open"
                >
                  <ExternalLink class="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {i18n.t('webServices.actions.openAddress')}
                </Button>
              </div>
              <div
                id="web-service-address-guidance"
                class={cn(
                  'mt-2 text-xs',
                  addressValidationVisible()
                    ? 'flex items-start gap-2.5 rounded-md border border-warning/25 bg-warning/[0.06] px-3 py-2.5 text-foreground'
                    : 'flex items-center gap-2 px-0.5 leading-5 text-muted-foreground',
                )}
                role={addressValidationVisible() ? 'alert' : undefined}
                data-testid="web-service-address-guidance"
              >
                <Show
                  when={addressValidationVisible()}
                  fallback={<>
                    <Globe class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><span class="font-medium text-foreground">{i18n.t('webServices.address.scopeTitle')}</span>{' '}{i18n.t('webServices.address.scopeDescription')}</span>
                  </>}
                >
                  <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warning/12 text-warning" aria-hidden="true">
                    <AlertTriangle class="h-3.5 w-3.5" />
                  </span>
                  <span class="min-w-0">
                    <span class="block font-medium leading-5">{i18n.t('webServices.address.invalidTitle')}</span>
                    <span class="block leading-5 text-muted-foreground">{i18n.t('webServices.address.invalid')}</span>
                    <span class="mt-1 block font-mono text-[11px] leading-4 text-foreground/80">{i18n.t('webServices.address.examples')}</span>
                  </span>
                </Show>
              </div>
            </div>

            <Show when={recentSession()?.ephemeral && recentSession()} keyed>
              {(session) => (
                <div class="mx-auto mt-3 flex w-full max-w-3xl flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <Tag variant="neutral" tone="soft" size="sm">{i18n.t('webServices.session.temporary')}</Tag>
                      <span class="truncate font-mono text-xs text-foreground">{session.forward.target_url}{session.app_path === '/' ? '' : session.app_path}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    class={cn('h-8 shrink-0', outlineControlClass)}
                    onClick={() => void doSaveRecentSession()}
                    disabled={savingSession()}
                  >
                    <Save class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {savingSession() ? i18n.t('webServices.actions.saving') : i18n.t('webServices.actions.saveService')}
                  </Button>
                </div>
              )}
            </Show>
          </form>

          {/* Permission warning */}
          <Show when={permissionReady() && !canExecute()}>
            <div class="flex items-center gap-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <span>{i18n.t('webServices.permission.executeRequired')}</span>
            </div>
          </Show>

          <div class="mx-auto w-full max-w-6xl space-y-3" data-testid="web-services-collection">
            {/* Search bar - only show when there are services */}
            <Show when={unmanagedForwards().length > 0 || managedState().length > 0}>
              <div class="w-full max-w-[23.5rem]" data-testid="web-services-search">
                <div class="relative min-w-0">
                  <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={searchQuery()}
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    placeholder={i18n.t('webServices.search.placeholder')}
                    size="sm"
                    class="h-9 w-full pl-9 pr-9"
                  />
                  <Show when={searchQuery()}>
                    <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="absolute right-0.5 top-1/2 h-8 -translate-y-1/2 px-2" aria-label={i18n.t('webServices.search.clear')}>
                      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </Button>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Services list */}
            <div
              class="relative"
              style={{ 'min-height': '200px' }}
              aria-busy={forwardsRefreshing() ? 'true' : undefined}
              data-testid="web-services-list-region"
            >
              <EnvCollectionLoadingSkeleton
                visible={initialForwardsLoading()}
                message={i18n.t('webServices.loadingMessage')}
                testId="web-services-initial-loading"
              />
              <Show when={forwardsRefreshing()}>
                <span class="sr-only" role="status" aria-live="polite">{i18n.t('webServices.loadingMessage')}</span>
              </Show>

              <Show when={forwards.error}>
                <div class="flex items-center gap-2 text-sm text-destructive p-4">
                <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                  />
                </svg>
                {i18n.t('webServices.errors.loadFailedPrefix')}: {String(forwards.error)}
                </div>
              </Show>

            <Show when={(forwardsRenderable() || managedState().length > 0) && !forwards.error}>
              <Show when={unmanagedForwards().length > 0 || managedState().length > 0} fallback={<EmptyState onCreateClick={() => setCreateOpen(true)} disabled={permissionReady() && !canExecute()} />}>
                <Show when={filteredForwards().length > 0 || filteredManagedServices().length > 0} fallback={
                  <div class="flex flex-col items-center justify-center py-12 px-4">
                    <p class="text-sm text-muted-foreground">{i18n.t('webServices.search.noMatches', { query: searchQuery() })}</p>
                    <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="mt-2">{i18n.t('webServices.search.clear')}</Button>
                  </div>
                }>
                  <div class="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" data-testid="unified-web-services-grid">
                    <For each={filteredManagedServices()}>{(service) => (
                      <ManagedServiceCard service={service} busy={managedBusy() || busyID() === `managed:${service.service_id}`} canOpen={canExecute()} canManage={canManageManagedService()} onOpen={() => void openManaged(service)} onOpenContainers={service.container_resource ? () => openManagedContainerResource(service) : undefined} onAction={(action) => void managedAction(service.service_id, action)} onUpdate={() => { setManagedUpdate(service); setUpdateNoticeAcceptances({}); }} onLogs={() => void loadManagedLogs(service.service_id)} onUninstall={() => setManagedUninstall({ service, deleteData: false })} />
                    )}</For>
                    <For each={filteredForwards()}>{(f) => (
                      <PortForwardCard forward={f} busy={busyID() === f.forward_id} busyText={busyID() === f.forward_id ? busyText() : undefined} onOpen={() => void doOpen(f)} onDelete={() => setDeleteID(f.forward_id)} />
                    )}</For>
                  </div>
                </Show>
              </Show>
            </Show>
            <Show when={managedLoadError()}><p class="mt-3 text-xs text-warning">{i18n.t('webServices.errors.loadFailedPrefix')}</p></Show>
            <Show when={managedOperation()} keyed>{(operation) => (
              <div class="mt-3 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs" role="status" aria-live="polite">
                <Show when={!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.state)}><InlineButtonSnakeLoading /></Show>
                <span>{managedStageLabel(operation.stage, i18n)}</span><span class="ml-auto font-mono text-muted-foreground">{Math.min(operation.progress_current, operation.progress_total)}/{operation.progress_total}</span>
                <Show when={['pending', 'running', 'cancelling'].includes(operation.state)}><Button size="sm" variant="ghost" onClick={() => void cancelManagedOperation()} disabled={operation.state === 'cancelling' || !canManageManagedService()}>{i18n.t('webServices.managed.cancelOperation')}</Button></Show>
              </div>
            )}</Show>
            </div>
          </div>
        </PanelContent>
      </Panel>

      {/* Create dialog */}
      <CreateForwardDialog open={createOpen()} loading={createLoading()} onOpenChange={setCreateOpen} onCreate={doCreate} />

      <EnvAppDrawer
        open={templateDrawerOpen()}
        class="service-template-explorer-drawer"
        onOpenChange={(open) => { if (!managedBusy() && !templateSaving()) { setTemplateDrawerOpen(open); if (!open) setInstallNoticeAcceptances({}); } }}
        title={templateDrawerView() === 'catalog' ? i18n.t('webServices.managed.serviceTemplates') : templateDrawerView() === 'install' ? i18n.t('webServices.managed.deployTemplate') : templateDraft()?.templateID ? i18n.t('webServices.managed.editTemplate') : i18n.t('webServices.managed.newTemplate')}
        description={templateDrawerView() === 'catalog' ? i18n.t('webServices.managed.templateCenterDescription') : undefined}
        footer={templateDrawerView() === 'catalog' ? undefined : (
          <div class="flex w-full items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setTemplateDrawerView('catalog'); setSelectedTemplateID(null); setTemplateDraft(null); setInstallNoticeAcceptances({}); }} disabled={managedBusy() || templateSaving()}>{i18n.t('webServices.managed.backToTemplates')}</Button>
            <div class="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setTemplateDrawerOpen(false)} disabled={managedBusy() || templateSaving()}>{i18n.t('webServices.actions.cancel')}</Button>
              <Show when={templateDrawerView() === 'install'}>
                <Show when={managedBusy()} fallback={<Button size="sm" variant="default" onClick={() => void installManaged()} disabled={!canManageManagedService() || !workspacePath().trim() || !selectedTemplate()?.available || !requiredNoticesAccepted(selectedTemplate()?.notices, installNoticeAcceptances())}>{i18n.t('webServices.managed.installStart')}</Button>}>
                  <Button size="sm" variant="outline" onClick={() => void cancelManagedOperation()} disabled={!managedOperation() || managedOperation()?.state === 'cancelling'}>{i18n.t('webServices.managed.cancelOperation')}</Button>
                </Show>
              </Show>
              <Show when={templateDrawerView() === 'editor'}>
                <Button size="sm" variant="default" onClick={() => void saveTemplate()} disabled={templateSaving() || !templateDraft()?.name.trim()}>{templateSaving() ? i18n.t('webServices.managed.savingTemplate') : i18n.t('webServices.managed.saveTemplate')}</Button>
              </Show>
            </div>
          </div>
        )}
      >
        <div class="min-h-0 space-y-4 p-1" data-testid="service-template-drawer">
          <Show when={templateDrawerView() === 'catalog'}>
            <ServiceTemplateCatalog
              category={templateCategory()}
              query={templateSearch()}
              hostCount={templateCounts().host}
              containerCount={templateCounts().container}
              templates={filteredTemplates()}
              loading={managedLoading()}
              canManage={canManageManagedService()}
              onCategoryChange={setTemplateCategory}
              onQueryChange={setTemplateSearch}
              onCreate={beginTemplateCreate}
              onDeploy={(templateID) => { const template = templateByID(templateID); if (template) beginTemplateInstall(template); }}
              onDuplicate={(templateID) => { const template = templateByID(templateID); if (template) beginTemplateDuplicate(template); }}
              onEdit={(templateID) => { const template = templateByID(templateID); if (template) beginTemplateEdit(template); }}
              onDelete={(templateID) => { const template = templateByID(templateID); if (template) setTemplateDelete(template); }}
            />
          </Show>

          <Show when={templateDrawerView() === 'install' && selectedTemplate()} keyed>{(template) => (
            <div class="space-y-5">
              <Show when={selectedTemplatePresentation()} keyed>{(presentation) => (
                <div class="service-template-install-identity rounded-xl border p-4">
                  <ServiceTemplateIdentity template={presentation} />
                </div>
              )}</Show>
              <section class="service-template-install-section border-t pt-4">
                <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.workspaceSection')}</h3>
                <p class="mt-1 text-xs text-muted-foreground">{i18n.t('webServices.managed.workspaceSectionDescription')}</p>
                <div class="service-template-workspace-picker mt-3" data-recommended={workspaceUsesRecommendedPath()}>
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="service-template-workspace-picker__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
                      <FolderOpen class="h-4 w-4" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-medium text-foreground">{i18n.t('webServices.managed.workspace')}</span>
                        <Show when={workspaceUsesRecommendedPath()}>
                          <span class="service-template-workspace-picker__badge rounded-full px-2 py-0.5 text-[10px] font-semibold">{i18n.t('webServices.managed.recommended')}</span>
                        </Show>
                      </div>
                      <p
                        class="mt-1 truncate font-mono text-xs text-muted-foreground"
                        title={workspacePath()}
                        data-testid="managed-workspace-path"
                        data-path={workspacePath()}
                      >
                        {workspacePath() || i18n.t('webServices.managed.workspacePlaceholder')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      class="shrink-0 gap-1.5"
                      data-testid="managed-workspace-picker-trigger"
                      onClick={openWorkspacePicker}
                      disabled={managedBusy()}
                    >
                      <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
                      {i18n.t('webServices.managed.chooseWorkspace')}
                    </Button>
                  </div>
                </div>
                <div class={cn('mt-2 flex items-start gap-2 text-[11px] leading-4', workspaceUsesRecommendedPath() ? 'text-muted-foreground' : 'text-warning')}>
                  <Show when={workspaceUsesRecommendedPath()} fallback={<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>
                    <ShieldCheck class="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                  </Show>
                  <span>{workspaceUsesRecommendedPath() ? i18n.t('webServices.managed.workspaceSafeDefaultDescription') : i18n.t('webServices.managed.workspaceCustomDescription')}</span>
                </div>
                <Show when={!workspaceUsesRecommendedPath() && template.default_workspace_path}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="mt-1.5 h-7 gap-1.5 px-2 text-xs"
                    onClick={() => setWorkspacePath(template.default_workspace_path)}
                    disabled={managedBusy()}
                  >
                    <Refresh class="h-3.5 w-3.5" aria-hidden="true" />
                    {i18n.t('webServices.managed.restoreRecommendedWorkspace')}
                  </Button>
                </Show>
              </section>
              <section class="service-template-install-section border-t pt-4">
                <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.deploymentInformation')}</h3>
                <dl class="mt-3 grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
                  <div><dt class="text-muted-foreground">{i18n.t('webServices.managed.currentEnvironment')}</dt><dd class="mt-1 font-medium text-foreground">{ctx.env()?.name || ctx.env_id()}</dd></div>
                  <div><dt class="text-muted-foreground">{i18n.t('webServices.managed.deployment')}</dt><dd class="mt-1 font-medium text-foreground">{managedDeploymentLabel(template.deployment, i18n)}</dd></div>
                  <div><dt class="text-muted-foreground">{i18n.t('webServices.managed.version')}</dt><dd class="mt-1 font-mono text-foreground">{template.version || i18n.t('webServices.managed.customVersion')}</dd></div>
                  <div><dt class="text-muted-foreground">{i18n.t('webServices.managed.dataLocation')}</dt><dd class="mt-1 text-foreground">{i18n.t('webServices.managed.managedPrivateData')}</dd></div>
                </dl>
              </section>
              <Show when={(template.notices?.length ?? 0) > 0}>
                <ManagedTemplateNotices
                  notices={template.notices ?? []}
                  accepted={installNoticeAcceptances()}
                  disabled={managedBusy()}
                  onAcceptedChange={(noticeID, accepted) => setInstallNoticeAcceptances((current) => ({ ...current, [noticeID]: accepted }))}
                />
              </Show>
              <Show when={template.source_url}><a class="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={template.source_url} target="_blank" rel="noreferrer">{i18n.t('webServices.managed.sourceCode')}<ExternalLink class="h-3 w-3" /></a></Show>
              <Show when={managedOperation()} keyed>{(operation) => <div class="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"><Show when={!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.state)}><InlineButtonSnakeLoading /></Show><span>{managedStageLabel(operation.stage, i18n)}</span><span class="ml-auto font-mono text-muted-foreground">{Math.min(operation.progress_current, operation.progress_total)}/{operation.progress_total}</span></div>}</Show>
            </div>
          )}</Show>

          <Show when={templateDrawerView() === 'editor' && templateDraft()} keyed>{(draft) => (
            <div class="service-template-editor space-y-5">
              <div class="rounded-md border border-warning/25 bg-warning/[0.05] p-3 text-xs text-muted-foreground">{i18n.t('webServices.managed.customTemplateSafety')}</div>
              <section class="service-template-editor__section">
                <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.templateBasics')}</h3>
                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.templateName')}</label><Input value={draft.name} maxlength={80} onInput={(event) => setTemplateDraft({ ...draft, name: event.currentTarget.value })} /></div>
                  <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.templateVersion')}</label><Input value={draft.version} maxlength={80} onInput={(event) => setTemplateDraft({ ...draft, version: event.currentTarget.value })} /></div>
                </div>
                <div class="mt-3"><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.templateDescriptionLabel')}</label><Textarea value={draft.description} maxlength={1000} onInput={(event) => setTemplateDraft({ ...draft, description: event.currentTarget.value })} rows={2} /></div>
              </section>

              <section class="service-template-editor__section">
                <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.endpointSettings')}</h3>
                <div class="mt-3 grid gap-3 sm:grid-cols-[180px_1fr_1fr]">
                  <div>
                    <div class="mb-1 text-xs font-medium">{i18n.t('webServices.managed.webScheme')}</div>
                    <div class="service-template-scheme-picker grid h-9 grid-cols-2 gap-1 rounded-md p-1" role="radiogroup" aria-label={i18n.t('webServices.managed.webScheme')}>
                      <For each={['http', 'https'] as const}>{(scheme) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={draft.scheme === scheme}
                          class="service-template-scheme-picker__option rounded px-2 text-xs font-semibold uppercase"
                          onClick={() => setTemplateDraft({ ...draft, scheme })}
                        >
                          {scheme}
                        </button>
                      )}</For>
                    </div>
                  </div>
                  <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.webPath')}</label><Input value={draft.path} onInput={(event) => setTemplateDraft({ ...draft, path: event.currentTarget.value })} class="font-mono" /></div>
                  <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.healthPath')}</label><Input value={draft.healthPath} onInput={(event) => setTemplateDraft({ ...draft, healthPath: event.currentTarget.value })} class="font-mono" /></div>
                </div>
              </section>

              <section class="service-template-editor__section">
                <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.serviceRuntimeSettings')}</h3>
                <Show when={draft.kind === 'host'}>
                  <p class="mt-2 text-xs leading-5 text-muted-foreground">{i18n.t('webServices.managed.hostScriptNote')}</p>
                  <div class="mt-3"><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.startScript')}</label><Textarea value={draft.startScript} onInput={(event) => setTemplateDraft({ ...draft, startScript: event.currentTarget.value })} rows={7} class="font-mono text-xs" /></div>
                  <details class="service-template-editor__advanced mt-3" open={Boolean(draft.installScript || draft.stopScript || draft.uninstallScript)}>
                    <summary class="py-2 text-xs font-medium text-muted-foreground">{i18n.t('webServices.managed.optionalLifecycleScripts')}</summary>
                    <div class="space-y-3 pb-1 pt-2">
                      <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.installScript')}</label><Textarea value={draft.installScript} onInput={(event) => setTemplateDraft({ ...draft, installScript: event.currentTarget.value })} rows={5} class="font-mono text-xs" /></div>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.stopScript')}</label><Textarea value={draft.stopScript} onInput={(event) => setTemplateDraft({ ...draft, stopScript: event.currentTarget.value })} rows={4} class="font-mono text-xs" /></div>
                        <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.uninstallScript')}</label><Textarea value={draft.uninstallScript} onInput={(event) => setTemplateDraft({ ...draft, uninstallScript: event.currentTarget.value })} rows={4} class="font-mono text-xs" /></div>
                      </div>
                    </div>
                  </details>
                </Show>
                <Show when={draft.kind === 'container'}>
                  <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_160px]">
                    <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.containerImage')}</label><Input value={draft.image} onInput={(event) => setTemplateDraft({ ...draft, image: event.currentTarget.value })} class="font-mono" /></div>
                    <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.containerPort')}</label><Input type="number" min="1" max="65535" value={draft.containerPort} onInput={(event) => setTemplateDraft({ ...draft, containerPort: event.currentTarget.value })} inputmode="numeric" /></div>
                  </div>
                  <details class="service-template-editor__advanced mt-3" open={Boolean(draft.entrypoint || draft.command || draft.environment)}>
                    <summary class="py-2 text-xs font-medium text-muted-foreground">{i18n.t('webServices.managed.optionalContainerSettings')}</summary>
                    <div class="space-y-3 pb-1 pt-2">
                      <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.entrypoint')}</label><Input value={draft.entrypoint} onInput={(event) => setTemplateDraft({ ...draft, entrypoint: event.currentTarget.value })} class="font-mono" /></div>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.commandArguments')}</label><Textarea value={draft.command} onInput={(event) => setTemplateDraft({ ...draft, command: event.currentTarget.value })} rows={6} class="font-mono text-xs" /></div>
                        <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.environmentVariables')}</label><Textarea value={draft.environment} onInput={(event) => setTemplateDraft({ ...draft, environment: event.currentTarget.value })} rows={6} class="font-mono text-xs" /></div>
                      </div>
                    </div>
                  </details>
                </Show>
                <Show when={draft.kind === 'compose'}>
                  <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                    <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.composeMainService')}</label><Input value={draft.mainService} onInput={(event) => setTemplateDraft({ ...draft, mainService: event.currentTarget.value })} /></div>
                    <div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.containerPort')}</label><Input type="number" min="1" max="65535" value={draft.containerPort} onInput={(event) => setTemplateDraft({ ...draft, containerPort: event.currentTarget.value })} inputmode="numeric" /></div>
                  </div>
                  <div class="mt-3"><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.composeYAML')}</label><Textarea value={draft.composeYAML} onInput={(event) => setTemplateDraft({ ...draft, composeYAML: event.currentTarget.value })} rows={18} class="font-mono text-xs" /></div>
                </Show>
              </section>
            </div>
          )}</Show>
        </div>
      </EnvAppDrawer>

      <LazyMountedDirectoryPicker
        open={workspacePickerOpen()}
        onOpenChange={setWorkspacePickerOpen}
        files={workspacePicker.files()}
        initialPath={workspacePath()}
        homePath="/"
        title={i18n.t('webServices.managed.selectWorkspace')}
        confirmText={i18n.t('common.actions.confirm')}
        cancelText={i18n.t('common.actions.cancel')}
        onExpand={workspacePicker.expandPath}
        ensurePath={workspacePicker.ensurePath}
        onSelect={setWorkspacePath}
      />

      <Dialog open={templateDuplicate() !== null} onOpenChange={(open) => { if (!open && !templateSaving()) setTemplateDuplicate(null); }} title={i18n.t('webServices.managed.duplicateTemplate')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setTemplateDuplicate(null)} disabled={templateSaving()}>{i18n.t('webServices.actions.cancel')}</Button><Button size="sm" variant="default" onClick={() => void duplicateTemplate()} disabled={templateSaving() || !templateDuplicateName().trim()}>{i18n.t('webServices.managed.duplicate')}</Button></div>}><div class="space-y-3"><p class="text-sm text-muted-foreground">{i18n.t('webServices.managed.duplicateNote')}</p><div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.templateName')}</label><Input value={templateDuplicateName()} onInput={(event) => setTemplateDuplicateName(event.currentTarget.value)} autofocus /></div></div></Dialog>

      <ConfirmDialog open={templateDelete() !== null} onOpenChange={(open) => { if (!open) setTemplateDelete(null); }} title={i18n.t('webServices.managed.deleteTemplate')} confirmText={i18n.t('webServices.actions.delete')} variant="destructive" loading={templateSaving()} onConfirm={() => void deleteTemplate()}><p class="text-sm">{i18n.t('webServices.managed.deleteTemplateQuestion', { name: templateDelete()?.name ?? '' })}</p></ConfirmDialog>

      <Dialog open={managedLogs() !== null} onOpenChange={(open) => { if (!open) setManagedLogs(null); }} title={i18n.t('webServices.managed.logsTitle')} footer={<div class="flex justify-end"><Button size="sm" variant="outline" onClick={() => setManagedLogs(null)}>{i18n.t('webServices.actions.cancel')}</Button></div>}><pre class="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 text-[11px] whitespace-pre-wrap">{(managedLogs() ?? []).join('\n') || i18n.t('webServices.managed.noLogs')}</pre></Dialog>

      <Dialog
        open={managedUpdate() !== null}
        onOpenChange={(open) => { if (!open && !managedBusy()) { setManagedUpdate(null); setUpdateNoticeAcceptances({}); } }}
        title={i18n.t('webServices.managed.updateTitle')}
        footer={(
          <div class="flex w-full justify-end gap-2">
            <Show when={managedBusy()} fallback={<>
              <Button size="sm" variant="outline" onClick={() => { setManagedUpdate(null); setUpdateNoticeAcceptances({}); }}>{i18n.t('webServices.actions.cancel')}</Button>
              <Button size="sm" variant="default" onClick={updateManagedService} disabled={!requiredNoticesAccepted(managedUpdate()?.update_notices, updateNoticeAcceptances())}>{i18n.t('webServices.managed.update')}</Button>
            </>}>
              <Button size="sm" variant="outline" onClick={() => void cancelManagedOperation()} disabled={!managedOperation() || managedOperation()?.state === 'cancelling'}>{i18n.t('webServices.managed.cancelOperation')}</Button>
            </Show>
          </div>
        )}
      >
        <Show when={managedUpdate()} keyed>{(service) => {
          const identity = () => managedServiceLocalizedIdentity(service, i18n);
          return (
            <div class="space-y-4" data-testid="managed-service-update-dialog">
              <div>
                <h3 class="text-sm font-semibold text-foreground">{identity().name}</h3>
                <p class="mt-1 text-xs text-muted-foreground">{i18n.t('webServices.managed.updateVersionChange', { current: service.version, target: service.target_version ?? service.version })}</p>
              </div>
              <div class="rounded-lg border bg-muted/25 p-3 text-xs">
                <div class="font-medium text-foreground">{i18n.t('webServices.managed.updateKeepsData')}</div>
                <p class="mt-1 leading-5 text-muted-foreground">{i18n.t('webServices.managed.updateKeepsDataDescription')}</p>
              </div>
              <Show when={(service.update_notices?.length ?? 0) > 0}>
                <ManagedTemplateNotices
                  notices={service.update_notices ?? []}
                  accepted={updateNoticeAcceptances()}
                  disabled={managedBusy()}
                  onAcceptedChange={(noticeID, accepted) => setUpdateNoticeAcceptances((current) => ({ ...current, [noticeID]: accepted }))}
                />
              </Show>
              <Show when={managedOperation()} keyed>{(operation) => <div class="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs" role="status" aria-live="polite"><Show when={!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.state)}><InlineButtonSnakeLoading /></Show><span>{managedStageLabel(operation.stage, i18n)}</span><span class="ml-auto font-mono text-muted-foreground">{Math.min(operation.progress_current, operation.progress_total)}/{operation.progress_total}</span></div>}</Show>
            </div>
          );
        }}</Show>
      </Dialog>

      <Dialog
        open={managedUninstall() !== null && !managedDeleteConfirm()}
        onOpenChange={(open) => { if (!open) setManagedUninstall(null); }}
        title={i18n.t('webServices.managed.uninstallTitle')}
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setManagedUninstall(null)} disabled={managedBusy()}>{i18n.t('webServices.actions.cancel')}</Button><Button size="sm" variant="destructive" onClick={confirmManagedUninstall} disabled={managedBusy()}>{i18n.t('webServices.managed.uninstall')}</Button></div>}
      >
        <div class="space-y-3">
          <p class="text-sm">{i18n.t('webServices.managed.uninstallQuestion')}</p>
          <Checkbox checked={managedUninstall()?.deleteData ?? false} onChange={(checked) => setManagedUninstall((current) => current ? { ...current, deleteData: Boolean(checked) } : current)} label={i18n.t('webServices.managed.deleteData')} size="sm" disabled={!(ctx.env()?.permissions?.can_admin || ctx.env()?.permissions?.is_owner)} />
          <Show when={!(ctx.env()?.permissions?.can_admin || ctx.env()?.permissions?.is_owner)}><p class="text-xs text-muted-foreground">{i18n.t('webServices.managed.adminRequired')}</p></Show>
        </div>
      </Dialog>

      <ConfirmDialog
        open={managedDeleteConfirm()}
        onOpenChange={(open) => { if (!open) setManagedDeleteConfirm(false); }}
        title={i18n.t('webServices.managed.deleteDataTitle')}
        confirmText={i18n.t('webServices.managed.deleteDataConfirm')}
        variant="destructive"
        loading={managedBusy()}
        onConfirm={() => { const request = managedUninstall(); if (request) void uninstallManaged(request); }}
      >
        <p class="text-sm">{i18n.t('webServices.managed.deleteDataWarning')}</p>
      </ConfirmDialog>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteID()}
        onOpenChange={(open) => {
          if (!open) setDeleteID(null);
        }}
        title={i18n.t('webServices.dialog.deleteTitle')}
        confirmText={i18n.t('webServices.actions.delete')}
        variant="destructive"
        loading={deleting()}
        onConfirm={() => void doDelete(deleteID() || '')}
      >
        <div class="space-y-2">
          <p class="text-sm">
            {i18n.t('webServices.dialog.deleteQuestionPrefix')}{' '}
            <span class="font-semibold">"{deleteTarget()?.name || deleteTarget()?.forward_id}"</span>?
          </p>
          <p class="text-xs text-muted-foreground">
            {i18n.t('webServices.dialog.deleteNotePrefix')}{' '}
            <span class="font-mono">{deleteTarget()?.target_url}</span> {i18n.t('webServices.dialog.deleteNoteSuffix')}
          </p>
        </div>
      </ConfirmDialog>

      {/* Global loading overlay for opening operations */}
      <RedevenLoadingCurtain visible={!!busyID() && !!busyText()} eyebrow={i18n.t('webServices.loadingEyebrow')} message={busyText() || i18n.t('webServices.status.working')} />
    </div>
  );
}
