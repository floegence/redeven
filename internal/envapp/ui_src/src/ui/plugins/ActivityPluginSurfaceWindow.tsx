import { useLayout } from '@floegence/floe-webapp-core';
import { AlertTriangle } from '@floegence/floe-webapp-core/icons';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import { PersistentFloatingWindow } from '../widgets/PersistentFloatingWindow';
import { PluginSurfaceBody } from './PluginSurfaceFrame';
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
  const [closeFailed, setCloseFailed] = createSignal(false);
  const [endSessionConfirmationOpen, setEndSessionConfirmationOpen] = createSignal(false);
  const [endingSession, setEndingSession] = createSignal(false);
  const [surface, setSurface] = createSignal<HTMLElement | null>(null);
  let closeBody: (() => Promise<boolean>) | null = null;
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

  const requestClose = async () => {
    if (closing()) return;
    if (!closeBody) return;
    setClosing(true);
    try {
      if (await closeBody()) {
        props.onClosed(props.instanceID);
      } else {
        setCloseFailed(true);
      }
    } finally {
      setClosing(false);
    }
  };

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
        visible={windowVisible()}
        registerClose={(close) => { closeBody = close; }}
        onRetirementError={props.onRetirementError}
      />
      <Show when={closeFailed()}>
        <div class="absolute inset-0 z-20 flex items-center justify-center bg-background p-6" data-plugin-surface-recovery>
          <div class="max-w-md text-center">
            <AlertTriangle class="mx-auto h-6 w-6 text-destructive" />
            <h2 class="mt-3 text-sm font-semibold">{i18n.t('uiCopy.plugin.needsAttention')}</h2>
            <p class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceCleanupFailed')}</p>
            <button
              type="button"
              class="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              onClick={() => setEndSessionConfirmationOpen(true)}
            >
              <AlertTriangle class="h-4 w-4" />
              {i18n.t('uiCopy.plugin.endPluginSession')}
            </button>
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
            <button
              type="button"
              class="cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              disabled={endingSession()}
              onClick={() => setEndSessionConfirmationOpen(false)}
            >
              {i18n.t('common.actions.cancel')}
            </button>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={endingSession()}
              onClick={() => void endPluginSession()}
            >
              <AlertTriangle class="h-4 w-4" />
              {i18n.t('uiCopy.plugin.endPluginSession')}
            </button>
          </div>
        )}
      >
        <div class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.surfaceCleanupFailed')}</div>
      </Dialog>
    </PersistentFloatingWindow>
  );
}
