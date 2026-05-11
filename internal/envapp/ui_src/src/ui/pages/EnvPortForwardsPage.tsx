import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { ExternalLink, Globe, Plus, RefreshIcon, Trash } from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { LoadingOverlay, SnakeLoader } from '@floegence/floe-webapp-core/loading';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  Input,
  Tag,
  type TagProps,
} from '@floegence/floe-webapp-core/ui';

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
import { fetchGatewayJSON } from '../services/gatewayApi';
import { trustedLauncherOriginFromSandboxLocation } from '../services/sandboxOrigins';
import { registerSandboxWindow } from '../services/sandboxWindowRegistry';
import { Tooltip } from '../primitives/Tooltip';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { useEnvContext } from './EnvContext';

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

export type WebServiceOpenRoute =
  | Readonly<{ kind: 'browser_direct'; url: string; label: 'Direct' }>
  | Readonly<{ kind: 'local_proxy'; url: string; label: 'Local proxy' }>
  | Readonly<{ kind: 'e2ee_tunnel'; forward_id: string; label: 'Secure tunnel' }>;

type BrowserLocationLike = Pick<Location, 'hostname' | 'href' | 'origin'>;

// ============================================================================
// Utility Functions
// ============================================================================

function fmtRelativeTime(ms: number): string {
  if (!ms) return 'Never';
  try {
    const now = Date.now();
    const diff = now - ms;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  } catch {
    return String(ms);
  }
}

