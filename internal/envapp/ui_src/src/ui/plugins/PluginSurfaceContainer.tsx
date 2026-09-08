import { Show, createMemo, onCleanup, onMount, type JSX } from 'solid-js';
import { Loader2, Package } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { PluginSurfaceBody, type PluginSurfaceBodyProps } from './PluginSurfaceFrame';
import type { PluginSurfaceLaunchTarget } from './pluginTypes';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';

export type PluginSurfaceStatus = 'ready' | 'pending' | 'loading' | 'disabled' | 'permission' | 'surfaceMissing' | 'unavailable' | 'unknown' | 'runtimeFailed';
export type PluginSurfaceResolution = Readonly<{
  target: PluginSurfaceLaunchTarget | null;
  generation: number;
  status: PluginSurfaceStatus;
  action?: Readonly<{ label: 'enable' | 'permissions' | 'retry' | 'details'; run: () => void }>;
}>;
export type PluginSurfaceResolver = (target: PluginSurfaceLaunchTarget) => PluginSurfaceResolution;

function UnavailableSurface(props: Readonly<{
  resolution: PluginSurfaceResolution;
  registerClose: PluginSurfaceBodyProps['registerClose'];
}>) {
  const i18n = useI18n();
  onMount(() => props.registerClose?.(async () => true));
  onCleanup(() => props.registerClose?.(null));
  return (
    <div data-plugin-workbench-unavailable data-plugin-surface-status={props.resolution.status}
      class="flex h-full min-h-0 items-center justify-center bg-background p-5">
      <div class="max-w-sm space-y-4 text-center">
        <Package class="mx-auto h-8 w-8 text-muted-foreground" />
        <p class="text-sm text-muted-foreground" role="status">
          {i18n.t(`uiCopy.plugin.continuity.${props.resolution.status}`)}
        </p>
        <Show when={props.resolution.action}>
          {(action) => <Button {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} size="sm" class="min-h-11 cursor-pointer"
            data-plugin-workbench-view-issue onClick={() => action().run()}>
            {i18n.t(`uiCopy.plugin.continuity.${action().label}Action`)}
          </Button>}
        </Show>
      </div>
    </div>
  );
}

// Product containers survive SDK leases. A new lease never recreates or moves
// the Workbench widget or Activity window that owns it.
export function PluginSurfaceContainer(props: PluginSurfaceBodyProps & { resolveSurface?: PluginSurfaceResolver }): JSX.Element {
  const i18n = useI18n();
  const resolution = createMemo<PluginSurfaceResolution>(() => props.resolveSurface?.(props.target)
    ?? { target: props.target, generation: 0, status: 'ready' });
  const lease = createMemo((previous: { key: string; target: PluginSurfaceLaunchTarget } | undefined) => {
    const current = resolution();
    if (current.status === 'pending') return previous;
    const target = current.target;
    if (!target) return undefined;
    const key = [target.pluginInstanceID, target.surfaceID, target.expectedManagementRevision, current.generation].join('\u0000');
    return previous?.key === key ? previous : { key, target };
  });
  return <div class="relative h-full min-h-0">
    <Show when={lease()} keyed fallback={<UnavailableSurface resolution={resolution()} registerClose={props.registerClose} />}>
      {(lease) => <div class="h-full min-h-0" inert={resolution().status === 'pending'} aria-hidden={resolution().status === 'pending' ? 'true' : undefined}>
        <PluginSurfaceBody {...props} target={resolution().status === 'pending' ? lease.target : resolution().target!} visible={props.visible && resolution().status !== 'pending'} />
      </div>}
    </Show>
    <Show when={resolution().status === 'pending' && lease()}>
      <div class="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/95 text-sm text-muted-foreground" role="status" aria-live="polite">
        <Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {i18n.t('uiCopy.plugin.continuity.pending')}
      </div>
    </Show>
  </div>;
}
