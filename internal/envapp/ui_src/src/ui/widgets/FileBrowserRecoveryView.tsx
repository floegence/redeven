import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertCircle, ArrowUp, Check, Copy, Home, Refresh, Settings, X } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { writeTextToClipboard } from '../utils/clipboard';
import { basenameFromAbsolutePath } from '../utils/askFlowerPath';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';

interface FileBrowserRecoveryViewProps {
  descriptionId?: string;
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

  const folderName = () => props.requestedPath === '/' ? i18n.t('files.rootLabel') : basenameFromAbsolutePath(props.requestedPath);
  const hasRecoveryDestination = () => props.parentAvailable || (props.accessFailure && props.canManageAccess);

  return (
    <section
      class={cn('relative min-w-0 shrink-0', props.unavailable
        ? 'flex min-h-full flex-col px-5 py-8'
        : 'px-3 py-2')}
      aria-busy={props.pending}
      data-testid="file-browser-navigation-failure"
    >
      <div class={cn('relative w-full min-w-0 rounded-xl border border-border/60 bg-muted/20', props.unavailable
        ? 'mx-auto my-auto max-w-[440px] p-6'
        : 'max-w-[960px] p-3')}>
        <div class="flex min-w-0 items-start gap-3">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning" aria-hidden="true">
            <AlertCircle class="size-4" />
          </div>
          <div {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS} class="min-w-0 flex-1 select-text" role="status" aria-live="polite">
            <h2 class={cn('pr-7 font-medium text-foreground', props.unavailable ? 'text-sm leading-5' : 'text-xs leading-5')}>
              {i18n.t('files.navigationFailure.title')}
            </h2>
            <Show when={props.unavailable && props.requestedPath}>
              <h3 class="mt-3 text-balance text-xl font-medium leading-7 tracking-tight text-foreground [overflow-wrap:anywhere]">
                {folderName()}
              </h3>
            </Show>
            <p id={props.descriptionId} class={cn('text-xs leading-5 text-muted-foreground', props.unavailable ? 'mt-2' : 'mt-0.5')}>
              {props.message}
            </p>
          </div>
        </div>
        <Show when={props.requestedPath}>
          <div class={cn('flex min-w-0 items-start gap-2 rounded-md border border-border/40 bg-background/50 py-1 pl-2.5 pr-1', props.unavailable ? 'mt-5' : 'mt-2.5')}>
            <dl {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS} class="min-w-0 flex-1 select-text self-center">
              <dt class="sr-only">{i18n.t('files.navigationFailure.requestedPath')}</dt>
              <dd class="whitespace-pre-wrap font-mono text-[11px] leading-5 text-foreground/80 [overflow-wrap:anywhere]">{props.requestedPath}</dd>
            </dl>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="icon" variant="ghost"
              class="size-6 shrink-0 rounded text-muted-foreground hover:text-foreground"
              title={copyLabel()} aria-label={copyLabel()} onClick={() => { void copyPath(); }}>
              <Show when={copyState() === 'copied'} fallback={<Copy class="size-3" aria-hidden="true" />}>
                <Check class="size-3 text-success" aria-hidden="true" />
              </Show>
            </Button>
            <span class="sr-only" role="status">{copyState() !== 'idle' ? copyLabel() : ''}</span>
          </div>
        </Show>
        <Show when={copyState() === 'failed'}>
          <p class="mt-2 text-xs text-error" role="status">{i18n.t('files.notifications.copyFailedTitle')}</p>
        </Show>
        <Show when={!props.unavailable && props.currentPath}>
          <p {...REDEVEN_WORKBENCH_TEXT_SELECTION_SURFACE_PROPS} class="mt-1.5 select-text text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
            {i18n.t('files.navigationFailure.currentLocation')}: <span class="font-mono">{props.currentPath}</span>
          </p>
        </Show>
        <div class={cn('flex flex-wrap items-center gap-1.5', props.unavailable ? 'mt-5 border-t border-border/50 pt-4' : 'mt-2.5')}>
          <Show when={props.parentAvailable}>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="sm" variant="secondary" icon={ArrowUp}
              class="rounded-md px-2.5 text-xs shadow-none" onClick={props.onOpenParent}>
              {i18n.t('files.navigationFailure.openParent')}
            </Button>
          </Show>
          <Show when={props.accessFailure && props.canManageAccess}>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="sm" variant="secondary" icon={Settings}
              class="rounded-md px-2.5 text-xs shadow-none" onClick={props.onManageAccess}>
              {i18n.t('files.navigationFailure.manageAccess')}
            </Button>
          </Show>
          <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="sm" variant={hasRecoveryDestination() ? 'ghost' : 'secondary'}
            class={cn('px-2.5 text-xs shadow-none aria-disabled:cursor-wait aria-disabled:opacity-60', hasRecoveryDestination() && 'text-muted-foreground')}
            aria-disabled={props.pending} onClick={() => { if (!props.pending) props.onRetry(); }}>
            <Refresh class={cn('size-3', props.pending && 'motion-safe:animate-spin')} aria-hidden="true" />
            {i18n.t('files.navigationFailure.retry')}
          </Button>
          <Show when={props.homeAvailable}>
            <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="sm" variant="ghost" icon={Home}
              class="px-2.5 text-xs text-muted-foreground" onClick={props.onOpenHome}>
              {i18n.t('files.navigationFailure.openHome')}
            </Button>
          </Show>
        </div>
        <Show when={props.accessFailure && !props.canManageAccess}>
          <p class="mt-3 text-xs leading-5 text-muted-foreground">{i18n.t('files.navigationFailure.askAdministrator')}</p>
        </Show>
        <span class="sr-only" role="status">{props.pending ? i18n.t('files.opening') : ''}</span>
        <Show when={!props.unavailable}>
          <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="icon" variant="ghost"
            class="absolute right-2 top-2 size-7 text-muted-foreground" aria-label={i18n.t('files.navigationFailure.dismiss')} onClick={props.onDismiss}>
            <X class="size-3.5" aria-hidden="true" />
          </Button>
        </Show>
      </div>
    </section>
  );
}
