import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, FileText, FolderOpen, Globe, MoreHorizontal, Pencil, Plus, RefreshIcon, Save, Search, ShieldCheck, Trash, Play, Stop, Refresh } from '@floegence/floe-webapp-core/icons';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  Textarea,
  Tag,
  type DropdownItem,
} from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import { DirectoryPicker } from '@floegence/floe-webapp-core/ui';

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
import { fetchLocalApiJSON } from '../services/localApi';
import { readUIStorageJSON, removeUIStorageItem } from '../services/uiStorage';
import { requestContainerResourceNavigation } from '../services/containerResourceNavigation';
import { trustedLauncherOriginFromSandboxLocation } from '../services/sandboxOrigins';
import { registerSandboxWindow } from '../services/sandboxWindowRegistry';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { Tooltip } from '../primitives/Tooltip';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { writeTextToClipboard } from '../utils/clipboard';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { useI18n, type EnvAppTranslationKey, type I18nHelpers } from '../i18n';
import { useEnvContext } from './EnvContext';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { EnvCollectionLoadingSkeleton } from './EnvCollectionLoadingSkeleton';
import { createFilesystemPickerDataSource } from '../../../../../flower_ui/src/filePicker/createFilesystemPickerDataSource';
import {
  ServiceTemplateCatalog,
  HostLifecyclePlanDetails,
  ServiceTemplateIdentity,
  type HostLifecyclePlan,
  type ServiceTemplateCategory,
  type ServiceTemplateKind,
  type ServiceTemplatePresentation,
  type ServiceTemplateRuntimeSpec,
} from './ServiceTemplateCatalog';
import { ManagedServiceShapingOrb } from './ManagedServiceShapingOrb';
import {
  ManagedServiceSettingsDrawer,
  type ManagedServiceReconfigureDraft,
} from './ManagedServiceSettingsDrawer';
import {
  createManagedServiceOperationController,
  type ManagedOperation,
} from './managedServiceOperationController';
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

type WebServiceAccessMode = 'unified_proxy' | 'desktop_loopback';

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
  access_mode?: WebServiceAccessMode;
  health: Health;
}>;

type ForwardSession = Readonly<{
  forward: PortForward;
  app_path: string;
  ephemeral: boolean;
}>;

type ForwardMetadataTarget = Readonly<
  | { mode: 'save'; session: ForwardSession }
  | { mode: 'edit'; forward: PortForward }
>;

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
  last_failure?: Readonly<{
    action?: ManagedOperation['action'];
    stage?: string;
    error_code: string;
    message: string;
    artifact_reference?: string;
    operation_id?: string;
    occurred_at_unix_ms?: number;
  }>;
  brand_icon?: ManagedBrandIcon;
  localization_key?: string;
  update_available: boolean;
  target_revision?: number;
  target_version?: string;
  update_notices?: ReadonlyArray<ManagedTemplateNotice>;
  active_operation?: ManagedOperation;
  access_mode?: WebServiceAccessMode;
  container_resources?: ReadonlyArray<Readonly<{
    kind: 'container' | 'image' | 'compose_project';
    engine: 'docker';
    endpoint_id?: string;
    view: 'containers' | 'images' | 'compose-projects';
    identity: string;
  }>>;
}>;

type ManagedContainerResource = NonNullable<ManagedService['container_resources']>[number];

type ManagedDeployment = 'native' | 'docker' | 'host' | 'container' | 'compose';
type ManagedBrandIcon = 'deepseek-harness' | 'ubuntu' | 'debian';
type ManagedTemplateNotice = Readonly<{
  id: string;
  revision: number;
  severity: 'info' | 'warning';
  title_key: string;
  description_key: string;
  acknowledgement_required: boolean;
}>;

type ManagedTemplateSpec = ServiceTemplateRuntimeSpec;

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
  default_access_mode?: WebServiceAccessMode;
  spec?: ManagedTemplateSpec;
  effective_spec?: ManagedTemplateSpec;
  host_lifecycle_plan?: HostLifecyclePlan;
}>;

type ManagedUninstallRequest = Readonly<{ service: ManagedService; deleteData: boolean }>;
type ManagedReconfigureRequest = Readonly<{
  draft: ManagedServiceReconfigureDraft;
  plan_digest: string;
  accepted_risk_ids: string[];
}>;
type TemplateDrawerView = 'catalog' | 'install' | 'editor';
export type TemplateEditorDraft = {
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
  hostLifecyclePlan?: HostLifecyclePlan;
};

export type TemplateEditorField = 'name' | 'description' | 'version' | 'path' | 'healthPath' | 'startScript' | 'image' | 'containerPort' | 'environment' | 'mainService' | 'composeYAML';
export type TemplateEditorError = 'required' | 'nameInvalid' | 'descriptionTooLong' | 'versionTooLong' | 'pathInvalid' | 'portInvalid' | 'imageInvalid' | 'environmentInvalid' | 'serviceNameInvalid';

function containsASCIIControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function validateTemplateDraft(draft: TemplateEditorDraft): Partial<Record<TemplateEditorField, TemplateEditorError>> {
  const errors: Partial<Record<TemplateEditorField, TemplateEditorError>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'required';
  else if (Array.from(name).length > 80 || containsASCIIControl(name)) errors.name = 'nameInvalid';
  if (draft.description.length > 1000) errors.description = 'descriptionTooLong';
  if (draft.version.length > 80) errors.version = 'versionTooLong';
  if (draft.path.trim() && !draft.path.trim().startsWith('/')) errors.path = 'pathInvalid';
  if (draft.healthPath.trim() && !draft.healthPath.trim().startsWith('/')) errors.healthPath = 'pathInvalid';

  if (draft.kind === 'host' && !draft.startScript.trim()) errors.startScript = 'required';
  if (draft.kind === 'container') {
    const image = draft.image.trim();
    if (!image) errors.image = 'required';
    else if (image.length > 512 || /\s/u.test(image) || containsASCIIControl(image)) errors.image = 'imageInvalid';
    if (!validTemplateEnvironment(draft.environment)) errors.environment = 'environmentInvalid';
  }
  if (draft.kind !== 'host') {
    const port = Number(draft.containerPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.containerPort = 'portInvalid';
  }
  if (draft.kind === 'compose') {
    const service = draft.mainService.trim();
    if (!service) errors.mainService = 'required';
    else if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(service)) errors.mainService = 'serviceNameInvalid';
    if (!draft.composeYAML.trim()) errors.composeYAML = 'required';
  }
  return errors;
}

function validTemplateEnvironment(raw: string): boolean {
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator <= 0 || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(line.slice(0, separator).trim())) return false;
    if (containsASCIIControl(line.slice(separator + 1))) return false;
  }
  return true;
}

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
    hostLifecyclePlan: template.host_lifecycle_plan,
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

function templateEditorErrorMessage(error: TemplateEditorError | undefined, i18n: WebServicesI18n): string {
  if (!error) return '';
  return i18n.t(`webServices.managed.validation.${error}` as EnvAppTranslationKey);
}

function TemplateEditorLabel(props: Readonly<{ for: string; label: string; required?: boolean }>) {
  return (
    <label class="mb-1 block text-xs font-medium" for={props.for}>
      {props.label}<Show when={props.required}> <span class="text-destructive" aria-hidden="true">*</span></Show>
    </label>
  );
}

function TemplateEditorGuidance(props: Readonly<{
  id: string;
  help: string;
  error?: TemplateEditorError;
  visible: boolean;
}>) {
  const i18n = useI18n();
  const message = () => props.visible && props.error ? templateEditorErrorMessage(props.error, i18n) : props.help;
  return <p id={props.id} class={cn('mt-1 min-h-4 text-[11px] leading-4', props.visible && props.error ? 'text-destructive' : 'text-muted-foreground')}>{message()}</p>;
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

function normalizeAppPath(value: string | undefined): string {
  const raw = compact(value) || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function localWebServiceProxyURL(
  forwardID: string,
  appPath: string,
  locationLike: BrowserLocationLike,
  desktopPrivateBridge: boolean,
): string {
  const navigation = new URL(normalizeAppPath(appPath), 'http://redeven.invalid');
  const base = new URL(locationLike.origin || locationLike.href);
  if (desktopPrivateBridge) {
    base.hostname = `pf-${forwardID}.localhost`;
    base.pathname = navigation.pathname;
  } else {
    base.pathname = `/pf/${encodeURIComponent(forwardID)}/${navigation.pathname.replace(/^\//u, '')}`;
  }
  base.search = navigation.search;
  base.hash = navigation.hash;
  return base.toString();
}

export function resolveWebServiceOpenRoute(args: Readonly<{
  forwardID: string;
  localRuntime: LocalRuntimeInfo | null;
  desktopContext?: DesktopSessionContextSnapshot | null;
  browserLocation?: BrowserLocationLike;
  appPath?: string;
  desktopWindowAvailable?: boolean;
}>): WebServiceOpenRoute {
  const forwardID = compact(args.forwardID);
  if (!args.localRuntime) {
    return { kind: 'e2ee_tunnel', forward_id: forwardID, label: 'Secure tunnel' };
  }

  const locationLike = args.browserLocation ?? window.location;
  const desktopPrivateBridge = args.desktopWindowAvailable === true
    && args.desktopContext?.document_transport === 'desktop_private_bridge_v2';

  return {
    kind: 'local_proxy',
    url: localWebServiceProxyURL(
      forwardID,
      normalizeAppPath(args.appPath),
      locationLike,
      desktopPrivateBridge,
    ),
    label: 'Local proxy',
  };
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

type ServiceStatusTone = 'success' | 'error' | 'neutral';

function ServiceStatusIndicator(props: { label: string; tone: ServiceStatusTone; class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        props.tone === 'success' && 'text-[var(--redeven-status-success-foreground)]',
        props.tone === 'error' && 'text-destructive',
        props.tone === 'neutral' && 'text-muted-foreground',
        props.class,
      )}
    >
      <span
        class={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          props.tone === 'success' && 'bg-[var(--redeven-status-success)]',
          props.tone === 'error' && 'bg-destructive',
          props.tone === 'neutral' && 'bg-muted-foreground/55',
        )}
        aria-hidden="true"
      />
      {props.label}
    </span>
  );
}

