import { GitTemplateImport } from './GitTemplateImport';
import type { ResolvedSource } from '@floegence/redeven-service-templates';
import { For, Show, createEffect, createMemo, createResource, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { cn, useNotification, useViewActivation } from '@floegence/floe-webapp-core';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ExternalLink, FileText, FolderOpen, Globe, MoreHorizontal, Pencil, Plus, RefreshIcon, Save, Search, ShieldCheck, Trash, Play, Stop, Refresh } from '@floegence/floe-webapp-core/icons';
import { SnakeLoader } from '@floegence/floe-webapp-core/loading';
import {
  Button,
  Checkbox,
  DialogPlacementProvider,
  Dropdown,
  Input,
  Textarea,
  Tag,
  type DropdownItem,
} from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';
import { ManagedServiceManagementDrawer, managementStatusKey, managementProblemKey, type ManagementAction, type ManagementRequest } from './ManagedServiceManagementDrawer';
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
import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';
import { readUIStorageJSON, removeUIStorageItem } from '../services/uiStorage';
import { requestContainerResourceNavigation } from '../services/containerResourceNavigation';
import { trustedLauncherOriginFromSandboxLocation } from '../services/sandboxOrigins';
import { registerSandboxWindow } from '../services/sandboxWindowRegistry';
import { Tooltip } from '../primitives/Tooltip';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { useI18n, type EnvAppTranslationKey } from '../i18n';
import { useEnvContext } from './EnvContext';
import { EnvCollectionLoadingSkeleton } from './EnvCollectionLoadingSkeleton';
import { useEnvFilesystemPicker } from '../services/filesystemPicker';
import {
  ServiceTemplateCatalog,
  HostLifecyclePlanDetails,
  ServiceTemplateIdentity,
  type HostLifecyclePlan,
  type ServiceTemplateCategory,
  type ServiceTemplateKind,
  type ServiceTemplateIcon,
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
  createManagedServiceOperationPresentation,
  type ManagedOperationPresentationPhase,
} from './managedServiceOperationPresentation';
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
  default_app_path?: string;
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
 management_state?: string;
 status?: string;
 primary_action?: string;
 problem_code?: string;
  service_id: string;
  template_id: string;
  name: string;
  description?: string;
  template_source: 'builtin' | 'custom' | 'git';
  default_locale?: string;
  deployment: ManagedDeployment;
  workspace_path: string;
  workspace_ownership: 'pending' | 'redeven_created' | 'user_selected';
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
  localizations?: Readonly<Record<string, ManagedTemplateLocalization>>;
  icon?: ServiceTemplateIcon;
  active_operation?: ManagedOperation;
  access_mode?: WebServiceAccessMode;
  container_resources?: ReadonlyArray<Readonly<{
    kind: 'container' | 'image' | 'compose_project';
    engine: 'docker';
    endpoint_id?: string;
    view: 'containers' | 'images' | 'compose-projects';
    identity: string;
  }>>;
  release_status: ManagedReleaseStatus;
  actions?: ManagedServiceActions;
  opening?: Readonly<{ state: string; error_code?: string }>;
  pending_changes?: boolean;
}>;

type ManagedReleaseIdentity = Readonly<{
	schema_version: 1;
	kind: 'none' | 'npm' | 'oci';
	source?: string;
	registry?: string;
	version?: string;
	tag?: string;
	digest?: string;
	integrity?: string;
	platform?: string;
	trust?: string;
}>;

type ManagedReleaseCandidate = Readonly<{
	schema_version: 2;
	candidate_id: string;
	source_kind: 'npm' | 'oci';
	source: string;
	registry?: string;
	version?: string;
	tag?: string;
	published_at_unix_ms?: number;
	channel: 'stable' | 'preview' | 'special';
	deprecated?: boolean;
	deprecation_message?: string;
	trust: string;
	selectable: boolean;
	reason_code?: string;
	reason?: string;
	platform?: string;
	index_digest?: string;
	digest?: string;
	integrity?: string;
	tag_moved?: boolean;
	is_current?: boolean;
	is_recommended?: boolean;
	recommendation_status?: 'pending' | 'available' | 'unavailable';
	digest_verified?: boolean;
	is_latest_stable?: boolean;
	is_latest_preview?: boolean;
	relation: 'newer' | 'same' | 'older' | 'unknown';
	verification_status: 'pending' | 'verified' | 'unavailable';
}>;

type ManagedReleaseCandidateResult = Readonly<{
	schema_version: 2;
	current_release?: ManagedReleaseIdentity;
	recommended_release?: ManagedReleaseIdentity;
	latest_stable_release?: ManagedReleaseCandidate;
	latest_preview_release?: ManagedReleaseCandidate;
	candidates: ReadonlyArray<ManagedReleaseCandidate>;
	catalog_status: 'loading' | 'complete' | 'stale' | 'error';
	has_more: boolean;
	cursor_id?: string;
	loaded_count: number;
	check_status: 'fresh' | 'stale' | 'error' | 'pending';
	checked_at_unix_ms: number;
	next_check_at_unix_ms?: number;
	last_error_code?: string;
}>;

type ManagedReleaseStatus = Readonly<{
	schema_version: 2;
  current_release?: ManagedReleaseIdentity;
  recommended_release?: ManagedReleaseIdentity;
  latest_stable_release?: ManagedReleaseIdentity;
  latest_preview_release?: ManagedReleaseIdentity;
  latest_stable_relation?: 'newer' | 'same' | 'older' | 'unknown';
  latest_preview_relation?: 'newer' | 'same' | 'older' | 'unknown';
  check_status: 'fresh' | 'stale' | 'error' | 'pending';
  checked_at_unix_ms?: number;
  next_check_at_unix_ms?: number;
	last_error_code?: string;
}>;

type ManagedUpdatePlan = Readonly<{
	schema_version: 3;
	update_plan_id: string;
	current_release: ManagedReleaseIdentity;
	target_release: ManagedReleaseIdentity;
  notices?: ReadonlyArray<ManagedTemplateNotice>;
  risk_ids?: ReadonlyArray<string>;
  requires_stopped?: boolean;
  expires_at_unix_ms: number;
}>;

type ManagedOpenSession = Readonly<{
	state: 'ready' | 'preparing';
	forward?: PortForward;
	app_path?: string;
	operation?: ManagedOperation;
}>;

type ManagedReleasePickerTarget = Readonly<{
	kind: 'template' | 'service';
	id: string;
	name: string;
	service?: ManagedService;
	authTokenParameter?: string;
}>;

type SelectedTemplateRelease = Readonly<{
	candidate: ManagedReleaseCandidate;
	parameters: Readonly<Record<string, string>>;
}>;

type ManagedContainerResource = NonNullable<ManagedService['container_resources']>[number];

type ManagedDeployment = 'host' | 'container' | 'compose';
type ManagedAction = 'start' | 'stop' | 'restart' | 'retry';
type ManagedActionCapability = Readonly<{ available: boolean; reason_code?: string }>;
type ManagedServiceActions = Readonly<Record<ManagedAction, ManagedActionCapability> & { open?: ManagedActionCapability; restore_management?: ManagedActionCapability; inspect?: ManagedActionCapability; recover?: ManagedActionCapability; detach?: ManagedActionCapability; uninstall?: ManagedActionCapability }>;
type ManagedTemplateLocalization = Readonly<{
  name: string;
  description: string;
  notices?: Readonly<Record<string, Readonly<{ title: string; description: string }>>>;
}>;
type ManagedTemplateNotice = Readonly<{
  id: string;
  revision: number;
  severity: 'info' | 'warning';
  acknowledgement_required: boolean;
  title?: string;
  description?: string;
}>;

type ManagedTemplateSpec = ServiceTemplateRuntimeSpec;

export type ManagedCatalogTemplate = Readonly<{
  default_locale?: string;
  source_sha256?: string;
  git_source?: ResolvedSource & {sha256: string; document_template_id: string; document_family_id: string};
  template_id: string;
  name: string;
  description: string;
  recommended_release?: ManagedReleaseIdentity;
  release_source?: 'npm' | 'oci';
  developer_preview: boolean;
  disk_bytes: number;
  data_location: string;
  source_url: string;
  docker_source_url: string;
  localizations?: Readonly<Record<string, ManagedTemplateLocalization>>;
  icon?: ServiceTemplateIcon;
  notices?: ReadonlyArray<ManagedTemplateNotice>;
  source: 'builtin' | 'custom' | 'git';
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

type HostManagementReview = Readonly<{ service_id: string; saved_identity: string; fingerprint: string; pid: number; process_group: number; executable: string; user_id: string; birth: string }>;

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
  kind: 'host' | 'container' | 'compose';
  scheme: 'http' | 'https';
  path: string;
  healthPath: string;
  containerPort: string;
  installScript: string;
  startScript: string;
  afterStartScript: string;
  openScript: string;
  outputMode: 'discard' | 'private_file';
  stopScript: string;
  uninstallScript: string;
  npmPackageName: string;
  npmPackageVersion: string;
  npmRegistryURL: string;
  npmExecutable: string;
  npmAuthTokenParameter: string;
  image: string;
  entrypoint: string;
  command: string;
  environment: string;
  composeYAML: string;
  mainService: string;
  originalSpec?: ManagedTemplateSpec;
  hostLifecyclePlan?: HostLifecyclePlan;
};

export type TemplateEditorField = 'name' | 'description' | 'path' | 'healthPath' | 'startScript' | 'npmPackageName' | 'npmPackageVersion' | 'npmRegistryURL' | 'npmExecutable' | 'npmAuthTokenParameter' | 'image' | 'containerPort' | 'environment' | 'mainService' | 'composeYAML';
export type TemplateEditorError = 'required' | 'nameInvalid' | 'descriptionTooLong' | 'pathInvalid' | 'portInvalid' | 'imageInvalid' | 'environmentInvalid' | 'serviceNameInvalid' | 'npmPackageInvalid' | 'npmVersionInvalid' | 'npmRegistryInvalid' | 'npmExecutableInvalid' | 'parameterNameInvalid';

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
  if (draft.path.trim() && !draft.path.trim().startsWith('/')) errors.path = 'pathInvalid';
  if (draft.healthPath.trim() && !draft.healthPath.trim().startsWith('/')) errors.healthPath = 'pathInvalid';

  if (draft.kind === 'host') {
    if (!draft.startScript.trim()) errors.startScript = 'required';
    const hasNPM = [draft.npmPackageName, draft.npmPackageVersion, draft.npmRegistryURL, draft.npmExecutable, draft.npmAuthTokenParameter].some((value) => value.trim());
    if (hasNPM) {
      if (!/^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(draft.npmPackageName.trim())) errors.npmPackageName = 'npmPackageInvalid';
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(draft.npmPackageVersion.trim())) errors.npmPackageVersion = 'npmVersionInvalid';
      try {
        const registry = new URL(draft.npmRegistryURL.trim());
        if (registry.protocol !== 'https:' || registry.username || registry.password || registry.search || registry.hash) errors.npmRegistryURL = 'npmRegistryInvalid';
      } catch {
        errors.npmRegistryURL = 'npmRegistryInvalid';
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(draft.npmExecutable.trim())) errors.npmExecutable = 'npmExecutableInvalid';
      if (draft.npmAuthTokenParameter.trim() && !/^[A-Z][A-Z0-9_]{0,63}$/u.test(draft.npmAuthTokenParameter.trim())) errors.npmAuthTokenParameter = 'parameterNameInvalid';
      const existingParameter = draft.originalSpec?.parameters?.find((parameter) => parameter.name === draft.npmAuthTokenParameter.trim());
      if (existingParameter && existingParameter.type !== 'secret') errors.npmAuthTokenParameter = 'parameterNameInvalid';
    }
  }
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
    name: '', description: '', kind, scheme: 'http', path: '/', healthPath: '/', containerPort: '3000',
    afterStartScript: '', openScript: '', outputMode: 'discard',
    installScript: '', startScript: kind === 'host' ? 'exec your-server --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT"' : '', stopScript: '', uninstallScript: '',
    npmPackageName: '', npmPackageVersion: '', npmRegistryURL: 'https://registry.npmjs.org/', npmExecutable: '', npmAuthTokenParameter: '',
    image: '', entrypoint: '', command: '', environment: '',
    composeYAML: 'services:\n  web:\n    image: nginx:stable-alpine\n', mainService: 'web',
  };
}

function draftFromTemplate(template: ManagedCatalogTemplate): TemplateEditorDraft {
  const spec = template.spec;
  const kind = spec?.kind ?? template.deployment;
  const draft = emptyTemplateDraft(kind);
  return {
    ...draft,
    templateID: template.template_id,
    name: template.name,
    description: template.description ?? '',
    scheme: spec?.endpoint.scheme ?? 'http',
    path: spec?.endpoint.path ?? '/',
    healthPath: spec?.endpoint.health_path ?? '/',
    containerPort: String(spec?.endpoint.container_port ?? 3000),
    afterStartScript: spec?.host?.after_start_script ?? '',
    openScript: spec?.host?.open_script ?? '',
    outputMode: spec?.host?.output_mode ?? 'discard',
    installScript: spec?.host?.install_script ?? '',
    startScript: spec?.host?.start_script ?? draft.startScript,
    stopScript: spec?.host?.stop_script ?? '',
    uninstallScript: spec?.host?.uninstall_script ?? '',
    npmPackageName: spec?.host?.npm?.package_name ?? '',
    npmPackageVersion: spec?.host?.npm?.version ?? '',
    npmRegistryURL: spec?.host?.npm?.registry_url ?? 'https://registry.npmjs.org/',
    npmExecutable: spec?.host?.npm?.executable ?? '',
    npmAuthTokenParameter: spec?.host?.npm?.auth_token_parameter ?? '',
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
  const hasNPM = draft.kind === 'host' && [draft.npmPackageName, draft.npmPackageVersion, draft.npmExecutable, draft.npmAuthTokenParameter].some((value) => value.trim());
  const parameters = [...(original?.parameters ?? [])];
  const authTokenParameter = draft.npmAuthTokenParameter.trim();
  if (hasNPM && authTokenParameter && !parameters.some((parameter) => parameter.name === authTokenParameter)) {
    parameters.push({ name: authTokenParameter, label: authTokenParameter, type: 'secret', required: true });
  }
  const endpoint = {
    ...(original?.endpoint ?? {}),
    scheme: draft.scheme,
    path: draft.path.trim() || '/',
    health_path: draft.healthPath.trim() || '/',
    startup_timeout_sec: original?.endpoint.startup_timeout_sec || 60,
    ...(draft.kind === 'host' ? {} : { container_port: Number(draft.containerPort) }),
  };
  const common = { schema_version: 6 as const, kind: draft.kind, endpoint, parameters };
  const spec: ManagedTemplateSpec = draft.kind === 'host'
    ? { ...common, host: { install_script: draft.installScript, start_script: draft.startScript, stop_script: draft.stopScript, uninstall_script: draft.uninstallScript, ...(original?.host?.environment ? { environment: original.host.environment } : {}), after_start_script: draft.afterStartScript, open_script: draft.openScript, output_mode: draft.outputMode, ...(!hasNPM && original?.host?.artifact ? { artifact: original.host.artifact } : {}), ...(hasNPM ? { npm: { package_name: draft.npmPackageName.trim(), version: draft.npmPackageVersion.trim(), registry_url: draft.npmRegistryURL.trim(), executable: draft.npmExecutable.trim(), ...(authTokenParameter ? { auth_token_parameter: authTokenParameter } : {}) } } : {}) } }
    : draft.kind === 'container'
	  ? { ...common, container: { image: draft.image.trim(), entrypoint: draft.entrypoint.trim() ? [draft.entrypoint.trim()] : [], command: draft.command.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean), environment: parseTemplateEnvironment(draft.environment), mounts: original?.container?.mounts ?? [{ type: 'workspace', target: '/workspace' }, { type: 'volume', source: 'data', target: '/data' }, { type: 'tmpfs', target: '/tmp' }], user: original?.container?.user ?? '', read_only_root: true, memory_bytes: original?.container?.memory_bytes, cpus: original?.container?.cpus, pids_limit: original?.container?.pids_limit || 512 } }
      : { ...common, compose: { yaml: draft.composeYAML, main_service: draft.mainService.trim() } };
  return { request_id: requestID, name: draft.name.trim(), description: draft.description.trim(), spec };
}

export type WebServiceOpenRoute =
  | Readonly<{ kind: 'local_proxy'; url: string; label: 'Local proxy' }>
  | Readonly<{ kind: 'e2ee_tunnel'; forward_id: string; label: 'Secure tunnel' }>;

type BrowserLocationLike = Pick<Location, 'hostname' | 'href' | 'origin'>;
type WebServicesI18n = Pick<ReturnType<typeof useI18n>, 'formatDateTime' | 'formatRelativeTime' | 'locale' | 't'>;

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

function forwardDefaultURL(forward: PortForward): string {
  const path = forward.default_app_path || '/';
  return path === '/' ? forward.target_url : new URL(path, forward.target_url).toString();
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

type ServiceStatusTone = 'success' | 'error' | 'warning' | 'neutral';

function ServiceStatusIndicator(props: { label: string; tone: ServiceStatusTone; class?: string }) {
  return (
    <span
      class={cn(
        'web-service-state inline-flex items-center gap-1.5 text-xs font-medium',
        props.tone === 'success' && 'text-[var(--redeven-status-success-foreground)]',
        props.tone === 'error' && 'text-destructive',
        props.tone === 'warning' && 'text-[var(--redeven-status-warning-foreground)]',
        props.tone === 'neutral' && 'text-muted-foreground',
        props.class,
      )}
    >
      <Show when={props.tone === 'warning' || props.tone === 'error'} fallback={
        <span class={cn('h-1.5 w-1.5 shrink-0 rounded-full', props.tone === 'success' ? 'bg-[var(--redeven-status-success)]' : 'bg-muted-foreground/55')} aria-hidden="true" />
      }><AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></Show>
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

const serviceRowGridClass = 'web-service-row';
const serviceRowActionsClass = 'web-service-actions';

function workspaceBasename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

function managedStatusTone(status: string): ServiceStatusTone {
  if (status === 'running') return 'success';
  if (['uninstall_pending', 'recovery_required', 'confirmation_required', 'inspection_unavailable'].includes(status)) return 'warning';
  return 'neutral';
}

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
      <div class="web-service-identity">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground">
          <Globe class="h-4 w-4" aria-hidden="true" />
        </div>
        <div class="web-service-identity-content min-w-0">
          <div class="truncate text-sm font-semibold leading-5">{props.forward.name || i18n.t('webServices.card.fallbackName', { id: props.forward.forward_id })}</div>
          <div class="mt-0.5 truncate font-mono text-xs leading-4 text-muted-foreground" title={forwardDefaultURL(props.forward)}>{forwardDefaultURL(props.forward)}</div>
      <div class="web-service-metadata web-service-forward-meta" data-testid="port-forward-secondary">
        <Tooltip content={fmtTime(props.forward.last_opened_at_unix_ms, i18n)} placement="top">
          <span class="cursor-default whitespace-nowrap">{i18n.t('webServices.fields.lastOpened')} · {fmtRelativeTime(props.forward.last_opened_at_unix_ms, i18n)}</span>
        </Tooltip>
        <span aria-hidden="true">·</span>
        <span class="truncate" title={props.forward.access_mode === 'desktop_loopback' ? i18n.t('webServices.accessMode.desktopLoopbackDescription') : i18n.t('webServices.accessMode.unifiedProxyDescription')}>
          {props.forward.access_mode === 'desktop_loopback' ? i18n.t('webServices.accessMode.desktopLoopbackShort') : i18n.t('webServices.accessMode.unifiedProxyShort')}
        </span>
      </div>

        </div>
      </div>


      <div class="web-service-status" data-testid="port-forward-status">
        <HealthStatus health={props.forward.health} />
      </div>

      <div class={serviceRowActionsClass} data-testid="port-forward-actions">
        <Tooltip content={props.openUnavailableReason || props.busyText || i18n.t('webServices.actions.openServiceTooltip')} placement="top" anchorClass="web-service-open">
          <Button
            size="sm"
            variant="default"
            onClick={props.onOpen}
            disabled={props.busy || props.canOpen === false}
            aria-busy={props.busy || undefined}
            class="web-service-button"
          >
            <Show when={props.busy} fallback={<ExternalLink class="mr-1.5 h-3.5 w-3.5" />}>
              <InlineButtonSnakeLoading class="mr-1.5" />
            </Show>
            {i18n.t('webServices.actions.open')}
          </Button>
        </Tooltip>
        <Tooltip content={i18n.t('webServices.actions.editServiceTooltip')} placement="top" anchorClass="web-service-manage">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onEdit}
            disabled={props.busy}
            class="h-8 w-8 px-0 text-muted-foreground hover:text-foreground"
            aria-label={`${props.forward.name}: ${i18n.t('webServices.actions.editServiceTooltip')}`}
          >
            <Pencil class="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={i18n.t('webServices.actions.deleteServiceTooltip')} placement="top" anchorClass="web-service-more">
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onDelete}
            disabled={props.busy}
            class="h-8 w-8 px-0 text-muted-foreground hover:text-destructive"
            aria-label={`${props.forward.name}: ${i18n.t('webServices.actions.deleteServiceTooltip')}`}
          >
            <Trash class="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>
      <Show when={props.openUnavailableReason}><div class="web-service-notice web-service-forward-notice" role="status"><AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><p>{props.openUnavailableReason}</p></div></Show>
    </div>
  );
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
    case 'workspace_cleanup': return i18n.t('webServices.managed.stages.workspaceCleanup');
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
    case 'retry': return i18n.t('webServices.managed.retry');
    case 'retry_install': return i18n.t('webServices.managed.retryInstall');
    case 'update': return i18n.t('webServices.managed.update');
    case 'reconfigure': return i18n.t('webServices.managed.reconfigure');
    case 'uninstall': return i18n.t('webServices.managed.uninstall');
    case 'detach': return i18n.t('webServices.management.actions.detach');
    case 'restore': return i18n.t('webServices.management.actions.restore');
    case 'recover': return i18n.t('webServices.management.actions.recover');
  }
}

