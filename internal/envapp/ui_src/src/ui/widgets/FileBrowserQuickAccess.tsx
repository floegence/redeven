import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button, Input, type DirectoryFavorites, type PickerCopy } from '@floegence/floe-webapp-core/ui';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import { Tooltip } from '../primitives/Tooltip';
import { useI18n } from '../i18n';
import { matchFilesystemRoot, type NormalizedFilesystemRoot } from '../utils/filesystemRoots';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

interface FileBrowserQuickAccessProps {
  roots?: readonly NormalizedFilesystemRoot[];
  favorites?: DirectoryFavorites;
  copy: PickerCopy;
  currentPath?: string;
  initializing?: boolean;
  onNavigate: (path: string) => void;
  onContextMenu: (event: MouseEvent | KeyboardEvent, path: string) => void;
}

/** Files composes authoritative roots and personal favorites over published Floe controls. */
export function FileBrowserQuickAccess(props: FileBrowserQuickAccessProps) {
  const i18n = useI18n();
  const [filter, setFilter] = createSignal('');
  const [filterHeight, setFilterHeight] = createSignal<number>();
  let viewport: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;
  let unfilteredScrollTop = 0;
  const rows = new Map<string, HTMLButtonElement>();
  const rootsByPath = createMemo(() => new Map((props.roots ?? []).map(root => [root.pathAbs, root])));
  const favoritePaths = createMemo(() => new Set(props.favorites?.paths ?? []));
  const paths = createMemo(() => [...new Set([...rootsByPath().keys(), ...favoritePaths()])]);
  const filteredPaths = createMemo(() => {
    const query = filter().trim().toLocaleLowerCase();
    return paths().filter(path => ((rootsByPath().get(path)?.label ?? '') + ' ' + path).toLocaleLowerCase().includes(query));
  });
  const activeRoot = createMemo(() => matchFilesystemRoot(props.currentPath ?? '', props.roots ?? []));
  const showFilter = () => paths().length > 5 || filter().length > 0;

  const focusPath = (path: string | undefined) => {
    if (!path || !viewport) return;
    const row = rows.get(path);
    if (!row) return;
    row.focus({ preventScroll: true });
    // Offset coordinates remain in CSS pixels in scaled Workbench windows.
    const item = row.closest<HTMLElement>('[data-file-shortcut-path]');
    if (!item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight;
  };
  const updateFilter = (value: string) => {
    if (!filter() && value && viewport) {
      setFilterHeight(viewport.clientHeight);
      unfilteredScrollTop = viewport.scrollTop;
    }
    setFilter(value);
    if (!value) setFilterHeight(undefined);
    if (viewport) viewport.scrollTop = value ? 0 : unfilteredScrollTop;
  };
  const onRowKeyDown = (event: KeyboardEvent, path: string) => {
    if (event.isComposing) return;
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { props.onContextMenu(event, path); return; }
    const list = filteredPaths();
    const index = list.indexOf(path);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
      : event.key === 'ArrowDown' ? Math.min(index + 1, list.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : undefined;
    if (next !== undefined) { event.preventDefault(); focusPath(list[next]); }
    if (event.key === 'Escape' && showFilter()) { event.preventDefault(); event.stopPropagation(); input?.focus({ preventScroll: true }); }
  };

  return <section data-filesystem-locations data-floe-reload-omit
    aria-label={i18n.t('files.quickAccess')} aria-hidden={props.initializing || undefined} inert={props.initializing}
    class={cn('flex min-h-0 max-h-[min(16rem,45%)] shrink-0 flex-col border-b border-sidebar-border/70 pb-1', props.initializing && 'invisible')}>
    <Show when={showFilter()}>
      <Input ref={element => { input = element; }} size="sm" class="mb-1 shrink-0"
        aria-label={i18n.t('files.filterLocations')} placeholder={i18n.t('files.filterLocations')} value={filter()}
        onInput={event => updateFilter(event.currentTarget.value)} onKeyDown={event => {
          if (event.isComposing) return;
          if (event.key === 'Escape' && filter()) { event.preventDefault(); event.stopPropagation(); updateFilter(''); }
          if (event.key === 'ArrowDown' || event.key === 'Enter') {
            const first = filteredPaths()[0];
            if (first) { event.preventDefault(); focusPath(first); if (event.key === 'Enter') props.onNavigate(first); }
          }
        }} />
    </Show>
    <div ref={element => { viewport = element; }} {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
      data-testid="file-shortcuts-scroll-region" aria-busy={Boolean(props.favorites?.loading)}
      class="relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]"
      style={{ height: filterHeight() === undefined ? undefined : filterHeight() + 'px' }}>
      <For each={filteredPaths()}>{path => {
        const root = () => rootsByPath().get(path);
        const active = () => root() ? activeRoot()?.id === root()?.id : props.currentPath === path;
        return <div {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
          data-file-shortcut-path={path}
          data-filesystem-root-id={root()?.id} data-filesystem-root-path={root() ? path : undefined}
          data-directory-favorite-path={favoritePaths().has(path) ? path : undefined}
          onContextMenu={event => props.onContextMenu(event, path)}
          class={cn('group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors',
            active() ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-foreground hover:bg-sidebar-accent/60')}>
          <Tooltip content={path} placement="right" anchorClass="min-w-0 flex-1">
            <button ref={element => { rows.set(path, element); onCleanup(() => { rows.delete(path); }); }} type="button" title={path} aria-label={root()?.label ?? path}
              aria-current={active() ? 'page' : undefined}
              class="flex w-full min-w-0 cursor-pointer items-center gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
              onClick={() => props.onNavigate(path)} onKeyDown={event => onRowKeyDown(event, path)}>
              <span class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                <FileItemIcon size={14} item={{ name: root()?.label ?? path, type: 'folder' }} class="h-3.5 w-3.5" />
              </span>
              <Show when={root()} fallback={<span class="flex min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                <span data-directory-favorite-parent class="min-w-0 truncate">{path.slice(0, path.lastIndexOf('/'))}</span>
                <span data-directory-favorite-name class="min-w-0 max-w-full shrink-0 truncate">{path.slice(path.lastIndexOf('/'))}</span>
              </span>}>{entry => <span class="min-w-0 flex-1 truncate">{entry().label}</span>}</Show>
            </button>
          </Tooltip>
          <Show when={props.favorites}><button type="button" data-directory-favorite-menu aria-label={i18n.t('common.actions.more') + ': ' + path}
            class="shrink-0 cursor-pointer rounded p-1 text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            onClick={event => props.onContextMenu(event, path)}><MoreHorizontal class="h-3.5 w-3.5" /></button></Show>
          <Show when={root()}>{entry => <span data-filesystem-root-write-badge={entry().id}
            class={cn('h-5 shrink-0 rounded-md border px-1.5 text-[8px] font-semibold leading-4 shadow-sm',
              entry().permissions.write ? 'border-primary/35 bg-primary/[0.16] text-primary shadow-primary/10' : 'border-border/50 bg-muted/60 text-muted-foreground')}
            title={i18n.t('files.rootAccessTitle', { label: entry().label, mode: entry().permissions.write ? i18n.t('files.readWriteAccess') : i18n.t('files.readOnlyAccess') })}>
            {entry().permissions.write ? i18n.t('files.readWriteBadge') : i18n.t('files.readOnlyBadge')}
          </span>}</Show>
        </div>;
      }}</For>
      <Show when={!filteredPaths().length && !props.favorites?.loading && !props.favorites?.error}>
        <p class="px-1 py-2 text-[11px] text-muted-foreground" role="status">{filter() ? i18n.t('files.noMatchingLocations') : props.copy.favoritesEmpty}</p>
      </Show>
      <Show when={props.favorites?.loading && !paths().length}>
        <p class="px-1 py-2 text-[11px] text-muted-foreground" role="status">{props.copy.loading}</p>
      </Show>
      <Show when={props.favorites?.error}><div class="px-1 py-1 text-[11px] text-muted-foreground">
        <p role="status">{props.favorites?.error}</p>
        <Button size="sm" variant="ghost" onClick={() => { void props.favorites?.onRefresh?.(); }}>{props.copy.retry}</Button>
      </div></Show>
    </div>
  </section>;
}