function fmtTime(ms: number): string {
  if (!ms) return 'Never';
  try {
    return new Date(ms).toLocaleString();
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
  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!compact(parsed.hostname)) return null;
  if (parsed.pathname && parsed.pathname !== '/') return null;
  if (parsed.search || parsed.hash) return null;
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

function localWebServiceProxyURL(forwardID: string, locationLike: BrowserLocationLike): string {
  return new URL(`/pf/${encodeURIComponent(forwardID)}/`, locationLike.origin || locationLike.href).toString();
}

export function resolveWebServiceOpenRoute(args: Readonly<{
  forwardID: string;
  targetURL: string;
  localRuntime: LocalRuntimeInfo | null;
  desktopContext?: DesktopSessionContextSnapshot | null;
  browserLocation?: BrowserLocationLike;
}>): WebServiceOpenRoute {
  const forwardID = compact(args.forwardID);
  if (!args.localRuntime) {
    return { kind: 'e2ee_tunnel', forward_id: forwardID, label: 'Secure tunnel' };
  }

  const locationLike = args.browserLocation ?? window.location;
  const targetURL = parseSupportedWebServiceTarget(args.targetURL);
  if (
    targetURL
    && hasSameDeviceBrowserConfidence(args.desktopContext)
    && isLoopbackHostname(locationLike.hostname)
    && isLoopbackHostname(targetURL.hostname)
  ) {
    return { kind: 'browser_direct', url: targetURL.origin, label: 'Direct' };
  }

  return { kind: 'local_proxy', url: localWebServiceProxyURL(forwardID, locationLike), label: 'Local proxy' };
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
        return 'Healthy';
      case 'unreachable':
        return 'Unreachable';
      default:
        return 'Unknown';
    }
  };

  const tooltipContent = () => {
    const parts: string[] = [];
    if (status() === 'healthy' && latency()) {
      parts.push(`Latency: ${latency()}ms`);
    }
    if (lastError()) {
      parts.push(`Error: ${lastError()}`);
    }
    return parts.length > 0 ? parts.join('\n') : `Status: ${label()}`;
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
  return (
    <div class="flex flex-col items-center justify-center py-12 px-4">
      <div class="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
        <Globe class="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 class="text-sm font-medium text-foreground mb-1">No web services yet</h3>
      <p class="text-xs text-muted-foreground text-center max-w-xs mb-4">
        Register an HTTP service running on, or reachable from, the runtime host.
      </p>
      <Button size="sm" variant="default" onClick={props.onCreateClick} disabled={props.disabled}>
        Add Service
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

  return (
    <Card
      class={cn(
        'border transition-all duration-200',
        isHealthy()
          ? 'border-emerald-500/30 bg-emerald-500/[0.02] hover:border-emerald-500/50'
          : props.forward.health?.status === 'unreachable'
            ? 'border-destructive/30 bg-destructive/[0.02] hover:border-destructive/50'
            : redevenSurfaceRoleClass('panelInteractive')
      )}
    >
      <CardHeader class="pb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <CardTitle class="text-sm truncate">{props.forward.name || `Service ${props.forward.forward_id}`}</CardTitle>
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
          <div class="text-muted-foreground">Last opened</div>
          <Tooltip content={fmtTime(props.forward.last_opened_at_unix_ms)} placement="top">
            <div class="text-right cursor-default">{fmtRelativeTime(props.forward.last_opened_at_unix_ms)}</div>
          </Tooltip>

          <Show when={isHealthy() && props.forward.health?.latency_ms}>
            <div class="text-muted-foreground">Latency</div>
            <div class="text-right font-mono">{props.forward.health?.latency_ms}ms</div>
          </Show>

          <Show when={props.forward.health?.last_checked_at_unix_ms}>
            <div class="text-muted-foreground">Last check</div>
            <Tooltip content={fmtTime(props.forward.health?.last_checked_at_unix_ms ?? 0)} placement="top">
              <div class="text-right cursor-default">{fmtRelativeTime(props.forward.health?.last_checked_at_unix_ms ?? 0)}</div>
            </Tooltip>
          </Show>
        </div>
      </CardContent>

      <CardFooter class={cn('pt-2 flex items-center justify-between gap-2 border-t', redevenDividerRoleClass())}>
        <Tooltip content={props.busyText || 'Open service'} placement="top">
          <Button size="sm" variant="default" onClick={props.onOpen} disabled={props.busy} class="flex-1">
            <Show when={props.busy} fallback={<ExternalLink class="w-3.5 h-3.5 mr-1" />}>
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            Open
          </Button>
        </Tooltip>
        <Tooltip content="Delete service" placement="top">
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
      title="Add Web Service"
      footer={
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => handleOpenChange(false)} disabled={props.loading} class={outlineControlClass}>
            Cancel
          </Button>
          <Button size="sm" variant="default" onClick={handleCreate} disabled={props.loading || !isValid()}>
            <Show when={props.loading}>
              <InlineButtonSnakeLoading class="mr-1" />
            </Show>
            Add Service
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium mb-1">
            Target <span class="text-destructive">*</span>
          </label>
          <Input
            value={target()}
            onInput={(e) => setTarget(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            placeholder="localhost:3000"
            size="sm"
            class={cn('w-full font-mono', showError() && 'border-destructive focus:ring-destructive')}
          />
          <Show
            when={showError()}
            fallback={
              <p class="text-[11px] text-muted-foreground mt-1">
                Use host:port or an http(s):// URL. Paths, query strings, and fragments are not supported.
              </p>
            }
          >
            <p class="text-[11px] text-destructive mt-1">Enter a host:port or http(s):// URL without a path.</p>
          </Show>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Name</label>
          <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="My Service" size="sm" class="w-full" />
          <p class="text-[11px] text-muted-foreground mt-1">A display name to identify this service.</p>
        </div>
        <div>
          <label class="block text-xs font-medium mb-1">Description</label>
          <Input
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="Development server for my project"
            size="sm"
            class="w-full"
          />
          <p class="text-[11px] text-muted-foreground mt-1">Optional description for reference.</p>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// Open web service logic
// ============================================================================

async function touchWebService(forwardID: string, setStatus: (s: string) => void): Promise<void> {
  setStatus('Updating service...');
  await fetchGatewayJSON(`/_redeven_proxy/api/forwards/${encodeURIComponent(forwardID)}/touch`, { method: 'POST' });
}

async function openPortForwardTunnel(
  forwardID: string,
  setStatus: (s: string) => void,
  win: Window,
): Promise<void> {
  const envPublicID = getEnvPublicIDFromSession();
  if (!envPublicID) throw new Error('Missing env context. Please reopen from the control plane.');

  const origin = portForwardOrigin(forwardID);
  const bootURL = `${origin}/_redeven_boot/?env=${encodeURIComponent(envPublicID)}`;

  registerSandboxWindow(win, { origin, floe_app: FLOE_APP_PORT_FORWARD, code_space_id: forwardID, app_path: '/' });

  try {
    await touchWebService(forwardID, setStatus);

    setStatus('Requesting entry ticket...');
    const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp: FLOE_APP_PORT_FORWARD, codeSpaceId: forwardID });

    const init = {
      v: 2,
      env_public_id: envPublicID,
      floe_app: FLOE_APP_PORT_FORWARD,
      code_space_id: forwardID,
      app_path: '/',
      entry_ticket: entryTicket,
    };
    const encoded = base64UrlEncode(JSON.stringify(init));

    setStatus('Opening...');
    win.location.assign(`${bootURL}#redeven=${encoded}`);
  } catch (e) {
    try {
      win.close();
    } catch {
      // ignore
    }
    throw e;
  }
}

async function openWebServiceRoute(
  route: WebServiceOpenRoute,
  forwardID: string,
  setStatus: (s: string) => void,
  win: Window,
): Promise<void> {
  if (route.kind === 'e2ee_tunnel') {
    await openPortForwardTunnel(forwardID, setStatus, win);
    return;
  }

  await touchWebService(forwardID, setStatus);
  setStatus(route.kind === 'browser_direct' ? 'Opening directly...' : 'Opening local proxy...');
  win.location.assign(route.url);
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvPortForwardsPage() {
  const ctx = useEnvContext();
  const notify = useNotification();
  const outlineControlClass = redevenSurfaceRoleClass('control');

  // Permission checks
  const permissionReady = () => ctx.env.state === 'ready';
  const canExecute = () => Boolean(ctx.env()?.permissions?.can_execute);

  // Search/filter state
  const [searchQuery, setSearchQuery] = createSignal('');

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
      const out = await fetchGatewayJSON<{ forwards: PortForward[] }>('/_redeven_proxy/api/forwards', { method: 'GET' });
      return Array.isArray(out?.forwards) ? out.forwards : [];
    }
  );

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
      notify.error('Missing target', 'Please enter a target like localhost:3000.');
      return;
    }
    setCreateLoading(true);
    try {
      await fetchGatewayJSON('/_redeven_proxy/api/forwards', {
        method: 'POST',
        body: JSON.stringify({ target, name, description }),
      });
      setCreateOpen(false);
      bumpRefresh();
      notify.success('Service added', name ? `Added "${name}"` : 'Web service added successfully');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to add service', msg);
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
      await fetchGatewayJSON(`/_redeven_proxy/api/forwards/${encodeURIComponent(fid)}`, { method: 'DELETE' });
      bumpRefresh();
      notify.success('Service deleted', 'Web service has been removed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to delete service', msg);
    } finally {
      setDeleting(false);
      setDeleteID(null);
    }
  };

  // Open service handler
  const doOpen = async (f: PortForward) => {
    const fid = String(f?.forward_id ?? '').trim();
    if (!fid) return;
    if (busyID()) return;

    setBusyID(fid);
    setBusyText('Opening...');
    const win = window.open('about:blank', `redeven_web_service_${fid}`);
    if (!win) {
      setBusyID(null);
      setBusyText('');
      notify.error('Failed to open service', 'Popup was blocked. Please allow popups and try again.');
      return;
    }

    try {
      setBusyText('Resolving route...');
      const localRuntime = await getLocalRuntime().catch(() => null);
      const desktopContext = readDesktopSessionContextSnapshot();
      const route = resolveWebServiceOpenRoute({
        forwardID: fid,
        targetURL: f.target_url,
        localRuntime,
        desktopContext,
      });
      await openWebServiceRoute(route, fid, (s) => setBusyText(s), win);
      bumpRefresh();
    } catch (e) {
      try {
        win.close();
      } catch {
        // ignore
      }
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to open service', msg);
    } finally {
      setBusyID(null);
      setBusyText('');
    }
  };

  // Find the service being deleted for the confirmation dialog
  const deleteTarget = createMemo(() => {
    const id = deleteID();
    if (!id) return null;
    return forwards()?.find((f) => f.forward_id === id) ?? null;
  });

  return (
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="h-full min-h-0 overflow-auto">
      <Panel class={cn('border rounded-md overflow-hidden', redevenSurfaceRoleClass('panelStrong'))} data-testid="web-services-panel">
        <PanelContent class="p-4 space-y-4">
          {/* Page header */}
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Globe class="w-5 h-5 text-primary" />
              </div>
              <div class="space-y-1">
                <div class="text-sm font-semibold">Web Services</div>
                <div class="text-xs text-muted-foreground">
                  Register runtime-reachable HTTP services and open them through the best route for this session.
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={bumpRefresh} disabled={!!busyID() || forwards.loading} aria-label="Refresh" title="Refresh" class={outlineControlClass}>
                <RefreshIcon class="w-3.5 h-3.5 sm:mr-1" />
                <span class="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setCreateOpen(true)}
                disabled={!!busyID() || (permissionReady() && !canExecute())}
                aria-label="Add Service"
                title="Add Service"
              >
                <Plus class="w-3.5 h-3.5 sm:mr-1" />
                <span class="hidden sm:inline">Add Service</span>
              </Button>
            </div>
          </div>

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
              <span>Execute permission is required to manage web services.</span>
            </div>
          </Show>

          {/* Search bar - only show when there are services */}
          <Show when={(forwards()?.length ?? 0) > 0}>
            <div class="flex items-center gap-2">
              <Input
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder="Search services by name, target, or description..."
                size="sm"
                class="max-w-sm"
              />
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
          <div class="relative" style={{ 'min-height': '200px' }}>
            <LoadingOverlay visible={forwards.loading} message="Loading web services..." />

            <Show when={forwards.error}>
              <div class="flex items-center gap-2 text-sm text-destructive p-4">
                <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
                  />
                </svg>
                Failed to load web services: {String(forwards.error)}
              </div>
            </Show>

            <Show when={forwards.state === 'ready' && !forwards.error}>
              <Show
                when={(forwards()?.length ?? 0) > 0}
                fallback={<EmptyState onCreateClick={() => setCreateOpen(true)} disabled={permissionReady() && !canExecute()} />}
              >
                <Show
                  when={filteredForwards().length > 0}
                  fallback={
                    <div class="flex flex-col items-center justify-center py-12 px-4">
                      <p class="text-sm text-muted-foreground">No services match "{searchQuery()}"</p>
                      <Button size="sm" variant="ghost" onClick={() => setSearchQuery('')} class="mt-2">
                        Clear search
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
        title="Delete Web Service"
        confirmText="Delete"
        variant="destructive"
        loading={deleting()}
        onConfirm={() => void doDelete(deleteID() || '')}
      >
        <div class="space-y-2">
          <p class="text-sm">
            Are you sure you want to delete{' '}
            <span class="font-semibold">"{deleteTarget()?.name || deleteTarget()?.forward_id}"</span>?
          </p>
          <p class="text-xs text-muted-foreground">
            This removes the service registration. The target at{' '}
            <span class="font-mono">{deleteTarget()?.target_url}</span> will not be affected.
          </p>
        </div>
      </ConfirmDialog>

      {/* Global loading overlay for opening operations */}
      <LoadingOverlay visible={!!busyID() && !!busyText()} message={busyText() || 'Working...'} />
    </div>
  );
}
