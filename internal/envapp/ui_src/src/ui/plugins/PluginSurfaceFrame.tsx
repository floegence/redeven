import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { PluginSurfaceHost, type FetchInitLike, type FetchResponseLike, type PluginConfirmationIntent } from '@floegence/redevplugin-ui';
import { X } from '@floegence/floe-webapp-core/icons';

import { prepareLocalApiRequestInit } from '../services/localApi';
import { trustedLauncherOriginFromSandboxLocation, type OriginLocationLike } from '../services/sandboxOrigins';
import { useI18n } from '../i18n';
import type { PluginOpenSurfaceResult } from './pluginTypes';

export type PluginSurfaceFrameProps = {
  surface: PluginOpenSurfaceResult;
  onClose: () => void;
};

type SurfaceLoadState = 'bootstrapping' | 'ready' | 'error';
type PluginTranslator = ReturnType<typeof useI18n>['t'];

const redevpluginAPIPath = '/_redevplugin/api/plugins';
const redevenPluginAPIPath = '/_redeven_proxy/api/plugins';
const redevenPluginSandboxPath = '/_redeven_plugin';

export function PluginSurfaceFrame(props: PluginSurfaceFrameProps): JSX.Element {
  const i18n = useI18n();
  let iframeRef!: HTMLIFrameElement;
  const [iframeSrc, setIframeSrc] = createSignal('about:blank');
  const [loadState, setLoadState] = createSignal<SurfaceLoadState>('bootstrapping');
  const [errorMessage, setErrorMessage] = createSignal('');

  createEffect(() => {
    const surface = props.surface;
    const iframeWindow = iframeRef?.contentWindow;
    if (!iframeWindow) {
      setLoadState('error');
      setErrorMessage(i18n.t('uiCopy.plugin.iframeUnavailable'));
      return;
    }

    let disposed = false;
    setIframeSrc('about:blank');
    setLoadState('bootstrapping');
    setErrorMessage('');

    const sandboxID = pluginSandboxID(surface);
    let iframeOrigin = '';
    try {
      iframeOrigin = pluginSandboxOriginFromEnvLocation(
        window.location,
        sandboxID,
        i18n.t('uiCopy.pluginRuntime.sandboxOriginUnavailable'),
      );
    } catch (error) {
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : i18n.t('uiCopy.plugin.surfaceFailed'));
      return;
    }
    const host = new PluginSurfaceHost({
      bootstrap: {
        pluginId: surface.plugin_id,
        pluginInstanceId: surface.plugin_instance_id,
        surfaceId: surface.surface_id,
        surfaceInstanceId: surface.surface_instance_id,
        activeFingerprint: surface.active_fingerprint,
        bridgeNonce: surface.bridge_nonce,
        ownerSessionHash: surface.owner_session_hash,
        ownerUserHash: surface.owner_user_hash,
        sessionChannelIdHash: surface.session_channel_id_hash,
      },
      iframeOrigin,
      iframeWindow,
      parentWindow: window,
      apiBaseURL: '',
      fetch: redevPluginPlatformFetch,
      confirm: (intent) => confirmPluginIntent(intent, (key, params) => i18n.t(key, params)),
      onError(error) {
        setLoadState('error');
        setErrorMessage(error.message || error.errorCode || i18n.t('uiCopy.plugin.surfaceFailed'));
      },
    });

    void (async () => {
      try {
        const assetSessionID = await openPluginAssetSession(surface, iframeOrigin, {
          bootstrapFailed: (status) => i18n.t('uiCopy.pluginRuntime.assetBootstrapFailed', { status }),
          sessionMissing: i18n.t('uiCopy.pluginRuntime.assetSessionMissing'),
        });
        if (disposed) return;
        const url = pluginAssetURL(surface, iframeOrigin, assetSessionID);
        setIframeSrc(url.href);
        setLoadState('ready');
        host.sendLifecycle({ type: 'visible' });
      } catch (error) {
        if (disposed) return;
        setLoadState('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
        host.dispose();
      }
    })();

    onCleanup(() => {
      disposed = true;
      try {
        host.sendLifecycle({ type: 'hidden' });
      } catch {
        // Lifecycle shutdown must not block component disposal.
      }
      host.dispose();
    });
  });

  return (
    <section
      data-plugin-surface-host
      data-plugin-id={props.surface.plugin_id}
      data-plugin-instance-id={props.surface.plugin_instance_id}
      data-surface-id={props.surface.surface_id}
      data-surface-instance-id={props.surface.surface_instance_id}
      class="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header class="flex min-h-12 items-center justify-between gap-3 border-b px-4">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold leading-tight">{i18n.t('uiCopy.plugin.surfaceTitle')}</h2>
          <p class="truncate text-[11px] text-muted-foreground">{props.surface.plugin_id} · {props.surface.surface_id}</p>
        </div>
        <button
          type="button"
          aria-label={i18n.t('uiCopy.plugin.closeSurface')}
          class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={props.onClose}
        >
          <X class="h-4 w-4" />
        </button>
      </header>

      <Show when={errorMessage()}>
        <div class="border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-xs text-destructive" data-plugin-surface-error>
          {errorMessage()}
        </div>
      </Show>

      <div class="relative min-h-0 flex-1 bg-muted/20">
        <Show when={loadState() === 'bootstrapping'}>
          <div class="absolute inset-0 z-10 flex items-center justify-center bg-background/85 text-sm text-muted-foreground">
            {i18n.t('uiCopy.plugin.openingSurface')}
          </div>
        </Show>
        <iframe
          ref={iframeRef}
          data-plugin-surface-iframe
          title={`${props.surface.plugin_id} ${props.surface.surface_id}`}
          src={iframeSrc()}
          sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-same-origin"
          class="h-full w-full border-0 bg-background"
        />
      </div>
    </section>
  );
}

