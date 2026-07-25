import { useLayout } from '@floegence/floe-webapp-core';
import { AlertTriangle, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import { PersistentFloatingWindow } from '../widgets/PersistentFloatingWindow';
import { PluginSurfaceBody } from './PluginSurfaceFrame';
import { isolateDocumentBranch } from './modalIsolation';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS } from './pluginPresentation';
import type { PluginConfirmationQueue } from './PluginConfirmationQueue';
import type { PluginSurfacePlacementCoordinator } from './pluginPlatform';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';

export type ActivityPluginSurfaceWindowProps = {
  instanceID: string;
  target: PluginSurfaceLaunchTarget;
  coordinator: PluginSurfacePlacementCoordinator;
  confirmationQueue: PluginConfirmationQueue;
  visible: boolean;
  active: boolean;
  zIndex: number;
  focusRequest: number;
  onActivate: (instanceID: string) => void;
  onClosed: (instanceID: string) => void;
  serializeClose?: (close: () => Promise<void>) => Promise<void>;
  registerRequestClose?: (instanceID: string, close: (() => Promise<void>) | null) => void;
  onEndPluginSession: () => Promise<boolean>;
  onRetirementError: (error: unknown) => void;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ActivityPluginSurfaceWindow(props: ActivityPluginSurfaceWindowProps): JSX.Element {
  const i18n = useI18n();
  const layout = useLayout();
  const [closing, setClosing] = createSignal(false);
  const [closeQueued, setCloseQueued] = createSignal(false);
  const [closeFailed, setCloseFailed] = createSignal(false);
  const [endSessionConfirmationOpen, setEndSessionConfirmationOpen] = createSignal(false);
  const [endingSession, setEndingSession] = createSignal(false);
  const [surface, setSurface] = createSignal<HTMLElement | null>(null);
  let closeBody: (() => Promise<boolean>) | null = null;
  let closeAttempt: Promise<void> | null = null;
  let continueQueuedClose: (() => void) | null = null;
  let settleQueuedClose: (() => void) | null = null;
  let disposed = false;
  let recoveryLayer: HTMLDivElement | undefined;
  let recoveryButton: HTMLButtonElement | undefined;
  const restoreFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  const title = () => i18n.t('uiCopy.plugin.activityWindowTitle', {
    plugin: props.target.displayName ?? props.target.pluginID,
    surface: props.target.surfaceDisplayNameKey
      ? i18n.t(props.target.surfaceDisplayNameKey)
      : props.target.surfaceID,
  });
  const windowVisible = () => props.visible && (!layout.isMobile() || props.active);

  const retire = (): Promise<void> => {
    if (closeAttempt) return closeAttempt;
    setClosing(true);
    setCloseQueued(!closeBody);
    closeAttempt = new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        continueQueuedClose = null;
        settleQueuedClose = null;
        closeAttempt = null;
        setCloseQueued(false);
        setClosing(false);
        resolve();
      };
      settleQueuedClose = settle;
      const run = async () => {
        if (disposed) {
          settle();
          return;
        }
        const close = closeBody;
        if (!close) {
          setCloseQueued(true);
          continueQueuedClose = () => { void run(); };
          return;
        }
        continueQueuedClose = null;
        setCloseQueued(false);
        try {
          const closed = await close();
          if (disposed) return;
          if (closed) {
            props.onClosed(props.instanceID);
          } else {
            setCloseFailed(true);
          }
        } catch (error) {
          setCloseFailed(true);
          props.onRetirementError(error);
        } finally {
          settle();
        }
      };
      void run();
    });
    return closeAttempt;
  };
  const requestClose = () => props.serializeClose ? props.serializeClose(retire) : retire();

  const registerCloseBody = (close: (() => Promise<boolean>) | null) => {
    closeBody = close;
    if (close && continueQueuedClose) {
      const continueClose = continueQueuedClose;
      continueQueuedClose = null;
      continueClose();
    }
  };

  props.registerRequestClose?.(props.instanceID, retire);

  const bindSurface = (next: HTMLElement | null) => {
    const previous = surface();
    previous?.removeEventListener('pointerdown', handlePointerDown, true);
    previous?.removeEventListener('keydown', handleKeyDown);
    previous?.removeAttribute('data-redeven-plugin-activity-window');
    setSurface(next);
    next?.setAttribute('data-redeven-plugin-activity-window', 'true');
    next?.addEventListener('pointerdown', handlePointerDown, true);
    next?.addEventListener('keydown', handleKeyDown);
  };

  function handlePointerDown(event: PointerEvent) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-plugin-surface-stage]')) return;
    props.onActivate(props.instanceID);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (closeFailed()) return;
    if (!layout.isMobile() || !props.active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void requestClose();
      return;
    }
    if (event.target instanceof HTMLIFrameElement) return;
    const windowSurface = surface();
    if (event.key !== 'Tab' || !windowSurface) return;
    const focusable = [...windowSurface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => (
        !element.hidden
        && element.getAttribute('aria-hidden') !== 'true'
        && !element.hasAttribute('data-plugin-focus-guard')
      ));
    if (focusable.length === 0) {
      event.preventDefault();
      windowSurface.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleRecoveryKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Tab' || !recoveryLayer) return;
    const focusable = [...recoveryLayer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    event.stopPropagation();
    if (focusable.length === 0) {
      event.preventDefault();
      recoveryLayer.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const focusWindowBoundary = (edge: 'first' | 'last') => {
    const windowSurface = surface();
    if (!windowSurface) return;
    const focusable = [...windowSurface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => (
        !element.hidden
        && element.getAttribute('aria-hidden') !== 'true'
        && !element.hasAttribute('data-plugin-focus-guard')
      ));
    (edge === 'first' ? focusable[0] : focusable[focusable.length - 1])?.focus();
  };

  const endPluginSession = async () => {
    if (endingSession()) return;
    setEndingSession(true);
    try {
      if (!(await props.onEndPluginSession())) setEndSessionConfirmationOpen(false);
    } finally {
      setEndingSession(false);
    }
  };

  createEffect(() => {
    const windowSurface = surface();
    if (!windowSurface) return;
    windowSurface.setAttribute('role', 'dialog');
    windowSurface.setAttribute('aria-label', title());
    windowSurface.setAttribute('aria-modal', layout.isMobile() && props.active ? 'true' : 'false');
    windowSurface.setAttribute('aria-hidden', windowVisible() ? 'false' : 'true');
    windowSurface.style.display = windowVisible() ? '' : 'none';
    windowSurface.inert = !windowVisible();
    windowSurface.tabIndex = -1;
  });

  createEffect(() => {
    const windowSurface = surface();
    if (!windowSurface || !layout.isMobile() || !props.active || !windowVisible()) return;
    const restoreIsolation = isolateDocumentBranch(windowSurface);
    onCleanup(restoreIsolation);
  });

  createEffect(() => {
    if (!closeFailed() || !props.active || !windowVisible()) return;
    queueMicrotask(() => recoveryButton?.focus());
  });

  createEffect(() => {
    if (
      !closeFailed()
      || !props.active
      || !windowVisible()
      || endSessionConfirmationOpen()
      || !recoveryLayer
    ) return;
    const restoreIsolation = isolateDocumentBranch(recoveryLayer);
    onCleanup(restoreIsolation);
  });

  let handledFocusRequest = 0;
  createEffect(() => {
    const windowSurface = surface();
    const focusRequest = props.focusRequest;
    if (windowSurface && windowVisible() && props.active && focusRequest > handledFocusRequest) {
      handledFocusRequest = focusRequest;
      queueMicrotask(() => {
        const currentSurface = surface();
        if (!currentSurface || !windowVisible() || !props.active) return;
        const iframe = currentSurface.querySelector('iframe') as HTMLElement | null;
        if (iframe) iframe.focus();
        else currentSurface.focus();
      });
    }
  });

  onCleanup(() => {
    disposed = true;
    settleQueuedClose?.();
    props.registerRequestClose?.(props.instanceID, null);
    bindSurface(null);
    if (props.active && restoreFocus?.isConnected) restoreFocus.focus();
  });

  return (
    <PersistentFloatingWindow
      open
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
      title={title()}
      persistenceKey={`plugin-surface:${props.target.pluginInstanceID}:${props.target.surfaceID}:activity`}
      defaultSize={{ width: 920, height: 680 }}
      minSize={{ width: 460, height: 360 }}
      zIndex={props.zIndex}
      surfaceRef={bindSurface}
      class="redeven-plugin-activity-window overflow-hidden rounded-md"
      contentClass="min-h-0 flex flex-1 flex-col !overflow-hidden !p-0"
    >
      <span
        data-plugin-focus-guard
        tabIndex={layout.isMobile() && props.active ? 0 : -1}
        class="fixed h-px w-px overflow-hidden opacity-0"
        onFocus={() => focusWindowBoundary('last')}
      />
      <PluginSurfaceBody
        coordinator={props.coordinator}
        confirmationQueue={props.confirmationQueue}
        target={props.target}
        visible={windowVisible() && !closeFailed()}
        registerClose={registerCloseBody}
        onInteraction={(event) => {
          if (event.kind === 'activation' || event.kind === 'focus' || event.kind === 'action') {
            props.onActivate(props.instanceID);
          }
        }}
        onRetirementError={props.onRetirementError}
      />
      <Show when={closeQueued()}>
        <div
          role="status"
          aria-live="polite"
          class="absolute inset-0 z-20 flex items-center justify-center bg-background/95 px-6 text-center text-sm text-muted-foreground"
          data-plugin-surface-close-queued
        >
          {i18n.t('uiCopy.plugin.closingSurface')}
        </div>
      </Show>
      <Show when={closeFailed()}>
        <div
          ref={(element) => { recoveryLayer = element; }}
          role="alertdialog"
          aria-modal={props.active && windowVisible() && !endSessionConfirmationOpen() ? 'true' : undefined}
          aria-hidden={!windowVisible() || endSessionConfirmationOpen() ? 'true' : undefined}
          inert={endSessionConfirmationOpen()}
          tabIndex={-1}
          aria-labelledby={`plugin-surface-recovery-title-${props.instanceID}`}
          aria-describedby={`plugin-surface-recovery-description-${props.instanceID}`}
          class="absolute inset-0 z-20 flex items-center justify-center bg-background p-6"
          data-plugin-surface-recovery
          onKeyDown={handleRecoveryKeyDown}
        >
          <div class="max-w-md text-center">
            <AlertTriangle class="mx-auto h-6 w-6 text-destructive" />
            <h2 id={`plugin-surface-recovery-title-${props.instanceID}`} class="mt-3 text-sm font-semibold">{i18n.t('uiCopy.plugin.needsAttention')}</h2>
            <p id={`plugin-surface-recovery-description-${props.instanceID}`} class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceCleanupFailed')}</p>
            <div class="mt-5 flex flex-col-reverse items-stretch justify-center gap-2 sm:flex-row">
              <Button
                type="button"
                size="sm"
                class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS}
                variant="ghost-destructive"
                icon={AlertTriangle}
                disabled={closing()}
                data-plugin-surface-end-session
                onClick={() => setEndSessionConfirmationOpen(true)}
              >
                {i18n.t('uiCopy.plugin.endPluginSession')}
              </Button>
              <Button
                ref={recoveryButton}
                type="button"
                size="sm"
                class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS}
                variant="default"
                icon={Refresh}
                loading={closing()}
                disabled={closing()}
                data-plugin-surface-retry
                onClick={() => void requestClose()}
              >
                {i18n.t('common.actions.retry')}
              </Button>
            </div>
          </div>
        </div>
      </Show>
      <span
        data-plugin-focus-guard
        tabIndex={layout.isMobile() && props.active ? 0 : -1}
        class="fixed h-px w-px overflow-hidden opacity-0"
        onFocus={() => focusWindowBoundary('first')}
      />
      <Dialog
        open={endSessionConfirmationOpen()}
        onOpenChange={setEndSessionConfirmationOpen}
        title={i18n.t('uiCopy.plugin.endPluginSessionTitle')}
        description={i18n.t('uiCopy.plugin.endPluginSessionDescription')}
        footer={(
          <div class="flex w-full justify-end gap-2">
            <Button
              type="button"
              size="sm"
              class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS}
              variant="outline"
              disabled={endingSession()}
              onClick={() => setEndSessionConfirmationOpen(false)}
            >
              {i18n.t('common.actions.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS}
              variant="destructive"
              icon={AlertTriangle}
              loading={endingSession()}
              disabled={endingSession()}
              onClick={() => void endPluginSession()}
            >
              {i18n.t('uiCopy.plugin.endPluginSession')}
            </Button>
          </div>
        )}
      >
        <div class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceCleanupFailed')}</div>
      </Dialog>
    </PersistentFloatingWindow>
  );
}
