import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { ExternalLink, Globe, Plus, RefreshIcon, Save, Search, Trash } from '@floegence/floe-webapp-core/icons';
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
  Input,
  Tag,
  type TagProps,
} from '@floegence/floe-webapp-core/ui';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';

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
import { trustedLauncherOriginFromSandboxLocation } from '../services/sandboxOrigins';
import { registerSandboxWindow } from '../services/sandboxWindowRegistry';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { Tooltip } from '../primitives/Tooltip';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { useI18n, type I18nHelpers } from '../i18n';
import { useEnvContext } from './EnvContext';
import { EnvCollectionLoadingSkeleton } from './EnvCollectionLoadingSkeleton';
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
  if (!compact(parsed.hostname)) return null;
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
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
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

/**
 * CreateForwardDialog - Dialog for registering a new runtime web service
 */
function CreateForwardDialog(props: {
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (target: string, name: string, description: string) => void;
}) {
  const [target, setTarget] = createSignal('');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [touched, setTouched] = createSignal(false);
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const i18n = useI18n();

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTarget('');
      setName('');
      setDescription('');
      setTouched(false);
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

  const showError = () => touched() && target().trim().length > 0 && !isSupportedWebServiceTarget(target());

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
            onBlur={() => setTouched(true)}
            placeholder={i18n.t('webServices.dialog.targetPlaceholder')}
            size="sm"
            class={cn('w-full font-mono', showError() && 'border-destructive focus:ring-destructive')}
          />
          <Show
            when={showError()}
            fallback={
              <p class="text-[11px] text-muted-foreground mt-1">
                {i18n.t('webServices.dialog.targetHelp')}
              </p>
            }
          >
            <p class="text-[11px] text-destructive mt-1">{i18n.t('webServices.dialog.targetError')}</p>
          </Show>
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
  appPath: string,
  useDesktopWindow: boolean,
  setStatus: (s: string) => void,
  copy: OpenWebServiceCopy,
  win?: Window | null,
): Promise<void> {
  let targetURL: string;
  if (route.kind === 'e2ee_tunnel') {
    const prepared = await preparePortForwardTunnel(forwardID, appPath, setStatus, copy);
    targetURL = prepared.url;
    if (win) registerSandboxWindow(win, { origin: prepared.origin, floe_app: FLOE_APP_PORT_FORWARD, code_space_id: forwardID, app_path: normalizeAppPath(appPath) });
  } else {
    await touchWebService(forwardID, setStatus, copy);
    setStatus(route.kind === 'browser_direct' ? copy.openingDirectly : copy.openingLocalProxy);
    targetURL = route.url;
  }

  if (useDesktopWindow) {
    setStatus(copy.opening);
    const response = await openWebServiceWindowInDesktopShell({ url: targetURL, forward_id: forwardID });
    if (!response?.ok) throw new Error(response?.message || copy.desktopWindowFailed);
    return;
  }
  if (!win) throw new Error(copy.popupBlocked);
  win.location.assign(targetURL);
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvPortForwardsPage() {
  const ctx = useEnvContext();
  const notify = useNotification();
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const i18n = useI18n();

  // Permission checks
  const permissionReady = () => ctx.env.state === 'ready';
  const canExecute = () => Boolean(ctx.env()?.permissions?.can_execute);

  // Search/filter state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [address, setAddress] = createSignal('');
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

  // Filtered and sorted services
  const filteredForwards = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const list = forwards() ?? [];

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

  // Busy state for individual operations
  const [busyID, setBusyID] = createSignal<string | null>(null);
  const [busyText, setBusyText] = createSignal<string>('');

  // Create dialog state
  const [createOpen, setCreateOpen] = createSignal(false);
  const [createLoading, setCreateLoading] = createSignal(false);

  // Delete dialog state
  const [deleteID, setDeleteID] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);

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
    await openWebServiceRoute(route, fid, appPath, useDesktopWindow, (s) => setBusyText(s), {
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
    if (!isSupportedWebServiceTarget(target) || busyID()) {
      notify.error(i18n.t('webServices.notifications.invalidAddressTitle'), i18n.t('webServices.notifications.invalidAddressMessage'));
      return;
    }
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
                onClick={bumpRefresh}
                disabled={!!busyID() || forwards.loading}
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
            <div class="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row">
              <div class="relative min-w-0 flex-1">
                <Globe class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={address()}
                  onInput={(event) => setAddress(event.currentTarget.value)}
                  placeholder={i18n.t('webServices.address.placeholder')}
                  aria-label={i18n.t('webServices.address.label')}
                  autocomplete="url"
                  spellcheck={false}
                  size="sm"
                  class="h-10 w-full pl-9 font-mono text-sm"
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

          {/* Search bar - only show when there are services */}
          <Show when={(forwards()?.length ?? 0) > 0}>
            <div class="flex items-center gap-2">
              <div class="relative w-full max-w-sm">
                <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  placeholder={i18n.t('webServices.search.placeholder')}
                  size="sm"
                  class="w-full pl-8"
                />
              </div>
              <Show when={searchQuery()}>
                <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="px-2">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </Button>
              </Show>
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

            <Show when={forwardsRenderable() && !forwards.error}>
              <Show
                when={(forwards()?.length ?? 0) > 0}
                fallback={<EmptyState onCreateClick={() => setCreateOpen(true)} disabled={permissionReady() && !canExecute()} />}
              >
                <Show
                  when={filteredForwards().length > 0}
                  fallback={
                    <div class="flex flex-col items-center justify-center py-12 px-4">
                      <p class="text-sm text-muted-foreground">{i18n.t('webServices.search.noMatches', { query: searchQuery() })}</p>
                      <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="mt-2">
                        {i18n.t('webServices.search.clear')}
                      </Button>
                    </div>
                  }
                >
                  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <For each={filteredForwards()}>
                      {(f) => (
                        <PortForwardCard
                          forward={f}
                          busy={busyID() === f.forward_id}
                          busyText={busyID() === f.forward_id ? busyText() : undefined}
                          onOpen={() => void doOpen(f)}
                          onDelete={() => setDeleteID(f.forward_id)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </PanelContent>
      </Panel>

      {/* Create dialog */}
      <CreateForwardDialog open={createOpen()} loading={createLoading()} onOpenChange={setCreateOpen} onCreate={doCreate} />

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
