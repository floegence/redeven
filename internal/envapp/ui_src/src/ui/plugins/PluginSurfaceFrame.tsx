import {
  PluginSurfaceSlot,
  type PluginSurfaceHost,
} from '@floegence/redevplugin-ui';
import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import type { PluginConfirmationOwner, PluginConfirmationQueue } from './PluginConfirmationQueue';
import type { PluginSurfacePlacementCoordinator } from './pluginPlatform';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';

export type PluginSurfaceBodyProps = {
  coordinator: PluginSurfacePlacementCoordinator;
  confirmationQueue: PluginConfirmationQueue;
  target: PluginSurfaceLaunchTarget;
  visible: boolean;
  registerClose?: (close: (() => Promise<boolean>) | null) => void;
  onRetirementError: (error: unknown) => void;
};

type SurfaceLoadState = 'opening' | 'ready' | 'closing' | 'error';

export function PluginSurfaceBody(props: PluginSurfaceBodyProps): JSX.Element {
  const i18n = useI18n();
  let stage!: HTMLDivElement;
  let slot: PluginSurfaceSlot | undefined;
  let mounted = true;
  const [host, setHost] = createSignal<PluginSurfaceHost>();
  const [pageVisible, setPageVisible] = createSignal(!document.hidden);
  const [loadState, setLoadState] = createSignal<SurfaceLoadState>('opening');
  const [errorMessage, setErrorMessage] = createSignal('');
  const confirmationOwner: PluginConfirmationOwner = {
    pluginID: props.target.pluginID,
    pluginInstanceID: props.target.pluginInstanceID,
    surfaceID: props.target.surfaceID,
    canConfirm: () => mounted && Boolean(host()) && props.visible && pageVisible(),
  };

  onMount(() => {
    const handleVisibilityChange = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    slot = PluginSurfaceSlot.create({
      stage,
      onStateChange(state, error) {
        if (state !== 'error') return;
        setLoadState('error');
        setErrorMessage(error?.message || i18n.t('uiCopy.plugin.surfaceFailed'));
      },
    });
    const ownedSlot = slot;
    props.coordinator.setVisible(ownedSlot, props.visible && pageVisible());
    void props.coordinator.open(ownedSlot, {
      plugin_instance_id: props.target.pluginInstanceID,
      surface_id: props.target.surfaceID,
      expected_management_revision: props.target.expectedManagementRevision,
    }, {
      confirm: props.confirmationQueue.createHandler(confirmationOwner),
      onError(error) {
        if (!mounted) return;
        setLoadState('error');
        setErrorMessage(error.message || error.errorCode || i18n.t('uiCopy.plugin.surfaceFailed'));
        void props.coordinator.fail(ownedSlot, error).catch((cleanupError: unknown) => {
          if (!mounted) return;
          setErrorMessage(cleanupError instanceof Error ? cleanupError.message : i18n.t('uiCopy.plugin.surfaceFailed'));
        });
      },
    }).then((openedHost) => {
      if (!mounted) return;
      openedHost.element.title = i18n.t('uiCopy.plugin.surfaceIframeTitle', {
        plugin: props.target.displayName ?? props.target.pluginID,
        surface: props.target.surfaceDisplayNameKey
          ? i18n.t(props.target.surfaceDisplayNameKey)
          : props.target.surfaceID,
      });
      openedHost.element.dataset.pluginSurfaceIframe = '';
      setHost(openedHost);
      setLoadState('ready');
    }).catch((error: unknown) => {
      if (!mounted) return;
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : i18n.t('uiCopy.plugin.surfaceFailed'));
    });

    onCleanup(() => {
      mounted = false;
      props.registerClose?.(null);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      props.confirmationQueue.cancelOwner(confirmationOwner);
      void props.coordinator.release(ownedSlot).catch(props.onRetirementError);
    });
  });

  createEffect(() => {
    const visible = props.visible && pageVisible();
    if (slot) props.coordinator.setVisible(slot, visible);
    if (!visible) props.confirmationQueue.cancelOwner(confirmationOwner);
  });

  const closeSurface = async () => {
    if (!slot || loadState() === 'closing') return false;
    setLoadState('closing');
    setErrorMessage('');
    props.confirmationQueue.cancelOwner(confirmationOwner);
    try {
      await props.coordinator.release(slot);
      return true;
    } catch (error) {
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : i18n.t('uiCopy.plugin.surfaceFailed'));
      return false;
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
      <Show when={errorMessage()}>
        <div role="alert" class="border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-xs text-destructive" data-plugin-surface-error>
          {errorMessage()}
        </div>
      </Show>

      <div class="relative min-h-0 flex-1 bg-muted/20">
        <Show when={loadState() === 'opening'}>
          <div role="status" aria-live="polite" class="absolute inset-0 z-10 flex items-center justify-center bg-background/85 text-sm text-muted-foreground">
            {i18n.t('uiCopy.plugin.openingSurface')}
          </div>
        </Show>
        <Show when={loadState() === 'closing'}>
          <div role="status" aria-live="polite" class="absolute inset-0 z-10 flex items-center justify-center bg-background/85 text-sm text-muted-foreground">
            {i18n.t('uiCopy.plugin.closingSurface')}
          </div>
        </Show>
        <div
          ref={stage}
          data-plugin-surface-stage
          class="h-full min-h-0 w-full bg-background [&>iframe]:block [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0"
        />
      </div>
    </section>
  );
}

export { PluginSurfaceBody as PluginSurfaceFrame };