function HealthStatus(props: { health?: Health }) {
  const status = () => props.health?.status ?? 'unknown';
  const latency = () => props.health?.latency_ms;
  const lastError = () => props.health?.last_error;
  const i18n = useI18n();

  const tone = (): ServiceStatusTone => {
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
      <span class="cursor-default"><ServiceStatusIndicator label={label()} tone={tone()} /></span>
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

const serviceRowGridClass = 'group grid min-h-16 min-w-0 grid-cols-[minmax(0,1fr)_13.5rem] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/25 lg:grid-cols-[minmax(0,1.15fr)_minmax(10rem,0.72fr)_6rem_13.5rem]';
const serviceRowActionsClass = 'col-start-2 row-start-1 grid w-[13.5rem] shrink-0 grid-cols-[4.75rem_4.75rem_2rem] items-center justify-end gap-2 lg:col-start-4';

export function PortForwardRow(props: {
  forward: PortForward;
  busy: boolean;
  busyText?: string;
  canOpen?: boolean;
  openUnavailableReason?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const i18n = useI18n();

  return (
    <div
      class={serviceRowGridClass}
      data-testid="port-forward-row"
      data-forward-id={props.forward.forward_id}
    >
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground">
          <Globe class="h-4 w-4" aria-hidden="true" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold leading-5">{props.forward.name || i18n.t('webServices.card.fallbackName', { id: props.forward.forward_id })}</div>
          <div class="mt-0.5 truncate font-mono text-[11px] leading-4 text-muted-foreground" title={props.forward.target_url}>{props.forward.target_url}</div>
        </div>
      </div>

      <div class="col-start-1 row-start-2 flex min-w-0 items-center gap-2 truncate text-[11px] leading-5 text-muted-foreground lg:col-start-2 lg:row-start-1" data-testid="port-forward-secondary">
        <Tooltip content={fmtTime(props.forward.last_opened_at_unix_ms, i18n)} placement="top">
          <span class="cursor-default whitespace-nowrap">{i18n.t('webServices.fields.lastOpened')} · {fmtRelativeTime(props.forward.last_opened_at_unix_ms, i18n)}</span>
        </Tooltip>
        <span aria-hidden="true">·</span>
        <span class="truncate" title={props.forward.access_mode === 'desktop_loopback' ? i18n.t('webServices.accessMode.desktopLoopbackDescription') : i18n.t('webServices.accessMode.unifiedProxyDescription')}>
          {props.forward.access_mode === 'desktop_loopback' ? i18n.t('webServices.accessMode.desktopLoopbackShort') : i18n.t('webServices.accessMode.unifiedProxyShort')}
        </span>
      </div>

      <div class="col-start-2 row-start-2 flex min-w-0 justify-end lg:col-start-3 lg:row-start-1" data-testid="port-forward-status">
        <HealthStatus health={props.forward.health} />
      </div>

      <div class={serviceRowActionsClass} data-testid="port-forward-actions">
        <Tooltip content={props.openUnavailableReason || props.busyText || i18n.t('webServices.actions.openServiceTooltip')} placement="top" anchorClass="col-start-1 w-full">
          <Button size="sm" variant="default" onClick={props.onOpen} disabled={props.busy || props.canOpen === false} class="h-8 w-full px-3">
            <Show when={props.busy} fallback={<ExternalLink class="mr-1.5 h-3.5 w-3.5" />}>
              <InlineButtonSnakeLoading class="mr-1.5" />
            </Show>
            {i18n.t('webServices.actions.open')}
          </Button>
        </Tooltip>
        <Tooltip content={i18n.t('webServices.actions.editServiceTooltip')} placement="top" anchorClass="col-start-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onEdit}
            disabled={props.busy}
            class="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
            aria-label={i18n.t('webServices.actions.editServiceTooltip')}
          >
            <Pencil class="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={i18n.t('webServices.actions.deleteServiceTooltip')} placement="top" anchorClass="col-start-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onDelete}
            disabled={props.busy}
            class="h-8 w-8 px-0 text-muted-foreground hover:text-destructive"
            aria-label={i18n.t('webServices.actions.deleteServiceTooltip')}
          >
            <Trash class="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>
    </div>
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
    case 'reconfigure_preflight': return i18n.t('webServices.managed.stages.reconfigurePreflight');
    case 'applying_configuration': return i18n.t('webServices.managed.stages.applyingConfiguration');
    case 'removing_runtime': return i18n.t('webServices.managed.stages.removingRuntime');
    case 'rebuilding_runtime': return i18n.t('webServices.managed.stages.rebuildingRuntime');
    case 'verifying_runtime': return i18n.t('webServices.managed.stages.verifyingRuntime');
    case 'cancelled': return i18n.t('webServices.managed.stages.cancelled');
    case 'interrupted': return i18n.t('webServices.managed.stages.interrupted');
    case 'failed': return i18n.t('webServices.managed.stages.failed');
    default: return i18n.t('webServices.managed.stages.completed');
  }
}

function managedActionLabel(action: ManagedOperation['action'], i18n: WebServicesI18n): string {
  switch (action) {
    case 'install': return i18n.t('webServices.managed.stages.installing');
    case 'start': return i18n.t('webServices.managed.start');
    case 'stop': return i18n.t('webServices.managed.stop');
    case 'restart': return i18n.t('webServices.managed.restart');
    case 'retry_install': return i18n.t('webServices.managed.retryInstall');
    case 'update': return i18n.t('webServices.managed.update');
    case 'reconfigure': return i18n.t('webServices.managed.reconfigure');
    case 'uninstall': return i18n.t('webServices.managed.uninstall');
  }
}

function managedActionFailureTitle(action: ManagedOperation['action'], i18n: WebServicesI18n): string {
  switch (action) {
    case 'start': return i18n.t('webServices.managed.startFailed');
    case 'stop': return i18n.t('webServices.managed.stopFailed');
    case 'restart': return i18n.t('webServices.managed.restartFailed');
    case 'retry_install': return i18n.t('webServices.managed.retryFailed');
    case 'update': return i18n.t('webServices.managed.updateFailed');
    case 'reconfigure': return i18n.t('webServices.managed.reconfigureFailed');
    case 'uninstall': return i18n.t('webServices.notifications.failedToDeleteTitle');
    default: return i18n.t('webServices.notifications.failedToAddTitle');
  }
}

function managedOperationFailureMessage(operation: ManagedOperation, fallback: string, i18n: WebServicesI18n): string {
  switch (operation.error_code) {
    case 'IMAGE_PULL_TIMEOUT': return i18n.t('webServices.managed.imagePullTimeout');
    case 'IMAGE_REGISTRY_UNAVAILABLE': return i18n.t('webServices.managed.imageRegistryUnavailable');
    case 'IMAGE_UNAVAILABLE': return i18n.t('webServices.managed.imageUnavailable');
    case 'IMAGE_REGISTRY_ACCESS_DENIED': return i18n.t('webServices.managed.imageRegistryAccessDenied');
    case 'IMAGE_REGISTRY_RATE_LIMITED': return i18n.t('webServices.managed.imageRegistryRateLimited');
    case 'IMAGE_PULL_STORAGE_EXHAUSTED': return i18n.t('webServices.managed.imagePullStorageExhausted');
    case 'IMAGE_PULL_FAILED': return i18n.t('webServices.managed.imagePullFailed');
    default: return operation.error_message || fallback;
  }
}

const managedOperationActive = (operation: ManagedOperation | null | undefined) => Boolean(operation && ['submitting', 'pending', 'running', 'cancelling'].includes(operation.state));

function managedOperationActivityLabel(operation: ManagedOperation, i18n: WebServicesI18n): string {
  return operation.state === 'submitting'
    ? i18n.t('webServices.managed.operationStarting')
    : `${managedActionLabel(operation.action, i18n)} · ${managedStageLabel(operation.stage, i18n)}`;
}

function managedOperationStages(operation: ManagedOperation, deployment: ManagedDeployment): readonly string[] {
  switch (operation.action) {
    case 'start': return ['starting', 'health_check', 'completed'];
    case 'stop': return ['stopping', 'completed'];
    case 'restart': return ['stopping', 'starting', 'health_check', 'completed'];
    case 'update': return ['update_preparing', 'pulling', 'stopping', 'installing', 'starting', 'health_check', 'completed'];
    case 'reconfigure': return ['reconfigure_preflight', 'removing_runtime', 'rebuilding_runtime', 'verifying_runtime', 'completed'];
    case 'uninstall': return ['stopping', 'uninstalling', 'completed'];
    default:
      return [
        'environment_check',
        deployment === 'native' || deployment === 'host' ? 'downloading' : 'pulling',
        'verifying',
        'installing',
        'starting',
        'health_check',
        'completed',
      ];
  }
}

function managedOperationStepState(operation: ManagedOperation, steps: readonly string[], index: number): 'complete' | 'active' | 'pending' | 'failed' {
  if (operation.state === 'succeeded') return 'complete';
  const failed = ['failed', 'cancelled', 'interrupted'].includes(operation.state);
  let activeIndex = steps.indexOf(operation.stage);
  if (activeIndex < 0) activeIndex = Math.max(0, Math.min(steps.length - 1, operation.progress_current - 1));
  if (index < activeIndex) return 'complete';
  if (index === activeIndex) return failed ? 'failed' : 'active';
  return 'pending';
}

function formatManagedBytes(value: number | undefined): string {
  const bytes = Math.max(0, Number(value ?? 0));
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = bytes;
  let unit = 'B';
  for (const candidate of units) {
    scaled /= 1000;
    unit = candidate;
    if (scaled < 1000) break;
  }
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${unit}`;
}

function formatManagedElapsed(startedAt: number | undefined, updatedAt: number | undefined): string {
  if (!startedAt) return '—';
  const seconds = Math.max(0, Math.round(((updatedAt || Date.now()) - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function managedTransferProgress(operation: ManagedOperation): Readonly<{ current: number; total: number }> {
  const transfer = operation.progress_detail?.transfer;
  if ((transfer?.total_bytes ?? 0) > 0) return { current: transfer?.downloaded_bytes ?? 0, total: transfer!.total_bytes! };
  return { current: 0, total: 0 };
}

function ManagedOperationDisclosure(props: Readonly<{
  operation: ManagedOperation;
  deployment: ManagedDeployment;
  expanded: boolean;
  canCancel: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onCancel: () => void;
}>) {
  const i18n = useI18n();
  const [currentTimeUnixMs, setCurrentTimeUnixMs] = createSignal(Date.now());
  const elapsedTimer = window.setInterval(() => setCurrentTimeUnixMs(Date.now()), 1_000);
  onCleanup(() => window.clearInterval(elapsedTimer));
  const transfer = () => props.operation.progress_detail?.transfer;
  const hostTransfer = () => props.deployment === 'native' || props.deployment === 'host';
  const terminal = () => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(props.operation.state);
  const progress = () => managedTransferProgress(props.operation);
  const percent = () => progress().total > 0 ? Math.max(0, Math.min(100, (progress().current / progress().total) * 100)) : 0;
  const steps = () => managedOperationStages(props.operation, props.deployment);
  const detailsID = () => `managed-operation-details-${props.operation.operation_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const transferSummary = () => {
    const item = transfer();
    if (!item) return `${Math.min(props.operation.progress_current, props.operation.progress_total)}/${props.operation.progress_total}`;
    if ((item.total_bytes ?? 0) > 0) return `${formatManagedBytes(item.downloaded_bytes)} / ${formatManagedBytes(item.total_bytes)}`;
    if ((item.total_layers ?? 0) > 0) return i18n.t('webServices.managed.operationLayersValue', { current: item.completed_layers ?? 0, total: item.total_layers ?? 0 });
    return `${Math.min(props.operation.progress_current, props.operation.progress_total)}/${props.operation.progress_total}`;
  };
  return (
    <div class="relative border-t border-border/70 bg-muted/15" role="status" aria-live="polite" data-testid="managed-operation-disclosure">
      <div class="flex min-w-0 items-stretch pl-[3.25rem] pr-3">
        <span class="absolute bottom-0 left-8 top-0 w-px bg-border/80" aria-hidden="true" />
        <span class="absolute left-8 top-[1.4rem] h-px w-5 bg-border/80" aria-hidden="true" />
        <button
          type="button"
          class="group flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={props.expanded}
          aria-controls={detailsID()}
          onClick={() => props.onExpandedChange(!props.expanded)}
          data-testid="managed-service-operation-trigger"
        >
          <ManagedServiceShapingOrb />
          <div class="min-w-0 flex-1">
            <div class="managed-operation-shimmer-text truncate text-xs font-semibold">{managedOperationActivityLabel(props.operation, i18n)}</div>
            <Show when={transfer()?.artifact_reference}>
              <div class="mt-0.5 truncate font-mono text-[10px] leading-4 text-muted-foreground" title={transfer()?.artifact_reference} data-testid="managed-operation-artifact">{transfer()?.artifact_reference}</div>
            </Show>
          </div>
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{transferSummary()}</span>
          <ChevronDown class={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', props.expanded && 'rotate-180')} aria-hidden="true" />
        </button>
        <Button size="sm" variant="ghost" class="my-auto h-7 shrink-0 px-2" onClick={props.onCancel} disabled={!props.canCancel || props.operation.state === 'cancelling' || props.operation.state === 'submitting'}>{i18n.t('webServices.managed.cancelOperation')}</Button>
      </div>
      <Show when={props.expanded}>
        <div id={detailsID()} class="grid gap-4 border-t border-border/60 px-5 py-4 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.2fr)]" data-testid="managed-service-operation-details">
          <ol class="space-y-2">
            <For each={steps()}>{(stage, index) => {
              const state = () => managedOperationStepState(props.operation, steps(), index());
              return <li class="flex items-center gap-2 text-xs" data-managed-operation-step data-state={state()}><span data-state={state()} class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] data-[state=complete]:border-success data-[state=complete]:bg-success/10 data-[state=complete]:text-success data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=failed]:border-destructive data-[state=failed]:bg-destructive/10 data-[state=failed]:text-destructive">{state() === 'complete' ? '✓' : index() + 1}</span><span class={state() === 'pending' ? 'text-muted-foreground' : 'font-medium text-foreground'}>{managedStageLabel(stage, i18n)}</span></li>;
            }}</For>
          </ol>
          <div class="min-w-0 rounded-lg border border-border/70 bg-background/70 p-3">
            <Show when={transfer()} fallback={(
              <div class="space-y-3">
                <p class="text-xs text-muted-foreground">{i18n.t('webServices.managed.operationPreparingDetails')}</p>
                <dl class="text-xs"><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationElapsed')}</dt><dd class="mt-0.5 font-medium text-foreground" data-testid="managed-operation-elapsed">{formatManagedElapsed(props.operation.progress_detail?.stage_started_at_unix_ms, terminal() ? props.operation.progress_detail?.updated_at_unix_ms : currentTimeUnixMs())}</dd></div></dl>
              </div>
            )} keyed>{(item) => (
              <>
                <div class="flex min-w-0 items-start gap-2"><div class="min-w-0 flex-1"><div class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t(hostTransfer() ? 'webServices.managed.softwarePackage' : 'webServices.managed.containerImage')}</div><div class="mt-1 truncate font-mono text-xs text-foreground" title={item.artifact_reference}>{item.artifact_reference || '—'}</div></div><Show when={(item.artifact_total ?? 0) > 1}><Tag variant="neutral" tone="soft" size="sm">{i18n.t('webServices.managed.operationImageSequence', { current: item.artifact_index ?? 0, total: item.artifact_total ?? 0 })}</Tag></Show></div>
                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={i18n.t('webServices.managed.operationTransferProgress')} aria-valuemin="0" aria-valuemax={progress().total || undefined} aria-valuenow={progress().total ? Math.min(progress().current, progress().total) : undefined} data-indeterminate={progress().total === 0 ? 'true' : undefined}><div class={cn('h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none', progress().total === 0 && 'w-1/3 animate-pulse motion-reduce:animate-none')} style={progress().total ? { width: `${percent()}%` } : undefined} /></div>
                <dl class={cn('mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs', hostTransfer() ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationDownloaded')}</dt><dd class="mt-0.5 font-medium text-foreground">{(item.total_bytes ?? 0) > 0 ? `${formatManagedBytes(item.downloaded_bytes)} / ${formatManagedBytes(item.total_bytes)}` : item.phase === 'cached' ? formatManagedBytes(0) : '—'}</dd></div><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationSpeed')}</dt><dd class="mt-0.5 font-medium text-foreground">{(item.bytes_per_second ?? 0) > 0 || item.phase === 'cached' ? `${formatManagedBytes(item.bytes_per_second)}/s` : '—'}</dd></div><Show when={!hostTransfer()}><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationLayers')}</dt><dd class="mt-0.5 font-medium text-foreground">{(item.total_layers ?? 0) > 0 ? `${item.completed_layers ?? 0} / ${item.total_layers}` : '—'}</dd></div></Show><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationElapsed')}</dt><dd class="mt-0.5 font-medium text-foreground" data-testid="managed-operation-elapsed">{formatManagedElapsed(props.operation.progress_detail?.stage_started_at_unix_ms, terminal() ? props.operation.progress_detail?.updated_at_unix_ms : currentTimeUnixMs())}</dd></div></dl>
              </>
            )}</Show>
          </div>
        </div>
      </Show>
    </div>
  );
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
    revision: 0,
    developerPreview: false,
    available: true,
    installed: true,
    duplicateable: false,
    editable: false,
  };
}

