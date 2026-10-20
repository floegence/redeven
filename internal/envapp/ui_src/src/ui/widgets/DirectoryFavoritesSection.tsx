import { For, Show, createSignal, createEffect, on } from 'solid-js';
import { DirectoryFavoriteButton, Input, Button, type DirectoryFavorites, type PickerCopy } from '@floegence/floe-webapp-core/ui';
import { FolderOpen } from '@floegence/floe-webapp-core/icons';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

export function DirectoryFavoritesSection(props: { favorites: DirectoryFavorites; copy: PickerCopy; onNavigate: (path: string) => void; onContextMenu: (event: MouseEvent | KeyboardEvent, path: string) => void }) {
  const [filter, setFilter] = createSignal('');
  const [failure, setFailure] = createSignal('');
  createEffect(on(() => props.favorites, () => {setFilter('');setFailure('');}));
  const paths = () => props.favorites.paths.filter(path => path.toLocaleLowerCase().includes(filter().trim().toLocaleLowerCase()));
  const rows: HTMLButtonElement[] = [];
  return <section class="flex min-h-0 shrink-0 flex-col gap-1 border-b border-border/40 pb-2" aria-label={props.copy.favorites}>
    <div class="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground"><span>{props.copy.favorites}</span>
      <Show when={props.favorites.error}><Button size="sm" variant="ghost" onClick={() => { void props.favorites.onRefresh?.(); }}>{props.copy.retry}</Button></Show>
    </div>
    <Show when={props.favorites.paths.length > 5 || filter().length > 0}><Input size="sm" aria-label={props.copy.favoritesFilter} placeholder={props.copy.favoritesFilter} value={filter()} onInput={event => setFilter(event.currentTarget.value)} /></Show>
    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="max-h-44 min-h-8 overflow-y-auto overscroll-contain" aria-busy={props.favorites.loading}>
      <Show when={paths().length} fallback={<p class="px-1 py-2 text-[11px] text-muted-foreground" role="status">{props.favorites.loading ? props.copy.loading : props.favorites.error || (filter() ? props.copy.favoritesNoMatches : props.copy.favoritesEmpty)}</p>}>
        <For each={paths()}>{(path, index) => <div class="flex min-w-0 items-center">
          <button ref={element => { createEffect(() => { rows[index()] = element; }); }} type="button" title={path} aria-label={path}
            class="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 text-left hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => props.onNavigate(path)} onContextMenu={event => props.onContextMenu(event, path)}
            onKeyDown={event => {
              if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { props.onContextMenu(event, path); return; }
              const target = event.key === 'Home' ? 0 : event.key === 'End' ? paths().length - 1 : event.key === 'ArrowDown' ? Math.min(index() + 1, paths().length - 1) : event.key === 'ArrowUp' ? Math.max(0, index() - 1) : undefined;
              if (target !== undefined) { event.preventDefault(); rows[target]?.focus(); rows[target]?.scrollIntoView?.({ block: 'nearest' }); }
            }}>
            <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span class="flex min-w-0 flex-1 flex-col"><span class="truncate text-xs">{path.split('/').filter(Boolean).at(-1) || props.copy.root}</span><span class="truncate text-[10px] text-muted-foreground">{path}</span></span>
          </button>
          <DirectoryFavoriteButton path={path} favorites={props.favorites} copy={props.copy} onError={setFailure} />
        </div>}</For>
      </Show>
    </div>
    <Show when={failure()}><p role="alert" class="text-xs text-error">{failure()}</p></Show>
  </section>;
}