export function pluginSandboxID(surface: Pick<PluginOpenSurfaceResult, 'plugin_id' | 'surface_id'>): string {
  const raw = `${surface.plugin_id}-${surface.surface_id}`;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const base = normalized || 'surface';
  if (base.length <= 42) return base;
  const suffix = stableBase36Hash(base).slice(0, 8);
  return `${base.slice(0, 33).replace(/-+$/u, '')}-${suffix}`;
}

export function pluginSandboxOriginFromEnvLocation(
  loc: OriginLocationLike,
  sandboxID: string,
  unavailableMessage = 'Plugin sandbox origin is unavailable for the current Env App host.',
): string {
  const hostname = normalizeHostname(loc.hostname);
  if (isLoopbackHost(hostname)) {
    const protocol = String(loc.protocol ?? '').trim();
    if (!protocol) throw new Error(unavailableMessage);
    const port = String(loc.port ?? '').trim();
    return `${protocol}//plg-${sandboxID}.localhost${port ? `:${port}` : ''}`;
  }

  try {
    return trustedLauncherOriginFromSandboxLocation(loc, 'plg', sandboxID);
  } catch {
    throw new Error(unavailableMessage);
  }
}

export function rewriteReDevPluginPlatformURL(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return raw;
  if (raw === redevpluginAPIPath || raw.startsWith(`${redevpluginAPIPath}/`)) {
    return `${redevenPluginAPIPath}${raw.slice(redevpluginAPIPath.length)}`;
  }
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.pathname === redevpluginAPIPath || parsed.pathname.startsWith(`${redevpluginAPIPath}/`)) {
      return `${redevenPluginAPIPath}${parsed.pathname.slice(redevpluginAPIPath.length)}${parsed.search}`;
    }
  } catch {
    // Keep the original value; fetch will surface malformed URL failures.
  }
  return raw;
}

async function redevPluginPlatformFetch(input: string, init: FetchInitLike): Promise<FetchResponseLike> {
  return fetch(
    rewriteReDevPluginPlatformURL(input),
    await prepareLocalApiRequestInit({
      method: init.method,
      headers: init.headers,
      body: init.body,
      credentials: init.credentials,
    }),
  );
}

async function openPluginAssetSession(
  surface: PluginOpenSurfaceResult,
  iframeOrigin: string,
  copy: Readonly<{ bootstrapFailed: (status: number) => string; sessionMissing: string }>,
): Promise<string> {
  const url = new URL(`${redevenPluginSandboxPath}/bootstrap`, iframeOrigin);
  const response = await fetch(url.href, await prepareLocalApiRequestInit({
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      surface_instance_id: surface.surface_instance_id,
      asset_ticket: surface.asset_ticket,
    }),
    credentials: 'include',
  }));
  if (!response.ok) {
    throw new Error(copy.bootstrapFailed(response.status));
  }
  const envelope = await response.json();
  const assetSessionID = assetSessionIDFromEnvelope(envelope);
  if (!assetSessionID) {
    throw new Error(copy.sessionMissing);
  }
  return assetSessionID;
}

function pluginAssetURL(surface: PluginOpenSurfaceResult, iframeOrigin: string, assetSessionID: string): URL {
  const url = new URL(`${redevenPluginSandboxPath}/assets/${encodeURIComponent(assetSessionID)}/ui/index.html`, iframeOrigin);
  url.searchParams.set('parent_origin', window.location.origin);
  url.searchParams.set('plugin_id', surface.plugin_id);
  url.searchParams.set('surface_id', surface.surface_id);
  url.searchParams.set('surface_instance_id', surface.surface_instance_id);
  url.searchParams.set('active_fingerprint', surface.active_fingerprint);
  url.searchParams.set('bridge_nonce', surface.bridge_nonce);
  return url;
}

function assetSessionIDFromEnvelope(value: unknown): string {
  const root = asRecord(value);
  const data = asRecord(root.data);
  return String(data.asset_session_id ?? root.asset_session_id ?? '').trim();
}

function confirmPluginIntent(
  intent: PluginConfirmationIntent,
  t: PluginTranslator,
): { confirmed: boolean } {
  return { confirmed: window.confirm(pluginConfirmationMessage(intent, t)) };
}

function pluginConfirmationMessage(
  intent: PluginConfirmationIntent,
  t: PluginTranslator,
): string {
  const plan = asRecord(intent.plan);
  const summary = String(plan.summary ?? '').trim();
  const target = String(plan.resource_display_name ?? plan.resource_ref ?? '').trim();
  return [
    t('uiCopy.pluginRuntime.approveAction'),
    summary ? t('uiCopy.pluginRuntime.summary', { value: summary }) : '',
    target ? t('uiCopy.pluginRuntime.target', { value: target }) : '',
    t('uiCopy.pluginRuntime.method', { value: intent.method }),
    t('uiCopy.pluginRuntime.requestHash', { value: intent.requestHash }),
  ].filter(Boolean).join('\n');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeHostname(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '');
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || hostname.startsWith('127.');
}

function stableBase36Hash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}
