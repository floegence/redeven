import {
  PluginSurfaceSlot,
  type PluginSurfaceHost,
} from '@floegence/redevplugin-ui';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, Loader2, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import type { PluginConfirmationOwner, PluginConfirmationQueue } from './PluginConfirmationQueue';
import type { PluginSurfaceInteractionEvent, PluginSurfacePlacementCoordinator } from './pluginPlatform';
import { createRedevenPluginSurfaceContext, pluginSurfaceContextFingerprint } from './pluginSurfaceContext';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';

export type PluginSurfaceBodyProps = {
  coordinator: PluginSurfacePlacementCoordinator;
  confirmationQueue: PluginConfirmationQueue;
  target: PluginSurfaceLaunchTarget;
  visible: boolean;
  registerClose?: (close: (() => Promise<boolean>) | null) => void;
  onInteraction?: (event: PluginSurfaceInteractionEvent) => void;
  onRetirementError: (error: unknown) => void;
};

type SurfaceLoadState = 'opening' | 'ready' | 'closing' | 'error';

export function PluginSurfaceBody(props: PluginSurfaceBodyProps): JSX.Element {
  const i18n = useI18n();
  let stage!: HTMLDivElement;
  let slot: PluginSurfaceSlot | undefined;
  let mounted = true;
  let closePromise: Promise<boolean> | undefined;
  let themeObserver: MutationObserver | undefined;
  let surfaceContextRevision = 1;
  let currentSurfaceContext = createRedevenPluginSurfaceContext(surfaceContextRevision, i18n.locale());
  let currentSurfaceContextFingerprint = pluginSurfaceContextFingerprint(currentSurfaceContext);
  const initialSurfaceContextRevision = currentSurfaceContext.revision;
  const [host, setHost] = createSignal<PluginSurfaceHost>();
  const [pageVisible, setPageVisible] = createSignal(!document.hidden);
  const [loadState, setLoadState] = createSignal<SurfaceLoadState>('opening');
  const [errorMessage, setErrorMessage] = createSignal('');
  const [retrying, setRetrying] = createSignal(false);
  const confirmationOwner: PluginConfirmationOwner = {
    pluginID: props.target.pluginID,
    displayName: props.target.displayName,
    pluginInstanceID: props.target.pluginInstanceID,
    surfaceID: props.target.surfaceID,
    canConfirm: () => mounted && Boolean(host()) && props.visible && pageVisible(),
  };

  const openFreshSurface = () => {
    setLoadState('opening');
    setErrorMessage('');
    setHost(undefined);
    const ownedSlot = PluginSurfaceSlot.create({
      stage,
      onStateChange(state, error) {
        if (slot !== ownedSlot) return;
        if (state !== 'error') return;
        setLoadState('error');
        setErrorMessage(error?.message || i18n.t('uiCopy.plugin.surfaceFailed'));
      },
    });
    slot = ownedSlot;
    props.coordinator.setVisible(ownedSlot, props.visible && pageVisible());
    void props.coordinator.open(ownedSlot, {
      plugin_instance_id: props.target.pluginInstanceID,
      surface_id: props.target.surfaceID,
      expected_management_revision: props.target.expectedManagementRevision,
    }, {
      confirm: props.confirmationQueue.createHandler(confirmationOwner),
      onInteraction: props.onInteraction,
      surfaceContext: currentSurfaceContext,
      onError(error) {
        if (!mounted || slot !== ownedSlot) return;
        setLoadState('error');
        setErrorMessage(error.message || error.errorCode || i18n.t('uiCopy.plugin.surfaceFailed'));
        void props.coordinator.fail(ownedSlot, error).catch((cleanupError: unknown) => {
          if (!mounted || slot !== ownedSlot) return;
          setErrorMessage(cleanupError instanceof Error ? cleanupError.message : i18n.t('uiCopy.plugin.surfaceFailed'));
        });
      },
    }).then((openedHost) => {
      if (!mounted || slot !== ownedSlot) return;
      openedHost.element.dataset.pluginSurfaceIframe = '';
      setHost(openedHost);
      if (currentSurfaceContext.revision > initialSurfaceContextRevision) {
        openedHost.updateContext(currentSurfaceContext);
      }
      setLoadState('ready');
    }).catch((error: unknown) => {
      if (!mounted || slot !== ownedSlot) return;
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : i18n.t('uiCopy.plugin.surfaceFailed'));
    });
  };

  onMount(() => {
    const handleVisibilityChange = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const refreshSurfaceContext = () => {
      const candidate = createRedevenPluginSurfaceContext(surfaceContextRevision + 1, i18n.locale());
      const fingerprint = pluginSurfaceContextFingerprint(candidate);
      if (fingerprint === currentSurfaceContextFingerprint) return;
      surfaceContextRevision += 1;
      currentSurfaceContext = { ...candidate, revision: surfaceContextRevision };
      currentSurfaceContextFingerprint = fingerprint;
      host()?.updateContext(currentSurfaceContext);
    };
    if (typeof MutationObserver === 'function') {
      themeObserver = new MutationObserver(refreshSurfaceContext);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'dir', 'lang', 'style', 'data-theme', 'data-floe-shell-theme'],
      });
    }
    openFreshSurface();

    onCleanup(() => {
      mounted = false;
      props.registerClose?.(null);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      themeObserver?.disconnect();
      props.confirmationQueue.cancelOwner(confirmationOwner);
      const ownedSlot = slot;
      if (ownedSlot) void props.coordinator.release(ownedSlot).catch(props.onRetirementError);
    });
  });

  createEffect(() => {
    const languageTag = i18n.locale();
    const candidate = createRedevenPluginSurfaceContext(surfaceContextRevision + 1, languageTag);
    const fingerprint = pluginSurfaceContextFingerprint(candidate);
    if (fingerprint === currentSurfaceContextFingerprint) return;
    surfaceContextRevision += 1;
    currentSurfaceContext = { ...candidate, revision: surfaceContextRevision };
    currentSurfaceContextFingerprint = fingerprint;
    host()?.updateContext(currentSurfaceContext);
  });

  createEffect(() => {
    const visible = props.visible && pageVisible();
    if (slot) props.coordinator.setVisible(slot, visible);
    if (!visible) props.confirmationQueue.cancelOwner(confirmationOwner);
  });

  createEffect(() => {
    const openedHost = host();
    if (!openedHost) return;
    openedHost.element.title = i18n.t('uiCopy.plugin.surfaceIframeTitle', {
      plugin: props.target.displayName ?? props.target.pluginID,
      surface: props.target.surfaceDisplayNameKey
        ? i18n.t(props.target.surfaceDisplayNameKey)
        : props.target.surfaceID,
    });
  });

  const closeSurface = async () => {
    if (!slot) return false;
    if (closePromise) return closePromise;
    closePromise = (async () => {
      setLoadState('closing');
      setErrorMessage('');
      props.confirmationQueue.cancelOwner(confirmationOwner);
      try {
        await props.coordinator.release(slot!);
        return true;
      } catch (error) {
        setLoadState('error');
        setErrorMessage(error instanceof Error ? error.message : i18n.t('uiCopy.plugin.surfaceFailed'));
        closePromise = undefined;
        return false;
      }
    })();
    return closePromise;
  };

  const retrySurface = async () => {
    const failedSlot = slot;
    if (!failedSlot || retrying() || loadState() !== 'error') return;
    setRetrying(true);
    props.confirmationQueue.cancelOwner(confirmationOwner);
    try {
      await props.coordinator.release(failedSlot);
      if (!mounted || slot !== failedSlot) return;
      slot = undefined;
      openFreshSurface();
    } catch (error) {
      if (!mounted || slot !== failedSlot) return;
      setErrorMessage(error instanceof Error ? error.message : i18n.t('uiCopy.plugin.surfaceFailed'));
      props.onRetirementError(error);
    } finally {
      if (mounted) setRetrying(false);
    }
  };

  onMount(() => props.registerClose?.(closeSurface));

  return (
    <section
      data-plugin-surface-host
      data-plugin-id={props.target.pluginID}
      data-plugin-instance-id={props.target.pluginInstanceID}
      data-surface-id={props.target.surfaceID}
      data-surface-instance-id={host()?.surfaceInstanceId}
      class="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <div class="relative min-h-0 flex-1 bg-muted/20">
        <Show when={loadState() === 'opening'}>
          <div role="status" aria-live="polite" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-muted-foreground animate-in fade-in duration-150 motion-reduce:animate-none">
            <Loader2 class="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span>{i18n.t('uiCopy.plugin.openingSurface')}</span>
          </div>
        </Show>
        <Show when={loadState() === 'closing'}>
          <div role="status" aria-live="polite" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-muted-foreground animate-in fade-in duration-150 motion-reduce:animate-none">
            <Loader2 class="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span>{i18n.t('uiCopy.plugin.closingSurface')}</span>
          </div>
        </Show>
        <Show when={loadState() === 'error'}>
          <div role="alert" class="absolute inset-0 z-10 flex items-center justify-center bg-background p-6 animate-in fade-in duration-150 motion-reduce:animate-none" data-plugin-surface-error>
            <div class="max-w-md text-center animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
              <span class="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle class="h-5 w-5" />
              </span>
              <h2 class="mt-3 text-sm font-semibold">{i18n.t('uiCopy.plugin.surfaceFailed')}</h2>
              <p class="mt-2 break-words text-sm leading-6 text-muted-foreground">{errorMessage()}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                icon={Refresh}
                loading={retrying()}
                disabled={retrying()}
                class={`${PLUGIN_MOBILE_TOUCH_TARGET_CLASS} mt-4`}
                data-plugin-surface-open-retry
                onClick={() => void retrySurface()}
              >
                {i18n.t('common.actions.retry')}
              </Button>
            </div>
          </div>
        </Show>
        <div
          ref={stage}
          data-plugin-surface-stage
          class={cn(
            'h-full min-h-0 w-full bg-background transition-opacity duration-200 ease-out [&>iframe]:block [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0 motion-reduce:transition-none',
            loadState() === 'ready' ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </section>
  );
}

export { PluginSurfaceBody as PluginSurfaceFrame };