function managedActionFailureTitle(action: ManagedOperation['action'], i18n: WebServicesI18n): string {
  switch (action) {
    case 'start': return i18n.t('webServices.managed.startFailed');
    case 'stop': return i18n.t('webServices.managed.stopFailed');
    case 'restart': return i18n.t('webServices.managed.restartFailed');
    case 'retry': return i18n.t('webServices.managed.retryFailed');
    case 'retry_install': return i18n.t('webServices.managed.retryFailed');
    case 'update': return i18n.t('webServices.managed.updateFailed');
    case 'reconfigure': return i18n.t('webServices.managed.reconfigureFailed');
    case 'uninstall': return i18n.t('webServices.notifications.failedToDeleteTitle');
    default: return i18n.t('webServices.notifications.failedToAddTitle');
  }
}

function managedOperationFailureMessage(operation: ManagedOperation, i18n: WebServicesI18n): string {
  return managedFailureMessage(operation.error_code || '', i18n);
}

function managedFailureMessage(errorCode: string, i18n: WebServicesI18n): string {
  switch (errorCode) {
    case 'STOP_SCRIPT_FAILED':
    case 'STOP_SCRIPT_UNAVAILABLE':
    case 'UNINSTALL_SCRIPT_FAILED':
    case 'UNINSTALL_SCRIPT_UNAVAILABLE': return i18n.t('webServices.management.problems.hookFailed');
    case 'UI_REQUEST_FAILED': return i18n.t('webServices.collection.requestFailed');
    case 'IMAGE_PULL_TIMEOUT': return i18n.t('webServices.managed.imagePullTimeout');
    case 'IMAGE_REGISTRY_UNAVAILABLE': return i18n.t('webServices.managed.imageRegistryUnavailable');
    case 'IMAGE_UNAVAILABLE': return i18n.t('webServices.managed.imageUnavailable');
    case 'IMAGE_REGISTRY_ACCESS_DENIED': return i18n.t('webServices.managed.imageRegistryAccessDenied');
    case 'IMAGE_REGISTRY_RATE_LIMITED': return i18n.t('webServices.managed.imageRegistryRateLimited');
    case 'IMAGE_PULL_STORAGE_EXHAUSTED': return i18n.t('webServices.managed.imagePullStorageExhausted');
    case 'IMAGE_PULL_FAILED': return i18n.t('webServices.managed.imagePullFailed');
    case 'CONTAINER_INSPECTION_FAILED': return i18n.t('webServices.managed.containerInspectionFailed');
    case 'CONTAINER_IDENTITY_MISSING': return i18n.t('webServices.managed.containerMissing');
    case 'CONTAINER_IDENTITY_MISMATCH': return i18n.t('webServices.managed.containerIdentityChanged');
    case 'CONTAINER_NAME_MISMATCH': return i18n.t('webServices.managed.containerNameChanged');
    case 'CONTAINER_IMAGE_MISMATCH': return i18n.t('webServices.managed.containerImageChanged');
    case 'CONTAINER_LABEL_MISMATCH': return i18n.t('webServices.managed.containerOwnershipChanged');
    case 'CONTAINER_CONFIGURATION_MISMATCH':
    case 'CONTAINER_CAPABILITY_MISMATCH':
    case 'CONTAINER_MOUNT_MISMATCH':
    case 'CONTAINER_DEVICE_MISMATCH':
    case 'CONTAINER_NETWORK_MISMATCH': return i18n.t('webServices.managed.containerConfigurationChanged');
    case 'DATA_IDENTITY_MISSING': return i18n.t('webServices.managed.dataIdentityMissing');
    case 'DATA_IDENTITY_INVALID': return i18n.t('webServices.managed.dataIdentityInvalid');
    case 'DATA_VOLUME_MISSING': return i18n.t('webServices.managed.dataVolumeMissing');
    case 'DATA_IDENTITY_MISMATCH': return i18n.t('webServices.managed.dataIdentityChanged');
    case 'DATA_IDENTITY_UNAVAILABLE': return i18n.t('webServices.managed.dataIdentityUnavailable');
    case 'DATA_VOLUME_CREATE_FAILED': return i18n.t('webServices.managed.dataVolumeCreateFailed');
    case 'WORKSPACE_CREATE_FAILED': return i18n.t('webServices.managed.workspaceCreateFailed');
    case 'WORKSPACE_MISSING': return i18n.t('webServices.managed.workspaceMissing');
    case 'WORKSPACE_UNAVAILABLE': return i18n.t('webServices.managed.workspaceUnavailable');
    case 'WORKSPACE_DELETE_FAILED': return i18n.t('webServices.managed.workspaceDeleteFailed');
    case 'WORKSPACE_DELETE_UNSAFE': return i18n.t('webServices.managed.workspaceDeleteUnsafe');
    case 'WORKSPACE_IN_USE': return i18n.t('webServices.managed.workspaceInUse');
    case 'HOST_RUNTIME_PREPARE_FAILED':
    case 'HOST_LOG_PREPARE_FAILED': return i18n.t('webServices.managed.hostRuntimePrepareFailed');
    case 'DEPENDENCY_LAYOUT_INVALID': return i18n.t('webServices.managed.dependencyLayoutInvalid');
    case 'HOST_PROCESS_IDENTITY_MISMATCH':
    case 'HOST_PROCESS_IDENTITY_UNAVAILABLE': return i18n.t('webServices.managed.hostProcessIdentityChanged');
    case 'HOST_RECOVERY_UNAVAILABLE':
    case 'HOST_RECOVERY_NOT_REQUIRED':
    case 'HOST_RECOVERY_CONFIRMATION_REQUIRED': return i18n.t('webServices.managed.managementRecoveryUnavailable');
    case 'SERVICE_ENDPOINT_UNAVAILABLE': return i18n.t('webServices.managed.endpointUnavailable');
    case 'SERVICE_OPEN_TARGET_INVALID':
    case 'HOST_OPEN_TARGET_INVALID': return i18n.t('webServices.managed.hostOpenTargetInvalid');
    case 'HOST_OPEN_HOOK_FAILED':
    case 'HOST_AFTER_START_HOOK_FAILED': return i18n.t('webServices.managed.openingRetryHint');
    case 'HOST_OPEN_TARGET_MISSING': return i18n.t('webServices.managed.hostOpenTargetMissing');
    case 'SERVICE_OPEN_TARGET_UNAVAILABLE':
    case 'HOST_OPEN_TARGET_UNAVAILABLE': return i18n.t('webServices.managed.hostOpenTargetUnavailable');
    case 'MANAGED_WEB_SERVICE_INTERNAL': return i18n.t('webServices.managed.operationFailed');
    default: return i18n.t('webServices.managed.operationFailed');
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
        deployment === 'host' ? 'downloading' : 'pulling',
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
  presentationPhase: ManagedOperationPresentationPhase;
  deployment: ManagedDeployment;
  expanded: boolean;
  canCancel: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onCancel: () => void;
}>) {
  const i18n = useI18n();
  let outputViewport: HTMLDivElement | undefined;
  let followOutput = true;
  const [currentTimeUnixMs, setCurrentTimeUnixMs] = createSignal(Date.now());
  const elapsedTimer = window.setInterval(() => setCurrentTimeUnixMs(Date.now()), 1_000);
  onCleanup(() => window.clearInterval(elapsedTimer));
  const transfer = () => props.operation.progress_detail?.transfer;
  const hostTransfer = () => props.deployment === 'host';
  const terminal = () => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(props.operation.state);
  const succeeded = () => props.operation.state === 'succeeded';
  const progress = () => managedTransferProgress(props.operation);
  const percent = () => progress().total > 0 ? Math.max(0, Math.min(100, (progress().current / progress().total) * 100)) : 0;
  const steps = () => managedOperationStages(props.operation, props.deployment);
  const commands = () => props.operation.progress_detail?.commands ?? [];
  const output = () => props.operation.progress_detail?.output ?? [];
  const lastOutputSequence = () => output()[output().length - 1]?.sequence ?? 0;
  createEffect(on(() => [props.expanded, lastOutputSequence()] as const, ([expanded]) => {
    if (!expanded || !followOutput || !outputViewport) return;
    window.requestAnimationFrame(() => {
      if (outputViewport && followOutput) outputViewport.scrollTop = outputViewport.scrollHeight;
    });
  }));
  const detailsID = () => `managed-operation-details-${props.operation.operation_id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const transferSummary = () => {
    const item = transfer();
    if (!item) return `${Math.min(props.operation.progress_current, props.operation.progress_total)}/${props.operation.progress_total}`;
    if ((item.total_bytes ?? 0) > 0) return `${formatManagedBytes(item.downloaded_bytes)} / ${formatManagedBytes(item.total_bytes)}`;
    if ((item.total_layers ?? 0) > 0) return i18n.t('webServices.managed.operationLayersValue', { current: item.completed_layers ?? 0, total: item.total_layers ?? 0 });
    return `${Math.min(props.operation.progress_current, props.operation.progress_total)}/${props.operation.progress_total}`;
  };
  return (
    <div
      class={cn(
        'grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-[220ms] ease-out motion-reduce:transform-none motion-reduce:transition-none',
        props.presentationPhase === 'exiting'
          ? 'grid-rows-[0fr] -translate-y-1 opacity-0'
          : 'grid-rows-[1fr] translate-y-0 opacity-100 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none',
      )}
      role="status"
      aria-live="polite"
      aria-hidden={props.presentationPhase === 'exiting' || undefined}
      data-testid="managed-operation-disclosure"
      data-presentation-state={props.presentationPhase}
    >
      <div class="relative min-h-0 overflow-hidden border-t border-border/70 bg-muted/15">
        <div class="flex h-14 min-h-14 min-w-0 items-stretch pl-[3.25rem] pr-3" data-testid="managed-operation-header">
        <span class="absolute bottom-0 left-8 top-0 w-px bg-border/80" aria-hidden="true" />
        <span class="absolute left-8 top-[1.4rem] h-px w-5 bg-border/80" aria-hidden="true" />
        <button
          type="button"
          class="group flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={props.expanded}
          aria-controls={detailsID()}
          onClick={() => props.onExpandedChange(!props.expanded)}
          data-testid="managed-service-operation-trigger"
        >
          <Show when={terminal()} fallback={<ManagedServiceShapingOrb />}>
            <span class={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full', succeeded() ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')} data-testid="managed-operation-terminal-icon">
              <Show when={succeeded()} fallback={<AlertTriangle class="h-3 w-3" aria-hidden="true" />}>
                <Check class="h-3 w-3" aria-hidden="true" />
              </Show>
            </span>
          </Show>
          <div class="min-w-0 flex-1">
            <div class={cn('truncate text-xs font-semibold', !terminal() && 'managed-operation-shimmer-text', succeeded() ? 'text-success' : terminal() ? 'text-destructive' : undefined)}>{managedOperationActivityLabel(props.operation, i18n)}</div>
            <Show when={transfer()?.artifact_reference}>
              <div class="mt-0.5 truncate font-mono text-[10px] leading-4 text-muted-foreground" title={transfer()?.artifact_reference} data-testid="managed-operation-artifact">{transfer()?.artifact_reference}</div>
            </Show>
          </div>
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{transferSummary()}</span>
          <ChevronDown class={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', props.expanded && 'rotate-180')} aria-hidden="true" />
        </button>
        <Show when={!terminal()}>
          <Button size="sm" variant="ghost" class="my-auto h-7 shrink-0 whitespace-nowrap px-2" onClick={props.onCancel} disabled={!props.canCancel || props.operation.state === 'cancelling' || props.operation.state === 'submitting'}>{i18n.t('webServices.managed.cancelOperation')}</Button>
        </Show>
        </div>
        <Show when={props.operation.state === 'failed' || props.operation.state === 'interrupted'}>
          <p class="web-service-operation-error" role="alert">{managedOperationFailureMessage(props.operation, i18n)}</p>
        </Show>
        <Show when={props.expanded}>
        <div id={detailsID()} class="grid gap-4 border-t border-border/60 px-5 py-4 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.2fr)]" data-testid="managed-service-operation-details">
          <ol class="space-y-2">
            <For each={steps()}>{(stage, index) => {
              const state = () => managedOperationStepState(props.operation, steps(), index());
              return <li class="flex items-center gap-2 text-xs" data-managed-operation-step data-state={state()}><span data-state={state()} class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] data-[state=complete]:border-success data-[state=complete]:bg-success/10 data-[state=complete]:text-success data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=failed]:border-destructive data-[state=failed]:bg-destructive/10 data-[state=failed]:text-destructive">{state() === 'complete' ? '✓' : index() + 1}</span><span class={state() === 'pending' ? 'text-muted-foreground' : 'font-medium text-foreground'}>{managedStageLabel(stage, i18n)}</span></li>;
            }}</For>
          </ol>
          <div class="min-w-0 rounded-lg border border-border/70 bg-background/70 p-3" data-testid="managed-operation-stage-detail" data-stage={props.operation.stage}>
            <h4 class="mb-3 text-xs font-semibold text-foreground">{managedStageLabel(props.operation.stage, i18n)}</h4>
            <Show when={transfer()} keyed>{(item) => (
              <div>
                <div class="flex min-w-0 items-start gap-2"><div class="min-w-0 flex-1"><div class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t(hostTransfer() ? 'webServices.managed.softwarePackage' : 'webServices.managed.containerImage')}</div><div class="mt-1 truncate font-mono text-xs text-foreground" title={item.artifact_reference}>{item.artifact_reference || '—'}</div></div><Show when={(item.artifact_total ?? 0) > 1}><Tag variant="neutral" tone="soft" size="sm">{i18n.t('webServices.managed.operationImageSequence', { current: item.artifact_index ?? 0, total: item.artifact_total ?? 0 })}</Tag></Show></div>
                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={i18n.t('webServices.managed.operationTransferProgress')} aria-valuemin="0" aria-valuemax={progress().total || undefined} aria-valuenow={progress().total ? Math.min(progress().current, progress().total) : undefined} data-indeterminate={progress().total === 0 ? 'true' : undefined}><div class={cn('h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none', progress().total === 0 && 'w-1/3 animate-pulse motion-reduce:animate-none')} style={progress().total ? { width: `${percent()}%` } : undefined} /></div>
                <dl class={cn('mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs', hostTransfer() ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationDownloaded')}</dt><dd class="mt-0.5 font-medium text-foreground">{(item.total_bytes ?? 0) > 0 ? `${formatManagedBytes(item.downloaded_bytes)} / ${formatManagedBytes(item.total_bytes)}` : item.phase === 'cached' ? formatManagedBytes(0) : '—'}</dd></div><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationSpeed')}</dt><dd class="mt-0.5 font-medium text-foreground">{(item.bytes_per_second ?? 0) > 0 || item.phase === 'cached' ? `${formatManagedBytes(item.bytes_per_second)}/s` : '—'}</dd></div><Show when={!hostTransfer()}><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationLayers')}</dt><dd class="mt-0.5 font-medium text-foreground">{(item.total_layers ?? 0) > 0 ? `${item.completed_layers ?? 0} / ${item.total_layers}` : '—'}</dd></div></Show><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationElapsed')}</dt><dd class="mt-0.5 font-medium text-foreground" data-testid="managed-operation-elapsed">{formatManagedElapsed(props.operation.progress_detail?.stage_started_at_unix_ms, terminal() ? props.operation.progress_detail?.updated_at_unix_ms : currentTimeUnixMs())}</dd></div></dl>
              </div>
            )}</Show>
            <Show when={commands().length > 0 || output().length > 0}>
              <div class={cn(transfer() && 'mt-4 border-t border-border/60 pt-4')} data-testid="managed-operation-command-output">
                <div class="flex items-center justify-between gap-3">
                  <h4 class="text-xs font-semibold text-foreground">{i18n.t('webServices.managed.operationCommandOutput')}</h4>
                  <Show when={props.operation.progress_detail?.output_truncated}><span class="text-[10px] text-warning">{i18n.t('webServices.managed.operationOutputTruncated')}</span></Show>
                </div>
                <div class="mt-2 space-y-1.5">
                  <For each={commands()}>{(command) => (
                    <div class="flex min-w-0 items-center gap-2 text-[10px]">
                      <code class="min-w-0 flex-1 truncate text-foreground" title={command.display}>{command.display}</code>
                      <span class="shrink-0 text-muted-foreground">{i18n.t(`webServices.managed.operationCommandState.${command.state}` as EnvAppTranslationKey)}</span>
                    </div>
                  )}</For>
                </div>
                <div
                  {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
                  ref={outputViewport}
                  class="mt-2 max-h-52 min-h-16 overflow-y-auto overscroll-contain rounded-md bg-muted/35 px-2.5 py-2 font-mono text-[10px] leading-4 [scrollbar-gutter:stable]"
                  role="log"
                  aria-label={i18n.t('webServices.managed.operationOutput')}
                  data-testid="managed-operation-output"
                  onScroll={() => {
                    if (!outputViewport) return;
                    followOutput = outputViewport.scrollHeight - outputViewport.scrollTop - outputViewport.clientHeight <= 24;
                  }}
                >
                  <For each={output()} fallback={<div class="text-muted-foreground">{i18n.t('webServices.managed.operationNoOutput')}</div>}>{(line) => (
                    <div class={cn('whitespace-pre-wrap break-all text-foreground/85', line.stream === 'stderr' && 'text-warning')} data-sequence={line.sequence}>
                      <span class="sr-only">{i18n.t(`webServices.managed.operationStream.${line.stream}` as EnvAppTranslationKey)}: </span>{line.text}
                    </div>
                  )}</For>
                </div>
              </div>
            </Show>
            <Show when={!transfer() && commands().length === 0 && output().length === 0 && (!terminal() || succeeded())}>
              <div class="space-y-3">
                <p class="text-xs text-muted-foreground">{i18n.t('webServices.managed.operationPreparingDetails')}</p>
                <dl class="text-xs"><div><dt class="text-muted-foreground">{i18n.t('webServices.managed.operationElapsed')}</dt><dd class="mt-0.5 font-medium text-foreground" data-testid="managed-operation-elapsed">{formatManagedElapsed(props.operation.progress_detail?.stage_started_at_unix_ms, terminal() ? props.operation.progress_detail?.updated_at_unix_ms : currentTimeUnixMs())}</dd></div></dl>
              </div>
            </Show>
          </div>
        </div>
        </Show>
      </div>
    </div>
  );
}

function managedDeploymentLabel(deployment: ManagedDeployment, i18n: WebServicesI18n): string {
  switch (deployment) {
    case 'host': return i18n.t('webServices.managed.hostDeployment');
    case 'compose': return i18n.t('webServices.managed.composeDeployment');
    default: return i18n.t('webServices.managed.containerDeployment');
  }
}

function managedTemplateKind(template: ManagedCatalogTemplate): ServiceTemplateKind {
  if (template.deployment === 'host') return 'host';
  if (template.deployment === 'compose' || template.container_mode === 'compose') return 'compose';
  return 'container';
}

function managedLocalization(
  localizations: Readonly<Record<string, ManagedTemplateLocalization>> | undefined,
  locale: string,
  defaultLocale = 'en-US',
): ManagedTemplateLocalization | undefined {
  return localizations?.[locale] ?? localizations?.[locale.split('-')[0]] ?? localizations?.[defaultLocale];
}

function managedTemplateLocalizedIdentity(template: ManagedCatalogTemplate, i18n: WebServicesI18n): Readonly<{ name: string; description: string }> {
  const localized = managedLocalization(template.localizations, i18n.locale(), template.default_locale);
  return { name: localized?.name || template.name, description: localized?.description || template.description };
}

function managedServiceLocalizedIdentity(service: ManagedService, i18n: WebServicesI18n): Readonly<{ name: string; description: string }> {
  const localized = managedLocalization(service.localizations, i18n.locale(), service.default_locale);
  return { name: localized?.name || service.name || service.template_id, description: localized?.description || service.description || '' };
}

function localizedManagedNotices(
  notices: readonly ManagedTemplateNotice[] | undefined,
  localizations: Readonly<Record<string, ManagedTemplateLocalization>> | undefined,
  locale: string,
  defaultLocale = 'en-US',
): ManagedTemplateNotice[] {
  const localized = managedLocalization(localizations, locale, defaultLocale)?.notices ?? {};
  return (notices ?? []).map((notice) => ({ ...notice, title: localized[notice.id]?.title, description: localized[notice.id]?.description }));
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
        return (
          <div class={cn('rounded-lg border p-3 text-xs', notice.severity === 'warning' ? 'border-warning/30 bg-warning/[0.07]' : 'border-border bg-muted/25')} data-notice-id={notice.id}>
            <div class="flex items-start gap-2.5">
              <span class={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', notice.severity === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')} aria-hidden="true">
                <Show when={notice.severity === 'warning'} fallback={<ShieldCheck class="h-3.5 w-3.5" />}><AlertTriangle class="h-3.5 w-3.5" /></Show>
              </span>
              <div class="min-w-0 flex-1">
                <div class="font-medium text-foreground">{notice.title || notice.id}</div>
                <p class="mt-1 leading-5 text-muted-foreground">{notice.description || '—'}</p>
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

type ManagedReleaseDefaultKind = 'redeven' | 'template';

type ManagedReleaseRequestPhase = 'idle' | 'initial' | 'refresh' | 'load_more' | 'verification_queued' | 'verification';

function releaseRiskHintIDs(candidate: ManagedReleaseCandidate | undefined, defaultKind: ManagedReleaseDefaultKind = 'redeven'): string[] {
	if (!candidate) return [];
	return [
		...(candidate.source_kind === 'npm' ? ['npm_lifecycle_scripts'] : []),
		...(!candidate.is_recommended ? [defaultKind === 'template' ? 'non_default_release' : 'non_recommended_release'] : []),
		...(candidate.channel === 'preview' ? ['preview_release'] : []),
		...(candidate.deprecated ? ['deprecated_release'] : []),
		...(candidate.relation === 'older' ? ['downgrade'] : []),
		...(candidate.relation === 'unknown' && !candidate.is_current ? ['version_order_unknown'] : []),
		...(candidate.tag_moved ? ['tag_digest_moved'] : []),
	];
}

function releaseRiskHintLabel(id: string, i18n: WebServicesI18n): string {
	return i18n.t(`webServices.managed.releaseRisk.${id}` as EnvAppTranslationKey);
}

function ManagedReleaseRiskHints(props: Readonly<{ riskIDs: ReadonlyArray<string> }>): JSX.Element {
	const i18n = useI18n();
	return (
		<Show when={props.riskIDs.length > 0}>
			<ul class="space-y-1.5 text-[11px] leading-5 text-muted-foreground" data-testid="managed-release-risk-hints">
				<For each={props.riskIDs}>{(risk) => (
					<li class="flex items-start gap-1.5">
						<AlertTriangle class="mt-1 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
						<span>{releaseRiskHintLabel(risk, i18n)}</span>
					</li>
				)}</For>
			</ul>
		</Show>
	);
}

function releaseTrustLabel(trust: string, i18n: WebServicesI18n): string {
	const known = new Set(['catalog_reviewed_source', 'upstream_registry', 'user_configured_registry', 'registry_verified']);
	return i18n.t(`webServices.managed.releaseTrust.${known.has(trust) ? trust : 'registry'}` as EnvAppTranslationKey);
}

function releaseReasonLabel(candidate: ManagedReleaseCandidate, i18n: WebServicesI18n): string {
	const known = new Set(['NODE_RANGE_UNSUPPORTED', 'NODE_VERSION_UNAVAILABLE', 'PLATFORM_UNAVAILABLE', 'RELEASE_IDENTITY_UNVERIFIABLE', 'RELEASE_DEPRECATED', 'RELEASE_NOT_FOUND', 'RECOMMENDED_TAG_UNAVAILABLE_DIGEST_VERIFIED']);
	if (candidate.reason_code && known.has(candidate.reason_code)) {
		return i18n.t(`webServices.managed.releaseReason.${candidate.reason_code}` as EnvAppTranslationKey);
	}
	return i18n.t('webServices.managed.releaseReason.unavailable');
}

function releaseSourceErrorLabel(error: unknown, i18n: WebServicesI18n): string {
	const code = typeof error === 'string' ? error : error instanceof LocalApiError ? error.code : '';
	const known = new Set([
		'RELEASE_SOURCE_AUTH_UNAVAILABLE',
		'RELEASE_SOURCE_AUTH_REQUIRED',
		'RELEASE_SOURCE_NOT_FOUND',
		'RELEASE_SOURCE_RATE_LIMITED',
		'RELEASE_SOURCE_TIMEOUT',
		'RELEASE_SOURCE_NETWORK_UNAVAILABLE',
		'RELEASE_SOURCE_RESPONSE_INVALID',
		'RELEASE_SOURCE_UNAVAILABLE',
		'RECOMMENDED_RELEASE_UNAVAILABLE',
	]);
	return i18n.t(`webServices.managed.releaseSourceError.${known.has(code) ? code : 'unavailable'}` as EnvAppTranslationKey);
}

function releaseIdentityLabel(identity: ManagedReleaseIdentity): string {
	return identity.version || identity.tag || identity.digest || identity.integrity || '—';
}

export function ManagedReleaseCandidates(props: Readonly<{
	result: ManagedReleaseCandidateResult | null;
	loading: boolean;
	requestPhase?: ManagedReleaseRequestPhase;
	queuedVerificationCount?: number;
	verificationCount?: number;
	error: string;
	query: string;
	filter: 'all' | 'stable' | 'preview';
	selectedID: string;
	onQueryChange: (value: string) => void;
	onFilterChange: (value: 'all' | 'stable' | 'preview') => void;
	onSelect: (candidateID: string) => void;
	onVerify?: (candidateID: string) => void;
	onVisible?: (candidateIDs: string[]) => void;
	onLoadMore?: () => void;
	checkingVerificationIDs?: ReadonlyArray<string>;
	queuedVerificationIDs?: ReadonlyArray<string>;
	leadingItem?: JSX.Element;
	showRiskHints?: boolean;
	defaultKind?: ManagedReleaseDefaultKind;
}>): JSX.Element {
	const i18n = useI18n();
	let scrollViewport: HTMLDivElement | undefined;
	let viewportFrame: number | undefined;
	const candidates = createMemo(() => (props.result?.candidates ?? []).filter((candidate) => {
		if (props.filter !== 'all' && candidate.channel !== props.filter) return false;
		const query = props.query.trim().toLowerCase();
		return !query || `${candidate.version ?? ''} ${candidate.tag ?? ''} ${candidate.source} ${candidate.registry ?? ''}`.toLowerCase().includes(query);
	}));
	const selected = createMemo(() => props.result?.candidates.find((candidate) => candidate.candidate_id === props.selectedID));
	const checkingVerificationIDs = createMemo(() => new Set(props.checkingVerificationIDs ?? []));
	const queuedVerificationIDs = createMemo(() => new Set(props.queuedVerificationIDs ?? []));
	const requestPhase = createMemo<ManagedReleaseRequestPhase>(() => props.requestPhase ?? (props.loading ? 'initial' : 'idle'));
	const statusText = createMemo(() => {
		if (props.error) return props.error;
		const loadedCount = props.result?.loaded_count ?? 0;
		const selectedCandidate = selected();
		const selectedLabel = selectedCandidate?.version || selectedCandidate?.tag || '';
		switch (requestPhase()) {
			case 'initial': return i18n.t('webServices.managed.releaseLoadingInitial', { count: loadedCount });
			case 'refresh': return i18n.t('webServices.managed.releaseRefreshing');
			case 'load_more': return i18n.t('webServices.managed.releaseLoadingMore', { count: loadedCount });
			case 'verification_queued': return selectedCandidate?.verification_status === 'pending' && queuedVerificationIDs().has(selectedCandidate.candidate_id)
				? i18n.t('webServices.managed.releaseSelectedVerificationQueued', { version: selectedLabel })
				: i18n.t('webServices.managed.releaseVerificationQueued', { count: props.queuedVerificationCount ?? 0 });
			case 'verification': return selectedCandidate?.verification_status === 'pending' && checkingVerificationIDs().has(selectedCandidate.candidate_id)
				? i18n.t('webServices.managed.releaseSelectedVerificationProgress', { version: selectedLabel })
				: i18n.t('webServices.managed.releaseVerificationProgress', { count: props.verificationCount ?? 0 });
			default:
				if (props.result?.has_more) return i18n.t('webServices.managed.releaseLoadMoreHint', { count: loadedCount });
				if (props.result) return i18n.t('webServices.managed.releaseLoadedSummary', { count: loadedCount });
				return '';
		}
	});
	const statusBusy = createMemo(() => requestPhase() !== 'idle' && !props.error);
	const scanViewport = () => {
		viewportFrame = undefined;
		if (!scrollViewport || scrollViewport.clientHeight <= 0 || props.loading) return;
		const viewportBounds = scrollViewport.getBoundingClientRect();
		const visible = Array.from(scrollViewport.querySelectorAll<HTMLButtonElement>('button[data-release-id][data-verification-status="pending"]'))
			.filter((candidate) => {
				const bounds = candidate.getBoundingClientRect();
				return bounds.bottom >= viewportBounds.top - 64 && bounds.top <= viewportBounds.bottom + 64;
			})
			.slice(0, 20)
			.map((candidate) => candidate.dataset.releaseId ?? '')
			.filter(Boolean);
		if (visible.length > 0) props.onVisible?.(visible);
		if (props.result?.has_more && scrollViewport.scrollHeight-scrollViewport.scrollTop-scrollViewport.clientHeight <= 192) {
			props.onLoadMore?.();
		}
	};
	const scheduleViewportScan = () => {
		if (viewportFrame !== undefined || typeof window === 'undefined') return;
		viewportFrame = window.requestAnimationFrame(scanViewport);
	};
	createEffect(() => {
		const result = props.result;
		const loading = props.loading;
		if (result || !loading) scheduleViewportScan();
	});
	onCleanup(() => {
		if (viewportFrame !== undefined) window.cancelAnimationFrame(viewportFrame);
	});
	return (
		<div class="flex h-full min-h-0 flex-col gap-3" data-testid="managed-release-candidates">
			<Show when={props.result}>{(result) => <div class="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-x-4 gap-y-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs">
				<Show when={result().current_release}>{(identity) => <Show when={identity().kind !== 'none'}><div class="min-w-0"><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.currentRelease')}</div><div class="mt-1 truncate font-mono text-foreground" title={releaseIdentityLabel(identity())}>{releaseIdentityLabel(identity())}</div><Show when={identity().integrity || identity().digest}>{(exactIdentity) => <code class="mt-1 block truncate text-[10px] text-muted-foreground" title={exactIdentity()}>{exactIdentity()}</code>}</Show><div class="mt-1 truncate text-[10px] text-muted-foreground">{identity().source || '—'}<Show when={identity().registry}>{(registry) => ` · ${registry()}`}</Show> · {releaseTrustLabel(identity().trust || 'registry', i18n)}</div></div></Show>}</Show>
				<Show when={result().recommended_release}>{(identity) => <div class="min-w-0"><div class="text-[10px] font-medium text-muted-foreground">{i18n.t(props.defaultKind === 'template' ? 'webServices.managed.defaultVersion' : 'webServices.managed.recommendedVersion')}</div><div class="mt-1 truncate font-mono text-foreground">{releaseIdentityLabel(identity())}</div></div>}</Show>
				<Show when={result().latest_stable_release}>{(candidate) => <div class="min-w-0"><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.latestStableRelease')}</div><div class="mt-1 truncate font-mono text-foreground">{candidate().version || candidate().tag}</div></div>}</Show>
				<Show when={result().latest_preview_release}>{(candidate) => <div class="min-w-0"><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.latestPreviewRelease')}</div><div class="mt-1 truncate font-mono text-foreground">{candidate().version || candidate().tag}</div></div>}</Show>
				<div class="min-w-0"><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.releaseCheckedAt')}</div><div class="mt-1 text-foreground">{i18n.formatDateTime(result().checked_at_unix_ms, { dateStyle: 'medium', timeStyle: 'short' })}</div><div class="mt-1 text-[10px] text-muted-foreground">{i18n.t('webServices.managed.releaseDirectSource')}</div></div>
			</div>}</Show>
			<Show when={props.result?.last_error_code}>{(code) => <div class="shrink-0 rounded-lg border border-warning/30 bg-warning/[0.06] p-3 text-xs text-warning"><div>{releaseSourceErrorLabel(code(), i18n)}</div><div class="mt-1 text-[10px] text-muted-foreground">{i18n.t('webServices.managed.releaseCheckStale')}</div></div>}</Show>
			<div class="flex shrink-0 flex-wrap gap-2">
				<Input value={props.query} onInput={(event) => props.onQueryChange(event.currentTarget.value)} placeholder={i18n.t('webServices.managed.releaseSearch')} aria-label={i18n.t('webServices.managed.releaseSearch')} class="min-w-48 flex-1" />
				<div class="inline-flex rounded-md border p-0.5" role="group" aria-label={i18n.t('webServices.managed.releaseFilterLabel')}>
					<For each={['all', 'stable', 'preview'] as const}>{(filter) => <Button size="sm" variant={props.filter === filter ? 'default' : 'ghost'} onClick={() => props.onFilterChange(filter)}>{i18n.t(`webServices.managed.releaseFilter.${filter}` as EnvAppTranslationKey)}</Button>}</For>
				</div>
			</div>
			<div class="flex min-h-0 flex-1 flex-col gap-2">
				<Show when={props.result} fallback={<div class={cn('flex min-h-0 flex-1 items-center justify-center rounded-lg border p-3 text-sm', props.error ? 'border-destructive/30 bg-destructive/[0.06] text-destructive' : 'text-muted-foreground')}>{props.error || i18n.t('common.status.loading')}</div>}>
					<div
						{...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
						ref={(element) => { scrollViewport = element; scheduleViewportScan(); }}
						class="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain rounded-lg border [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]"
						data-testid="managed-release-candidate-scroll"
						role="radiogroup"
						aria-label={i18n.t('webServices.managed.releaseListLabel')}
						tabindex="0"
						onScroll={scheduleViewportScan}
						onWheel={(event) => {
							if (!scrollViewport || event.deltaY === 0) return;
							event.preventDefault();
							event.stopPropagation();
							scrollViewport.scrollTop = Math.max(0, Math.min(scrollViewport.scrollHeight - scrollViewport.clientHeight, scrollViewport.scrollTop + event.deltaY));
						}}
					>
						{props.leadingItem}
						<For each={candidates()} fallback={<div class="py-8 text-center text-sm text-muted-foreground">{i18n.t('webServices.managed.noReleaseMatches')}</div>}>{(candidate) => {
			const isSelected = () => props.selectedID === candidate.candidate_id;
			const isChecking = () => checkingVerificationIDs().has(candidate.candidate_id);
			const isQueued = () => queuedVerificationIDs().has(candidate.candidate_id);
			return <button type="button" role="radio" class={cn('grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] sm:items-center sm:py-2', isSelected() && 'bg-primary/[0.06] shadow-[inset_3px_0_0_0_var(--primary)]', candidate.verification_status === 'unavailable' && 'cursor-not-allowed opacity-65')} disabled={candidate.verification_status === 'unavailable'} aria-checked={isSelected()} aria-busy={isChecking() || isQueued() || undefined} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
								event.stopPropagation();
								if (candidate.verification_status === 'pending') {
									props.onSelect(candidate.candidate_id);
									props.onVerify?.(candidate.candidate_id);
								} else {
									props.onSelect(candidate.candidate_id);
								}
							}} data-release-id={candidate.candidate_id} data-verification-status={candidate.verification_status}>
								<div class="flex min-w-0 items-start gap-2"><span class={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', isSelected() ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 text-transparent')} aria-hidden="true"><Check class="h-3 w-3" /></span><div class="min-w-0"><div class="truncate font-mono text-sm font-semibold text-foreground" title={candidate.version || candidate.tag} data-testid="managed-release-version-label">{candidate.version || candidate.tag}</div><div class="mt-0.5 truncate text-[10px] text-muted-foreground" title={`${candidate.source}${candidate.registry ? ` · ${candidate.registry}` : ''} · ${candidate.platform || i18n.t('webServices.managed.platformAny')}`}>{candidate.source}<Show when={candidate.registry}>{(registry) => ` · ${registry()}`}</Show> · {candidate.platform || i18n.t('webServices.managed.platformAny')}</div></div></div>
								<div class="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1"><div class="truncate text-[10px] text-muted-foreground">{releaseTrustLabel(candidate.trust, i18n)}<Show when={candidate.published_at_unix_ms}>{(published) => ` · ${i18n.t('webServices.managed.releasePublishedAt', { date: i18n.formatDateTime(published(), { dateStyle: 'medium' }) })}`}</Show></div><Show when={candidate.integrity || candidate.digest}>{(exactIdentity) => <code class="mt-0.5 block truncate text-[10px] text-muted-foreground" title={exactIdentity()}>{exactIdentity()}</code>}</Show></div>
				<div class="col-start-2 row-start-1 flex min-w-0 flex-wrap justify-end gap-1 sm:col-start-3 sm:max-w-52"><Show when={candidate.verification_status === 'pending'}><Tag size="sm" variant="neutral" tone="soft">{i18n.t(`webServices.managed.releaseVerification.${isChecking() ? 'active' : isQueued() ? 'queued' : 'pending'}` as EnvAppTranslationKey)}</Tag></Show><Show when={candidate.is_current}><Tag size="sm" variant="success" tone="soft">{i18n.t('webServices.managed.releaseBadge.current')}</Tag></Show><Show when={candidate.is_recommended && candidate.recommendation_status === 'available'}><Tag size="sm" variant="info" tone="soft">{i18n.t(props.defaultKind === 'template' ? 'webServices.managed.defaultVersion' : 'webServices.managed.releaseBadge.recommended')}</Tag></Show><Show when={candidate.recommendation_status === 'unavailable'}><Tag size="sm" variant="warning" tone="soft">{i18n.t('webServices.managed.releaseBadge.recommendedUnavailable')}</Tag></Show><Show when={candidate.digest_verified}><Tag size="sm" variant="success" tone="soft">{i18n.t('webServices.managed.releaseBadge.verifiedDigest')}</Tag></Show><Show when={candidate.is_latest_stable}><Tag size="sm" variant="neutral" tone="soft">{i18n.t('webServices.managed.releaseBadge.latestStable')}</Tag></Show><Show when={candidate.is_latest_preview}><Tag size="sm" variant="warning" tone="soft">{i18n.t('webServices.managed.releaseBadge.latestPreview')}</Tag></Show><Tag size="sm" variant={candidate.channel === 'preview' ? 'warning' : 'neutral'} tone="soft">{i18n.t(`webServices.managed.releaseChannel.${candidate.channel}` as EnvAppTranslationKey)}</Tag><Show when={candidate.deprecated}><Tag size="sm" variant="warning" tone="soft">{i18n.t('webServices.managed.deprecated')}</Tag></Show></div>
								<Show when={candidate.tag_moved}><p class="col-span-2 text-[11px] text-warning sm:col-span-3">{i18n.t('webServices.managed.releaseTagMoved')}</p></Show>
								<Show when={candidate.digest_verified || candidate.verification_status === 'unavailable'}><p class="col-span-2 text-[11px] text-warning sm:col-span-3">{releaseReasonLabel(candidate, i18n)}</p></Show>
							</button>
						}}</For>
					</div>
				</Show>
				<div class="managed-release-list-status" data-loading={statusBusy()} data-error={Boolean(props.error)} data-phase={requestPhase()} data-testid="managed-release-more-sentinel" role="status" aria-live="polite" aria-busy={statusBusy() || undefined}>
					<Show when={statusBusy()}>
						<span class="managed-release-list-status__spinner" data-testid="managed-release-loading-spinner" aria-hidden="true" />
					</Show>
					<span class="managed-release-list-status__message min-w-0 text-xs font-medium leading-5">{statusText()}</span>
					<Show when={statusBusy()}><span class="managed-release-list-status__track" aria-hidden="true"><span /></span></Show>
				</div>
			</div>
			<Show when={props.showRiskHints && selected()} keyed>{(candidate) => (
				<div class="shrink-0"><ManagedReleaseRiskHints riskIDs={releaseRiskHintIDs(candidate, props.defaultKind)} /></div>
			)}</Show>
		</div>
	);
}

function managedServicePresentation(service: ManagedService, i18n: WebServicesI18n): ServiceTemplatePresentation {
  const identity = managedServiceLocalizedIdentity(service, i18n);
  const kind = service.deployment === 'host'
    ? 'host'
    : service.deployment === 'compose'
      ? 'compose'
      : 'container';
  return {
    id: service.template_id,
    name: identity.name,
    description: identity.description,
    source: service.template_source || 'custom',
    kind,
    icon: service.icon,
    deploymentLabel: managedDeploymentLabel(service.deployment, i18n),
    defaultReleaseLabel: service.release_status.current_release ? releaseIdentityLabel(service.release_status.current_release) : undefined,
    revision: 0,
    developerPreview: false,
    available: true,
    installed: true,
    duplicateable: false,
    editable: false,
  };
}

function managedActionUnavailableReason(capability: ManagedActionCapability, i18n: WebServicesI18n): string {
  if (capability.available) return '';
  const known = new Set(['OPERATION_ACTIVE', 'SERVICE_STATE_UNAVAILABLE', 'NO_RETRYABLE_FAILURE', 'RESELECT_RELEASE_REQUIRED', 'REFLIGHT_REQUIRED', 'RUNTIME_BINDING_INVALID', 'RUNTIME_UNAVAILABLE']);
  const code = capability.reason_code && known.has(capability.reason_code) ? capability.reason_code : 'SERVICE_STATE_UNAVAILABLE';
  return i18n.t(`webServices.managed.actionUnavailable.${code}` as EnvAppTranslationKey);
}

export function ManagedServiceRow(props: { service: ManagedService; selected?: boolean; operation?: ManagedOperation | null; operationPhase?: ManagedOperationPresentationPhase; operationExpanded: boolean; busy: boolean; busyText?: string; canOpen: boolean; openUnavailableReason?: string; canManage: boolean; onOpen: () => void; onOpenResource: (resource: ManagedContainerResource) => void; onAction: (action: ManagedAction) => void; onOperationExpandedChange: (operationID: string, expanded: boolean) => void; onCancelOperation?: () => void; onDiagnosticCopyFailure?: (message: string) => void; onSettings?: () => void; onRestoreManagement?: () => void; onVersions?: () => void; onLogs: () => void; onUninstall: () => void; onInspect?: () => void }) {
  const i18n = useI18n();
  const presentation = () => managedServicePresentation(props.service, i18n);
  const running = () => props.service.observed_state === 'running';
  const operation = () => props.operation ?? null;
  const activeOperation = () => managedOperationActive(props.operation) ? props.operation ?? null : null;
  const statusLabel = createMemo(() => {
    const current = activeOperation();
    if (!current) return i18n.t(managementStatusKey(props.service.status ?? props.service.observed_state));
    return current.state === 'submitting' ? i18n.t('webServices.managed.operationStarting') : managedStageLabel(current.stage, i18n);
  });
  const busy = () => props.busy || managedOperationActive(props.operation);
  const actionCapability = (action: ManagedAction): ManagedActionCapability => props.service.actions?.[action] ?? { available: false, reason_code: 'SERVICE_STATE_UNAVAILABLE' };
  const primaryAction = (): string => props.service.primary_action ?? 'inspect';
  const primaryFullLabel = () => primaryAction() === 'start' ? i18n.t('webServices.managed.start') : primaryAction() === 'stop' ? i18n.t('webServices.managed.stop') : primaryAction() === 'recover' ? i18n.t('webServices.management.actions.recover') : i18n.t('webServices.management.title');
  const archived = () => Boolean(props.service.management_state && props.service.management_state !== 'active');
  const primaryLabel = () => archived()
    ? i18n.t(props.service.management_state === 'detached' ? 'webServices.collection.restore' : 'webServices.collection.viewData')
    : primaryAction() === 'start' || primaryAction() === 'stop' ? primaryFullLabel()
    : i18n.t(primaryAction() === 'recover' ? 'webServices.collection.recover' : 'webServices.collection.review');
  const notices = createMemo(() => {
    if (activeOperation()) return [];
    const messages: string[] = [];
    if (props.service.status === 'uninstall_pending') messages.push(i18n.t('webServices.management.problems.cleanupBlocked'));
    else if (props.service.problem_code) messages.push(i18n.t(managementProblemKey(props.service.problem_code)));
    if (running() && props.service.opening?.error_code) messages.push(`${i18n.t('webServices.managed.openingUnavailable')}: ${managedFailureMessage(props.service.opening.error_code, i18n)}`);
    if (props.service.pending_changes) messages.push(i18n.t('webServices.managed.pendingChanges'));
    if (props.openUnavailableReason) messages.push(props.openUnavailableReason);
    return [...new Set(messages)];
  });
  const primaryCapability = (): ManagedActionCapability => primaryAction() === 'inspect' || primaryAction() === 'recover' ? props.service.actions?.inspect ?? { available: true } : actionCapability(primaryAction() as ManagedAction);
  const executePrimary = () => { const action = primaryAction(); if (action === 'start' || action === 'stop') props.onAction(action); else props.onInspect?.(); };
  const actionLabel = (action: ManagedAction): string => {
    const label = action === 'restart' ? i18n.t(props.service.pending_changes ? 'webServices.managed.applyAndRestart' : 'webServices.managed.restart') : i18n.t('webServices.managed.retry');
    const reason = managedActionUnavailableReason(actionCapability(action), i18n);
    return reason ? `${label} — ${reason}` : label;
  };
  const moreItems = (): DropdownItem[] => [
 { id: 'inspect', label: i18n.t('webServices.management.title') },
    ...(props.service.actions?.restore_management?.available ? [{ id: 'restore-management', label: i18n.t('webServices.managed.restoreManagement'), disabled: busy() || !props.canManage }] : []),
    ...(props.service.container_resources ?? []).map((resource) => ({
      id: `resource:${resource.kind}`,
      label: resource.kind === 'image'
        ? i18n.t('containers.views.images')
        : resource.kind === 'compose_project'
          ? i18n.t('containers.views.compose-projects')
          : i18n.t('containers.views.containers'),
    })),
		...(props.service.release_status.current_release?.kind === 'npm' || props.service.release_status.current_release?.kind === 'oci' ? [{
			id: 'versions',
			label: i18n.t('webServices.managed.versions'),
			disabled: busy() || !props.canManage,
		}] : []),
    ...(props.onSettings ? [{
      id: 'settings',
      label: i18n.t('common.actions.settings'),
      disabled: busy() || !props.canManage,
    }] : []),
    ...(!archived() ? [{
      id: 'restart',
      label: actionLabel('restart'),
      disabled: busy() || !props.canManage || !actionCapability('restart').available,
    }] : []),
    {
      id: 'logs',
      label: i18n.t('webServices.managed.logs'),
      disabled: false,
    },
    {
      id: 'uninstall',
      label: i18n.t(props.service.management_state === 'uninstalled' ? 'webServices.management.cleanupRetained' : 'webServices.managed.uninstall'),
      disabled: busy() || !props.canManage || props.service.actions?.uninstall?.available === false,
    },
  ];
  const selectMoreItem = (id: string) => {
    if (id === 'inspect') { props.onInspect?.(); return; }
    if (id === 'restore-management') { props.onRestoreManagement?.(); return; }
    if (id.startsWith('resource:')) {
      const resource = props.service.container_resources?.find((item) => `resource:${item.kind}` === id);
      if (resource) props.onOpenResource(resource);
    }
		else if (id === 'versions') props.onVersions?.();
    else if (id === 'settings') props.onSettings?.();
    else if (id === 'restart' || id === 'retry') props.onAction(id);
    else if (id === 'logs') props.onLogs();
    else if (id === 'uninstall') props.onUninstall();
  };
  return (
    <div class="web-service-managed" data-selected={props.selected || undefined}
      data-testid="managed-service-row"
      data-managed-service-id={props.service.service_id}
    >
      <div class={serviceRowGridClass}>
        <div class="web-service-identity"><ServiceTemplateIdentity template={presentation()} compact metadata={
          <div class="web-service-metadata" data-testid="managed-service-secondary">
            <span>{presentation().deploymentLabel}</span>
            <Tooltip placement="top" content={<div class="max-w-72 space-y-1 text-left text-xs">
              <div>{i18n.t('webServices.managed.currentRelease')}: {props.service.release_status.current_release ? releaseIdentityLabel(props.service.release_status.current_release) : '—'}</div>
              <Show when={props.service.release_status.recommended_release}>{(release) => <div>{i18n.t(props.service.template_source === 'builtin' ? 'webServices.managed.recommendedVersion' : 'webServices.managed.defaultVersion')}: {releaseIdentityLabel(release())}</div>}</Show>
              <Show when={props.service.release_status.checked_at_unix_ms}><div>{i18n.t('webServices.managed.releaseCheckedAt')}: {i18n.formatDateTime(props.service.release_status.checked_at_unix_ms!, { dateStyle: 'medium', timeStyle: 'short' })}<Show when={props.service.release_status.check_status === 'stale' || props.service.release_status.check_status === 'error'}> · {i18n.t('webServices.managed.releaseCheckStale')}</Show></div></Show>
            </div>}>
              <button type="button" class="web-service-version" onClick={props.onVersions} disabled={busy() || !props.canManage || !props.onVersions}
                aria-label={`${props.service.name}: ${i18n.t('webServices.managed.versions')}`} data-testid="managed-service-version">
                {props.service.release_status.current_release ? releaseIdentityLabel(props.service.release_status.current_release) : '—'}
                <Show when={props.service.release_status.latest_stable_relation === 'newer'}><span class="web-service-update-dot" aria-label={i18n.t('webServices.collection.updateAvailable')} /></Show>
                <Show when={props.service.release_status.latest_stable_relation !== 'newer' && props.service.release_status.latest_preview_relation === 'newer'}><span class="web-service-preview">{i18n.t('webServices.managed.releaseChannel.preview')}</span></Show>
              </button>
            </Tooltip>
            <span class="web-service-workspace" title={props.service.workspace_path} data-testid="managed-service-workspace"><FolderOpen class="h-3 w-3 shrink-0" aria-hidden="true" /><span>{workspaceBasename(props.service.workspace_path)}</span></span>
            <span class="web-service-access">{i18n.t(props.service.access_mode === 'desktop_loopback' ? 'webServices.accessMode.desktopLoopbackShort' : 'webServices.accessMode.unifiedProxyShort')}</span>
          </div>
        } /></div>
        <div class="web-service-status" data-testid="managed-service-status" role="status" aria-live="polite">
          <ServiceStatusIndicator label={statusLabel()}
            tone={activeOperation() ? 'neutral' : managedStatusTone(props.service.status ?? props.service.observed_state)} />
        </div>

        <div class={serviceRowActionsClass} data-archived={archived() || undefined} data-testid="managed-service-actions">
          <Show when={!archived()}><Tooltip content={props.openUnavailableReason || (props.busy ? props.busyText || i18n.t('webServices.status.opening') : i18n.t('webServices.actions.openServiceTooltip'))} placement="top" anchorClass="web-service-open">
            <Button
              size="sm"
              variant="default"
              class="web-service-button"
              onClick={props.onOpen}
              disabled={!props.service.actions?.open?.available || props.busy || !props.canOpen}
              aria-busy={props.busy || undefined}
            >
              <Show when={props.busy} fallback={<ExternalLink class="mr-1.5 h-3.5 w-3.5" />}>
                <InlineButtonSnakeLoading class="mr-1.5" />
              </Show>
              {i18n.t('webServices.actions.open')}
            </Button>
          </Tooltip></Show>
          <Tooltip content={managedActionUnavailableReason(primaryCapability(), i18n)} placement="top" anchorClass="web-service-manage" disabled={primaryCapability().available}>
            <Button data-testid="managed-service-primary" size="sm" variant="outline" class="web-service-button" aria-label={`${props.service.name}: ${primaryFullLabel()}`} onClick={executePrimary} disabled={!primaryCapability().available || ((primaryAction() === 'start' || primaryAction() === 'stop') && (busy() || !props.canManage))}>
              <Show when={primaryAction() === 'stop'}><Stop class="mr-1.5 h-3.5 w-3.5" /></Show>
              <Show when={primaryAction() === 'start'}><Play class="mr-1.5 h-3.5 w-3.5" /></Show>
              <Show when={primaryAction() !== 'start' && primaryAction() !== 'stop'}><Search class="mr-1.5 h-3.5 w-3.5" /></Show>
              {primaryLabel()}
            </Button>
          </Tooltip>
          <Dropdown
            align="end"
            items={moreItems()}
            onSelect={selectMoreItem}
            triggerAriaLabel={`${props.service.name}: ${i18n.t('webServices.managed.moreActions')}`}
            triggerClass="web-service-more shrink-0 rounded-md"
            trigger={(
              <span
                class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="managed-service-more"
                title={i18n.t('webServices.managed.moreActions')}
              >
                <MoreHorizontal class="h-4 w-4" aria-hidden="true" />
              </span>
            )}
          />
        </div>
      </div>
      <div class="web-service-notice-region" data-expanded={notices().length > 0 || undefined} aria-hidden={notices().length === 0 || undefined} data-testid="managed-service-notice">
        <div class="web-service-notice-clip"><div class="web-service-notice">
          <AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div><For each={notices()}>{(message) => <p>{message}</p>}</For></div>
        </div></div>
      </div>
      <Show when={operation()}>{(activeOperation) => (
        <ManagedOperationDisclosure
          operation={activeOperation()}
          presentationPhase={props.operationPhase ?? 'visible'}
          deployment={props.service.deployment}
          expanded={props.operationExpanded}
          canCancel={props.canManage}
          onExpandedChange={(expanded) => props.onOperationExpandedChange(activeOperation().operation_id, expanded)}
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
              showScopeRestriction() && 'border-warning/45',
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
  targetURL: string;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (target: string, name: string, description: string, accessMode: WebServiceAccessMode) => void;
}>) {
  const i18n = useI18n();
  const [target, setTarget] = createSignal('');
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
    setTarget(props.targetURL);
    setName(props.initialName);
    setDescription(props.initialDescription);
    setAccessMode(props.initialAccessMode || 'unified_proxy');
    setValidationVisible(false);
  });

  const targetError = () => isSupportedWebServiceTarget(target())
    ? ''
    : i18n.t('webServices.dialog.targetError');
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
    if (targetError() || nameError() || descriptionError()) return;
    props.onSubmit(target().trim(), name().trim(), description().trim(), accessMode());
  };
  const showScopeRestriction = () => target().trim().length > 0 && Boolean(targetError());
  const showMissingTarget = () => validationVisible() && target().trim().length === 0;

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
          <label class="mb-1 block text-xs font-medium" for="web-service-metadata-target">{i18n.t('webServices.fields.url')} <span class="text-destructive">*</span></label>
          <Input
            id="web-service-metadata-target"
            value={target()}
            onInput={(event) => setTarget(event.currentTarget.value)}
            placeholder={i18n.t('webServices.dialog.targetPlaceholder')}
            aria-invalid={showScopeRestriction() || showMissingTarget() ? 'true' : undefined}
            aria-describedby="web-service-metadata-target-guidance"
            class={cn(
              'w-full font-mono',
              showScopeRestriction() && 'border-warning/45',
            )}
          />
          <div
            id="web-service-metadata-target-guidance"
            class={cn(
              'mt-1.5 min-h-4 text-[11px]',
              showScopeRestriction()
                ? 'flex items-start gap-2 rounded-md border border-warning/25 bg-warning/[0.06] px-2.5 py-2 text-foreground'
                : showMissingTarget() ? 'text-destructive' : 'leading-4 text-muted-foreground',
            )}
            role={showScopeRestriction() ? 'alert' : undefined}
          >
            <Show
              when={showScopeRestriction()}
              fallback={showMissingTarget() ? i18n.t('webServices.dialog.targetError') : i18n.t('webServices.dialog.targetHelp')}
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
        <AccessModePicker value={accessMode()} targetURL={target()} disabled={props.loading} onChange={setAccessMode} />
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
  let pageRoot: HTMLDivElement | undefined;
  let addressInput: HTMLInputElement | undefined;
  const ctx = useEnvContext();
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
  const activation = (() => {
    try {
      return useViewActivation();
    } catch {
      // Standalone and embedded surfaces can mount outside the activity activation provider.
      return { active: () => true, activationSeq: () => 0 };
    }
  })();

  // Search/filter state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [addressValidationVisible, setAddressValidationVisible] = createSignal(false);
  const [recentSession, setRecentSession] = createSignal<ForwardSession | null>(null);
  const [forwardMetadataTarget, setForwardMetadataTarget] = createSignal<ForwardMetadataTarget | null>(null);
  const [forwardMetadataSaving, setForwardMetadataSaving] = createSignal(false);

  createEffect(() => {
    const active = activation.active();
    activation.activationSeq();
    if (!active || !canExecute()) return;

    window.requestAnimationFrame(() => {
      if (!activation.active() || addressInput?.disabled) return;
      addressInput?.focus({ preventScroll: true });
    });
  });

  // Web services resource
  const [refreshSeq, setRefreshSeq] = createSignal(0);
  const bumpRefresh = () => setRefreshSeq((n) => n + 1);

  const [forwards] = createResource<{ items: PortForward[]; loaded: boolean; checkFailed: boolean }, number | null>(
    () => permissionReady() && canExecute() ? refreshSeq() : null,
    async (_key, previous) => {
      try {
        const out = await fetchLocalApiJSON<{ forwards: PortForward[] }>('/_redeven_proxy/api/forwards', { method: 'GET' });
        return { items: Array.isArray(out?.forwards) ? out.forwards : [], loaded: true, checkFailed: false };
      } catch {
        return { items: previous.value?.items ?? [], loaded: previous.value?.loaded ?? false, checkFailed: true };
      }
    },
  );
  const initialForwardsLoading = () => forwards.state === 'pending';
  const forwardsRefreshing = () => forwards.state === 'refreshing';
  const forwardsRenderable = () => forwards()?.loaded ?? false;
  const forwardsCheckFailed = () => forwards()?.checkFailed ?? false;

  const [managedState, setManagedState] = createSignal<ManagedService[]>([]);
  const [managedTemplates, setManagedTemplates] = createSignal<ManagedCatalogTemplate[]>([]);
  const [managedLoading, setManagedLoading] = createSignal(false);
  const [managedLoadError, setManagedLoadError] = createSignal(false);
  const [expandedManagedOperations, setExpandedManagedOperations] = createSignal<Record<string, boolean>>({});
  const managedOperationPresentation = createManagedServiceOperationPresentation({
    isExpanded: (operationID) => Boolean(expandedManagedOperations()[operationID]),
  });
  const managedOperations = createManagedServiceOperationController({
    streamFailedMessage: () => i18n.t('webServices.managed.operationStreamFailed'),
    timedOutMessage: () => i18n.t('webServices.managed.operationTimedOut'),
    onOperationUpdated: managedOperationPresentation.update,
    onOperationReleased: managedOperationPresentation.release,
    onSubmittingOperationAccepted: (submittingOperationID, operationID) => {
      setExpandedManagedOperations((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, submittingOperationID)) return current;
        const next = { ...current, [operationID]: current[submittingOperationID] ?? false };
        delete next[submittingOperationID];
        return next;
      });
    },
  });
  const [managedInstallSubmitting, setManagedInstallSubmitting] = createSignal(false);
	const [installReview, setInstallReview] = createSignal<{ plan_digest: string; workspace_path: string; fingerprint: string } | null>(null);
	const [installParameters,setInstallParameters]=createSignal<Record<string,string>>({});
  const [workspacePath, setWorkspacePath] = createSignal('');
  const [managedAccessMode, setManagedAccessMode] = createSignal<WebServiceAccessMode>('unified_proxy');
  const [workspacePickerOpen, setWorkspacePickerOpen] = createSignal(false);
  const [gitImportOpen, setGitImportOpen] = createSignal(false);
  const [gitImportTemplate, setGitImportTemplate] = createSignal<ManagedCatalogTemplate>();
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
  const [managementReview, setManagementReview] = createSignal<HostManagementReview | null>(null);
  const [managementRestoreBusy, setManagementRestoreBusy] = createSignal(false);
  const [managedLogIsHost, setManagedLogIsHost] = createSignal(false);
  const [managedLogs, setManagedLogs] = createSignal<string[] | null>(null);
  const [updateNoticeAcceptances, setUpdateNoticeAcceptances] = createSignal<Record<string, boolean>>({});
  const [managementTarget, setManagementTarget] = createSignal<{ service: ManagedService; action: ManagementAction } | null>(null);
  const closeManagement = () => {
    const id = managementTarget()?.service.service_id;
    const rows = Array.from(pageRoot?.querySelectorAll<HTMLElement>('[data-managed-service-id]') ?? []);
    const index = rows.findIndex((row) => row.dataset.managedServiceId === id);
    const original = rows[index];
    const neighbors = [rows[index + 1], rows[index - 1]];
    setManagementTarget(null);
    setManagementReview(null);
    window.requestAnimationFrame(() => {
      if (original?.isConnected) return; // The shared Dialog restores a surviving trigger.
      const next = neighbors.find((row) => row?.isConnected)?.querySelector<HTMLElement>('[data-testid="managed-service-primary"]');
      (next ?? pageRoot?.querySelector<HTMLElement>('#web-services-collection-title'))?.focus({ preventScroll: true });
    });
  };
  const [archiveView, setArchiveView] = createSignal('active');
  const [managedSettingsService, setManagedSettingsService] = createSignal<ManagedService | null>(null);
	const [releasePickerTarget, setReleasePickerTarget] = createSignal<ManagedReleasePickerTarget | null>(null);
	const [releaseCandidates, setReleaseCandidates] = createSignal<ManagedReleaseCandidateResult | null>(null);
	const [releaseCandidatesLoading, setReleaseCandidatesLoading] = createSignal(false);
	const [releaseRequestPhase, setReleaseRequestPhase] = createSignal<ManagedReleaseRequestPhase>('idle');
	const [releaseVerificationQueuedIDs, setReleaseVerificationQueuedIDs] = createSignal<string[]>([]);
	const [releaseVerificationActiveIDs, setReleaseVerificationActiveIDs] = createSignal<string[]>([]);
	const [releaseCandidatesError, setReleaseCandidatesError] = createSignal('');
	const [templateRecommendationUnavailable, setTemplateRecommendationUnavailable] = createSignal(false);
	const [releaseQuery, setReleaseQuery] = createSignal('');
	const [releaseFilter, setReleaseFilter] = createSignal<'all' | 'stable' | 'preview'>('all');
	const [selectedReleaseID, setSelectedReleaseID] = createSignal('');
	const [releaseSecretParameters, setReleaseSecretParameters] = createSignal<Record<string, string>>({});
	const [managedUpdatePlan, setManagedUpdatePlan] = createSignal<ManagedUpdatePlan | null>(null);
	const [managedUpdatePlanLoading, setManagedUpdatePlanLoading] = createSignal(false);
	const [managedUpdatePlanError, setManagedUpdatePlanError] = createSignal('');
	const [selectedTemplateRelease, setSelectedTemplateRelease] = createSignal<SelectedTemplateRelease | null>(null);
	let releasePickerRequest: AbortController | null = null;
	let releasePickerGeneration = 0;
	let releaseVerificationTimer: ReturnType<typeof setTimeout> | undefined;
	let releaseRequestFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
	let releaseRequestFeedbackStartedAt = 0;
	let releaseRequestFeedbackGeneration = 0;
	const queuedReleaseVerifications = new Set<string>();
	const attemptedVisibleReleaseVerifications = new Set<string>();
	const resetReleaseRequestFeedback = () => {
		if (releaseRequestFeedbackTimer !== undefined) clearTimeout(releaseRequestFeedbackTimer);
		releaseRequestFeedbackTimer = undefined;
		releaseRequestFeedbackGeneration += 1;
		releaseRequestFeedbackStartedAt = 0;
		setReleaseRequestPhase('idle');
		setReleaseVerificationQueuedIDs([]);
		setReleaseVerificationActiveIDs([]);
	};
	const startReleaseRequestFeedback = (phase: Exclude<ManagedReleaseRequestPhase, 'idle'>) => {
		if (releaseRequestFeedbackTimer !== undefined) clearTimeout(releaseRequestFeedbackTimer);
		releaseRequestFeedbackTimer = undefined;
		releaseRequestFeedbackGeneration += 1;
		releaseRequestFeedbackStartedAt = Date.now();
		setReleaseRequestPhase(phase);
	};
	const finishReleaseRequestFeedback = () => {
		if (releaseRequestFeedbackTimer !== undefined) clearTimeout(releaseRequestFeedbackTimer);
		const feedbackGeneration = releaseRequestFeedbackGeneration;
		const remaining = Math.max(0, 280 - (Date.now() - releaseRequestFeedbackStartedAt));
		const finish = () => {
			if (feedbackGeneration !== releaseRequestFeedbackGeneration || releaseCandidatesLoading() || queuedReleaseVerifications.size > 0) return;
			releaseRequestFeedbackTimer = undefined;
			setReleaseRequestPhase('idle');
		};
		if (remaining === 0) finish();
		else releaseRequestFeedbackTimer = setTimeout(finish, remaining);
	};
	onCleanup(() => {
		releasePickerRequest?.abort();
		if (releaseVerificationTimer !== undefined) clearTimeout(releaseVerificationTimer);
		if (releaseRequestFeedbackTimer !== undefined) clearTimeout(releaseRequestFeedbackTimer);
	});
  const managedRowOperation = (serviceID: string) => managedOperations.operationForService(serviceID);
  const managedPresentedOperation = (serviceID: string) => managedOperationPresentation.operationForService(serviceID);
  const setManagedOperationExpanded = (operationID: string, expanded: boolean) => {
    setExpandedManagedOperations((current) => ({ ...current, [operationID]: expanded }));
    managedOperationPresentation.reconcileExpansion(operationID);
  };
  createEffect(() => {
    const visible = new Set(managedOperationPresentation.operationIDs());
    setExpandedManagedOperations((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([operationID]) => visible.has(operationID)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  });

  const workspacePicker = useEnvFilesystemPicker();
  createEffect(() => { if (!templateDrawerOpen()) setWorkspacePickerOpen(false); });

  const openWorkspacePicker = () => {
    setWorkspacePickerOpen(true);
  };


  let managedLoadGeneration = 0;
  const loadManaged = async (refreshCatalog = true) => {
    if (!permissionReady() || !canRead()) return;
    const generation = ++managedLoadGeneration;
    setManagedLoading(true);
    try {
      const [catalog, services] = await Promise.all([
        refreshCatalog || managedTemplates().length === 0
          ? fetchLocalApiJSON<{ templates: ManagedCatalogTemplate[] }>('/_redeven_proxy/api/managed-web-services/catalog', { method: 'GET' })
          : Promise.resolve({ templates: managedTemplates() }),
        fetchLocalApiJSON<{ services: ManagedService[] }>('/_redeven_proxy/api/managed-web-services', { method: 'GET' }),
      ]);
      if (generation !== managedLoadGeneration) return;
      const templates = Array.isArray(catalog.templates) ? catalog.templates : [];
      setManagedTemplates(templates);
      const nextServices = Array.isArray(services.services) ? services.services : [];
      setManagedState(nextServices);
      managedOperationPresentation.pruneServices(new Set(nextServices.map((service) => service.service_id)));
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
      if (generation === managedLoadGeneration) setManagedLoadError(true);
    } finally { if (generation === managedLoadGeneration) setManagedLoading(false); }
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

	const requestManagedOpenSession = async (service: ManagedService) => {
    try { return await fetchLocalApiJSON<ManagedOpenSession>(
		`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(service.service_id)}/open-session`,
		{ method: 'POST', body: JSON.stringify({ request_id: managedRequestID() }) },
	); } catch (error) { if (error instanceof LocalApiError) throw new Error(managedFailureMessage(error.code, i18n)); throw error; }
  };

	const resolveManagedForwardSession = async (service: ManagedService): Promise<Pick<ForwardSession, 'forward' | 'app_path'>> => {
		let result = await requestManagedOpenSession(service);
		if (result.state === 'preparing') {
			if (!result.operation) throw new Error(i18n.t('webServices.managed.openPreparationFailed'));
			const preparingOperation = result.operation;
			setOpenRequests((current) => ({ ...current, [`managed:${service.service_id}`]: i18n.t('webServices.managed.preparingService') }));
			let operation: ManagedOperation;
			try {
				operation = await managedOperations.track(preparingOperation);
				await loadManaged(false);
			} finally {
				managedOperations.clear(preparingOperation.operation_id);
			}
			if (operation.state !== 'succeeded') throw new Error(managedOperationFailureMessage(operation, i18n));
			result = await requestManagedOpenSession(service);
		}
		if (result.state !== 'ready' || !result.forward || !result.app_path) {
			throw new Error(i18n.t('webServices.managed.openPreparationFailed'));
		}
		return { forward: result.forward, app_path: result.app_path };
	};

  const closeTemplateDrawer = () => {
	setInstallParameters({});setInstallReview(null);
    setTemplateDrawerOpen(false);
    setTemplateDrawerView('catalog');
    setSelectedTemplateID(null);
    setTemplateDraft(null);
    setInstallNoticeAcceptances({});
		setTemplateValidationVisible(false);
		setSelectedTemplateRelease(null);
		setTemplateRecommendationUnavailable(false);
  };

	const installRequest = () => ({ template_id: selectedTemplate()?.template_id, deployment: selectedTemplate()?.deployment, workspace_path: workspacePath().trim(), access_mode: managedAccessMode(), parameters: {...selectedTemplateRelease()?.parameters, ...installParameters()}, accepted_notice_revisions: acceptedNoticeRevisions(selectedTemplate()?.notices, installNoticeAcceptances()), target_release_id: selectedTemplateRelease()?.candidate.candidate_id });
	createEffect(() => { const review = installReview(); if (review && review.fingerprint !== JSON.stringify(installRequest())) setInstallReview(null); });
  const installManaged = async () => {
    const template = selectedTemplate();
    if (!template || managedInstallSubmitting() || !template.available || templateRecommendationUnavailable() || !requiredNoticesAccepted(template.notices, installNoticeAcceptances()) || managedState().some((service) => service.template_id === template.template_id && (service.management_state ?? 'active') === 'active') || !canManageManagedService()) return;
    setManagedInstallSubmitting(true);
    try {
		if (!installReview()) {
			const request = installRequest();
			const plan = await fetchLocalApiJSON<{ plan_digest: string; workspace_path: string }>('/_redeven_proxy/api/managed-web-services/install-plans', { method: 'POST', body: JSON.stringify(request) });
			if (JSON.stringify(request) !== JSON.stringify(installRequest())) return;
			setWorkspacePath(plan.workspace_path);
			setInstallReview({ ...plan, fingerprint: JSON.stringify(installRequest()) });
			return;
		}
		const result = await fetchLocalApiJSON<{ service: ManagedService; operation: ManagedOperation }>('/_redeven_proxy/api/managed-web-services', { method: 'POST', body: JSON.stringify({ ...installRequest(), request_id: managedRequestID(), plan_digest: installReview()?.plan_digest }) });
      const operationPromise = managedOperations.track(result.operation);
      void operationPromise
        .then(async (operation) => {
          await loadManaged(false);
          bumpRefresh();
          if (operation.state !== 'succeeded') {
            notify.error(i18n.t('webServices.notifications.failedToAddTitle'), managedOperationFailureMessage(operation, i18n));
            return;
          }
          notify.success(i18n.t('webServices.notifications.serviceAddedTitle'), i18n.t('webServices.notifications.serviceAddedMessage'));
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
		const message = error instanceof LocalApiError && error.code === 'RECOMMENDED_RELEASE_UNAVAILABLE'
			? releaseSourceErrorLabel(error, i18n)
			: error instanceof Error ? error.message : String(error);
		notify.error(i18n.t('webServices.notifications.failedToAddTitle'), message);
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
      const message = error instanceof LocalApiError && error.code === 'RECOMMENDED_RELEASE_UNAVAILABLE'
        ? releaseSourceErrorLabel(error, i18n)
        : error instanceof Error ? error.message : String(error);
      notify.error(i18n.t('webServices.notifications.failedToAddTitle'), message);
    } finally {
      setManagedInstallSubmitting(false);
    }
  };

	const managedAction = async (serviceID: string, action: ManagedAction | 'update', noticeRevisions: Readonly<Record<string, number>> = {}, updatePlanID = '') => {
    if (!canManageManagedService() || managedOperationActive(managedRowOperation(serviceID))) return;
    const submission = managedOperations.begin(serviceID, action);
    let operationID = submission.operation_id;
    try {
		const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(serviceID)}/operations`, { method: 'POST', body: JSON.stringify({ request_id: managedRequestID(), action, accepted_notice_revisions: noticeRevisions, ...(updatePlanID ? { update_plan_id: updatePlanID } : {}) }) });
      operationID = result.operation_id;
      const operationPromise = managedOperations.track(result);
      await loadManaged(false);
      const operation = await operationPromise;
      await loadManaged(false);
      if (operation.state !== 'succeeded') throw new Error(managedOperationFailureMessage(operation, i18n));
      if (action === 'update') {
        notify.success(i18n.t('webServices.managed.updateComplete'), i18n.t('webServices.managed.updateCompleteMessage'));
      }
    } catch (error) {
      const requestFailed = operationID === submission.operation_id;
      const errorCode = error instanceof LocalApiError ? error.code : 'UI_REQUEST_FAILED';
      const message = requestFailed ? managedFailureMessage(errorCode, i18n) : error instanceof Error ? error.message : String(error);
      if (requestFailed) {
        managedOperationPresentation.update({ ...submission, state: 'failed', stage: 'failed', error_code: errorCode });
      }
      notify.error(managedActionFailureTitle(action, i18n), message);
    }
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
      if (operation.state !== 'succeeded') throw new Error(managedOperationFailureMessage(operation, i18n));
    } catch (error) {
      notify.error(managedActionFailureTitle('reconfigure', i18n), error instanceof Error ? error.message : String(error));
    } finally {
      if (operationID) managedOperations.clear(operationID);
    }
  };

  const reviewManagement = async (service: ManagedService) => {
		setManagementTarget({service,action:'restore'});
    try {
      const review = await fetchLocalApiJSON<HostManagementReview>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(service.service_id)}/management-review`, { method: 'POST', body: '{}' });
      setManagementReview(review);
    } catch (error) { notify.error(i18n.t('webServices.managed.restoreManagement'), error instanceof LocalApiError ? managedFailureMessage(error.code, i18n) : error instanceof Error ? error.message : String(error)); }
  };
  const restoreManagement = async () => {
    const review = managementReview();
    if (!review || managementRestoreBusy()) return;
    setManagementRestoreBusy(true);
    try {
      await fetchLocalApiJSON(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(review.service_id)}/restore-management`, { method: 'POST', body: JSON.stringify({ saved_identity: review.saved_identity, fingerprint: review.fingerprint, confirmed: true }) });
      setManagementReview(null);
      await loadManaged(false);
    } catch (error) { notify.error(i18n.t('webServices.managed.restoreManagement'), error instanceof LocalApiError ? managedFailureMessage(error.code, i18n) : error instanceof Error ? error.message : String(error)); }
    finally { setManagementRestoreBusy(false); }
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
      case 'TEMPLATE_SCHEMA_UNSUPPORTED': return i18n.t('webServices.sources.upgradeRequired');
      case 'TEMPLATE_SOURCE_UNAVAILABLE':
      case 'TEMPLATE_SOURCE_DIGEST_MISMATCH': return i18n.t('webServices.sources.failed');
      case 'PLATFORM_UNSUPPORTED': return i18n.t('webServices.managed.unavailable.platform');
      case 'CATALOG_TRUST_UNAVAILABLE': return i18n.t('webServices.managed.unavailable.catalogTrust');
      case 'CATALOG_UNAVAILABLE': return i18n.t('webServices.managedCatalogUnavailable');
      case 'NESTED_DOCKER_UNSUPPORTED': return i18n.t('webServices.managed.unavailable.nestedDocker');
      case 'DOCKER_UNAVAILABLE': return i18n.t('webServices.managed.unavailable.docker');
      case 'COMPOSE_UNAVAILABLE': return i18n.t('webServices.managed.unavailable.compose');
      default: return template?.reason ?? '';
    }
  };

  const installedServiceForTemplate = (template: ManagedCatalogTemplate) => managedState().find((service) => (service.management_state ?? 'active') === 'active' && service.template_id === template.template_id);
  const templateOpenUnavailableReason = (service: ManagedService | undefined) => {
    if (!service) return '';
    if (managedOperationActive(managedRowOperation(service.service_id))) return i18n.t('webServices.managed.openUnavailableOperation');
    if (service.observed_state !== 'running') return i18n.t('webServices.managed.openUnavailableNotRunning');
    if (!canExecute()) return i18n.t('webServices.permission.executeRequired');
    if (openBusy(`managed:${service.service_id}`)) return i18n.t('webServices.status.opening');
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
      icon: template.icon,
      deploymentLabel: managedDeploymentLabel(template.deployment, i18n),
	  defaultReleaseLabel: template.recommended_release ? releaseIdentityLabel(template.recommended_release) : undefined,
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
      return `${template.name}\n${template.description}\n${template.defaultReleaseLabel ?? ''}\n${template.deploymentLabel}`.toLowerCase().includes(query);
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
  const workspacePickerInitialPath = createMemo(() => {
    if (!workspaceUsesRecommendedPath()) return workspacePath();
    const template = selectedTemplate();
    const recommended = template?.default_workspace_path ?? '';
    const roots = [...(template?.workspace_roots ?? [])].sort((left, right) => right.path.length - left.path.length);
    return roots.find((root) => {
      const prefix = root.path.replace(/[\\/]+$/, '');
      return recommended === root.path || recommended.startsWith(`${prefix}/`) || recommended.startsWith(`${prefix}\\`);
    })?.path ?? '/';
  });
	const templateByID = (templateID: string) => managedTemplates().find((template) => template.template_id === templateID);
	const selectedReleaseCandidate = createMemo(() => releaseCandidates()?.candidates.find((candidate) => candidate.candidate_id === selectedReleaseID()));
	const selectedReleaseDefaultKind = createMemo<ManagedReleaseDefaultKind>(() => {
		const target = releasePickerTarget();
		if (!target) return 'redeven';
		const source = target.kind === 'template' ? templateByID(target.id)?.source : target.service?.template_source;
		return source === 'builtin' ? 'redeven' : 'template';
	});
	const managedUpdatePlanNoticesAccepted = () => requiredNoticesAccepted(managedUpdatePlan()?.notices, updateNoticeAcceptances());
	const managedUpdatePlanRequiresStopped = () => Boolean(managedUpdatePlan()?.requires_stopped && (releasePickerTarget()?.service?.desired_state !== 'stopped' || releasePickerTarget()?.service?.observed_state !== 'stopped'));
	const returnToReleaseCandidates = () => {
		setManagedUpdatePlan(null);
		setManagedUpdatePlanError('');
		setUpdateNoticeAcceptances({});
	};
	const installReleaseRiskHints = createMemo(() => {
		const selected = selectedTemplateRelease()?.candidate;
		if (selected) return releaseRiskHintIDs(selected, selectedTemplate()?.source === 'builtin' ? 'redeven' : 'template');
		const template = selectedTemplate();
		const release = template?.recommended_release;
		if (!release || release.kind === 'none') return [];
		const value = (release.version || release.tag || '').replace(/^v/u, '');
		const semantic = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
		return [
			...(release.kind === 'npm' ? ['npm_lifecycle_scripts'] : []),
			...(semantic && value.includes('-') ? ['preview_release'] : []),
			...(!semantic ? ['version_order_unknown'] : []),
		];
	});
	const closeReleasePicker = () => {
		releasePickerGeneration += 1;
		releasePickerRequest?.abort();
		releasePickerRequest = null;
		if (releaseVerificationTimer !== undefined) clearTimeout(releaseVerificationTimer);
		releaseVerificationTimer = undefined;
		queuedReleaseVerifications.clear();
		attemptedVisibleReleaseVerifications.clear();
		resetReleaseRequestFeedback();
		setReleaseCandidatesLoading(false);
		setManagedUpdatePlanLoading(false);
		setReleasePickerTarget(null);
		setReleaseCandidates(null);
		setReleaseCandidatesError('');
		setSelectedReleaseID('');
		setManagedUpdatePlan(null);
		setManagedUpdatePlanError('');
		setUpdateNoticeAcceptances({});
		setReleaseQuery('');
		setReleaseFilter('all');
	};
	const beginReleasePickerRequest = (target: ManagedReleasePickerTarget) => {
		releasePickerRequest?.abort();
		const controller = new AbortController();
		releasePickerRequest = controller;
		const generation = ++releasePickerGeneration;
		const isCurrent = () => {
			const current = releasePickerTarget();
			return !controller.signal.aborted && releasePickerGeneration === generation && current?.kind === target.kind && current.id === target.id;
		};
		return { controller, isCurrent };
	};
	const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';
	const flushVisibleReleaseVerifications = () => {
		releaseVerificationTimer = undefined;
		const target = releasePickerTarget();
		if (!target || releaseCandidatesLoading() || managedUpdatePlanLoading()) return;
		const selectedID = selectedReleaseID();
		const candidateIDs = [
			...(queuedReleaseVerifications.has(selectedID) ? [selectedID] : []),
			...Array.from(queuedReleaseVerifications).filter((candidateID) => candidateID !== selectedID),
		].slice(0, 20);
		if (candidateIDs.length === 0) return;
		candidateIDs.forEach((candidateID) => {
			queuedReleaseVerifications.delete(candidateID);
			attemptedVisibleReleaseVerifications.add(candidateID);
		});
		setReleaseVerificationQueuedIDs(Array.from(queuedReleaseVerifications));
		setReleaseVerificationActiveIDs(candidateIDs);
		void loadReleaseCandidates(target, 'verify', { candidateIDs });
	};
	const scheduleVisibleReleaseVerification = (candidateIDs: string[]) => {
		for (const candidateID of candidateIDs) {
			if (!attemptedVisibleReleaseVerifications.has(candidateID)) queuedReleaseVerifications.add(candidateID);
		}
		setReleaseVerificationQueuedIDs(Array.from(queuedReleaseVerifications));
		if (!releaseCandidatesLoading() && queuedReleaseVerifications.size > 0) setReleaseRequestPhase('verification_queued');
		if (releaseVerificationTimer !== undefined || queuedReleaseVerifications.size === 0) return;
		releaseVerificationTimer = setTimeout(flushVisibleReleaseVerifications, 50);
	};
	const prioritizeReleaseVerification = (candidateID: string) => {
		if (releaseVerificationActiveIDs().includes(candidateID)) return;
		attemptedVisibleReleaseVerifications.delete(candidateID);
		queuedReleaseVerifications.add(candidateID);
		setReleaseVerificationQueuedIDs(Array.from(queuedReleaseVerifications));
		if (releaseCandidatesLoading() || managedUpdatePlanLoading()) return;
		setReleaseRequestPhase('verification_queued');
		if (releaseVerificationTimer !== undefined) clearTimeout(releaseVerificationTimer);
		releaseVerificationTimer = setTimeout(flushVisibleReleaseVerifications, 0);
	};

	const loadReleaseCandidates = async (
		target = releasePickerTarget(),
		action: 'open' | 'refresh' | 'continue' | 'verify' = 'open',
		options: Readonly<{ cursorID?: string; candidateIDs?: string[] }> = {},
	) => {
		if (!target) return;
		const request = beginReleasePickerRequest(target);
		let refreshAfterOpen = false;
		let requestFailed = false;
		const requestPhase = action === 'open' ? 'initial' : action === 'refresh' ? 'refresh' : action === 'continue' ? 'load_more' : 'verification';
		startReleaseRequestFeedback(requestPhase);
		if (action !== 'verify') setReleaseVerificationActiveIDs([]);
		setReleaseCandidatesLoading(true);
		setReleaseCandidatesError('');
		try {
			const explicitlyVerifiedCandidateID = action === 'verify' && options.candidateIDs?.length === 1 ? options.candidateIDs[0] : undefined;
			const endpoint = target.kind === 'template'
				? `/_redeven_proxy/api/managed-web-service-templates/${encodeURIComponent(target.id)}/release-candidates`
				: `/_redeven_proxy/api/managed-web-services/${encodeURIComponent(target.id)}/release-candidates`;
			const result = await fetchLocalApiJSON<ManagedReleaseCandidateResult>(endpoint, {
				method: 'POST',
				signal: request.controller.signal,
				body: JSON.stringify({
					action,
					parameters: target.kind === 'template' ? releaseSecretParameters() : undefined,
					cursor_id: options.cursorID,
					candidate_ids: options.candidateIDs,
				}),
			});
			if (!request.isCurrent()) return;
			setReleaseCandidates(result);
			if (target.kind === 'template') {
				const recommendation = result.candidates.find((candidate) => candidate.recommendation_status === 'unavailable' || candidate.recommendation_status === 'available');
				if (recommendation?.recommendation_status === 'unavailable') setTemplateRecommendationUnavailable(true);
				if (recommendation?.recommendation_status === 'available') setTemplateRecommendationUnavailable(false);
			}
			if (explicitlyVerifiedCandidateID && result.candidates.some((candidate) => candidate.candidate_id === explicitlyVerifiedCandidateID && candidate.verification_status === 'verified' && candidate.selectable)) {
				setSelectedReleaseID(explicitlyVerifiedCandidateID);
			}
			const recommended = target.kind === 'template'
				? result.candidates.find((candidate) => candidate.selectable && candidate.is_recommended)
				: undefined;
			if (!selectedReleaseID() && recommended) setSelectedReleaseID(recommended.candidate_id);
			setManagedUpdatePlan(null);
			setManagedUpdatePlanError('');
			setUpdateNoticeAcceptances({});
			refreshAfterOpen = action === 'open' && result.check_status === 'stale';
		} catch (error) {
			if (isAbortError(error) && action === 'verify') {
				for (const candidateID of options.candidateIDs ?? []) {
					attemptedVisibleReleaseVerifications.delete(candidateID);
				}
			}
			if (request.isCurrent() && !isAbortError(error)) {
				requestFailed = true;
				setReleaseCandidatesError(releaseSourceErrorLabel(error, i18n));
			}
		} finally {
			if (request.isCurrent()) {
				releasePickerRequest = null;
				if (refreshAfterOpen) {
					void loadReleaseCandidates(target, 'refresh');
				} else {
					setReleaseCandidatesLoading(false);
					if (action === 'verify') setReleaseVerificationActiveIDs([]);
					if (queuedReleaseVerifications.size > 0 && releaseVerificationTimer === undefined) {
						setReleaseRequestPhase('verification_queued');
						releaseVerificationTimer = setTimeout(flushVisibleReleaseVerifications, 0);
					} else if (requestFailed) {
						setReleaseRequestPhase('idle');
					} else {
						finishReleaseRequestFeedback();
					}
				}
			}
		}
	};

	const openTemplateReleasePicker = (templateID: string) => {
		const template = templateByID(templateID);
		if (!template) return;
		const authTokenParameter = template.spec?.host?.npm?.auth_token_parameter;
		const target: ManagedReleasePickerTarget = { kind: 'template', id: templateID, name: managedTemplateLocalizedIdentity(template, i18n).name, authTokenParameter };
		queuedReleaseVerifications.clear();
		attemptedVisibleReleaseVerifications.clear();
		setReleaseVerificationQueuedIDs([]);
		setReleaseVerificationActiveIDs([]);
		setReleasePickerTarget(target);
		setReleaseSecretParameters({});
		if (!authTokenParameter) void loadReleaseCandidates(target, 'open');
	};

	const openServiceReleasePicker = (service: ManagedService) => {
		const target: ManagedReleasePickerTarget = { kind: 'service', id: service.service_id, name: managedServiceLocalizedIdentity(service, i18n).name, service };
		queuedReleaseVerifications.clear();
		attemptedVisibleReleaseVerifications.clear();
		setReleaseVerificationQueuedIDs([]);
		setReleaseVerificationActiveIDs([]);
		setReleasePickerTarget(target);
		setReleaseSecretParameters({});
		void loadReleaseCandidates(target, 'open');
	};

	const canReviewManagedUpdate = createMemo(() => {
		const target = releasePickerTarget();
		if (target?.kind !== 'service' || !canManageManagedService()) return false;
		const candidate = selectedReleaseCandidate();
		if (selectedReleaseID() && (!candidate || !candidate.selectable)) return false;
		return Boolean(candidate && !candidate.is_current && candidate.relation !== 'same');
	});
	const releaseSelectionActionLabel = (readyKey: EnvAppTranslationKey) => {
		const candidate = selectedReleaseCandidate();
		if (candidate?.verification_status === 'pending') return i18n.t('webServices.managed.releaseSelectionPending');
		if (candidate?.verification_status === 'unavailable') return i18n.t('webServices.managed.releaseSelectionUnavailable');
		return i18n.t(readyKey);
	};

	const createManagedUpdatePlan = async () => {
		const target = releasePickerTarget();
		if (target?.kind !== 'service' || !canReviewManagedUpdate() || managedUpdatePlanLoading()) return;
		const request = beginReleasePickerRequest(target);
		setManagedUpdatePlanLoading(true);
		setManagedUpdatePlan(null);
		setManagedUpdatePlanError('');
		setUpdateNoticeAcceptances({});
		try {
			const candidateID = selectedReleaseID();
			const plan = await fetchLocalApiJSON<ManagedUpdatePlan>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(target.id)}/update-plans`, {
				method: 'POST',
				signal: request.controller.signal,
				body: JSON.stringify({ target_candidate_id: candidateID }),
			});
			if (request.isCurrent()) setManagedUpdatePlan(plan);
		} catch (error) {
			if (request.isCurrent() && !isAbortError(error)) setManagedUpdatePlanError(error instanceof Error ? error.message : String(error));
		} finally {
			if (request.isCurrent()) {
				setManagedUpdatePlanLoading(false);
				releasePickerRequest = null;
			}
		}
	};

	const submitManagedUpdatePlan = () => {
		const target = releasePickerTarget();
		const plan = managedUpdatePlan();
		if (target?.kind !== 'service' || !plan) return;
		if (!requiredNoticesAccepted(plan.notices, updateNoticeAcceptances())) return;
		if (plan.requires_stopped && (target.service?.desired_state !== 'stopped' || target.service?.observed_state !== 'stopped')) return;
		const notices = acceptedNoticeRevisions(plan.notices, updateNoticeAcceptances());
		const updatePlanID = plan.update_plan_id;
		const serviceID = target.id;
		closeReleasePicker();
		void managedAction(serviceID, 'update', notices, updatePlanID);
	};

  const openTemplateCatalog = () => {
    setTemplateDrawerView('catalog');
    setSelectedTemplateID(null);
    setTemplateDraft(null);
    setTemplateValidationVisible(false);
    setInstallNoticeAcceptances({});
    setTemplateDrawerOpen(true);
  };

	const beginTemplateInstall = (template: ManagedCatalogTemplate, preserveRelease = false) => {
    if (!template.available || installedServiceForTemplate(template)) return;
		if (!preserveRelease) {
			setSelectedTemplateRelease(null);
			setTemplateRecommendationUnavailable(false);
		}
    setSelectedTemplateID(template.template_id);
		setInstallReview(null);
		setInstallParameters({});
    setWorkspacePath(template.default_workspace_path);
    setManagedAccessMode(template.default_access_mode || 'unified_proxy');
    setInstallNoticeAcceptances({});
    setTemplateDrawerView('install');
  };

	const confirmReleaseSelection = () => {
		const target = releasePickerTarget();
		const candidate = selectedReleaseCandidate();
		if (target?.kind !== 'template' || !candidate || !candidate.selectable) return;
		const template = templateByID(target.id);
		if (!template) return;
		setSelectedTemplateRelease({ candidate, parameters: releaseSecretParameters() });
		setTemplateRecommendationUnavailable(false);
		closeReleasePicker();
		beginTemplateInstall(template, true);
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

  const loadManagedLogs = async (serviceID: string) => {
    try { const result = await fetchLocalApiJSON<{ lines: string[] }>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(serviceID)}/logs`, { method: 'GET' }); setManagedLogIsHost(managedState().find((service) => service.service_id === serviceID)?.deployment === 'host'); setManagedLogs(result.lines ?? []); }
    catch (error) { notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), error instanceof Error ? error.message : String(error)); }
  };

  // Filtered and sorted services
  const unmanagedForwards = createMemo(() => {
    const managedForwardIDs = new Set(managedState().map((service) => service.forward_id));
    return (forwards()?.items ?? []).filter((forward) => !managedForwardIDs.has(forward.forward_id));
  });

  const filteredForwards = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const list = archiveView() === 'active' ? unmanagedForwards() : [];

    // Filter by search query
    const filtered = query
      ? list.filter((f) => {
          const hay = `${f.name ?? ''}\n${f.description ?? ''}\n${forwardDefaultURL(f)}\n${f.forward_id ?? ''}`.toLowerCase();
          return hay.includes(query);
        })
      : list;

    return [...filtered].sort((a, b) => a.created_at_unix_ms - b.created_at_unix_ms || a.forward_id.localeCompare(b.forward_id));
  });

  const filteredManagedServices = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    return managedState().filter((service) => (service.management_state ?? 'active') === archiveView()).filter((service) => !query || `${service.name}\n${service.description ?? ''}\n${service.workspace_path}\n${service.template_id}`.toLowerCase().includes(query));
  });
  const managedServicesByID = createMemo(() => new Map(managedState().map((service) => [service.service_id, service])));
  const filteredManagedServiceIDs = createMemo(() => filteredManagedServices().map((service) => service.service_id));
  const managedServiceForID = (serviceID: string) => managedServicesByID().get(serviceID) ?? null;

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

  const [openRequests, setOpenRequests] = createSignal<Record<string, string>>({});
  const [openErrors, setOpenErrors] = createSignal<Record<string, string>>({});
  const openBusy = (id: string) => Object.prototype.hasOwnProperty.call(openRequests(), id);
  const openStatus = (id: string) => openRequests()[id] ?? '';
  const addressOpening = () => openBusy('new-session');

  // Create dialog state
  const [createOpen, setCreateOpen] = createSignal(false);
  const [createLoading, setCreateLoading] = createSignal(false);

  // Delete dialog state
  const [deleteID, setDeleteID] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);

  createEffect(() => { if (permissionReady() && canRead()) void loadManaged(); });
  onCleanup(() => {
    managedOperations.dispose();
    managedOperationPresentation.dispose();
  });

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
    setStatus: (status: string) => void,
  ) => {
    const accessMode = f.access_mode || 'unified_proxy';
    if (accessMode === 'desktop_loopback' && !useDesktopWindow) {
      throw new Error(i18n.t('webServices.errors.desktopLoopbackRequiresDesktop'));
    }
    const fid = String(f.forward_id).trim();
    setStatus(i18n.t('webServices.status.resolvingRoute'));
    const localRuntime = await getLocalRuntime().catch(() => null);
    const desktopContext = readDesktopSessionContextSnapshot();
    const route = resolveWebServiceOpenRoute({
      forwardID: fid,
      localRuntime,
      desktopContext,
      appPath,
      desktopWindowAvailable: useDesktopWindow,
    });
    await openWebServiceRoute(route, fid, f.target_url, accessMode, appPath, useDesktopWindow, setStatus, {
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
    if (openBusy(transactionID)) return;
    const setStatus = (status: string) => setOpenRequests((current) => ({ ...current, [transactionID]: status }));
    const finish = () => setOpenRequests((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== transactionID)));
    setStatus(initialStatus);
    setOpenErrors((current) => ({ ...current, [transactionID]: '' }));
    const useDesktopWindow = desktopShellWebServiceWindowOpenAvailable();
    const win = useDesktopWindow ? null : window.open('about:blank', popupName);
    if (!useDesktopWindow && !win) {
      finish();
      setOpenErrors((current) => ({ ...current, [transactionID]: i18n.t('webServices.errors.popupBlocked') }));
      notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), i18n.t('webServices.errors.popupBlocked'));
      return;
    }

    try {
      const target = await resolveTarget();
      await performOpen(target.forward, target.appPath, useDesktopWindow, win, setStatus);
    } catch (e) {
      try {
        win?.close();
      } catch {
        // ignore
      }
      const msg = e instanceof Error ? e.message : String(e);
      setOpenErrors((current) => ({ ...current, [transactionID]: msg }));
      notify.error(i18n.t('webServices.notifications.failedToOpenTitle'), msg);
    } finally {
      finish();
    }
  };

  // Open service handler
  const doOpen = async (f: PortForward, appPath = f.default_app_path || '/') => {
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
    if (addressOpening()) return;
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

  const doSaveRecentSession = async (session: ForwardSession, target: string, name: string, description: string, accessMode: WebServiceAccessMode) => {
    if (!session.ephemeral || forwardMetadataSaving()) return;
    setForwardMetadataSaving(true);
    try {
      const forward = await fetchLocalApiJSON<PortForward>(`/_redeven_proxy/api/forward-sessions/${encodeURIComponent(session.forward.forward_id)}/save`, {
        method: 'POST',
        body: JSON.stringify({ target, name, description, access_mode: accessMode }),
      });
      setRecentSession({ ...session, forward, app_path: forward.default_app_path || '/', ephemeral: false });
      setForwardMetadataTarget(null);
      bumpRefresh();
      notify.success(i18n.t('webServices.notifications.sessionSavedTitle'), i18n.t('webServices.notifications.sessionSavedMessage', { name }));
    } catch (error) {
      notify.error(i18n.t('webServices.notifications.failedToSaveTitle'), error instanceof Error ? error.message : String(error));
    } finally {
      setForwardMetadataSaving(false);
    }
  };

  const doUpdateForwardMetadata = async (forward: PortForward, target: string, name: string, description: string, accessMode: WebServiceAccessMode) => {
    if (forwardMetadataSaving()) return;
    setForwardMetadataSaving(true);
    try {
      await fetchLocalApiJSON<PortForward>(`/_redeven_proxy/api/forwards/${encodeURIComponent(forward.forward_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ target, name, description, access_mode: accessMode }),
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

  const submitForwardMetadata = (targetURL: string, name: string, description: string, accessMode: WebServiceAccessMode) => {
    const target = forwardMetadataTarget();
    if (!target) return;
    if (target.mode === 'save') void doSaveRecentSession(target.session, targetURL, name, description, accessMode);
    else void doUpdateForwardMetadata(target.forward, targetURL, name, description, accessMode);
  };

  // Find the service being deleted for the confirmation dialog
  const deleteTarget = createMemo(() => {
    const id = deleteID();
    if (!id) return null;
    return forwards()?.items.find((f) => f.forward_id === id) ?? null;
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
        targetURL: target.session.app_path === '/' ? forward.target_url : new URL(target.session.app_path, forward.target_url).toString(),
      } as const;
    }
    return {
      mode: target.mode,
      editorKey: target.forward.forward_id,
      initialName: target.forward.name,
      initialDescription: target.forward.description,
      initialAccessMode: target.forward.access_mode || 'unified_proxy',
      targetURL: forwardDefaultURL(target.forward),
    } as const;
  });

  return (
    <div ref={pageRoot} {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class={cn('web-services flex h-full min-h-0 flex-col overflow-hidden', redevenSurfaceRoleClass('main'))}>
      <header class="web-services-header shrink-0" data-testid="web-services-panel">
        <div class="web-services-header-inner">
          <div class="web-services-heading">
            <h1 class="text-base font-semibold tracking-tight">{i18n.t('webServices.title')}</h1>
            <p class="web-services-description">{i18n.t('webServices.description')}</p>
          </div>
          <div class="web-services-header-actions">
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
              disabled={permissionReady() && !canExecute()}
              aria-label={i18n.t('webServices.actions.addService')}
              title={i18n.t('webServices.actions.addService')}
            >
              <Plus class="mr-1.5 h-3.5 w-3.5" />
              <span>{i18n.t('webServices.actions.addService')}</span>
            </Button>
          </div>
        </div>
      </header>

      <main {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="web-services-main min-h-0 flex-1 overflow-auto">
        <div class="web-services-content">
          <section aria-label={i18n.t('webServices.address.label')}>
            <form
              class="w-full"
              onSubmit={(event) => {
                event.preventDefault();
                void doOpenAddress();
              }}
              data-testid="web-service-address-form"
            >
              <div class="web-services-address">
                <div class="relative min-w-0 flex-1" data-testid="web-service-address-input-shell">
                  <Globe class="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    ref={(element) => { addressInput = element; }}
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
                      'h-10 w-full pl-10 pr-12 font-mono text-sm',
                      addressValidationVisible() && 'border-warning/45',
                    )}
                    autofocus
                    disabled={!canExecute() || addressOpening()}
                    data-testid="web-service-address-input"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    class="web-service-address-submit absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-foreground/80 transition-colors hover:text-foreground focus-visible:text-foreground"
                    disabled={!canExecute() || addressOpening()}
                    aria-busy={addressOpening() || undefined}
                    aria-label={addressOpening() ? openStatus('new-session') : i18n.t('webServices.actions.openAddress')}
                    title={i18n.t('webServices.actions.openAddress')}
                    data-testid="web-service-address-open"
                  >
                    <Show when={addressOpening()} fallback={<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>}>
                      <InlineButtonSnakeLoading />
                    </Show>
                  </Button>
                </div>
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

              <Show when={openErrors()['new-session']}><p class="mt-2 text-xs text-warning" role="alert">{openErrors()['new-session']}</p></Show>
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
            <Show when={!initialForwardsLoading() || managedState().length > 0}>
              <div class="web-services-toolbar">
                <div class="web-services-toolbar-heading">
                  <Show when={archiveView() !== 'active'}><Button variant="ghost" size="sm" class="h-8 w-8 px-0" onClick={() => setArchiveView('active')} aria-label={i18n.t('webServices.collection.back')}><ArrowLeft class="h-4 w-4" /></Button></Show>
                  <h2 id="web-services-collection-title" tabindex="-1">{archiveView() === 'active' ? i18n.t('webServices.collection.title') : i18n.t(`webServices.management.archive.${archiveView()}` as EnvAppTranslationKey)}</h2>
                  <span class="text-xs tabular-nums text-muted-foreground">{filteredForwards().length + filteredManagedServices().length}</span>
                </div>
                <div class="web-services-toolbar-actions" data-testid="web-services-toolbar-actions">
                  <div class="web-services-search" data-testid="web-services-search">
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
                  <Dropdown align="end" triggerAriaLabel={i18n.t('webServices.collection.archives')}
                    items={(['detached', 'uninstalled'] as const).map((state) => ({ id: state, label: i18n.t('webServices.collection.archiveCount', { name: i18n.t(`webServices.management.archive.${state}`), count: managedState().filter((service) => service.management_state === state).length }) }))}
                    onSelect={(id) => setArchiveView(id)}
                    triggerClass="web-services-menu-trigger" trigger={<span>{i18n.t('webServices.collection.archives')}<ChevronDown class="ml-1.5 h-3.5 w-3.5" aria-hidden="true" /></span>} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { bumpRefresh(); void loadManaged(true); }}
                    disabled={forwards.loading || managedLoading()}
                    aria-label={i18n.t('webServices.actions.refresh')}
                    aria-busy={forwardsRefreshing() || managedLoading() ? 'true' : undefined}
                    title={i18n.t('webServices.actions.refresh')}
                    class="h-9 w-9 shrink-0 px-0"
                    data-testid="web-services-refresh"
                  >
                    <RefreshIcon class={cn('h-4 w-4', (forwardsRefreshing() || managedLoading()) && 'animate-spin motion-reduce:animate-none')} />
                  </Button>
                </div>
              </div>
            </Show>

            <div
              class="relative"
              style={{ 'min-height': '200px' }}
              aria-busy={forwardsRefreshing() || managedLoading() ? 'true' : undefined}
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

              <Show when={forwardsCheckFailed() || managedLoadError()}><div class="web-services-refresh-error" role="status"><AlertTriangle class="h-4 w-4 shrink-0" aria-hidden="true" /><p>{i18n.t(forwardsRenderable() || managedState().length ? 'webServices.collection.refreshFailed' : 'webServices.errors.loadFailedPrefix')}</p></div></Show>

              <Show when={forwardsRenderable() || managedState().length > 0}>
                <Show when={unmanagedForwards().length > 0 || managedState().length > 0} fallback={<EmptyState onCreateClick={() => setCreateOpen(true)} disabled={permissionReady() && !canExecute()} />}>
                  <Show when={filteredForwards().length > 0 || filteredManagedServices().length > 0} fallback={
                    <div class="flex flex-col items-center justify-center px-4 py-12">
                      <p class="text-sm text-muted-foreground">{searchQuery() ? i18n.t('webServices.search.noMatches', { query: searchQuery() }) : i18n.t('webServices.collection.archiveEmpty')}</p>
                      <Show when={searchQuery()}><Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="mt-2">{i18n.t('webServices.search.clear')}</Button></Show>
                    </div>
                  }>
                    <div class={cn('web-service-list', redevenSurfaceRoleClass('panel'))} data-testid="unified-web-services-list">
                      <For each={filteredManagedServiceIDs()}>{(serviceID) => (
                        <Show when={managedServiceForID(serviceID)}>{(service) => (
                          <ManagedServiceRow
                            service={service()}
                            selected={managementTarget()?.service.service_id === serviceID}
                            operation={managedPresentedOperation(serviceID)}
                            operationPhase={managedOperationPresentation.phaseForService(serviceID)}
                            operationExpanded={Boolean(expandedManagedOperations()[managedPresentedOperation(serviceID)?.operation_id ?? ''])}
                            busy={openBusy(`managed:${serviceID}`)}
                            busyText={openStatus(`managed:${serviceID}`)}
                            canOpen={canExecute() && (service().access_mode !== 'desktop_loopback' || desktopShellWebServiceWindowOpenAvailable())}
                            openUnavailableReason={openErrors()[`managed:${serviceID}`] || (service().access_mode === 'desktop_loopback' && !desktopShellWebServiceWindowOpenAvailable()
                              ? i18n.t('webServices.errors.desktopLoopbackRequiresDesktop')
                              : undefined)}
                            canManage={canManageManagedService()}
                            onOpen={() => void openManaged(service())}
                            onRestoreManagement={() => void reviewManagement(service())}
                            onOpenResource={openManagedContainerResource}
                            onAction={(action) => void managedAction(serviceID, action)}
                            onOperationExpandedChange={setManagedOperationExpanded}
                            onCancelOperation={() => void cancelManagedOperation(managedRowOperation(serviceID))}
                            onDiagnosticCopyFailure={(message) => notify.error(i18n.t('webServices.managed.failureDiagnosticCopyFailedTitle'), message)}
                            onSettings={() => setManagedSettingsService(service())}
                            onVersions={() => openServiceReleasePicker(service())}
                            onLogs={() => void loadManagedLogs(serviceID)}
                            onUninstall={() => setManagementTarget({ service: service(), action: 'uninstall' })}
                            onInspect={() => setManagementTarget({ service: service(), action: service().status === 'uninstall_pending' || service().management_state === 'uninstalled' ? 'uninstall' : 'recover' })}
                          />
                        )}</Show>
                      )}</For>
                      <For each={filteredForwards()}>{(forward) => (
                        <PortForwardRow
                          forward={forward}
                          busy={openBusy(forward.forward_id)}
                          busyText={openStatus(forward.forward_id)}
                          canOpen={forward.access_mode !== 'desktop_loopback' || desktopShellWebServiceWindowOpenAvailable()}
                          openUnavailableReason={openErrors()[forward.forward_id] || (forward.access_mode === 'desktop_loopback' && !desktopShellWebServiceWindowOpenAvailable()
                            ? i18n.t('webServices.errors.desktopLoopbackRequiresDesktop')
                            : undefined)}
                          onOpen={() => void doOpen(forward)}
                          onEdit={() => setForwardMetadataTarget({ mode: 'edit', forward })}
                          onDelete={() => setDeleteID(forward.forward_id)}
                        />
                      )}</For>
                    </div>
                  </Show>
                </Show>
              </Show>
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

      <ManagedServiceManagementDrawer
        service={managementTarget() ? managedServicesByID().get(managementTarget()!.service.service_id) ?? managementTarget()!.service : null}
        initialAction={managementTarget()?.action ?? 'uninstall'}
		operation={(() => {const operation=managementTarget() ? managedRowOperation(managementTarget()!.service.service_id) : null;return operation && managedOperationActive(operation) ? {label:managedStageLabel(operation.stage,i18n),current:operation.progress_current ?? 0,total:operation.progress_total ?? 7,cancellable:!operation.cancel_requested}:null;})()}
		onCancelOperation={() => void cancelManagedOperation(managementTarget() ? managedRowOperation(managementTarget()!.service.service_id) : null)}
        administrator={Boolean(ctx.env()?.permissions?.can_admin || ctx.env()?.permissions?.is_owner)}
        onClose={closeManagement}
		onService={(id) => {setManagementTarget(null);setArchiveView('active');const service=managedServiceForID(id);if(service)setSearchQuery(service.name);}}
        onResource={(identity) => openManagedContainerResource({ kind: 'container', engine: 'docker', view: 'containers', identity })}
        onSettings={() => { const target = managementTarget(); if (target) { setManagementTarget(null); setManagedSettingsService(target.service); } }}
        canLegacyRestore={managementTarget()?.service.deployment === 'host' && Boolean(managementTarget()?.service.actions?.restore_management?.available)}
        canReinstall={Boolean(managementTarget() && templateByID(managementTarget()!.service.template_id)?.available)}
        onReinstall={() => { const target = managementTarget(); if (!target) return; const template = templateByID(target.service.template_id); if (!template) return; setManagementTarget(null); beginTemplateInstall(template); setTemplateDrawerOpen(true); }}
        onLegacyRestore={() => { const target = managementTarget(); if (target) void reviewManagement(target.service); }}
		ownershipReview={<Show when={managementReview()?.service_id === managementTarget()?.service.service_id && managementReview()}>{(review) => <div class="space-y-3 rounded-lg border p-3"><p class="text-sm">{i18n.t('webServices.managed.restoreManagementHelp')}</p><p class="break-all font-mono text-xs">{i18n.t('webServices.managed.processFacts', { pid: review().pid, group: review().process_group, executable: review().executable, user: review().user_id, birth: review().birth })}</p><Button size="sm" onClick={() => void restoreManagement()} disabled={managementRestoreBusy()}>{i18n.t('webServices.managed.confirmProcess')}</Button></div>}</Show>}
        onExecute={async (request: ManagementRequest & { plan_digest: string }) => {
          const target = managementTarget(); if (!target) return;
          const result = await fetchLocalApiJSON<ManagedOperation>(`/_redeven_proxy/api/managed-web-services/${encodeURIComponent(target.service.service_id)}/operations`, { method: 'POST', body: JSON.stringify({ ...request, request_id: managedRequestID() }) });
          try {
            const completed = await managedOperations.track(result);
            await loadManaged(false); bumpRefresh();
            if (completed.state !== 'succeeded') throw new LocalApiError({ message: completed.error_message ?? '', code: completed.error_code ?? 'OPERATION_FAILED', status: 409 });
            closeManagement();
          } finally {
            managedOperations.clear(result.operation_id);
          }
        }}
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
        onEditTemplate={managedSettingsService() && templateByID(managedSettingsService()!.template_id)?.editable ? () => {
          const template=templateByID(managedSettingsService()!.template_id);
          if (!template) return;
          setManagedSettingsService(null);beginTemplateEdit(template);setTemplateDrawerOpen(true);
        } : undefined}
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
            <Button size="sm" variant="ghost" onClick={() => { setTemplateDrawerView('catalog'); setSelectedTemplateID(null); setTemplateDraft(null); setTemplateValidationVisible(false); setInstallNoticeAcceptances({}); setTemplateRecommendationUnavailable(false); }} disabled={templateSaving()}>{i18n.t('webServices.managed.backToTemplates')}</Button>
            <div class="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={closeTemplateDrawer} disabled={templateSaving()}>{templateDrawerView() === 'install' ? i18n.t('common.actions.close') : i18n.t('webServices.actions.cancel')}</Button>
              <Show when={templateDrawerView() === 'install'}>
              <Button size="sm" variant="default" onClick={() => void installManaged()} disabled={managedInstallSubmitting() || !canManageManagedService() || !workspacePath().trim() || !selectedTemplate()?.available || templateRecommendationUnavailable() || !requiredNoticesAccepted(selectedTemplate()?.notices, installNoticeAcceptances())}>{managedInstallSubmitting() ? i18n.t('webServices.managed.operationStarting') : installReview() ? i18n.t('webServices.managed.installStart') : i18n.t('webServices.management.reviewInstall')}</Button>
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
              onImport={() => {setGitImportTemplate(undefined);setGitImportOpen(true);}}
              onCheckSource={(id) => {setGitImportTemplate(templateByID(id));setGitImportOpen(true);}}
              onDeploy={(templateID) => { const template = templateByID(templateID); if (template) beginTemplateInstall(template); }}
              onOpen={openInstalledTemplate}
			  onVersions={openTemplateReleasePicker}
              onDuplicate={(templateID) => { const template = templateByID(templateID); if (template) beginTemplateDuplicate(template); }}
              onEdit={(templateID) => { const template = templateByID(templateID); if (template) beginTemplateEdit(template); }}
              onDelete={(templateID) => { const template = templateByID(templateID); if (template) setTemplateDelete(template); }}
            />
          </Show>

          <Show when={templateDrawerView() === 'install' && selectedTemplate()} keyed>{(template) => (
            <div class="space-y-5">
				<Show when={installReview()}><p role="status" class="rounded-md border p-3 text-sm">{i18n.t('webServices.management.installReviewed')}</p></Show>
				<For each={template.effective_spec?.parameters ?? template.spec?.parameters ?? []}>{(parameter) => <div class="space-y-1"><label class="block text-xs font-medium" for={`install-parameter-${parameter.name}`}>{parameter.label || parameter.name}{parameter.required ? ' *' : ''}</label><Input id={`install-parameter-${parameter.name}`} type={parameter.type==='secret' ? 'password' : 'text'} autocomplete="off" required={parameter.required} value={installParameters()[parameter.name] ?? selectedTemplateRelease()?.parameters[parameter.name] ?? parameter.default ?? ''} onInput={(event) => setInstallParameters((current) => ({...current,[parameter.name]:event.currentTarget.value}))} /><Show when={parameter.description}><p class="text-xs text-muted-foreground">{parameter.description}</p></Show></div>}</For>
              <Show when={selectedTemplatePresentation()} keyed>{(presentation) => (
                <div class="service-template-install-identity rounded-xl border p-4">
                  <ServiceTemplateIdentity template={presentation} />
                </div>
              )}</Show>
			  <section class="service-template-install-section border-t pt-4">
				<div class="flex items-start justify-between gap-3">
					<div><h3 class="text-xs font-semibold uppercase tracking-[0.08em] text-foreground">{i18n.t('webServices.managed.versions')}</h3><p class="mt-1 text-xs text-muted-foreground">{i18n.t('webServices.managed.releaseSelectionDescription')}</p></div>
					<Button size="sm" variant="outline" onClick={() => openTemplateReleasePicker(template.template_id)} disabled={managedInstallSubmitting()}>{i18n.t('webServices.managed.chooseVersion')}</Button>
				</div>
				<div class="mt-3 rounded-lg border bg-muted/20 p-3"><div class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{template.source === 'builtin' ? i18n.t('webServices.managed.recommendedVersion') : i18n.t('webServices.managed.defaultVersion')}</div><div class="mt-1 font-mono text-sm text-foreground">{selectedTemplateRelease()?.candidate.version || selectedTemplateRelease()?.candidate.tag || (template.recommended_release ? releaseIdentityLabel(template.recommended_release) : '—')}</div></div>
				<Show when={templateRecommendationUnavailable()}><p class="mt-2 text-xs text-warning">{i18n.t('webServices.managed.releaseSourceError.RECOMMENDED_RELEASE_UNAVAILABLE')}</p></Show>
				<Show when={installReleaseRiskHints().length > 0}><div class="mt-3"><ManagedReleaseRiskHints riskIDs={installReleaseRiskHints()} /></div></Show>
			  </section>
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
                        class={`mt-1 font-mono text-xs text-muted-foreground ${installReview() ? "break-all" : "truncate"}`}
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
                  <div>
                    <div>{workspaceUsesRecommendedPath() ? i18n.t('webServices.managed.workspaceSafeDefaultDescription') : i18n.t('webServices.managed.workspaceCustomDescription')}</div>
                    <Show when={workspaceUsesRecommendedPath()}><div>{i18n.t('webServices.managed.workspaceCreatedOnDeploy')}</div></Show>
                  </div>
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
                  <div><dt class="text-muted-foreground">{template.source === 'builtin' ? i18n.t('webServices.managed.recommendedVersion') : i18n.t('webServices.managed.defaultVersion')}</dt><dd class="mt-1 font-mono text-foreground">{template.recommended_release ? releaseIdentityLabel(template.recommended_release) : i18n.t('webServices.managed.customVersion')}</dd></div>
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
                  notices={localizedManagedNotices(template.notices, template.localizations, i18n.locale(), template.default_locale)}
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
                  <div class="mt-3 grid gap-x-4 gap-y-3">
                    <div>
                      <TemplateEditorLabel for="template-editor-name" label={i18n.t('webServices.managed.templateName')} required />
                      <Input id="template-editor-name" data-template-field="name" value={draft().name} maxlength={80} placeholder={i18n.t('webServices.managed.placeholders.templateName')} aria-invalid={invalid('name') ? 'true' : undefined} aria-describedby="template-editor-name-help" onInput={(event) => update({ name: event.currentTarget.value })} />
                      <TemplateEditorGuidance id="template-editor-name-help" help={i18n.t('webServices.managed.help.templateName')} error={error('name')} visible={templateValidationVisible()} />
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
                    <details class="service-template-editor__advanced mt-3" open={Boolean(draft().afterStartScript || draft().openScript || draft().outputMode === 'private_file')}>
                      <summary class="cursor-pointer text-xs font-medium">{i18n.t('webServices.managed.openingHooks')}</summary>
                      <p class="mt-2 text-xs text-muted-foreground">{i18n.t('webServices.managed.openingHooksHelp')}</p>
                      <div class="mt-3 space-y-3">
                        <div><TemplateEditorLabel for="template-editor-output-mode" label={i18n.t('webServices.managed.outputMode')} /><select id="template-editor-output-mode" class="w-full rounded border bg-background p-2 text-xs" value={draft().outputMode} onChange={(event) => update({ outputMode: event.currentTarget.value as 'discard' | 'private_file' })}><option value="discard">{i18n.t('webServices.managed.outputDiscard')}</option><option value="private_file">{i18n.t('webServices.managed.outputPrivateFile')}</option></select></div>
                        <div><TemplateEditorLabel for="template-editor-after-start" label={i18n.t('webServices.managed.afterStartScript')} /><Textarea id="template-editor-after-start" value={draft().afterStartScript} rows={5} class="font-mono text-xs" onInput={(event) => update({ afterStartScript: event.currentTarget.value })} /></div>
                        <div><TemplateEditorLabel for="template-editor-open-script" label={i18n.t('webServices.managed.openScript')} /><Textarea id="template-editor-open-script" value={draft().openScript} rows={3} class="font-mono text-xs" onInput={(event) => update({ openScript: event.currentTarget.value })} /></div>
                      </div>
                    </details>
                    <details class="service-template-editor__advanced mt-3" open={Boolean(draft().npmPackageName)}>
                      <summary class="cursor-pointer py-2 text-xs font-medium text-muted-foreground">{i18n.t('webServices.managed.npmPackageSettings')}</summary>
                      <div class="grid gap-x-4 gap-y-3 pb-1 pt-2 sm:grid-cols-2">
                        <div>
                          <TemplateEditorLabel for="template-editor-npm-package" label={i18n.t('webServices.managed.npmPackageName')} />
                          <Input id="template-editor-npm-package" data-template-field="npmPackageName" value={draft().npmPackageName} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.npmPackageName')} aria-invalid={invalid('npmPackageName') ? 'true' : undefined} aria-describedby="template-editor-npm-package-help" onInput={(event) => update({ npmPackageName: event.currentTarget.value })} />
                          <TemplateEditorGuidance id="template-editor-npm-package-help" help={i18n.t('webServices.managed.help.npmPackage')} error={error('npmPackageName')} visible={templateValidationVisible()} />
                        </div>
                        <div>
                          <TemplateEditorLabel for="template-editor-npm-version" label={i18n.t('webServices.managed.npmPackageVersion')} />
                          <Input id="template-editor-npm-version" data-template-field="npmPackageVersion" value={draft().npmPackageVersion} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.npmPackageVersion')} aria-invalid={invalid('npmPackageVersion') ? 'true' : undefined} aria-describedby="template-editor-npm-version-help" onInput={(event) => update({ npmPackageVersion: event.currentTarget.value })} />
                          <TemplateEditorGuidance id="template-editor-npm-version-help" help={i18n.t('webServices.managed.help.npmVersion')} error={error('npmPackageVersion')} visible={templateValidationVisible()} />
                        </div>
                        <div>
                          <TemplateEditorLabel for="template-editor-npm-registry" label={i18n.t('webServices.managed.npmRegistryURL')} />
                          <Input id="template-editor-npm-registry" data-template-field="npmRegistryURL" value={draft().npmRegistryURL} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.npmRegistryURL')} aria-invalid={invalid('npmRegistryURL') ? 'true' : undefined} aria-describedby="template-editor-npm-registry-help" onInput={(event) => update({ npmRegistryURL: event.currentTarget.value })} />
                          <TemplateEditorGuidance id="template-editor-npm-registry-help" help={i18n.t('webServices.managed.help.npmRegistry')} error={error('npmRegistryURL')} visible={templateValidationVisible()} />
                        </div>
                        <div>
                          <TemplateEditorLabel for="template-editor-npm-executable" label={i18n.t('webServices.managed.npmExecutable')} />
                          <Input id="template-editor-npm-executable" data-template-field="npmExecutable" value={draft().npmExecutable} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.npmExecutable')} aria-invalid={invalid('npmExecutable') ? 'true' : undefined} aria-describedby="template-editor-npm-executable-help" onInput={(event) => update({ npmExecutable: event.currentTarget.value })} />
                          <TemplateEditorGuidance id="template-editor-npm-executable-help" help={i18n.t('webServices.managed.help.npmExecutable')} error={error('npmExecutable')} visible={templateValidationVisible()} />
                        </div>
                        <div class="sm:col-span-2">
                          <TemplateEditorLabel for="template-editor-npm-token-parameter" label={i18n.t('webServices.managed.npmAuthTokenParameter')} />
                          <Input id="template-editor-npm-token-parameter" data-template-field="npmAuthTokenParameter" value={draft().npmAuthTokenParameter} class="font-mono" placeholder={i18n.t('webServices.managed.placeholders.npmAuthTokenParameter')} aria-invalid={invalid('npmAuthTokenParameter') ? 'true' : undefined} aria-describedby="template-editor-npm-token-parameter-help" onInput={(event) => update({ npmAuthTokenParameter: event.currentTarget.value })} />
                          <TemplateEditorGuidance id="template-editor-npm-token-parameter-help" help={i18n.t('webServices.managed.help.npmAuthTokenParameter')} error={error('npmAuthTokenParameter')} visible={templateValidationVisible()} />
                        </div>
                      </div>
                    </details>
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
                            label={i18n.t(draft().hostLifecyclePlan?.install.steps.some((step) => step.kind === 'prepare_verified_package' || step.kind === 'prepare_verified_node_runtime') ? 'webServices.managed.afterInstallHook' : 'webServices.managed.installScript')}
                          />
                          <Textarea id="template-editor-install-script" value={draft().installScript} rows={5} class="font-mono text-xs" placeholder={i18n.t('webServices.managed.placeholders.installScript')} aria-describedby="template-editor-install-script-help" onInput={(event) => update({ installScript: event.currentTarget.value })} />
                          <p id="template-editor-install-script-help" class="mt-1 text-[11px] leading-4 text-muted-foreground">
                            {i18n.t(draft().hostLifecyclePlan?.install.steps.some((step) => step.kind === 'prepare_verified_package' || step.kind === 'prepare_verified_node_runtime') ? 'webServices.managed.help.afterInstallHook' : 'webServices.managed.help.installScript')}
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
        open={templateDrawerOpen() && workspacePickerOpen()}
        onOpenChange={setWorkspacePickerOpen}
        {...workspacePicker}
        initialPath={workspacePickerInitialPath() || "/"}
        title={i18n.t('webServices.managed.selectWorkspace')}
        confirmText={i18n.t('common.actions.confirm')}
        cancelText={i18n.t('common.actions.cancel')}
        onSelect={setWorkspacePath}
      />

      <GitTemplateImport
        open={gitImportOpen()}
        environmentName={ctx.env()?.name || ctx.env_id()}
        template={gitImportTemplate()}
        onClose={() => setGitImportOpen(false)}
        onImported={() => {
          void loadManaged();
          notify.success(i18n.t('webServices.managed.templateSaved'), i18n.t('webServices.managed.templateSavedMessage'));
        }}
        serviceName={(id) => managedState().find((item) => item.service_id === id)?.name || id}
      />
      <Dialog open={templateDuplicate() !== null} onOpenChange={(open) => { if (!open && !templateSaving()) setTemplateDuplicate(null); }} title={i18n.t('webServices.managed.duplicateTemplate')} footer={<div class="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setTemplateDuplicate(null)} disabled={templateSaving()}>{i18n.t('webServices.actions.cancel')}</Button><Button size="sm" variant="default" onClick={() => void duplicateTemplate()} disabled={templateSaving() || !templateDuplicateName().trim()}>{i18n.t('webServices.managed.duplicate')}</Button></div>}><div class="space-y-3"><p class="text-sm text-muted-foreground">{i18n.t('webServices.managed.duplicateNote')}</p><div><label class="mb-1 block text-xs font-medium">{i18n.t('webServices.managed.templateName')}</label><Input value={templateDuplicateName()} onInput={(event) => setTemplateDuplicateName(event.currentTarget.value)} autofocus /></div></div></Dialog>

      <ConfirmDialog open={templateDelete() !== null} onOpenChange={(open) => { if (!open) setTemplateDelete(null); }} title={i18n.t('webServices.managed.deleteTemplate')} confirmText={i18n.t('webServices.actions.delete')} variant="destructive" loading={templateSaving()} onConfirm={() => void deleteTemplate()}><p class="text-sm">{i18n.t('webServices.managed.deleteTemplateQuestion', { name: templateDelete()?.name ?? '' })}</p></ConfirmDialog>

      <Dialog open={managedLogs() !== null} onOpenChange={(open) => { if (!open) setManagedLogs(null); }} title={i18n.t('webServices.managed.logsTitle')} footer={<div class="flex justify-end"><Button size="sm" variant="outline" onClick={() => setManagedLogs(null)}>{i18n.t('webServices.actions.cancel')}</Button></div>}><Show when={managedLogIsHost()}><p class="mb-3 text-xs text-muted-foreground">{i18n.t('webServices.managed.logScope')}</p></Show><pre class="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 text-[11px] whitespace-pre-wrap">{(managedLogs() ?? []).join('\n') || i18n.t('webServices.managed.noLogs')}</pre></Dialog>

      <DialogPlacementProvider mode="global">
        <EnvAppDrawer
          open={releasePickerTarget() !== null}
          class="managed-service-version-drawer"
          bodyClass="h-full min-h-0"
          onOpenChange={(open) => { if (!open) closeReleasePicker(); }}
          title={i18n.t('webServices.managed.releaseTitle', { name: releasePickerTarget()?.name ?? '' })}
          footer={<div class="flex w-full flex-wrap items-center justify-between gap-2">
            <Show when={managedUpdatePlan()} fallback={<Button size="sm" variant="ghost" onClick={() => void loadReleaseCandidates(releasePickerTarget(), 'refresh')} disabled={releaseCandidatesLoading() || managedUpdatePlanLoading()}><Refresh class="mr-1.5 h-3.5 w-3.5" />{i18n.t('common.actions.refresh')}</Button>}>
            <Button size="sm" variant="ghost" onClick={returnToReleaseCandidates} disabled={managedUpdatePlanLoading()}><ArrowLeft class="mr-1.5 h-3.5 w-3.5" />{i18n.t('webServices.managed.backToReleaseList')}</Button>
          </Show>
          <div class="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={closeReleasePicker}>{i18n.t('webServices.actions.cancel')}</Button>
            <Show when={releasePickerTarget()?.kind === 'template'}>
              <Button size="sm" variant="default" onClick={confirmReleaseSelection} disabled={!canManageManagedService() || !selectedReleaseCandidate()?.selectable}>{releaseSelectionActionLabel('webServices.managed.deploySelectedRelease')}</Button>
            </Show>
            <Show when={releasePickerTarget()?.kind === 'service'}>
              <Show when={managedUpdatePlan()} fallback={<Button size="sm" variant="default" onClick={() => void createManagedUpdatePlan()} disabled={!canReviewManagedUpdate() || managedUpdatePlanLoading()}>{managedUpdatePlanLoading() ? i18n.t('webServices.managed.preparingUpdatePlan') : releaseSelectionActionLabel('webServices.managed.reviewUpdatePlan')}</Button>}>
                <Button size="sm" variant="default" onClick={submitManagedUpdatePlan} disabled={!canManageManagedService() || !managedUpdatePlanNoticesAccepted() || managedUpdatePlanRequiresStopped()}>{i18n.t('webServices.managed.update')}</Button>
              </Show>
            </Show>
          </div>
          </div>}
        >
          <div class="flex h-full min-h-0 flex-col overflow-hidden p-1" data-testid="managed-release-drawer-body" data-view={managedUpdatePlan() ? 'plan' : 'releases'}>
            <Show when={!managedUpdatePlan()}>
              <div class="flex h-full min-h-0 flex-col gap-3" data-testid="managed-release-browser">
              <Show when={releasePickerTarget()?.authTokenParameter}>{(parameterName) => <div class="shrink-0 rounded-lg border p-3"><label class="mb-1 block text-xs font-medium" for="managed-release-token">{i18n.t('webServices.managed.registryToken', { parameter: parameterName() })}</label><Input id="managed-release-token" type="password" autocomplete="off" value={releaseSecretParameters()[parameterName()] ?? ''} onInput={(event) => setReleaseSecretParameters((current) => ({ ...current, [parameterName()]: event.currentTarget.value }))} /><p class="mt-1 text-[11px] text-muted-foreground">{i18n.t('webServices.managed.registryTokenDescription')}</p><Show when={!releaseCandidates() && !releaseCandidatesLoading()}><p class="mt-2 text-[11px] text-foreground">{i18n.t('webServices.managed.releaseTokenRefreshPrompt')}</p></Show></div>}</Show>
              <div class="min-h-0 flex-1">
                <ManagedReleaseCandidates
                  result={releaseCandidates()}
                  loading={releaseCandidatesLoading()}
                  requestPhase={releaseRequestPhase()}
                  queuedVerificationCount={releaseVerificationQueuedIDs().length}
                  verificationCount={releaseVerificationActiveIDs().length}
				  queuedVerificationIDs={releaseVerificationQueuedIDs()}
				  checkingVerificationIDs={releaseVerificationActiveIDs()}
                  error={releaseCandidatesError()}
                  query={releaseQuery()}
                  filter={releaseFilter()}
                  selectedID={selectedReleaseID()}
				  onQueryChange={setReleaseQuery}
				  onFilterChange={setReleaseFilter}
				  onSelect={(candidateID) => { setSelectedReleaseID(candidateID); setManagedUpdatePlanError(''); setUpdateNoticeAcceptances({}); }}
				  onVerify={prioritizeReleaseVerification}
				  onVisible={scheduleVisibleReleaseVerification}
				  onLoadMore={() => {
					const result = releaseCandidates();
					if (!releaseCandidatesLoading() && result?.has_more && result.cursor_id) {
						void loadReleaseCandidates(releasePickerTarget(), 'continue', { cursorID: result.cursor_id });
					}
				  }}
				  showRiskHints={releasePickerTarget()?.kind === 'template'}
                  defaultKind={selectedReleaseDefaultKind()}
                />
              </div>
              <Show when={releasePickerTarget()?.kind === 'service' && !canReviewManagedUpdate() && !releaseCandidatesLoading() && !releaseCandidatesError()}><div class="shrink-0 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">{i18n.t('webServices.managed.updateNotRequired')}</div></Show>
              <Show when={managedUpdatePlanError()}><div class="shrink-0 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3 text-xs text-destructive">{managedUpdatePlanError()}</div></Show>
              </div>
            </Show>
            <Show when={managedUpdatePlan()} keyed>{(plan) => <section {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="h-full min-h-0 space-y-3 overflow-y-auto overscroll-contain rounded-lg border bg-muted/20 p-4 [scrollbar-gutter:stable]" data-testid="managed-update-plan">
            <div><h3 class="text-sm font-semibold text-foreground">{i18n.t('webServices.managed.updatePlanTitle')}</h3><p class="mt-1 text-xs text-muted-foreground">{i18n.t('webServices.managed.updatePlanDescription')}</p></div>
            <div class="grid gap-3 text-xs sm:grid-cols-2">
              <div><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.currentRelease')}</div><div class="mt-1 font-mono text-foreground">{releaseIdentityLabel(plan.current_release)}</div></div>
              <div><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.targetRelease')}</div><div class="mt-1 font-mono text-foreground">{releaseIdentityLabel(plan.target_release)}</div></div>
			  <div><div class="text-[10px] font-medium text-muted-foreground">{i18n.t('webServices.managed.updatePlanExpires')}</div><div class="mt-1 text-foreground">{i18n.formatDateTime(plan.expires_at_unix_ms, { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
            </div>
            <Show when={managedUpdatePlanRequiresStopped()}><div class="rounded-md border border-warning/30 bg-warning/[0.06] p-3 text-xs text-warning">{i18n.t('webServices.managed.downgradeRequiresStopped')}</div></Show>
            <Show when={(plan.notices?.length ?? 0) > 0}><ManagedTemplateNotices notices={localizedManagedNotices(plan.notices, releasePickerTarget()?.service?.localizations, i18n.locale(), releasePickerTarget()?.service?.default_locale)} accepted={updateNoticeAcceptances()} disabled={false} onAcceptedChange={(noticeID, accepted) => setUpdateNoticeAcceptances((current) => ({ ...current, [noticeID]: accepted }))} /></Show>
            <ManagedReleaseRiskHints riskIDs={plan.risk_ids ?? []} />
            </section>}</Show>
          </div>
        </EnvAppDrawer>
      </DialogPlacementProvider>

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
    </div>
  );
}
