import { cn } from '@floegence/floe-webapp-core';
import { Tag, type TagVariant } from '@floegence/floe-webapp-core/ui';
import { Settings } from '@floegence/floe-webapp-core/icons';
import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import type { PluginInventoryItem, PluginProcessStatusState } from './pluginTypes';
import { pluginLifecycleLabel, pluginSourceLabel } from './pluginPresentation';
import { resolveAuthorPresentation, resolvePluginPresentation } from './officialPluginCatalog';
import { acquireCachedPluginIcon, loadPluginIcon, type LoadedPluginIcon, type PluginIconLoadState } from './pluginIconLoader';

export type PluginIconSize = 'row' | 'card' | 'detail' | 'launcher' | 'dock';

export function PluginIcon(props: {
  item: Pick<PluginInventoryItem, 'iconURL'>;
  size?: PluginIconSize;
  class?: string;
}): JSX.Element {
  const [loadState, setLoadState] = createSignal<'idle' | PluginIconLoadState | 'ready' | 'failed'>('idle');
  const [loadedIconURL, setLoadedIconURL] = createSignal<string>();
  const size = () => props.size ?? 'row';
  const iconURL = () => props.item.iconURL;
  const iconClass = () => size() === 'launcher' || size() === 'dock'
    ? 'h-7 w-7'
    : size() === 'detail' || size() === 'card'
      ? 'h-5 w-5'
      : 'h-4 w-4';
  createEffect(() => {
    let current = true;
    let request: AbortController | undefined;
    let releaseLoadedIcon: (() => void) | undefined;
    onCleanup(() => {
      current = false;
      request?.abort();
      releaseLoadedIcon?.();
    });
    const sourceURL = iconURL();
    setLoadedIconURL(undefined);
    if (!sourceURL) {
      setLoadState('failed');
      return;
    }
    const cached = acquireCachedPluginIcon(sourceURL);
    if (cached) {
      setLoadedIconURL(cached.url);
      setLoadState('ready');
      releaseLoadedIcon = cached.release;
      return;
    }
    request = new AbortController();
    setLoadState('loading');
    void loadPluginIcon(sourceURL, {
      signal: request.signal,
      onState: (state) => {
        if (current) setLoadState(state);
      },
    }).then((icon: LoadedPluginIcon) => {
      if (!current) {
        icon.release();
        return;
      }
      setLoadedIconURL(icon.url);
      setLoadState('ready');
      releaseLoadedIcon = icon.release;
    }).catch(() => {
      if (current) setLoadState('failed');
    });
  });
  const showingFallback = () => !iconURL() || loadState() === 'failed';
  const showingPlaceholder = () => Boolean(iconURL()) && !loadedIconURL() && !showingFallback();
  return (
    <span
      class={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden bg-[var(--floe-well)] text-foreground',
        (size() === 'launcher' || size() === 'dock') && 'border bg-muted shadow-sm',
        size() === 'launcher' && 'h-16 w-16 rounded-2xl',
        size() === 'dock' && 'h-[42px] w-[42px] rounded-xl',
        size() === 'detail' && 'h-10 w-10 rounded-lg',
        size() === 'card' && 'h-8 w-8 rounded-lg',
        size() === 'row' && 'h-10 w-10 rounded-lg',
        props.class,
      )}
      aria-busy={showingPlaceholder() ? 'true' : undefined}
    >
      <Show when={showingFallback()}>
        <Settings class={iconClass()} />
      </Show>
      <Show when={showingPlaceholder()}>
        <span aria-hidden="true" class="absolute inset-1 animate-pulse rounded-md bg-muted-foreground/15 motion-reduce:animate-none" />
      </Show>
      <Show when={loadedIconURL()}>
        <img
          src={loadedIconURL()}
          alt=""
          draggable={false}
          class="absolute inset-0 h-full w-full object-cover"
          onDragStart={(event) => event.preventDefault()}
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
  const tone = (): TagVariant => {
    if (props.item.lifecycleState === 'enabled') {
      return 'success';
    }
    if (props.item.lifecycleState === 'needs_attention') {
      return 'warning';
    }
    if (props.item.lifecycleState === 'update_available') {
      return 'info';
    }
    return 'neutral';
  };
  return (
    <Tag variant={tone()} size="sm" class={props.class}>
      {pluginLifecycleLabel(props.item, i18n)}
    </Tag>
  );
}

