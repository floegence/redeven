import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button, Input, type DirectoryFavorites, type PickerCopy } from '@floegence/floe-webapp-core/ui';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Loader2, MoreHorizontal } from '@floegence/floe-webapp-core/icons';
import { Tooltip } from '../primitives/Tooltip';
import { useI18n } from '../i18n';
import type { NormalizedFilesystemRoot } from '../utils/filesystemRoots';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

interface FileBrowserQuickAccessProps {
  roots?: readonly NormalizedFilesystemRoot[];
  favorites?: DirectoryFavorites;
  copy: PickerCopy;
  currentPath?: string;
  pendingNavigationPath?: string;
  initializing?: boolean;
  onNavigate: (path: string) => void;
  onContextMenu: (event: MouseEvent | KeyboardEvent, path: string) => void;
}

/** Files composes authoritative roots and personal favorites over published Floe controls. */
export function FileBrowserQuickAccess(props: FileBrowserQuickAccessProps) {
  const i18n = useI18n();
  const [filter, setFilter] = createSignal('');
  const [filterHeight, setFilterHeight] = createSignal<number>();
  const [progressPath, setProgressPath] = createSignal('');
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
  const activePath = () => props.pendingNavigationPath || props.currentPath;
  const showFilter = () => paths().length > 5 || filter().length > 0;

  // Selection and accessibility update immediately; fast revalidation should
  // not replace the folder icon for a single frame. Retire superseded timers.
  createEffect(() => {
    const path = props.pendingNavigationPath;
    setProgressPath('');
    if (!path) return;
    const timer = window.setTimeout(() => setProgressPath(path), 150);
    onCleanup(() => window.clearTimeout(timer));
  });

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
        const active = () => activePath() === path;
        const pending = () => props.pendingNavigationPath === path;
        return <div {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
          data-file-shortcut-path={path}
          data-file-shortcut-active={active()}
          data-filesystem-root-id={root()?.id} data-filesystem-root-path={root() ? path : undefined}
          data-directory-favorite-path={favoritePaths().has(path) ? path : undefined}
          onContextMenu={event => props.onContextMenu(event, path)}
          class={cn('group relative flex min-h-8 min-w-0 items-stretch rounded-md text-xs font-normal',
            active() ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-foreground hover:bg-sidebar-accent/30')}>
          <Show when={active()}><span aria-hidden="true" class="pointer-events-none absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" /></Show>
          <Tooltip content={path} placement="right" anchorClass="flex min-w-0 flex-1 items-stretch">
            <button ref={element => { rows.set(path, element); onCleanup(() => { rows.delete(path); }); }} type="button" title={path} aria-label={root()?.label ?? path}
              aria-current={active() && props.currentPath === path ? 'page' : undefined}
              aria-busy={pending() || undefined}
              class="flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
              onClick={() => props.onNavigate(path)} onKeyDown={event => onRowKeyDown(event, path)}>
              <span class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                <Show when={pending() && progressPath() === path} fallback={<FileItemIcon size={14} item={{ name: root()?.label ?? path, type: 'folder' }} class="h-3.5 w-3.5" />}>
                  <Loader2 aria-hidden="true" class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                </Show>
              </span>
              <Show when={root()} fallback={<span data-file-shortcut-label class="flex min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                <span data-directory-favorite-parent class="min-w-0 truncate">{path.slice(0, path.lastIndexOf('/'))}</span>
                <span data-directory-favorite-name class="min-w-0 max-w-full shrink-0 truncate">{path.slice(path.lastIndexOf('/'))}</span>
              </span>}>{entry => <span data-file-shortcut-label class="min-w-0 flex-1 truncate">{entry().label}</span>}</Show>
              <Show when={root()}>{entry => <span data-filesystem-root-write-badge={entry().id}
                class={cn('h-5 shrink-0 rounded-md border px-1.5 text-[8px] font-semibold leading-4 shadow-sm',
                  entry().permissions.write ? 'border-primary/35 bg-primary/[0.16] text-primary shadow-primary/10' : 'border-border/50 bg-muted/60 text-muted-foreground')}
                title={i18n.t('files.rootAccessTitle', { label: entry().label, mode: entry().permissions.write ? i18n.t('files.readWriteAccess') : i18n.t('files.readOnlyAccess') })}>
                {entry().permissions.write ? i18n.t('files.readWriteBadge') : i18n.t('files.readOnlyBadge')}
              </span>}</Show>
            </button>
          </Tooltip>
          <Show when={props.favorites}><button type="button" data-directory-favorite-menu aria-label={i18n.t('common.actions.more') + ': ' + path}
            class="flex min-h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            onClick={event => props.onContextMenu(event, path)}><MoreHorizontal class="h-3.5 w-3.5" /></button></Show>
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
