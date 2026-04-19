import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Refresh, X } from '@floegence/floe-webapp-core/icons';

import type { RuntimeUpdatePromptMode } from '../maintenance/createRuntimeUpdatePromptCoordinator';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';

const WINDOW_MARGIN_DESKTOP = 16;
const WINDOW_MARGIN_MOBILE = 10;
const WINDOW_WIDTH_DESKTOP = 360;
const WINDOW_WIDTH_MOBILE = 320;
const WINDOW_HEIGHT = 220;

type RuntimeUpdateFloatingPromptProps = Readonly<{
  open: boolean;
  mode: RuntimeUpdatePromptMode;
  currentVersion: string;
  targetVersion: string;
  latestMessage?: string;
  stage?: string | null;
  error?: string | null;
  onClose: () => void;
  onUpdateNow: () => Promise<void> | void;
  onRetry: () => Promise<void> | void;
  onSkip: () => void;
}>;

function currentViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveWindowPosition(viewport: { width: number; height: number }): { x: number; y: number } {
  const compact = viewport.width < 640;
  const margin = compact ? WINDOW_MARGIN_MOBILE : WINDOW_MARGIN_DESKTOP;
  const width = compact ? Math.min(WINDOW_WIDTH_MOBILE, viewport.width - margin * 2) : Math.min(WINDOW_WIDTH_DESKTOP, viewport.width - margin * 2);
  const height = Math.min(WINDOW_HEIGHT, viewport.height - margin * 2);
  return {
    x: Math.max(margin, viewport.width - width - margin),
    y: Math.max(margin, viewport.height - height - margin),
  };
}

function resolveWindowWidth(viewport: { width: number; height: number }): number {
  const compact = viewport.width < 640;
  const margin = compact ? WINDOW_MARGIN_MOBILE : WINDOW_MARGIN_DESKTOP;
  const preferred = compact ? WINDOW_WIDTH_MOBILE : WINDOW_WIDTH_DESKTOP;
  return Math.max(280, Math.min(preferred, viewport.width - margin * 2));
}

export function RuntimeUpdateFloatingPrompt(props: RuntimeUpdateFloatingPromptProps) {
  const [viewport, setViewport] = createSignal(currentViewportSize());

  onMount(() => {
    const syncViewport = () => setViewport(currentViewportSize());
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    onCleanup(() => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    });
  });

  const position = createMemo(() => resolveWindowPosition(viewport()));
  const width = createMemo(() => resolveWindowWidth(viewport()));
  const title = createMemo(() => {
    if (props.mode === 'updating') return 'Updating Redeven';
    if (props.mode === 'failed') return 'Update failed';
    return 'Update available';
  });

  const description = createMemo(() => {
    if (props.mode === 'updating') {
      return props.stage || 'Restarting runtime...';
    }
    if (props.mode === 'failed') {
      return props.error || 'The update could not be completed. You can retry now or skip this version.';
    }
    return 'A newer recommended Redeven version is ready for this environment.';
  });

  const footer = createMemo(() => {
    if (props.mode === 'updating') {
      return (
        <div class="flex w-full items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Hide
          </Button>
        </div>
      );
    }

    if (props.mode === 'failed') {
      return (
        <div class="flex w-full items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Later
          </Button>
          <div class="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={props.onSkip}>
              Skip this version
            </Button>
            <Button size="sm" variant="default" onClick={() => void props.onRetry()}>
              <Refresh class="size-3.5" />
              <span class="ml-1.5">Retry</span>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div class="flex w-full items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Later
        </Button>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={props.onSkip}>
            Skip this version
          </Button>
          <Button size="sm" variant="default" onClick={() => void props.onUpdateNow()}>
            Update now
          </Button>
        </div>
      </div>
    );
  });

  return (
    <Show when={props.open}>
      <PersistentFloatingWindow
        open
        onOpenChange={(next) => {
          if (!next) props.onClose();
        }}
        title={title()}
        persistenceKey="runtime-update-prompt"
        defaultPosition={position()}
        defaultSize={{ width: width(), height: WINDOW_HEIGHT }}
        minSize={{ width: width(), height: WINDOW_HEIGHT }}
        maxSize={{ width: width(), height: WINDOW_HEIGHT }}
        class="runtime-update-floating-prompt"
        zIndex={ENV_APP_FLOATING_LAYER.runtimeUpdatePrompt}
        footer={footer()}
      >
        <div class="flex h-full min-h-0 flex-col gap-4 px-1 py-1">
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="text-sm font-medium text-foreground">{title()}</div>
              <p class="text-xs leading-5 text-muted-foreground">{description()}</p>
            </div>
            <button
              type="button"
              class="mt-0.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={props.onClose}
              aria-label="Close update prompt"
            >
              <X class="size-3.5" />
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg border border-border bg-muted/25 p-3">
              <div class="text-[11px] font-medium text-muted-foreground">Current</div>
              <div class="mt-1 text-sm font-mono font-medium text-foreground">{props.currentVersion || '—'}</div>
            </div>
            <div class="rounded-lg border border-border bg-muted/25 p-3">
              <div class="text-[11px] font-medium text-muted-foreground">Target</div>
              <div class="mt-1 text-sm font-mono font-medium text-foreground">{props.targetVersion || '—'}</div>
            </div>
          </div>

          <Show when={props.mode === 'available' && props.latestMessage}>
            <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {props.latestMessage}
            </div>
          </Show>

          <Show when={props.mode === 'updating'}>
            <div class="rounded-lg border border-border/70 bg-primary/5 px-3 py-2 text-xs leading-5 text-primary">
              The update runs online and the page will reconnect to the updated runtime automatically.
            </div>
          </Show>

          <Show when={props.mode === 'failed' && props.error}>
            <div class="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs leading-5 text-error">
              {props.error}
            </div>
          </Show>
        </div>
      </PersistentFloatingWindow>
    </Show>
  );
}