export function ManagedServiceRow(props: { service: ManagedService; operation?: ManagedOperation | null; busy: boolean; canOpen: boolean; openUnavailableReason?: string; canManage: boolean; onOpen: () => void; onOpenResource: (resource: ManagedContainerResource) => void; onAction: (action: 'start' | 'stop' | 'restart' | 'retry_install') => void; onCancelOperation?: () => void; onDiagnosticCopyFailure?: (message: string) => void; onSettings?: () => void; onUpdate: () => void; onLogs: () => void; onUninstall: () => void }) {
  const i18n = useI18n();
  const [operationDetailsOpen, setOperationDetailsOpen] = createSignal(false);
  const [failureDiagnosticCopied, setFailureDiagnosticCopied] = createSignal(false);
  let failureDiagnosticResetTimer: number | undefined;
  const presentation = () => managedServicePresentation(props.service, i18n);
  const running = () => props.service.observed_state === 'running';
  const failed = () => props.service.observed_state === 'error';
  const operation = () => managedOperationActive(props.operation) ? props.operation ?? null : null;
  const busy = () => props.busy || managedOperationActive(props.operation);
  const primaryAction = () => failed() ? 'retry_install' as const : running() ? 'stop' as const : 'start' as const;
  const primaryLabel = () => failed() ? i18n.t('webServices.managed.retryInstall') : running() ? i18n.t('webServices.managed.stop') : i18n.t('webServices.managed.start');
  const failureOccurredAt = () => {
    const occurredAt = props.service.last_failure?.occurred_at_unix_ms;
    return occurredAt ? i18n.formatDateTime(occurredAt, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  };
  const failureDiagnostic = () => {
    const failure = props.service.last_failure;
    if (!failure) return '';
    return [
      `${i18n.t('webServices.managed.failureDiagnosticService')}: ${presentation().name}`,
      `${i18n.t('webServices.managed.failureDiagnosticServiceID')}: ${props.service.service_id}`,
      ...(failure.action ? [`${i18n.t('webServices.managed.operationAction')}: ${managedActionLabel(failure.action, i18n)}`] : []),
      ...(failure.stage ? [`${i18n.t('webServices.managed.failureDiagnosticStage')}: ${managedStageLabel(failure.stage, i18n)}`] : []),
      `${i18n.t('webServices.managed.failureDiagnosticErrorCode')}: ${failure.error_code}`,
      `${i18n.t('webServices.managed.failureDiagnosticMessage')}: ${failure.message}`,
      ...(failure.artifact_reference ? [`${i18n.t('webServices.managed.containerImage')}: ${failure.artifact_reference}`] : []),
      ...(failure.operation_id ? [`${i18n.t('webServices.managed.operationID')}: ${failure.operation_id}`] : []),
      ...(failureOccurredAt() ? [`${i18n.t('webServices.managed.failureDiagnosticOccurred')}: ${failureOccurredAt()}`] : []),
    ].join('\n');
  };
  const copyFailureDiagnostic = async () => {
    try {
      await writeTextToClipboard(failureDiagnostic());
      setFailureDiagnosticCopied(true);
      if (failureDiagnosticResetTimer !== undefined) window.clearTimeout(failureDiagnosticResetTimer);
      failureDiagnosticResetTimer = window.setTimeout(() => {
        setFailureDiagnosticCopied(false);
        failureDiagnosticResetTimer = undefined;
      }, 1_600);
    } catch (error) {
      props.onDiagnosticCopyFailure?.(error instanceof Error ? error.message : i18n.t('webServices.managed.failureDiagnosticCopyFailedMessage'));
    }
  };
  createEffect(on(() => props.operation?.operation_id, () => setOperationDetailsOpen(false)));
  createEffect(on(
    () => [props.service.last_failure?.operation_id, props.service.last_failure?.occurred_at_unix_ms] as const,
    () => setFailureDiagnosticCopied(false),
  ));
  onCleanup(() => {
    if (failureDiagnosticResetTimer !== undefined) window.clearTimeout(failureDiagnosticResetTimer);
  });
  const moreItems = (): DropdownItem[] => [
    ...(props.service.container_resources ?? []).map((resource) => ({
      id: `resource:${resource.kind}`,
      label: resource.kind === 'image'
        ? i18n.t('containers.views.images')
        : resource.kind === 'compose_project'
          ? i18n.t('containers.views.compose-projects')
          : i18n.t('containers.views.containers'),
    })),
    ...(props.service.update_available ? [{
      id: 'update',
      label: i18n.t('webServices.managed.update'),
      disabled: busy() || !props.canManage,
    }] : []),
    ...(props.onSettings ? [{
      id: 'settings',
      label: i18n.t('common.actions.settings'),
      disabled: busy() || !props.canManage,
    }] : []),
    {
      id: 'restart',
      label: i18n.t('webServices.managed.restart'),
      disabled: busy() || !props.canManage || !running(),
    },
    {
      id: 'logs',
      label: i18n.t('webServices.managed.logs'),
      disabled: busy(),
    },
    {
      id: 'uninstall',
      label: i18n.t('webServices.managed.uninstall'),
      disabled: busy() || !props.canManage,
    },
  ];
  const selectMoreItem = (id: string) => {
    if (id.startsWith('resource:')) {
      const resource = props.service.container_resources?.find((item) => `resource:${item.kind}` === id);
      if (resource) props.onOpenResource(resource);
    }
    else if (id === 'update') props.onUpdate();
    else if (id === 'settings') props.onSettings?.();
    else if (id === 'restart') props.onAction('restart');
    else if (id === 'logs') props.onLogs();
    else if (id === 'uninstall') props.onUninstall();
  };
  return (
    <div
      data-testid="managed-service-row"
      data-managed-service-id={props.service.service_id}
    >
      <div class={serviceRowGridClass}>
        <div class="min-w-0"><ServiceTemplateIdentity template={presentation()} compact /></div>

        <div class="col-start-1 row-start-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground lg:col-start-2 lg:row-start-1" data-testid="managed-service-secondary">
          <span class="truncate font-mono leading-5 text-foreground/70" title={props.service.workspace_path} data-testid="managed-service-workspace">{props.service.workspace_path}</span>
          <span aria-hidden="true">·</span>
          <span class="shrink-0" title={props.service.access_mode === 'desktop_loopback' ? i18n.t('webServices.accessMode.desktopLoopbackDescription') : i18n.t('webServices.accessMode.unifiedProxyDescription')}>
            {props.service.access_mode === 'desktop_loopback' ? i18n.t('webServices.accessMode.desktopLoopbackShort') : i18n.t('webServices.accessMode.unifiedProxyShort')}
          </span>
        </div>

        <div class="col-start-2 row-start-2 flex min-w-0 flex-col items-end gap-0.5 lg:col-start-3 lg:row-start-1" data-testid="managed-service-status">
          <Show when={operation()} keyed fallback={(
            <Show when={failed() && props.service.last_failure} keyed fallback={(
              <ServiceStatusIndicator
                label={managedStatusLabel(props.service.observed_state, i18n)}
                tone={running() ? 'success' : props.service.observed_state === 'error' ? 'error' : 'neutral'}
              />
            )}>{(failure) => (
              <div class="flex items-center gap-0.5" data-testid="managed-service-failure-diagnostic">
                <Tooltip
                  placement="top"
                  content={(
                    <div class="max-w-72 space-y-1.5 text-left">
                      <div class="font-semibold text-popover-foreground">{failure.action ? managedActionLabel(failure.action, i18n) : managedStatusLabel('error', i18n)}</div>
                      <div class="leading-5 text-popover-foreground/90">{failure.message}</div>
                      <Show when={failure.stage || failureOccurredAt()}>
                        <div class="text-[10px] text-muted-foreground">
                          <Show when={failure.stage}>{managedStageLabel(failure.stage!, i18n)}</Show>
                          <Show when={failure.stage && failureOccurredAt()}> · </Show>
                          <Show when={failureOccurredAt()}>{failureOccurredAt()}</Show>
                        </div>
                      </Show>
                    </div>
                  )}
                >
                  <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={i18n.t('webServices.managed.failureDetails')}>
                    <AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
                    {managedStatusLabel('error', i18n)}
                  </button>
                </Tooltip>
                <Tooltip content={i18n.t('webServices.managed.copyFailureDiagnostic')} placement="top">
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={i18n.t('webServices.managed.copyFailureDiagnostic')} onClick={() => void copyFailureDiagnostic()} data-testid="managed-service-copy-failure">
                    <Show when={failureDiagnosticCopied()} fallback={<Copy class="h-3.5 w-3.5" aria-hidden="true" />}>
                      <Check class="h-3.5 w-3.5" aria-hidden="true" />
                      <span class="sr-only" aria-live="polite">{i18n.t('webServices.managed.failureDiagnosticCopied')}</span>
                    </Show>
                  </button>
                </Tooltip>
              </div>
            )}</Show>
          )}>{(activeOperation) => (
            <div class="inline-flex min-h-8 max-w-full items-center gap-1.5 px-2 text-[11px] font-medium text-primary" data-testid="managed-service-active-status">
              <ManagedServiceShapingOrb />
              <span class="sr-only">{managedStageLabel(activeOperation.stage, i18n)}</span>
              <span class="shrink-0 font-mono text-muted-foreground">{Math.min(activeOperation.progress_current, activeOperation.progress_total)}/{activeOperation.progress_total}</span>
            </div>
          )}</Show>
          <Show when={props.service.update_available}><span class="text-[10px] font-medium text-warning">{i18n.t('webServices.managed.updateAvailable')}</span></Show>
        </div>

        <div class={serviceRowActionsClass} data-testid="managed-service-actions">
          <Tooltip content={props.openUnavailableReason || i18n.t('webServices.actions.openServiceTooltip')} placement="top" anchorClass="w-full">
            <Button size="sm" variant="default" class="h-8 w-full px-3" onClick={props.onOpen} disabled={!running() || busy() || !props.canOpen}><ExternalLink class="mr-1.5 h-3.5 w-3.5" />{i18n.t('webServices.actions.open')}</Button>
          </Tooltip>
          <Button size="sm" variant="outline" class="h-8 w-full whitespace-nowrap px-3" onClick={() => props.onAction(primaryAction())} disabled={busy() || !props.canManage}>
            <Show when={running()} fallback={<Show when={!failed()}><Play class="mr-1.5 h-3.5 w-3.5" /></Show>}>
              <Stop class="mr-1.5 h-3.5 w-3.5" />
            </Show>
            {primaryLabel()}
          </Button>
          <Dropdown
            align="end"
            items={moreItems()}
            onSelect={selectMoreItem}
            triggerAriaLabel={`${props.service.name}: ${i18n.t('webServices.managed.moreActions')}`}
            triggerClass="shrink-0 rounded-md"
            trigger={(
              <button
                type="button"
                class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="managed-service-more"
                title={i18n.t('webServices.managed.moreActions')}
              >
                <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          />
        </div>
      </div>
      <Show when={operation()} keyed>{(activeOperation) => (
        <ManagedOperationDisclosure
          operation={activeOperation}
          deployment={props.service.deployment}
          expanded={operationDetailsOpen()}
          canCancel={props.canManage}
          onExpandedChange={setOperationDetailsOpen}
          onCancel={() => props.onCancelOperation?.()}
        />
      )}</Show>
    </div>
  );
}

function AccessModePicker(props: Readonly<{
  value: WebServiceAccessMode;
  targetURL: string;
  disabled?: boolean;
  onChange: (mode: WebServiceAccessMode) => void;
}>) {
  const i18n = useI18n();
  const loopbackAvailable = () => parseSupportedWebServiceTarget(props.targetURL)?.protocol !== 'https:';
  const options = (): ReadonlyArray<Readonly<{
    value: WebServiceAccessMode;
    title: string;
    description: string;
    disabled: boolean;
  }>> => [
    {
      value: 'unified_proxy',
      title: i18n.t('webServices.accessMode.unifiedProxyTitle'),
      description: i18n.t('webServices.accessMode.unifiedProxyDescription'),
      disabled: false,
    },
    {
      value: 'desktop_loopback',
      title: i18n.t('webServices.accessMode.desktopLoopbackTitle'),
      description: loopbackAvailable()
        ? i18n.t('webServices.accessMode.desktopLoopbackDescription')
        : i18n.t('webServices.accessMode.desktopLoopbackHTTPOnly'),
      disabled: !loopbackAvailable(),
    },
  ];

  createEffect(() => {
    if (!loopbackAvailable() && props.value === 'desktop_loopback') props.onChange('unified_proxy');
  });

  return (
    <fieldset data-testid="web-service-access-mode">
      <legend class="mb-1.5 text-xs font-medium">{i18n.t('webServices.accessMode.label')}</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <For each={options()}>{(option) => {
          const selected = () => props.value === option.value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected()}
              disabled={props.disabled || option.disabled}
              class={cn(
                'cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55',
                selected() ? 'border-primary/55 bg-primary/[0.07]' : 'border-border bg-muted/15 hover:border-foreground/25 hover:bg-muted/30',
              )}
              data-access-mode={option.value}
              onClick={() => props.onChange(option.value)}
            >
              <span class="flex items-center gap-2 text-xs font-medium text-foreground">
                <span class={cn('h-2 w-2 rounded-full ring-2 ring-offset-2 ring-offset-background', selected() ? 'bg-primary ring-primary/35' : 'bg-muted-foreground/35 ring-transparent')} aria-hidden="true" />
                {option.title}
              </span>
              <span class="mt-1 block pl-4 text-[11px] leading-4 text-muted-foreground">{option.description}</span>
            </button>
          );
        }}</For>
      </div>
    </fieldset>
  );
}

/**
 * CreateForwardDialog - Dialog for registering a new runtime web service
 */
export function CreateForwardDialog(props: {
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (target: string, name: string, description: string, accessMode: WebServiceAccessMode) => void;
}) {
  const [target, setTarget] = createSignal('');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [accessMode, setAccessMode] = createSignal<WebServiceAccessMode>('unified_proxy');
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const i18n = useI18n();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTarget('');
      setName('');
      setDescription('');
      setAccessMode('unified_proxy');
    }
    props.onOpenChange(open);
  };

  const handleCreate = () => {
    const targetVal = target().trim();
    if (!targetVal || !isSupportedWebServiceTarget(targetVal) || !name().trim()) return;
    props.onCreate(targetVal, name().trim(), description().trim(), accessMode());
  };

  const isValid = () => {
    const val = target().trim();
    return val.length > 0
      && isSupportedWebServiceTarget(val)
      && name().trim().length > 0
      && Array.from(name().trim()).length <= 64
      && Array.from(description().trim()).length <= 256;
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
          <label class="block text-xs font-medium mb-1">{i18n.t('webServices.fields.name')} <span class="text-destructive">*</span></label>
          <Input value={name()} maxlength={64} onInput={(e) => setName(e.currentTarget.value)} placeholder={i18n.t('webServices.dialog.namePlaceholder')} size="sm" class="w-full" />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t('webServices.dialog.nameHelp')}</p>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">{i18n.t('webServices.fields.description')}</label>
          <Input
            value={description()}
            maxlength={256}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder={i18n.t('webServices.dialog.descriptionPlaceholder')}
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">{i18n.t('webServices.dialog.descriptionHelp')}</p>
        </div>
        <AccessModePicker value={accessMode()} targetURL={target()} disabled={props.loading} onChange={setAccessMode} />
      </div>
    </Dialog>
  );
}

