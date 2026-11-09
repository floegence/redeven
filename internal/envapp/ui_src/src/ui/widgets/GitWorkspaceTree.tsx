import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { Button, PersistentHorizontalScrollbar } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, Minus, MoreHorizontal, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import type { GitListWorkspacePageResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { changeSecondaryPath, workspaceEntryKey, type GitWorkspaceViewSection } from '../utils/gitWorkbench';
import { useI18n } from '../i18n';
import { gitChangePathClass } from './GitChrome';
import { GitChangeStatusPill, GitContentSkeleton, GitPagedTableFooter, gitChangedFilesRowClass } from './GitWorkbenchPrimitives';
import { GIT_WORKBENCH_SCROLL_REGION_PROPS } from './gitWorkbenchScrollRegion';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { buildGitWorkspaceTree, type GitWorkspaceDirectoryLoader, type GitWorkspaceTreeNode } from './gitWorkspaceTreeModel';

interface DirectoryState {
  items: GitWorkspaceChange[];
  loading: boolean;
  failed: boolean;
  initialized: boolean;
  nextOffset: number;
  hasMore: boolean;
}
export interface GitWorkspaceTreeProps {
  scrollMode?: 'viewport' | 'content';
  items: GitWorkspaceChange[];
  section: GitWorkspaceViewSection;
  directoryPath: string;
  generation: unknown;
  filter?: string;
  collapseToken?: number;
  selectedKey?: string;
  itemKey?: (item: GitWorkspaceChange) => string;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: string;
  sectionActionKey?: string;
  loadDirectory?: GitWorkspaceDirectoryLoader;
  onSelect?: (item: GitWorkspaceChange) => void;
  onOpenDirectory?: (path: string) => void;
  onAction?: (item: GitWorkspaceChange) => void;
  onDiscard?: (item: GitWorkspaceChange) => void;
  onContextMenu?: (event: MouseEvent, item: GitWorkspaceChange) => void;
  onContextMenuKey?: (event: KeyboardEvent, item: GitWorkspaceChange) => void;
}

/** Bounded lazy reads retain exact paths and never replace the root inventory. */
export function GitWorkspaceTree(props: GitWorkspaceTreeProps) {
  const i18n = useI18n();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set<string>());
  const [pages, setPages] = createSignal<Record<string, DirectoryState>>({});
  const [focusKey, setFocusKey] = createSignal('');
  let epoch = 0;
  onCleanup(() => { epoch++; });
  createEffect(on(() => [props.generation, props.section, props.directoryPath] as const, () => { epoch++; setPages({}); setFocusKey(''); }));
  createEffect(on(() => [props.section, props.directoryPath] as const, () => { setExpanded(new Set<string>()); setFocusKey(''); }));
  createEffect(on(() => props.collapseToken, () => { setExpanded(new Set<string>()); setFocusKey(''); }, { defer: true }));
  const itemKey = (item: GitWorkspaceChange) => props.itemKey?.(item) ?? workspaceEntryKey(item);
  const tree = createMemo(() => buildGitWorkspaceTree(props.items, props.directoryPath));
  const query = () => props.filter?.trim().toLowerCase() ?? '';
  // Unread directories remain navigable during filtering; a filter never scans the repository.
  const matches = (node: GitWorkspaceTreeNode): boolean => !query() || node.path.toLowerCase().includes(query()) || Boolean(node.directory && node.item) || node.children.some(matches);
  const open = (node: GitWorkspaceTreeNode) => expanded().has(node.path) || Boolean(query() && !node.item && node.children.some(matches));
  const load = async (path: string, append = false) => {
    const previous = pages()[path];
    if (!props.loadDirectory || previous?.loading || (!append && previous?.initialized && !previous.failed)) return;
    const generation = epoch;
    setPages(all => ({ ...all, [path]: { items: previous?.items ?? [], loading: true, failed: false, initialized: previous?.initialized ?? false, nextOffset: previous?.nextOffset ?? 0, hasMore: previous?.hasMore ?? false } }));
    try {
      const result: GitListWorkspacePageResponse | undefined = await props.loadDirectory(props.section, path, append ? previous?.nextOffset ?? 0 : 0);
      if (generation !== epoch) return;
      setPages(all => ({ ...all, [path]: result ? { items: append ? [...(previous?.items ?? []), ...result.items] : result.items, loading: false, failed: false, initialized: true, nextOffset: result.nextOffset ?? 0, hasMore: Boolean(result.hasMore) } : { ...all[path], loading: false, failed: true } }));
    } catch {
      if (generation === epoch) setPages(all => ({ ...all, [path]: { ...all[path], loading: false, failed: true } }));
    }
  };
  const toggle = (node: GitWorkspaceTreeNode) => {
    setExpanded(current => { const next = new Set(current); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next; });
    if (open(node) && node.item && !props.loadDirectory) props.onOpenDirectory?.(node.path);
  };
  const focus = (button?: HTMLButtonElement) => {
    if (!button) return;
    setFocusKey(button.dataset.gitTreeKey ?? '');
    button.focus({ preventScroll: true });
    button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const navigate = (event: KeyboardEvent, node: GitWorkspaceTreeNode) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const buttons = Array.from(viewport()?.querySelectorAll<HTMLButtonElement>('[data-git-tree-select]') ?? []);
    const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown': next = buttons[Math.min(buttons.length - 1, index + 1)]; break;
      case 'ArrowUp': next = buttons[Math.max(0, index - 1)]; break;
      case 'Home': next = buttons[0]; break;
      case 'End': next = buttons.at(-1); break;
      case 'ArrowRight':
        if (!node.directory) return;
        if (!open(node)) toggle(node); else next = buttons[index + 1];
        break;
      case 'ArrowLeft':
        if (node.directory && open(node)) toggle(node);
        else next = buttons.find(button => button.dataset.gitTreeSelect === node.path.slice(0, node.path.lastIndexOf('/')));
        break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); focus(next);
  };
  createEffect(on(query, () => setFocusKey(''), { defer: true }));
  const renderNode = (node: GitWorkspaceTreeNode, depth: number) => {
    const page = () => pages()[node.path];
    const children = createMemo(() => node.item ? buildGitWorkspaceTree(page()?.items ?? [], node.path) : node.children);
    const active = () => Boolean(node.item && props.selectedKey === itemKey(node.item));
    const busy = () => Boolean(props.busyWorkspaceAction && (props.busyWorkspaceKey === (node.item && workspaceEntryKey(node.item)) || props.busyWorkspaceKey === props.sectionActionKey));
    const discardable = () => node.item && ['changes', 'unstaged', 'untracked'].includes(node.item.section ?? '');
    createEffect(() => { if (node.directory && node.item && open(node) && !page()?.initialized && !page()?.loading && !page()?.failed) void load(node.path); });
    return (
      <Show when={matches(node)}>
        <div role="treeitem" aria-level={depth + 1} aria-expanded={node.directory ? open(node) : undefined} aria-selected={active()} data-git-tree-path={node.path}>
          <div class={`${gitChangedFilesRowClass(active())} git-workspace-tree__row`} style={{ '--git-tree-depth': depth }} data-git-changes-context-target="item"
            on:contextmenu={event => { if (node.item) { event.stopPropagation(); props.onContextMenu?.(event, node.item); } }}
            onKeyDown={event => { if (node.item && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.stopPropagation(); props.onContextMenuKey?.(event, node.item); } }}>
            <button type="button" class="git-workspace-tree__identity" aria-expanded={node.directory ? open(node) : undefined} data-git-tree-select={node.path} data-git-tree-key={node.key} title={node.item ? changeSecondaryPath(node.item) || node.path : node.path}
              tabIndex={focusKey() ? focusKey() === node.key ? 0 : -1 : tree().find(matches)?.key === node.key ? 0 : -1}
              onFocus={() => setFocusKey(node.key)}
              onClick={() => node.directory ? toggle(node) : node.item && props.onSelect?.(node.item)}
              onKeyDown={event => navigate(event, node)}>
              <span class="git-workspace-tree__chevron"><Show when={node.directory}><ChevronRight class={`size-3 ${open(node) ? 'rotate-90' : ''}`} /></Show></span>
              <FileItemIcon size={14} open={node.directory && open(node)} item={{ name: node.label, type: node.directory ? 'folder' : 'file' }} class="size-3.5 shrink-0" />
              <span class={node.directory ? '' : gitChangePathClass(node.item?.changeType)}>{node.label}</span>
            </button>
            <Show when={!node.directory && node.item}><GitChangeStatusPill compact change={node.item?.changeType} /></Show>
            <Show when={node.item && (props.onAction || props.onDiscard || props.onContextMenu)}>
              <span class="git-workspace-tree__actions">
                <Show when={props.onAction}><Button size="icon" variant="ghost" disabled={busy()} loading={busy() && props.busyWorkspaceAction !== 'discard'} icon={props.section === 'staged' ? Minus : Plus} aria-label={i18n.t(props.section === 'staged' ? 'git.changes.unstage' : 'git.changes.stageWithPlus')} onClick={() => props.onAction?.(node.item!)} /></Show>
                <Show when={discardable() && props.onDiscard}><Button size="icon" variant="ghost" class="text-destructive" disabled={busy()} loading={busy() && props.busyWorkspaceAction === 'discard'} icon={Trash} aria-label={i18n.t('git.changes.discard')} onClick={() => props.onDiscard?.(node.item!)} /></Show>
                <Show when={props.onContextMenu}><Button size="icon" variant="ghost" icon={MoreHorizontal} aria-label={i18n.t('git.common.moreActions')} onClick={event => props.onContextMenu?.(event, node.item!)} /></Show>
              </span>
            </Show>
          </div>
          <Show when={node.directory && open(node)}>
            <div role="group">
              <For each={children()}>{child => renderNode(child, depth + 1)}</For>
              <Show when={page()?.loading && !page()?.initialized}><GitContentSkeleton variant="file-rail" rows={2} label={i18n.t('git.changes.loadingWorkspaceChanges')} /></Show>
              <Show when={page()?.failed}><div class="git-workspace-tree__recovery" role="alert"><span>{i18n.t('git.tree.loadFailed')}</span><Button size="xs" variant="ghost" onClick={() => void load(node.path, Boolean(page()?.initialized))}>{i18n.t('common.actions.retry')}</Button></div></Show>
              <Show when={page()?.hasMore}><GitPagedTableFooter summary={null} hasMore loading={page()?.loading} onLoadMore={() => void load(node.path, true)} loadingStatus={i18n.t('git.changes.loadingNextPage')} /></Show>
            </div>
          </Show>
        </div>
      </Show>
    );
  };
  return (
    <div class="git-workspace-tree" data-scroll-mode={props.scrollMode ?? 'viewport'}>
      <div ref={setViewport} {...GIT_WORKBENCH_SCROLL_REGION_PROPS} class="git-workspace-tree__viewport" data-git-tree-scroll>
        <div role="tree" aria-label={i18n.t('uiCopy.git.changedFiles')} class="git-workspace-tree__content"><For each={tree()}>{node => renderNode(node, 0)}</For></div>
      </div>
      <Show when={props.scrollMode !== 'content'}><PersistentHorizontalScrollbar viewport={viewport()} {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} aria-label={i18n.t('git.tree.horizontalScroll')} /></Show>
    </div>
  );
}
