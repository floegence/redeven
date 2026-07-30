import { cn } from '@floegence/floe-webapp-core';
import { Grid3x3, Settings } from '@floegence/floe-webapp-core/icons';
import { Show, createSignal, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import type { PluginInventoryItem } from './pluginTypes';
import { pluginLifecycleLabel, pluginTrustLabel } from './pluginPresentation';

export type PluginIconSize = 'row' | 'card' | 'detail' | 'launcher';

export function PluginIcon(props: {
  item: PluginInventoryItem;
  size?: PluginIconSize;
  class?: string;
}): JSX.Element {
  const [imageFailed, setImageFailed] = createSignal(false);
  const size = () => props.size ?? 'row';
  const iconClass = () => size() === 'launcher'
    ? 'h-7 w-7'
    : size() === 'detail' || size() === 'card'
      ? 'h-5 w-5'
      : 'h-4 w-4';
  return (
    <span
      class={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border bg-muted text-foreground shadow-sm',
        size() === 'launcher' && 'h-16 w-16 rounded-2xl',
        size() === 'detail' && 'h-12 w-12 rounded-xl',
        size() === 'card' && 'h-12 w-12 rounded-lg',
        size() === 'row' && 'h-10 w-10 rounded-lg',
        props.class,
      )}
    >
      <Show when={props.item.iconURL && !imageFailed()} fallback={(
        props.item.iconFallback === 'containers'
          ? <Grid3x3 class={iconClass()} />
          : <Settings class={iconClass()} />
      )}>
        <img
          src={props.item.iconURL ?? ''}
          alt=""
          class="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      </Show>
    </span>
  );
}

export function PluginUpdateBadge(props: { item: PluginInventoryItem; class?: string }): JSX.Element {
  const i18n = useI18n();
  return (
    <Show when={props.item.lifecycleState === 'update_available'}>
      <span
        aria-hidden="true"
        data-plugin-update-badge
        class={cn(
          'pointer-events-none absolute -top-1 right-3 inline-flex h-4 min-w-7 items-center justify-center rounded-full border border-background bg-primary px-1.5 text-[9px] font-bold leading-none text-primary-foreground shadow-sm transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none',
          props.class,
        )}
      >
        {i18n.t('uiCopy.plugin.launcherUpdateBadge')}
      </span>
    </Show>
  );
}

export function PluginStatusBadge(props: { item: PluginInventoryItem; class?: string }): JSX.Element {
  const i18n = useI18n();
  const tone = () => {
    if (props.item.lifecycleState === 'enabled') {
      return 'bg-[var(--redeven-status-success-soft)] text-[var(--redeven-status-success-foreground)]';
    }
    if (props.item.lifecycleState === 'needs_attention') {
      return 'bg-[var(--redeven-status-warning-soft)] text-[var(--redeven-status-warning-foreground)]';
    }
    if (props.item.lifecycleState === 'update_available') {
      return 'bg-[var(--redeven-status-info-soft)] text-[var(--redeven-status-info-foreground)]';
    }
    return 'bg-muted text-muted-foreground';
  };
  return (
    <span class={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold transition-[background-color,color,transform] duration-150 ease-out motion-reduce:transition-none', tone(), props.class)}>
      {pluginLifecycleLabel(props.item, i18n)}
    </span>
  );
}

export function PluginTrustBadge(props: { item: PluginInventoryItem; class?: string }): JSX.Element {
  const i18n = useI18n();
  const tone = () => {
    if (props.item.trustBadge === 'official' || props.item.trustBadge === 'verified') {
      return 'bg-primary/10 text-primary';
    }
    if (props.item.trustBadge === 'blocked' || props.item.trustBadge === 'revoked') {
      return 'bg-destructive/10 text-destructive';
    }
    return 'bg-[var(--redeven-status-warning-soft)] text-[var(--redeven-status-warning-foreground)]';
  };
  return (
    <span class={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold transition-[background-color,color,transform] duration-150 ease-out motion-reduce:transition-none', tone(), props.class)}>
      {pluginTrustLabel(props.item, i18n)}
    </span>
  );
}

export function PluginIdentityHeader(props: {
  item: PluginInventoryItem;
  description?: boolean;
  class?: string;
  headingRef?: (element: HTMLHeadingElement) => void;
}): JSX.Element {
  return (
    <div class={cn('flex min-w-0 items-start gap-3', props.class)} data-plugin-identity>
      <PluginIcon item={props.item} size="detail" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <h2
            ref={props.headingRef}
            tabIndex={props.headingRef ? -1 : undefined}
            data-plugin-center-detail-heading={props.headingRef ? '' : undefined}
            class="min-w-0 truncate text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {props.item.displayName}
          </h2>
          <PluginTrustBadge item={props.item} />
          <PluginStatusBadge item={props.item} />
        </div>
        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span class="truncate">{props.item.publisher}</span>
          <Show when={props.item.version}><span>v{props.item.version}</span></Show>
        </div>
        <Show when={props.description}>
          <p class="mt-1.5 text-xs leading-5 text-muted-foreground">{props.item.description}</p>
        </Show>
      </div>
    </div>
  );
}