export function ForwardMetadataDialog(props: Readonly<{
  open: boolean;
  mode: 'save' | 'edit';
  editorKey: string;
  initialName: string;
  initialDescription: string;
  initialAccessMode?: WebServiceAccessMode;
  targetURL?: string;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, description: string, accessMode: WebServiceAccessMode) => void;
}>) {
  const i18n = useI18n();
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [accessMode, setAccessMode] = createSignal<WebServiceAccessMode>('unified_proxy');
  const [validationVisible, setValidationVisible] = createSignal(false);
  let loadedKey = '';

  createEffect(() => {
    if (!props.open) {
      loadedKey = '';
      return;
    }
    const nextKey = `${props.mode}:${props.editorKey}`;
    if (loadedKey === nextKey) return;
    loadedKey = nextKey;
    setName(props.initialName);
    setDescription(props.initialDescription);
    setAccessMode(props.initialAccessMode || 'unified_proxy');
    setValidationVisible(false);
  });

  const nameError = () => {
    const value = name().trim();
    if (!value) return i18n.t('webServices.dialog.nameRequired');
    if (Array.from(value).length > 64) return i18n.t('webServices.dialog.nameTooLong');
    return '';
  };
  const descriptionError = () => Array.from(description().trim()).length > 256
    ? i18n.t('webServices.dialog.descriptionTooLong')
    : '';
  const submit = () => {
    setValidationVisible(true);
    if (nameError() || descriptionError()) return;
    props.onSubmit(name().trim(), description().trim(), accessMode());
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.mode === 'save' ? i18n.t('webServices.dialog.saveTitle') : i18n.t('webServices.dialog.editTitle')}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)} disabled={props.loading}>{i18n.t('webServices.actions.cancel')}</Button>
          <Button size="sm" variant="default" onClick={submit} disabled={props.loading}>
            <Show when={props.loading}><InlineButtonSnakeLoading class="mr-1.5" /></Show>
            {props.mode === 'save' ? i18n.t('webServices.actions.saveService') : i18n.t('webServices.actions.saveChanges')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-4" data-testid="web-service-metadata-dialog">
        <div>
          <label class="mb-1 block text-xs font-medium" for="web-service-metadata-name">{i18n.t('webServices.fields.name')} <span class="text-destructive">*</span></label>
          <Input
            id="web-service-metadata-name"
            value={name()}
            maxlength={64}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder={i18n.t('webServices.dialog.namePlaceholder')}
            aria-invalid={validationVisible() && Boolean(nameError()) ? 'true' : undefined}
            aria-describedby="web-service-metadata-name-guidance"
            autofocus
          />
          <p id="web-service-metadata-name-guidance" class={cn('mt-1 min-h-4 text-[11px]', validationVisible() && nameError() ? 'text-destructive' : 'text-muted-foreground')}>
            {validationVisible() && nameError() ? nameError() : i18n.t('webServices.dialog.nameHelp')}
          </p>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium" for="web-service-metadata-description">{i18n.t('webServices.fields.description')}</label>
          <Textarea
            id="web-service-metadata-description"
            value={description()}
            maxlength={256}
            rows={3}
            onInput={(event) => setDescription(event.currentTarget.value)}
            placeholder={i18n.t('webServices.dialog.descriptionPlaceholder')}
            aria-invalid={validationVisible() && Boolean(descriptionError()) ? 'true' : undefined}
            aria-describedby="web-service-metadata-description-guidance"
          />
          <p id="web-service-metadata-description-guidance" class={cn('mt-1 min-h-4 text-[11px]', validationVisible() && descriptionError() ? 'text-destructive' : 'text-muted-foreground')}>
            {validationVisible() && descriptionError() ? descriptionError() : i18n.t('webServices.dialog.descriptionHelp')}
          </p>
        </div>
        <AccessModePicker value={accessMode()} targetURL={props.targetURL || ''} disabled={props.loading} onChange={setAccessMode} />
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
  accessMode: WebServiceAccessMode,
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
    setStatus(copy.openingLocalProxy);
    browserTargetURL = route.url;
  }

  if (useDesktopWindow) {
    setStatus(copy.opening);
    const response = await openWebServiceWindowInDesktopShell({
      url: browserTargetURL,
      forward_id: forwardID,
      target_url: serviceTargetURL,
      access_mode: accessMode,
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
  const [forwardMetadataTarget, setForwardMetadataTarget] = createSignal<ForwardMetadataTarget | null>(null);
  const [forwardMetadataSaving, setForwardMetadataSaving] = createSignal(false);

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
  const managedOperations = createManagedServiceOperationController({
    streamFailedMessage: () => i18n.t('webServices.managed.operationStreamFailed'),
    timedOutMessage: () => i18n.t('webServices.managed.operationTimedOut'),
  });
  const [managedInstallSubmitting, setManagedInstallSubmitting] = createSignal(false);
  const [workspacePath, setWorkspacePath] = createSignal('');
  const [managedAccessMode, setManagedAccessMode] = createSignal<WebServiceAccessMode>('unified_proxy');
  const [workspacePickerOpen, setWorkspacePickerOpen] = createSignal(false);
  const [templateDrawerOpen, setTemplateDrawerOpen] = createSignal(false);
  const [templateDrawerView, setTemplateDrawerView] = createSignal<TemplateDrawerView>('catalog');
  const [templateCategory, setTemplateCategory] = createSignal<ServiceTemplateCategory>('host');
  const [templateSearch, setTemplateSearch] = createSignal('');
  const [selectedTemplateID, setSelectedTemplateID] = createSignal<string | null>(null);
  const [installNoticeAcceptances, setInstallNoticeAcceptances] = createSignal<Record<string, boolean>>({});
  const [templateDraft, setTemplateDraft] = createSignal<TemplateEditorDraft | null>(null);
  const [templateValidationVisible, setTemplateValidationVisible] = createSignal(false);
  const [templateSaving, setTemplateSaving] = createSignal(false);
  const [templateDuplicate, setTemplateDuplicate] = createSignal<ManagedCatalogTemplate | null>(null);
  const [templateDuplicateName, setTemplateDuplicateName] = createSignal('');
  const [templateDelete, setTemplateDelete] = createSignal<ManagedCatalogTemplate | null>(null);
  const [managedLogs, setManagedLogs] = createSignal<string[] | null>(null);
  const [managedUpdate, setManagedUpdate] = createSignal<ManagedService | null>(null);
  const [updateNoticeAcceptances, setUpdateNoticeAcceptances] = createSignal<Record<string, boolean>>({});
  const [managedUninstall, setManagedUninstall] = createSignal<ManagedUninstallRequest | null>(null);
  const [managedSettingsService, setManagedSettingsService] = createSignal<ManagedService | null>(null);
  const [managedDeleteConfirm, setManagedDeleteConfirm] = createSignal(false);
  const managedRowOperation = (serviceID: string) => managedOperations.operationForService(serviceID);

  const workspacePicker = createFilesystemPickerDataSource({
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
      for (const service of nextServices) {
        const activeOperation = service.active_operation;
        if (!activeOperation || managedOperations.knows(activeOperation.operation_id)) continue;
        void managedOperations.track(activeOperation)
          .then(async (terminal) => {
            try {
              await loadManaged(false);
            } finally {
              managedOperations.clear(terminal.operation_id);
            }
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            managedOperations.clear(activeOperation.operation_id);
            notify.error(i18n.t('webServices.managed.operationStreamFailed'), error instanceof Error ? error.message : String(error));
          });
      }
    } catch {
      setManagedLoadError(true);
    } finally { setManagedLoading(false); }
  };

  const openManagedContainerResource = (link: ManagedContainerResource) => {
    requestContainerResourceNavigation({
      engine: link.engine,
      endpointID: link.endpoint_id,
      view: link.view,
      identity: link.identity,
    });
    ctx.goActivity('containers');
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

  const closeTemplateDrawer = () => {
    setTemplateDrawerOpen(false);
    setTemplateDrawerView('catalog');
    setSelectedTemplateID(null);
    setTemplateDraft(null);
    setInstallNoticeAcceptances({});
    setTemplateValidationVisible(false);
  };

  const installManaged = async () => {
    const template = selectedTemplate();
    if (!template || managedInstallSubmitting() || !template.available || !requiredNoticesAccepted(template.notices, installNoticeAcceptances()) || managedState().some((service) => service.template_id === template.template_id) || !canManageManagedService()) return;
    setManagedInstallSubmitting(true);
    try {
      const result = await fetchLocalApiJSON<{ service: ManagedService; operation: ManagedOperation }>('/_redeven_proxy/api/managed-web-services', { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), template_id: template.template_id, deployment: template.deployment, workspace_path: workspacePath().trim(), access_mode: managedAccessMode(), accepted_notice_revisions: acceptedNoticeRevisions(template.notices, installNoticeAcceptances()) }) });
      const operationPromise = managedOperations.track(result.operation);
      void operationPromise
        .then(async (operation) => {
          await loadManaged(false);
          bumpRefresh();
          if (operation.state !== 'succeeded') {
            notify.error(i18n.t('webServices.notifications.failedToAddTitle'), managedOperationFailureMessage(operation, i18n.t('webServices.notifications.failedToAddTitle'), i18n));
            return;
          }
          notify.success(i18n.t('webServices.notifications.serviceAddedTitle'), i18n.t('webServices.notifications.serviceAddedMessage'));
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          notify.error(i18n.t('webServices.notifications.failedToAddTitle'), error instanceof Error ? error.message : String(error));
        })
        .finally(() => managedOperations.clear(result.operation.operation_id));

      setSearchQuery('');
      closeTemplateDrawer();
      void loadManaged(false).then(() => {
        window.requestAnimationFrame(() => {
          const row = Array.from(document.querySelectorAll<HTMLElement>('[data-managed-service-id]'))
            .find((item) => item.dataset.managedServiceId === result.service.service_id);
          if (typeof row?.scrollIntoView === 'function') {
            row.scrollIntoView({
              block: 'nearest',
              behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            });
          }
        });
      });
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToAddTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setManagedInstallSubmitting(false);
    }
  };

  const managedAction = async (serviceID: string, action: 'start' | 'stop' | 'restart' | 'retry_install' | 'update', noticeRevisions: Readonly<Record<string, number>> = {}) => {
    if (!canManageManagedService()) return;
    let operationID = managedOperations.begin(serviceID, action).operation_id;
    try {
      const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(serviceID)}/operations`, { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), action, accepted_notice_revisions: noticeRevisions }) });
      operationID = result.operation_id;
      const operationPromise = managedOperations.track(result);
      await loadManaged(false);
      const operation = await operationPromise;
      await loadManaged(false);
      if (operation.state !== 'succeeded') throw new Error(managedOperationFailureMessage(operation, managedActionFailureTitle(action, i18n), i18n));
      if (action === 'update') {
        notify.success(i18n.t('webServices.managed.updateComplete'), i18n.t('webServices.managed.updateCompleteMessage'));
      }
    } catch (error) { notify.error(managedActionFailureTitle(action, i18n), error instanceof Error ? error.message : String(error)); }
    finally { if (operationID) managedOperations.clear(operationID); }
  };

  const reconfigureManagedService = async (serviceID: string, request: ManagedReconfigureRequest) => {
    if (!canManageManagedService()) throw new Error(i18n.t('webServices.permission.executeRequired'));
    let operationID = managedOperations.begin(serviceID, 'reconfigure').operation_id;
    try {
      const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(serviceID)}/operations`, {
        method: 'POST',
        body: JSON.stringify({ request_id: managedRequestID(), action: 'reconfigure', reconfigure: request }),
      });
      operationID = result.operation_id;
      const operationPromise = managedOperations.track(result);
      await loadManaged(false);
      const operation = await operationPromise;
      await loadManaged(false);
      if (operation.state !== 'succeeded') throw new Error(managedOperationFailureMessage(operation, managedActionFailureTitle('reconfigure', i18n), i18n));
    } catch (error) {
      notify.error(managedActionFailureTitle('reconfigure', i18n), error instanceof Error ? error.message : String(error));
    } finally {
      if (operationID) managedOperations.clear(operationID);
    }
  };

  const updateManagedService = () => {
    const service = managedUpdate();
    if (!service || !service.update_available || !requiredNoticesAccepted(service.update_notices, updateNoticeAcceptances())) return;
    const accepted = acceptedNoticeRevisions(service.update_notices, updateNoticeAcceptances());
    setManagedUpdate(null);
    setUpdateNoticeAcceptances({});
    void managedAction(service.service_id, 'update', accepted);
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
    setManagedUninstall(null);
    setManagedDeleteConfirm(false);
    let operationID = managedOperations.begin(request.service.service_id, 'uninstall').operation_id;
    try {
      const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(request.service.service_id)}/operations`, { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), action: 'uninstall', delete_data: request.deleteData }) });
      operationID = result.operation_id;
      const operationPromise = managedOperations.track(result);
      await loadManaged(false);
      const operation = await operationPromise;
      await loadManaged(false);
      if (operation.state !== 'succeeded') throw new Error(managedOperationFailureMessage(operation, i18n.t('webServices.notifications.failedToDeleteTitle'), i18n));
      bumpRefresh();
      notify.success(i18n.t('webServices.managed.uninstallComplete'), i18n.t('webServices.managed.uninstallCompleteMessage'));
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToDeleteTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      if (operationID) managedOperations.clear(operationID);
    }
  };

  const cancelManagedOperation = async (operation: ManagedOperation | null | undefined) => {
    if (!canManageManagedService()) return;
    if (!operation || !['pending', 'running', 'cancelling'].includes(operation.state)) return;
    try {
      await managedOperations.cancel(operation);
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

  const installedServiceForTemplate = (template: ManagedCatalogTemplate) => managedState().find((service) => service.template_id === template.template_id);
  const templateOpenUnavailableReason = (service: ManagedService | undefined) => {
    if (!service) return '';
    if (managedOperationActive(managedRowOperation(service.service_id))) return i18n.t('webServices.managed.openUnavailableOperation');
    if (service.observed_state !== 'running') return i18n.t('webServices.managed.openUnavailableNotRunning');
    if (!canExecute()) return i18n.t('webServices.permission.executeRequired');
    if (busyID() === `managed:${service.service_id}`) return i18n.t('webServices.status.opening');
    if (service.access_mode === 'desktop_loopback' && !desktopShellWebServiceWindowOpenAvailable()) return i18n.t('webServices.errors.desktopLoopbackRequiresDesktop');
    return '';
  };
  const openInstalledTemplate = (templateID: string) => {
    const template = templateByID(templateID);
    const service = template ? installedServiceForTemplate(template) : undefined;
    if (!service || templateOpenUnavailableReason(service)) return;
    void openManaged(service);
  };
  const templatePresentation = (template: ManagedCatalogTemplate): ServiceTemplatePresentation => {
    const identity = managedTemplateLocalizedIdentity(template, i18n);
    const installedService = installedServiceForTemplate(template);
    const openUnavailableReason = templateOpenUnavailableReason(installedService);
    return {
      id: template.template_id,
      name: identity.name,
      description: identity.description,
      source: template.source,
      kind: managedTemplateKind(template),
      brandIcon: template.brand_icon,
      deploymentLabel: managedDeploymentLabel(template.deployment, i18n),
      version: template.version,
      revision: template.revision,
      diskBytes: template.disk_bytes,
      dataLocation: template.data_location,
      sourceURL: template.source_url,
      dockerSourceURL: template.docker_source_url,
      defaultWorkspacePath: template.default_workspace_path,
      defaultAccessMode: template.default_access_mode,
      runtimeSpec: template.effective_spec,
      hostLifecyclePlan: template.host_lifecycle_plan,
      developerPreview: template.developer_preview,
      available: template.available,
      availabilityReason: templateUnavailableReason(template),
      installed: Boolean(installedService),
      openable: Boolean(installedService) && !openUnavailableReason,
      openUnavailableReason,
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
    setTemplateValidationVisible(false);
    setInstallNoticeAcceptances({});
    setTemplateDrawerOpen(true);
  };

  const beginTemplateInstall = (template: ManagedCatalogTemplate) => {
    if (!template.available || installedServiceForTemplate(template)) return;
    setSelectedTemplateID(template.template_id);
    setWorkspacePath(template.default_workspace_path);
    setManagedAccessMode(template.default_access_mode || 'unified_proxy');
    setInstallNoticeAcceptances({});
    setTemplateDrawerView('install');
  };

  const beginTemplateCreate = (kind: 'host' | 'container' | 'compose') => {
    setTemplateDraft(emptyTemplateDraft(kind));
    setTemplateValidationVisible(false);
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
    setTemplateValidationVisible(false);
    setTemplateDrawerView('editor');
  };

  const templateDraftErrors = createMemo(() => {
    const draft = templateDraft();
    return draft ? validateTemplateDraft(draft) : {};
  });

  const saveTemplate = async () => {
    const draft = templateDraft();
    if (!draft || !canManageManagedService()) return;
    const errors = validateTemplateDraft(draft);
    const firstInvalidField = (Object.keys(errors) as TemplateEditorField[])[0];
    if (firstInvalidField) {
      setTemplateValidationVisible(true);
      queueMicrotask(() => document.querySelector<HTMLElement>(`[data-template-field="${firstInvalidField}"]`)?.focus());
      return;
    }
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
      setTemplateValidationVisible(false);
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

  createEffect(() => { if (permissionReady() && canRead()) void loadManaged(); });
  onCleanup(() => managedOperations.dispose());

  // Create service handler
  const doCreate = async (target: string, name: string, description: string, accessMode: WebServiceAccessMode) => {
    if (!target) {
      notify.error(i18n.t('webServices.notifications.missingTargetTitle'), i18n.t('webServices.notifications.missingTargetMessage'));
      return;
    }
    setCreateLoading(true);
    try {
      await fetchLocalApiJSON('/_redeven_proxy/api/forwards', {
        method: 'POST',
        body: JSON.stringify({ target, name, description, access_mode: accessMode }),
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
    const accessMode = f.access_mode || 'unified_proxy';
    if (accessMode === 'desktop_loopback' && !useDesktopWindow) {
      throw new Error(i18n.t('webServices.errors.desktopLoopbackRequiresDesktop'));
    }
    const fid = String(f.forward_id).trim();
    setBusyText(i18n.t('webServices.status.resolvingRoute'));
    const localRuntime = await getLocalRuntime().catch(() => null);
    const desktopContext = readDesktopSessionContextSnapshot();
    const route = resolveWebServiceOpenRoute({
      forwardID: fid,
      localRuntime,
      desktopContext,
      appPath,
      desktopWindowAvailable: useDesktopWindow,
    });
    await openWebServiceRoute(route, fid, f.target_url, accessMode, appPath, useDesktopWindow, (s) => setBusyText(s), {
      missingEnvContext: i18n.t('webServices.errors.missingEnvContext'),
      opening: i18n.t('webServices.status.opening'),
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

  const doSaveRecentSession = async (session: ForwardSession, name: string, description: string, accessMode: WebServiceAccessMode) => {
    if (!session.ephemeral || forwardMetadataSaving()) return;
    setForwardMetadataSaving(true);
    try {
      const forward = await fetchLocalApiJSON<PortForward>(`/_redeven_proxy/api/forward-sessions/${encodeURIComponent(session.forward.forward_id)}/save`, {
        method: 'POST',
        body: JSON.stringify({ name, description, access_mode: accessMode }),
      });
      setRecentSession({ ...session, forward, ephemeral: false });
      setForwardMetadataTarget(null);
      bumpRefresh();
      notify.success(i18n.t('webServices.notifications.sessionSavedTitle'), i18n.t('webServices.notifications.sessionSavedMessage', { name }));
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToSaveTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setForwardMetadataSaving(false);
    }
  };

  const doUpdateForwardMetadata = async (forward: PortForward, name: string, description: string, accessMode: WebServiceAccessMode) => {
    if (forwardMetadataSaving()) return;
    setForwardMetadataSaving(true);
    try {
      await fetchLocalApiJSON<PortForward>(`/_redeven_proxy/api/forwards/${encodeURIComponent(forward.forward_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description, access_mode: accessMode }),
      });
      setForwardMetadataTarget(null);
      bumpRefresh();
      notify.success(i18n.t('webServices.notifications.serviceUpdatedTitle'), i18n.t('webServices.notifications.serviceUpdatedMessage', { name }));
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToUpdateTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setForwardMetadataSaving(false);
    }
  };

  const submitForwardMetadata = (name: string, description: string, accessMode: WebServiceAccessMode) => {
    const target = forwardMetadataTarget();
    if (!target) return;
    if (target.mode === 'save') void doSaveRecentSession(target.session, name, description, accessMode);
    else void doUpdateForwardMetadata(target.forward, name, description, accessMode);
  };

  // Find the service being deleted for the confirmation dialog
  const deleteTarget = createMemo(() => {
    const id = deleteID();
    if (!id) return null;
    return forwards()?.find((f) => f.forward_id === id) ?? null;
  });

  const forwardMetadataDialog = createMemo(() => {
    const target = forwardMetadataTarget();
    if (!target) return null;
    if (target.mode === 'save') {
      const forward = target.session.forward;
      return {
        mode: target.mode,
        editorKey: forward.forward_id,
        initialName: forward.name || new URL(forward.target_url).host,
        initialDescription: forward.description,
        initialAccessMode: forward.access_mode || 'unified_proxy',
        targetURL: forward.target_url,
      } as const;
    }
    return {
      mode: target.mode,
      editorKey: target.forward.forward_id,
      initialName: target.forward.name,
      initialDescription: target.forward.description,
      initialAccessMode: target.forward.access_mode || 'unified_proxy',
      targetURL: target.forward.target_url,
    } as const;
  });

  return (
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class={cn('flex h-full min-h-0 flex-col overflow-hidden', redevenSurfaceRoleClass('main'))}>
      <header class="shrink-0 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-5" data-testid="web-services-panel">
        <div class="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3">
          <div class="min-w-0">
            <h1 class="text-base font-semibold tracking-tight">{i18n.t('webServices.title')}</h1>
            <p class="hidden text-xs leading-5 text-muted-foreground sm:block">{i18n.t('webServices.description')}</p>
          </div>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={openTemplateCatalog}
              disabled={managedLoading() || (permissionReady() && !canRead())}
              class={cn('h-8', outlineControlClass)}
              data-testid="service-templates-button"
            >
              <FileText class="mr-1.5 h-3.5 w-3.5" />
              <span>{i18n.t('webServices.managed.serviceTemplates')}</span>
            </Button>
            <Button
              size="sm"
              variant="default"
              class="h-8"
              onClick={() => setCreateOpen(true)}
              disabled={!!busyID() || (permissionReady() && !canExecute())}
              aria-label={i18n.t('webServices.actions.addService')}
              title={i18n.t('webServices.actions.addService')}
            >
              <Plus class="mr-1.5 h-3.5 w-3.5" />
              <span>{i18n.t('webServices.actions.addService')}</span>
            </Button>
          </div>
        </div>
      </header>

      <main {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="min-h-0 flex-1 overflow-auto px-4 py-5 md:px-5">
        <div class="mx-auto w-full max-w-5xl space-y-6">
          <section aria-labelledby="web-service-address-label">
            <div class="mb-2 flex items-center gap-2">
              <Globe class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <h2 id="web-service-address-label" class="text-xs font-medium text-foreground">{i18n.t('webServices.address.label')}</h2>
            </div>
            <form
              class="w-full"
              onSubmit={(event) => {
                event.preventDefault();
                void doOpenAddress();
              }}
              data-testid="web-service-address-form"
            >
              <div class="flex w-full flex-col gap-2 sm:flex-row">
                <div class="min-w-0 flex-1" data-testid="web-service-address-input-shell">
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
                      'h-10 w-full font-mono text-sm',
                      addressValidationVisible() && 'border-warning/45 focus-visible:border-warning/60 focus-visible:ring-warning/20',
                    )}
                    disabled={!canExecute() || !!busyID()}
                    data-testid="web-service-address-input"
                  />
                </div>
                <Button type="submit" size="sm" class="h-10 shrink-0 px-4" disabled={!canExecute() || !!busyID() || !address().trim()} data-testid="web-service-address-open">
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

              <Show when={recentSession()?.ephemeral && recentSession()} keyed>
                {(session) => (
                  <div class="mt-3 flex flex-col gap-2 rounded-lg bg-muted/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex min-w-0 items-center gap-2">
                      <Tag variant="neutral" tone="soft" size="sm">{i18n.t('webServices.session.temporary')}</Tag>
                      <span class="truncate font-mono text-xs text-foreground">{session.forward.target_url}{session.app_path === '/' ? '' : session.app_path}</span>
                    </div>
                    <Button type="button" size="sm" variant="ghost" class="h-8 shrink-0" onClick={() => setForwardMetadataTarget({ mode: 'save', session })} disabled={forwardMetadataSaving()}>
                      <Save class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      {i18n.t('webServices.actions.saveService')}
                    </Button>
                  </div>
                )}
              </Show>
            </form>
          </section>

          <Show when={permissionReady() && !canExecute()}>
            <div class="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
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

          <section class="space-y-3" data-testid="web-services-collection" aria-labelledby="web-services-collection-title">
            <Show when={unmanagedForwards().length > 0 || managedState().length > 0}>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div class="flex items-baseline gap-2">
                  <h2 id="web-services-collection-title" class="text-sm font-semibold tracking-tight">{i18n.t('webServices.collection.title')}</h2>
                  <span class="text-xs tabular-nums text-muted-foreground">{unmanagedForwards().length + managedState().length}</span>
                </div>
                <div class="flex min-w-0 items-center gap-2 sm:ml-auto" data-testid="web-services-toolbar-actions">
                  <div class="relative min-w-0 sm:w-64" data-testid="web-services-search">
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { bumpRefresh(); void loadManaged(true); }}
                    disabled={!!busyID() || forwards.loading || managedLoading()}
                    aria-label={i18n.t('webServices.actions.refresh')}
                    aria-busy={forwardsRefreshing() ? 'true' : undefined}
                    title={i18n.t('webServices.actions.refresh')}
                    class="h-9 w-9 shrink-0 px-0"
                    data-testid="web-services-refresh"
                  >
                    <RefreshIcon class={cn('h-4 w-4', forwardsRefreshing() && 'animate-spin motion-reduce:animate-none')} />
                  </Button>
                </div>
              </div>
            </Show>

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
                    <div class="flex flex-col items-center justify-center px-4 py-12">
                      <p class="text-sm text-muted-foreground">{i18n.t('webServices.search.noMatches', { query: searchQuery() })}</p>
                      <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="mt-2">{i18n.t('webServices.search.clear')}</Button>
                    </div>
                  }>
                    <div class={cn('overflow-hidden rounded-xl border divide-y', redevenSurfaceRoleClass('panel'))} data-testid="unified-web-services-list">
                      <For each={filteredManagedServices()}>{(service) => (
                        <ManagedServiceRow
                          service={service}
                          operation={managedRowOperation(service.service_id)}
                          busy={busyID() === `managed:${service.service_id}`}
                          canOpen={canExecute() && (service.access_mode !== 'desktop_loopback' || desktopShellWebServiceWindowOpenAvailable())}
                          openUnavailableReason={service.access_mode === 'desktop_loopback' && !desktopShellWebServiceWindowOpenAvailable()
                            ? i18n.t('webServices.errors.desktopLoopbackRequiresDesktop')
                            : undefined}
                          canManage={canManageManagedService()}
                          onOpen={() => void openManaged(service)}
                          onOpenResource={openManagedContainerResource}
                          onAction={(action) => void managedAction(service.service_id, action)}
                          onCancelOperation={() => void cancelManagedOperation(managedRowOperation(service.service_id))}
                          onDiagnosticCopyFailure={(message) => notify.error(i18n.t('webServices.managed.failureDiagnosticCopyFailedTitle'), message)}
                          onSettings={() => setManagedSettingsService(service)}
                          onUpdate={() => { setManagedUpdate(service); setUpdateNoticeAcceptances({}); }}
                          onLogs={() => void loadManagedLogs(service.service_id)}
                          onUninstall={() => setManagedUninstall({ service, deleteData: false })}
                        />
                      )}</For>
                      <For each={filteredForwards()}>{(forward) => (
                        <PortForwardRow
                          forward={forward}
                          busy={busyID() === forward.forward_id}
                          busyText={busyID() === forward.forward_id ? busyText() : undefined}
                          canOpen={forward.access_mode !== 'desktop_loopback' || desktopShellWebServiceWindowOpenAvailable()}
                          openUnavailableReason={forward.access_mode === 'desktop_loopback' && !desktopShellWebServiceWindowOpenAvailable()
                            ? i18n.t('webServices.errors.desktopLoopbackRequiresDesktop')
                            : undefined}
                          onOpen={() => void doOpen(forward)}
                          onEdit={() => setForwardMetadataTarget({ mode: 'edit', forward })}
                          onDelete={() => setDeleteID(forward.forward_id)}
                        />
                      )}</For>
                    </div>
                  </Show>
                </Show>
              </Show>
              <Show when={managedLoadError()}><p class="mt-3 text-xs text-warning">{i18n.t('webServices.errors.loadFailedPrefix')}</p></Show>
            </div>
          </section>
        </div>
      </main>

      {/* Create dialog */}
      <CreateForwardDialog open={createOpen()} loading={createLoading()} onOpenChange={setCreateOpen} onCreate={doCreate} />
      <ForwardMetadataDialog
        open={Boolean(forwardMetadataDialog())}
        mode={forwardMetadataDialog()?.mode ?? 'edit'}
        editorKey={forwardMetadataDialog()?.editorKey ?? ''}
        initialName={forwardMetadataDialog()?.initialName ?? ''}
        initialDescription={forwardMetadataDialog()?.initialDescription ?? ''}
        initialAccessMode={forwardMetadataDialog()?.initialAccessMode ?? 'unified_proxy'}
        targetURL={forwardMetadataDialog()?.targetURL ?? ''}
        loading={forwardMetadataSaving()}
        onOpenChange={(open) => { if (!open && !forwardMetadataSaving()) setForwardMetadataTarget(null); }}
        onSubmit={submitForwardMetadata}
      />

      <ManagedServiceSettingsDrawer
        open={managedSettingsService() !== null}
        serviceID={managedSettingsService()?.service_id ?? ''}
        serviceName={managedSettingsService()?.name ?? ''}
        canManage={canManageManagedService()}
        onOpenChange={(open) => { if (!open) setManagedSettingsService(null); }}
        onChanged={() => { void loadManaged(false); bumpRefresh(); }}
        onRequestStop={() => {
          const service = managedSettingsService();
          if (!service) return;
          setManagedSettingsService(null);
          void managedAction(service.service_id, 'stop');
        }}
        onApply={async (request) => {
          const service = managedSettingsService();
          if (!service) return;
          setManagedSettingsService(null);
          await reconfigureManagedService(service.service_id, request);
        }}
        onDuplicateTemplate={() => {
          const service = managedSettingsService();
          const template = service ? managedTemplates().find((item) => item.template_id === service.template_id) : null;
          if (!template) return;
          setManagedSettingsService(null);
          setTemplateDuplicate(template);
          setTemplateDuplicateName(i18n.t('webServices.managed.copyName', { name: template.name }));
        }}
      />

      <EnvAppDrawer
        open={templateDrawerOpen()}
        class="service-template-explorer-drawer"
        bodyClass="h-full"
        onOpenChange={(open) => {
          if (templateSaving()) return;
          if (open) setTemplateDrawerOpen(true);
          else closeTemplateDrawer();
        }}
        title={templateDrawerView() === 'catalog' ? i18n.t('webServices.managed.serviceTemplates') : templateDrawerView() === 'install' ? i18n.t('webServices.managed.deployTemplate') : templateDraft()?.templateID ? i18n.t('webServices.managed.editTemplate') : i18n.t('webServices.managed.newTemplate')}
        description={templateDrawerView() === 'catalog' ? i18n.t('webServices.managed.templateCenterDescription') : undefined}
        footer={templateDrawerView() === 'catalog' ? undefined : (
          <div class="flex w-full items-center justify-between gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setTemplateDrawerView('catalog'); setSelectedTemplateID(null); setTemplateDraft(null); setTemplateValidationVisible(false); setInstallNoticeAcceptances({}); }} disabled={templateSaving()}>{i18n.t('webServices.managed.backToTemplates')}</Button>
            <div class="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={closeTemplateDrawer} disabled={templateSaving()}>{templateDrawerView() === 'install' ? i18n.t('common.actions.close') : i18n.t('webServices.actions.cancel')}</Button>
              <Show when={templateDrawerView() === 'install'}>
                <Button size="sm" variant="default" onClick={() => void installManaged()} disabled={managedInstallSubmitting() || !canManageManagedService() || !workspacePath().trim() || !selectedTemplate()?.available || !requiredNoticesAccepted(selectedTemplate()?.notices, installNoticeAcceptances())}>{managedInstallSubmitting() ? i18n.t('webServices.managed.operationStarting') : i18n.t('webServices.managed.installStart')}</Button>
              </Show>
              <Show when={templateDrawerView() === 'editor'}>
                <Button size="sm" variant="default" onClick={() => void saveTemplate()} disabled={templateSaving() || !canManageManagedService()}>{templateSaving() ? i18n.t('webServices.managed.savingTemplate') : i18n.t('webServices.managed.saveTemplate')}</Button>
              </Show>
            </div>
          </div>
        )}
      >
        <div class="service-template-drawer-shell h-full min-h-0 space-y-4 p-1" data-view={templateDrawerView()} data-testid="service-template-drawer">
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
              onOpen={openInstalledTemplate}
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
                      disabled={managedInstallSubmitting()}
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
                    disabled={managedInstallSubmitting()}
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
              <section class="service-template-install-section border-t pt-4">
                <AccessModePicker
                  value={managedAccessMode()}
                  targetURL={`${template.spec?.endpoint.scheme ?? 'http'}://127.0.0.1`}
                  disabled={managedInstallSubmitting()}
                  onChange={setManagedAccessMode}
                />
              </section>
              <Show when={(template.notices?.length ?? 0) > 0}>
                <ManagedTemplateNotices
                  notices={template.notices ?? []}
                  accepted={installNoticeAcceptances()}
                  disabled={managedInstallSubmitting()}
                  onAcceptedChange={(noticeID, accepted) => setInstallNoticeAcceptances((current) => ({ ...current, [noticeID]: accepted }))}
                />
              </Show>
              <Show when={template.source_url}><a class="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={template.source_url} target="_blank" rel="noreferrer">{i18n.t('webServices.managed.sourceCode')}<ExternalLink class="h-3 w-3" /></a></Show>
            </div>
          )}</Show>

          <Show when={templateDrawerView() === 'editor' && templateDraft()}>{(currentDraft) => {
            const draft = () => currentDraft() as TemplateEditorDraft;
            const error = (field: TemplateEditorField) => templateDraftErrors()[field];
            const invalid = (field: TemplateEditorField) => templateValidationVisible() && Boolean(error(field));
            const update = (patch: Partial<TemplateEditorDraft>) => setTemplateDraft({ ...draft(), ...patch });
            return (
              <div class="service-template-editor space-y-5">
                <div class="rounded-lg border border-warning/25 bg-warning/[0.05] px-3.5 py-3 text-xs leading-5 text-muted-foreground">{i18n.t('webServices.managed.customTemplateSafety')}</div>
                <section class="service-template-editor__section">
                  <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.templateBasics')}</h3>
                  <div class="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
                    <div>
                      <TemplateEditorLabel for="template-editor-name" label={i18n.t('webServices.managed.templateName')} required />
                      <Input id="template-editor-name" data-template-field="name" value={draft().name} maxlength={80} placeholder={i18n.t('webServices.managed.placeholders.templateName')} aria-invalid={invalid('name') ? 'true' : undefined} aria-describedby="template-editor-name-help" onInput={(event) => update({ name: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-name-help" help={i18n.t('webServices.managed.help.templateName')} error={error('name')} visible={templateValidationVisible()} />
                    </div>
                    <div>
                      <TemplateEditorLabel for="template-editor-version" label={i18n.t('webServices.managed.templateVersion')} />
                      <Input id="template-editor-version" data-template-field="version" value={draft().version} maxlength={80} placeholder={i18n.t('webServices.managed.placeholders.templateVersion')} aria-invalid={invalid('version') ? 'true' : undefined} aria-describedby="template-editor-version-help" onInput={(event) => update({ version: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-version-help" help={i18n.t('webServices.managed.help.templateVersion')} error={error('version')} visible={templateValidationVisible()} />
                    </div>
                  </div>
                  <div class="mt-3">
                    <TemplateEditorLabel for="template-editor-description" label={i18n.t('webServices.managed.templateDescriptionLabel')} />
                    <Textarea id="template-editor-description" data-template-field="description" value={draft().description} maxlength={1000} rows={3} placeholder={i18n.t('webServices.managed.placeholders.templateDescription')} aria-invalid={invalid('description') ? 'true' : undefined} aria-describedby="template-editor-description-help" onInput={(event) => update({ description: event.currentTarget.value })} />
                    <TemplateEditorGuidance id="template-editor-description-help" help={i18n.t('webServices.managed.help.templateDescription')} error={error('description')} visible={templateValidationVisible()} />
                  </div>
                </section>

                <section class="service-template-editor__section">
                  <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.endpointSettings')}</h3>
                  <div class="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-[180px_1fr_1fr]">
                    <div>
                      <div class="mb-1 text-xs font-medium">{i18n.t('webServices.managed.webScheme')} <span class="text-destructive" aria-hidden="true">*</span></div>
                      <div class="service-template-scheme-picker grid h-9 grid-cols-2 gap-1 rounded-md p-1" role="radiogroup" aria-label={i18n.t('webServices.managed.webScheme')}>
                        <For each={['http', 'https'] as const}>{(scheme) => <button type="button" role="radio" aria-checked={draft().scheme === scheme} class="service-template-scheme-picker__option cursor-pointer rounded px-2 text-xs font-semibold uppercase" onClick={() => update({ scheme })}>{scheme}</button>}</For>
                      </div>
                      <TemplateEditorGuidance id="template-editor-scheme-help" help={i18n.t('webServices.managed.help.webScheme')} visible={false} />
                    </div>
                    <div>
                      <TemplateEditorLabel for="template-editor-path" label={i18n.t('webServices.managed.webPath')} />
                      <Input id="template-editor-path" data-template-field="path" value={draft().path} placeholder={i18n.t('webServices.managed.placeholders.webPath')} class="font-mono" aria-invalid={invalid('path') ? 'true' : undefined} aria-describedby="template-editor-path-help" onInput={(event) => update({ path: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-path-help" help={i18n.t('webServices.managed.help.webPath')} error={error('path')} visible={templateValidationVisible()} />
                    </div>
                    <div>
                      <TemplateEditorLabel for="template-editor-health-path" label={i18n.t('webServices.managed.healthPath')} />
                      <Input id="template-editor-health-path" data-template-field="healthPath" value={draft().healthPath} placeholder={i18n.t('webServices.managed.placeholders.healthPath')} class="font-mono" aria-invalid={invalid('healthPath') ? 'true' : undefined} aria-describedby="template-editor-health-path-help" onInput={(event) => update({ healthPath: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-health-path-help" help={i18n.t('webServices.managed.help.healthPath')} error={error('healthPath')} visible={templateValidationVisible()} />
                    </div>
                  </div>
                </section>

                <section class="service-template-editor__section">
                  <h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.serviceRuntimeSettings')}</h3>
                  <Show when={draft().kind === 'host'}>
                    <p class="mt-2 text-xs leading-5 text-muted-foreground">{i18n.t('webServices.managed.hostScriptNote')}</p>
                    <Show when={draft().hostLifecyclePlan} fallback={(
                      <section class="service-template-lifecycle-plan mt-4" data-testid="host-lifecycle-plan-pending">
                        <h4 class="text-[11px] font-semibold leading-5 text-foreground">{i18n.t('webServices.managed.managedLifecycle')}</h4>
                        <p class="mt-1 text-[11px] leading-4 text-muted-foreground">{i18n.t('webServices.managed.lifecyclePlanAfterSave')}</p>
                      </section>
                    )}>{(plan) => (
                      <div class="mt-4">
                        <HostLifecyclePlanDetails plan={plan()} templateCommands="reference" />
                      </div>
                    )}</Show>
                    <div class="mt-3">
                      <TemplateEditorLabel for="template-editor-start-script" label={i18n.t('webServices.managed.startScript')} required />
                      <Textarea id="template-editor-start-script" data-template-field="startScript" value={draft().startScript} rows={7} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.startScript')} aria-invalid={invalid('startScript') ? 'true' : undefined} aria-describedby="template-editor-start-script-help" onInput={(event) => update({ startScript: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-start-script-help" help={i18n.t('webServices.managed.help.startScript')} error={error('startScript')} visible={templateValidationVisible()} />
                    </div>
                    <details class="service-template-editor__advanced mt-3" open={Boolean(draft().installScript || draft().stopScript || draft().uninstallScript)}>
                      <summary class="cursor-pointer py-2 text-xs font-medium text-muted-foreground">{i18n.t('webServices.managed.lifecycleHooks')}</summary>
                      <div class="space-y-3 pb-1 pt-2">
                        <div>
                          <TemplateEditorLabel
                            for="template-editor-install-script"
                            label={i18n.t(draft().hostLifecyclePlan?.install.steps.some((step) => step.kind === 'prepare_verified_package') ? 'webServices.managed.afterInstallHook' : 'webServices.managed.installScript')}
                          />
                          <Textarea id="template-editor-install-script" value={draft().installScript} rows={5} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.installScript')} aria-describedby="template-editor-install-script-help" onInput={(event) => update({ installScript: event.currentTarget.value })} />
                          <p id="template-editor-install-script-help" class="mt-1 text-[11px] leading-4 text-muted-foreground">
                            {i18n.t(draft().hostLifecyclePlan?.install.steps.some((step) => step.kind === 'prepare_verified_package') ? 'webServices.managed.help.afterInstallHook' : 'webServices.managed.help.installScript')}
                            <Show when={!draft().installScript.trim()}> {i18n.t('webServices.managed.noAdditionalCommand')}</Show>
                          </p>
                        </div>
                        <div class="grid gap-3 sm:grid-cols-2">
                          <div>
                            <TemplateEditorLabel for="template-editor-stop-script" label={i18n.t('webServices.managed.beforeStopHook')} />
                            <Textarea id="template-editor-stop-script" value={draft().stopScript} rows={4} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.stopScript')} aria-describedby="template-editor-stop-script-help" onInput={(event) => update({ stopScript: event.currentTarget.value })} />
                            <p id="template-editor-stop-script-help" class="mt-1 text-[11px] leading-4 text-muted-foreground">
                              {i18n.t('webServices.managed.help.beforeStopHook')}<Show when={!draft().stopScript.trim()}> {i18n.t('webServices.managed.noAdditionalCommand')}</Show>
                            </p>
                          </div>
                          <div>
                            <TemplateEditorLabel for="template-editor-uninstall-script" label={i18n.t('webServices.managed.beforeUninstallHook')} />
                            <Textarea id="template-editor-uninstall-script" value={draft().uninstallScript} rows={4} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.uninstallScript')} aria-describedby="template-editor-uninstall-script-help" onInput={(event) => update({ uninstallScript: event.currentTarget.value })} />
                            <p id="template-editor-uninstall-script-help" class="mt-1 text-[11px] leading-4 text-muted-foreground">
                              {i18n.t('webServices.managed.help.beforeUninstallHook')}<Show when={!draft().uninstallScript.trim()}> {i18n.t('webServices.managed.noAdditionalCommand')}</Show>
                            </p>
                          </div>
                        </div>
                      </div>
                    </details>
                  </Show>

                  <Show when={draft().kind === 'container'}>
                    <div class="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-[1fr_160px]">
                      <div>
                        <TemplateEditorLabel for="template-editor-image" label={i18n.t('webServices.managed.containerImage')} required />
                        <Input id="template-editor-image" data-template-field="image" value={draft().image} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.containerImage')} aria-invalid={invalid('image') ? 'true' : undefined} aria-describedby="template-editor-image-help" onInput={(event) => update({ image: event.currentTarget.value })} />
                        <TemplateEditorGuidance id="template-editor-image-help" help={i18n.t('webServices.managed.help.containerImage')} error={error('image')} visible={templateValidationVisible()} />
                      </div>
                      <div>
                        <TemplateEditorLabel for="template-editor-port" label={i18n.t('webServices.managed.containerPort')} required />
                        <Input id="template-editor-port" data-template-field="containerPort" type="number" min="1" max="65535" value={draft().containerPort} placeholder={i18n.t('webServices.managed.placeholders.containerPort')} inputmode="numeric" aria-invalid={invalid('containerPort') ? 'true' : undefined} aria-describedby="template-editor-port-help" onInput={(event) => update({ containerPort: event.currentTarget.value })} />
                        <TemplateEditorGuidance id="template-editor-port-help" help={i18n.t('webServices.managed.help.containerPort')} error={error('containerPort')} visible={templateValidationVisible()} />
                      </div>
                    </div>
                    <details class="service-template-editor__advanced mt-3" open={Boolean(draft().entrypoint || draft().command || draft().environment)}>
                      <summary class="cursor-pointer py-2 text-xs font-medium text-muted-foreground">{i18n.t('webServices.managed.optionalContainerSettings')}</summary>
                      <div class="space-y-3 pb-1 pt-2">
                        <div><TemplateEditorLabel for="template-editor-entrypoint" label={i18n.t('webServices.managed.entrypoint')} /><Input id="template-editor-entrypoint" value={draft().entrypoint} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.entrypoint')} onInput={(event) => update({ entrypoint: event.currentTarget.value })} /></div>
                        <div class="grid gap-3 sm:grid-cols-2">
                          <div><TemplateEditorLabel for="template-editor-command" label={i18n.t('webServices.managed.commandArguments')} /><Textarea id="template-editor-command" value={draft().command} rows={5} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.commandArguments')} onInput={(event) => update({ command: event.currentTarget.value })} /></div>
                          <div><TemplateEditorLabel for="template-editor-environment" label={i18n.t('webServices.managed.environmentVariables')} /><Textarea id="template-editor-environment" data-template-field="environment" value={draft().environment} rows={5} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.environmentVariables')} aria-invalid={invalid('environment') ? 'true' : undefined} aria-describedby="template-editor-environment-help" onInput={(event) => update({ environment: event.currentTarget.value })} /><TemplateEditorGuidance id="template-editor-environment-help" help={i18n.t('webServices.managed.help.environmentVariables')} error={error('environment')} visible={templateValidationVisible()} /></div>
                        </div>
                      </div>
                    </details>
                  </Show>

                  <Show when={draft().kind === 'compose'}>
                    <div class="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-[1fr_180px]">
                      <div>
                        <TemplateEditorLabel for="template-editor-main-service" label={i18n.t('webServices.managed.composeMainService')} required />
                        <Input id="template-editor-main-service" data-template-field="mainService" value={draft().mainService} placeholder={i18n.t('webServices.managed.placeholders.composeMainService')} aria-invalid={invalid('mainService') ? 'true' : undefined} aria-describedby="template-editor-main-service-help" onInput={(event) => update({ mainService: event.currentTarget.value })} />
                        <TemplateEditorGuidance id="template-editor-main-service-help" help={i18n.t('webServices.managed.help.composeMainService')} error={error('mainService')} visible={templateValidationVisible()} />
                      </div>
                      <div>
                        <TemplateEditorLabel for="template-editor-compose-port" label={i18n.t('webServices.managed.containerPort')} required />
                        <Input id="template-editor-compose-port" data-template-field="containerPort" type="number" min="1" max="65535" value={draft().containerPort} placeholder={i18n.t('webServices.managed.placeholders.containerPort')} inputmode="numeric" aria-invalid={invalid('containerPort') ? 'true' : undefined} aria-describedby="template-editor-compose-port-help" onInput={(event) => update({ containerPort: event.currentTarget.value })} />
                        <TemplateEditorGuidance id="template-editor-compose-port-help" help={i18n.t('webServices.managed.help.containerPort')} error={error('containerPort')} visible={templateValidationVisible()} />
                      </div>
                    </div>
                    <div class="mt-3">
                      <TemplateEditorLabel for="template-editor-compose-yaml" label={i18n.t('webServices.managed.composeYAML')} required />
                      <Textarea id="template-editor-compose-yaml" data-template-field="composeYAML" value={draft().composeYAML} rows={14} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.composeYAML')} aria-invalid={invalid('composeYAML') ? 'true' : undefined} aria-describedby="template-editor-compose-yaml-help" onInput={(event) => update({ composeYAML: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-compose-yaml-help" help={i18n.t('webServices.managed.help.composeYAML')} error={error('composeYAML')} visible={templateValidationVisible()} />
                    </div>
                  </Show>
                </section>
              </div>
            );
          }}</Show>
        </div>
      </EnvAppDrawer>

      <DirectoryPicker
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
        onOpenChange={(open) => { if (!open) { setManagedUpdate(null); setUpdateNoticeAcceptances({}); } }}
        title={i18n.t('webServices.managed.updateTitle')}
        footer={(
          <div class="flex w-full justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setManagedUpdate(null); setUpdateNoticeAcceptances({}); }}>{i18n.t('webServices.actions.cancel')}</Button>
            <Button size="sm" variant="default" onClick={updateManagedService} disabled={!requiredNoticesAccepted(managedUpdate()?.update_notices, updateNoticeAcceptances())}>{i18n.t('webServices.managed.update')}</Button>
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
                <p class="mt-1 leading-5 text-muted-foreground">
                  {i18n.t(service.deployment === 'native'
                    ? 'webServices.managed.nativeUpdateKeepsRuntimeDescription'
                    : 'webServices.managed.updateKeepsDataDescription')}
                </p>
              </div>
              <Show when={(service.update_notices?.length ?? 0) > 0}>
                <ManagedTemplateNotices
                  notices={service.update_notices ?? []}
                  accepted={updateNoticeAcceptances()}
                  disabled={false}
                  onAcceptedChange={(noticeID, accepted) => setUpdateNoticeAcceptances((current) => ({ ...current, [noticeID]: accepted }))}
                />
              </Show>
            </div>
          );
        }}</Show>
      </Dialog>

      <Dialog
        open={managedUninstall() !== null && !managedDeleteConfirm()}
        onOpenChange={(open) => { if (!open) setManagedUninstall(null); }}
        title={i18n.t('webServices.managed.uninstallTitle')}
        footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setManagedUninstall(null)}>{i18n.t('webServices.actions.cancel')}</Button><Button size="sm" variant="destructive" onClick={confirmManagedUninstall}>{i18n.t('webServices.managed.uninstall')}</Button></div>}
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
        loading={false}
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
