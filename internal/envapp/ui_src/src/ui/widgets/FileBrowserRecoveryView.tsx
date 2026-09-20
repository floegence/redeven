import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ArrowUp, Check, Copy, Folder, Home, Lock, Refresh, Settings, X } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { writeTextToClipboard } from '../utils/clipboard';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';

interface FileBrowserRecoveryViewProps {
  requestedPath: string;
  currentPath?: string;
  message: string;
  unavailable: boolean;
  pending: boolean;
  homeAvailable: boolean;
  parentAvailable: boolean;
  accessFailure: boolean;
  canManageAccess: boolean;
  onRetry: () => void;
  onOpenHome: () => void;
  onOpenParent: () => void;
  onManageAccess: () => void;
  onDismiss: () => void;
}

/** Files presentation only; navigation and request lifetime remain with RemoteFileBrowser. */
export function FileBrowserRecoveryView(props: FileBrowserRecoveryViewProps) {
  const i18n = useI18n();
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  createEffect(on(() => props.requestedPath, () => {
    clearTimeout(copyTimer);
    setCopyState('idle');
  }));
  onCleanup(() => { disposed = true; clearTimeout(copyTimer); });
  const copyLabel = () => copyState() === 'copied' ? i18n.t('common.actions.copied')
    : copyState() === 'failed' ? i18n.t('files.notifications.copyFailedTitle')
      : i18n.t('files.navigationFailure.copyPath');
  const copyPath = async () => {
    const path = props.requestedPath;
    let result: 'copied' | 'failed';
    try {
      await writeTextToClipboard(path);
      result = 'copied';
    } catch {
      result = 'failed';
    }
    if (disposed || props.requestedPath !== path) return;
    clearTimeout(copyTimer);
    setCopyState(result);
    copyTimer = setTimeout(() => setCopyState('idle'), 2500);
  };

  return (
    <section
      class={cn('relative min-w-0 shrink-0', props.unavailable
        ? 'flex min-h-full flex-col items-center justify-center px-6 py-10'
        : 'm-3 rounded-lg border border-border/60 px-4 py-3')}
      aria-busy={props.pending}
      data-testid="file-browser-navigation-failure"
    >
      <div class={cn('min-w-0 w-full', props.unavailable && 'max-w-[420px] text-center')}>
        <div {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS} class="select-text" role="status" aria-live="polite">
          <div class={cn('flex', props.unavailable ? 'flex-col items-center' : 'items-start gap-3 pr-7')}>
            <div class={cn('flex shrink-0 items-center justify-center text-muted-foreground', props.unavailable
              ? cn('mb-5 size-14 rounded-2xl border border-border/50', redevenSurfaceRoleClass('inset'))
              : 'mt-0.5 size-5')} aria-hidden="true">
              <Show when={props.accessFailure} fallback={<Folder class={props.unavailable ? 'size-6' : 'size-4'} />}>
                <Lock class={props.unavailable ? 'size-6' : 'size-4'} />
              </Show>
            </div>
            <div class="min-w-0">
              <h2 class={cn('font-medium tracking-tight text-foreground', props.unavailable ? 'text-lg' : 'text-sm')}>
                {i18n.t('files.navigationFailure.title')}
              </h2>
              <p class={cn('text-muted-foreground', props.unavailable ? 'mt-2 text-[13px] leading-6' : 'mt-1 text-xs leading-5')}>
                {props.message}
              </p>
            </div>
          </div>
        </div>
        <Show when={props.requestedPath}>
          <div class={cn('flex min-w-0 items-start gap-2 rounded-lg px-3 py-2.5 text-left', redevenSurfaceRoleClass('inset'), props.unavailable ? 'mt-5' : 'mt-3')}>
            <dl {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS} class="min-w-0 flex-1 select-text self-center">
              <dt class="sr-only">{i18n.t('files.navigationFailure.requestedPath')}</dt>
              <dd class="whitespace-pre-wrap font-mono text-[11px] leading-5 text-foreground/80 [overflow-wrap:anywhere]">{props.requestedPath}</dd>
            </dl>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="icon" variant="ghost"
              class="-my-0.5 -mr-1 size-7 shrink-0 text-muted-foreground"
              title={copyLabel()} aria-label={copyLabel()} onClick={() => { void copyPath(); }}>
              <Show when={copyState() === 'copied'} fallback={<Copy class="size-3.5" aria-hidden="true" />}>
                <Check class="size-3.5 text-success" aria-hidden="true" />
              </Show>
            </Button>
            <span class="sr-only" role="status">{copyState() !== 'idle' ? copyLabel() : ''}</span>
          </div>
        </Show>
        <Show when={copyState() === 'failed'}>
          <p class="mt-2 text-xs text-error" role="status">{i18n.t('files.notifications.copyFailedTitle')}</p>
        </Show>
        <Show when={!props.unavailable && props.currentPath}>
          <p {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS} class="mt-2 select-text text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {i18n.t('files.navigationFailure.currentLocation')}: <span class="font-mono">{props.currentPath}</span>
          </p>
        </Show>
        <div class={cn('flex flex-wrap items-center gap-2', props.unavailable ? 'mt-6 justify-center' : 'mt-3')}>
          <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="md" variant="primary"
            class="min-w-24 aria-disabled:cursor-wait aria-disabled:opacity-70"
            aria-disabled={props.pending} onClick={() => { if (!props.pending) props.onRetry(); }}>
            <Refresh class={cn('size-3.5', props.pending && 'motion-safe:animate-spin')} aria-hidden="true" />
            {i18n.t('files.navigationFailure.retry')}
          </Button>
          <Show when={props.parentAvailable}>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="md" variant="outline" icon={ArrowUp} onClick={props.onOpenParent}>
              {i18n.t('files.navigationFailure.openParent')}
            </Button>
          </Show>
          <Show when={props.accessFailure && props.canManageAccess}>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="md" variant="outline" icon={Settings} onClick={props.onManageAccess}>
              {i18n.t('files.navigationFailure.manageAccess')}
            </Button>
          </Show>
          <Show when={props.homeAvailable}>
            <div class={props.unavailable ? 'w-full pt-1' : ''}>
              <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="sm" variant="ghost" icon={Home}
                class="text-muted-foreground" onClick={props.onOpenHome}>
                {i18n.t('files.navigationFailure.openHome')}
              </Button>
            </div>
          </Show>
        </div>
        <Show when={props.accessFailure && !props.canManageAccess}>
          <p class="mt-3 text-xs leading-5 text-muted-foreground">{i18n.t('files.navigationFailure.askAdministrator')}</p>
        </Show>
        <span class="sr-only" role="status">{props.pending ? i18n.t('files.opening') : ''}</span>
      </div>
      <Show when={!props.unavailable}>
        <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="icon" variant="ghost"
          class="absolute right-2 top-2 size-7 text-muted-foreground" aria-label={i18n.t('files.navigationFailure.dismiss')} onClick={props.onDismiss}>
          <X class="size-3.5" aria-hidden="true" />
        </Button>
      </Show>
    </section>
  );
}
