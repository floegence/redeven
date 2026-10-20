import { For, Show, createSignal, createEffect, on } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Input, Button, type DirectoryFavorites, type PickerCopy } from '@floegence/floe-webapp-core/ui';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import { Tooltip } from '../primitives/Tooltip';
import { useI18n } from '../i18n';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

interface DirectoryFavoritesSectionProps {
  favorites: DirectoryFavorites;
  copy: PickerCopy;
  currentPath?: string;
  onNavigate: (path: string) => void;
  onContextMenu: (event: MouseEvent | KeyboardEvent, path: string) => void;
}

export function DirectoryFavoritesSection(props: DirectoryFavoritesSectionProps) {
  const i18n = useI18n();
  const [filter, setFilter] = createSignal('');
  createEffect(on(() => props.favorites, () => setFilter('')));
  const paths = () => props.favorites.paths.filter(path => path.toLocaleLowerCase().includes(filter().trim().toLocaleLowerCase()));
  const rows: HTMLButtonElement[] = [];
  return <section class="flex min-h-0 shrink-0 flex-col" aria-label={props.copy.favorites}>
    <Show when={props.favorites.paths.length > 5 || filter().length > 0}><Input size="sm" aria-label={props.copy.favoritesFilter} placeholder={props.copy.favoritesFilter} value={filter()} onInput={event => setFilter(event.currentTarget.value)} /></Show>
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="max-h-44 overflow-x-hidden overflow-y-auto overscroll-contain" aria-busy={props.favorites.loading}>
      <Show when={paths().length} fallback={<p class="px-1 py-2 text-[11px] text-muted-foreground" role="status">{props.favorites.loading ? props.copy.loading : props.favorites.error || (filter() ? props.copy.favoritesNoMatches : props.copy.favoritesEmpty)}</p>}>
        <For each={paths()}>{(path, index) => <div
          {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
          data-directory-favorite-path={path}
          onContextMenu={event => props.onContextMenu(event, path)}
          class={cn('group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors',
            props.currentPath === path ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-foreground hover:bg-sidebar-accent/60')}>
          <Tooltip content={path} placement="right" anchorClass="min-w-0 flex-1">
            <button ref={element => { createEffect(() => { rows[index()] = element; }); }} type="button" title={path} aria-label={path}
              aria-current={props.currentPath === path ? 'page' : undefined}
              class="flex w-full min-w-0 cursor-pointer items-center gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
              onClick={() => props.onNavigate(path)}
              onKeyDown={event => {
                if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { props.onContextMenu(event, path); return; }
                const target = event.key === 'Home' ? 0 : event.key === 'End' ? paths().length - 1 : event.key === 'ArrowDown' ? Math.min(index() + 1, paths().length - 1) : event.key === 'ArrowUp' ? Math.max(0, index() - 1) : undefined;
                if (target !== undefined) { event.preventDefault(); rows[target]?.focus(); rows[target]?.scrollIntoView?.({ block: 'nearest' }); }
              }}>
              <span class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                <FileItemIcon size={14} item={{ name: path, type: 'folder' }} class="h-3.5 w-3.5" />
              </span>
              <span class="flex min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                <span data-directory-favorite-parent class="min-w-0 truncate">{path.slice(0, path.lastIndexOf('/'))}</span>
                <span data-directory-favorite-name class="min-w-0 max-w-full shrink-0 truncate">{path.slice(path.lastIndexOf('/'))}</span>
              </span>
            </button>
          </Tooltip>
          <button type="button" data-directory-favorite-menu aria-label={i18n.t('common.actions.more') + ': ' + path}
            class="shrink-0 cursor-pointer rounded p-1 text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            onClick={event => props.onContextMenu(event, path)}><MoreHorizontal class="h-3.5 w-3.5" /></button>
        </div>}</For>
      </Show>
    </div>
    <Show when={props.favorites.error}><Button size="sm" variant="ghost" onClick={() => { void props.favorites.onRefresh?.(); }}>{props.copy.retry}</Button></Show>
  </section>;
}