export function PluginProcessStatusBadge(props: { state: PluginProcessStatusState; class?: string }): JSX.Element {
  const i18n = useI18n();
  const tone = (): TagVariant => {
    if (props.state === 'running') return 'success';
    if (props.state === 'blocked' || props.state === 'crashed') return 'error';
    if (props.state === 'stream_gap') return 'warning';
    if (props.state === 'starting') return 'info';
    return 'neutral';
  };
  const label = () => {
    switch (props.state) {
      case 'starting': return i18n.t('uiCopy.plugin.external.processStatus.starting');
      case 'running': return i18n.t('uiCopy.plugin.external.processStatus.running');
      case 'exited': return i18n.t('uiCopy.plugin.external.processStatus.exited');
      case 'blocked': return i18n.t('uiCopy.plugin.external.processStatus.blocked');
      case 'crashed': return i18n.t('uiCopy.plugin.external.processStatus.crashed');
      case 'stream_gap': return i18n.t('uiCopy.plugin.external.processStatus.streamGap');
    }
  };
  return (
    <Tag
      variant={tone()} size="sm" dot
      data-plugin-process-status={props.state}
      class={props.class}
    >
      {label()}
    </Tag>
  );
}

export function PluginSourceBadge(props: { item: PluginInventoryItem; class?: string }): JSX.Element {
  const i18n = useI18n();
  const tone = (): TagVariant => props.item.sourceKind === 'official' ? 'primary' : 'neutral';
  return (
    <Tag variant={tone()} size="sm" class={props.class}>
      {pluginSourceLabel(props.item, i18n)}
    </Tag>
  );
}

export function PluginIdentityHeader(props: {
  item: PluginInventoryItem;
  description?: boolean;
  review?: boolean;
  version?: JSX.Element;
  class?: string;
  headingId?: string;
  headingRef?: (element: HTMLHeadingElement) => void;
}): JSX.Element {
  const i18n = useI18n();
  const presentation = () => props.item.presentation
    ? resolveAuthorPresentation(props.item.presentation, i18n.locale())
    : !props.item.pluginInstanceID && props.item.officialCatalog
      ? resolvePluginPresentation(props.item.officialCatalog, i18n.locale())
      : undefined;
  const displayName = () => presentation()?.plugin_name ?? props.item.displayName;
  const publisher = () => presentation()?.publisher_name ?? props.item.publisher;
  const summary = () => presentation()?.summary ?? props.item.description;
  return (
    <div class={cn('flex min-w-0 items-start gap-3', props.class)} data-plugin-identity>
      <PluginIcon item={props.item} size="detail" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <h2
            id={props.headingId}
            ref={props.headingRef}
            tabIndex={props.headingRef ? -1 : undefined}
            data-plugin-center-detail-heading={props.headingRef ? '' : undefined}
            lang={presentation()?.resolved_locale}
            dir="auto"
            class={cn('w-full min-w-0 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', props.review ? 'break-words' : 'truncate')}
          >
            {displayName()}
          </h2>
          <Show when={!props.review}><PluginSourceBadge item={props.item} /><PluginStatusBadge item={props.item} /></Show>
        </div>
        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span class="truncate" lang={presentation()?.resolved_locale} dir="auto">{publisher()}</span>
          <Show when={props.version} fallback={<Show when={props.item.version}><span>v{props.item.version}</span></Show>}>{props.version}</Show>
        </div>
        <Show when={props.description}>
          <p class="mt-1.5 text-xs leading-5 text-muted-foreground" lang={presentation()?.resolved_locale} dir="auto">{summary()}</p>
        </Show>
      </div>
    </div>
  );
}
