import {
  PluginSurfaceSlot,
  type PluginSurfaceHost,
} from '@floegence/redevplugin-ui';
import { cn } from '@floegence/floe-webapp-core';
import { AlertTriangle, Copy, Loader2, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import type { PluginConfirmationOwner, PluginConfirmationQueue } from './PluginConfirmationQueue';
import type { PluginSurfaceInteractionEvent, PluginSurfacePlacementCoordinator } from './pluginPlatform';
import { createRedevenPluginSurfaceContext, pluginSurfaceContextFingerprint } from './pluginSurfaceContext';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import { surfaceOpeningFeedback, surfaceOpeningStageKeys, surfaceFailureDiagnostic, type SurfaceOpeningFeedback } from './pluginSurfaceOpeningFeedback';

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
  let firstTerminalError: Error | undefined;
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
  const [openingProgress, setOpeningProgress] = createSignal<SurfaceOpeningFeedback>();
  const [openingFailure, setOpeningFailure] = createSignal<SurfaceOpeningFeedback>();
  const [errorCode, setErrorCode] = createSignal('');
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  const [cleanupPending, setCleanupPending] = createSignal(false);
  const diagnostic = () => surfaceFailureDiagnostic(errorCode(), openingFailure());
  const confirmationOwner: PluginConfirmationOwner = {
    pluginID: props.target.pluginID,
    displayName: props.target.displayName,
    pluginInstanceID: props.target.pluginInstanceID,
    surfaceID: props.target.surfaceID,
    canConfirm: () => mounted && Boolean(host()) && props.visible && pageVisible(),
  };

  const recordTerminalError = (ownedSlot: PluginSurfaceSlot, error: unknown): Readonly<{
    error: Error;
    first: boolean;
  }> | undefined => {
    if (!mounted || slot !== ownedSlot) return undefined;
    const first = firstTerminalError === undefined;
    firstTerminalError ??= error instanceof Error
      ? error
      : new Error(i18n.t('uiCopy.plugin.surfaceFailed'));
    const code = 'errorCode' in firstTerminalError && typeof firstTerminalError.errorCode === 'string'
      ? firstTerminalError.errorCode
      : '';
    setErrorCode(code);
    setOpeningFailure(surfaceOpeningFeedback('details' in firstTerminalError ? firstTerminalError.details : undefined));
    setOpeningProgress(undefined);
    setLoadState('error');
    setErrorMessage(firstTerminalError.message || code || i18n.t('uiCopy.plugin.surfaceFailed'));
    return { error: firstTerminalError, first };
  };

  const openFreshSurface = () => {
    setLoadState('opening');
    setErrorMessage('');
    setErrorCode('');
    setOpeningProgress(undefined);
    setOpeningFailure(undefined);
    setCopyState('idle');
    setCleanupPending(false);
    setHost(undefined);
    firstTerminalError = undefined;
    const ownedSlot = PluginSurfaceSlot.create({ stage });
    slot = ownedSlot;
    props.coordinator.setVisible(ownedSlot, props.visible && pageVisible());
    void props.coordinator.open(ownedSlot, {
      plugin_instance_id: props.target.pluginInstanceID,
      surface_id: props.target.surfaceID,
      expected_management_revision: props.target.expectedManagementRevision,
    }, {
      confirm: props.confirmationQueue.createHandler(confirmationOwner),
      onInteraction: props.onInteraction,
      onCleanupError: props.onRetirementError,
      surfaceContext: currentSurfaceContext,
      onOpeningProgress(progress) {
        if (!mounted || slot !== ownedSlot || firstTerminalError || loadState() !== 'opening') return;
        setOpeningProgress(surfaceOpeningFeedback(progress));
      },
      onError(error) {
        const terminal = recordTerminalError(ownedSlot, error);
        if (!terminal?.first) return;
        void props.coordinator.fail(ownedSlot, terminal.error).catch(props.onRetirementError);
      },
    }).then((openedHost) => {
      if (!mounted || slot !== ownedSlot || firstTerminalError) return;
      openedHost.element.dataset.pluginSurfaceIframe = '';
      setHost(openedHost);
      if (currentSurfaceContext.revision > initialSurfaceContextRevision) {
        openedHost.updateContext(currentSurfaceContext);
      }
      setOpeningProgress(undefined);
      setLoadState('ready');
    }).catch((error: unknown) => {
      recordTerminalError(ownedSlot, error);
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
      surface: props.target.surfaceID,
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
      setCleanupPending(true);
      props.onRetirementError(error);
    } finally {
      if (mounted) setRetrying(false);
    }
  };

  const copyDiagnostic = async () => {
    const ownedSlot = slot;
    try {
      await navigator.clipboard.writeText(diagnostic());
      if (mounted && slot === ownedSlot) setCopyState('copied');
    } catch {
      if (mounted && slot === ownedSlot) setCopyState('failed');
    }
  };

  onMount(() => props.registerClose?.(closeSurface));

  return (
    <section
      data-plugin-surface-host
      aria-busy={loadState() === 'opening' || loadState() === 'closing'}
      data-plugin-id={props.target.pluginID}
      data-plugin-instance-id={props.target.pluginInstanceID}
      data-surface-id={props.target.surfaceID}
      data-surface-instance-id={host()?.surfaceInstanceId}
      class="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <div class="relative min-h-0 flex-1 bg-muted/20">
        <Show when={loadState() === 'opening' && openingProgress()}>
          {(progress) => <div role="status" aria-live="polite" data-plugin-surface-opening
            class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-muted-foreground">
            <Loader2 class="h-5 w-5 animate-spin motion-reduce:animate-none" />
            <span>{i18n.t(surfaceOpeningStageKeys[progress().stage])}</span>
          </div>}
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
              <Show when={errorCode() === 'PLUGIN_BRIDGE_TIMEOUT'}>
                <p class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceTimedOut')}</p>
              </Show>
              <Show when={cleanupPending()}>
                <p role="status" class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceRetryCleanup')}</p>
              </Show>
              <details class="mt-2 break-words text-sm leading-6 text-muted-foreground">
                <summary class="cursor-pointer">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
                <p>{errorMessage()}</p>
                <Show when={errorCode() || openingFailure()}>
                  <pre data-plugin-surface-diagnostics class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-start text-xs select-text">{diagnostic()}</pre>
                  <Button type="button" size="sm" variant="ghost" icon={Copy}
                    class={`${PLUGIN_MOBILE_TOUCH_TARGET_CLASS} mt-2`}
                    data-plugin-surface-copy-diagnostics onClick={() => void copyDiagnostic()}>
                    {copyState() === 'copied' ? i18n.t('common.actions.copied') : i18n.t('uiCopy.plugin.copySurfaceDiagnostics')}
                  </Button>
                  <Show when={copyState() === 'failed'}>
                    <p role="status">{i18n.t('uiCopy.plugin.copySurfaceDiagnosticsFailed')}</p>
                  </Show>
                </Show>
              </details>
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
          inert={loadState() !== 'ready' || !props.visible}
          aria-hidden={loadState() !== 'ready' || !props.visible ? 'true' : undefined}
          data-plugin-surface-stage
          class={cn(
            'h-full min-h-0 w-full bg-background transition-opacity duration-200 ease-out [&>iframe]:block [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0 motion-reduce:transition-none',
            loadState() === 'error' ? 'opacity-0' : 'opacity-100',
          )}
        />
      </div>
    </section>
  );
}

export { PluginSurfaceBody as PluginSurfaceFrame };
