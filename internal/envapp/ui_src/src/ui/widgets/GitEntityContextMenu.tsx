import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';

import { useI18n } from '../i18n';
import {
  FLOATING_CONTEXT_MENU_WIDTH_PX,
  FloatingContextMenu,
  type FloatingContextMenuItem,
} from './FloatingContextMenu';

export const GIT_CONTEXT_ACTION_GROUPS = [
  'assistant',
  'inspect',
  'navigate',
  'modify',
  'clipboard',
  'destructive',
] as const;

export type GitContextActionGroup = (typeof GIT_CONTEXT_ACTION_GROUPS)[number];

export type GitContextMenuActionItem = Extract<FloatingContextMenuItem, { kind: 'action' }> & Readonly<{
  group: GitContextActionGroup;
  rank: number;
}>;

export interface GitEntityContextMenuState<TTarget> {
  x: number;
  y: number;
  boundarySize: Readonly<{ width: number; height: number }>;
  target: TTarget;
  restoreFocusTo: HTMLElement | null;
}

export interface GitEntityContextMenuController<TTarget> {
  state: () => GitEntityContextMenuState<TTarget> | null;
  openFromContextMenu: (event: MouseEvent, target: TTarget) => void;
  openFromKeyboard: (event: KeyboardEvent, target: TTarget) => void;
  close: () => void;
  setMenuElement: (element: HTMLDivElement | null) => void;
}

export interface GitEntityContextMenuControllerOptions<TTarget> {
  snapshotTarget?: (target: TTarget) => TTarget;
}

function defaultTargetSnapshot<TTarget>(target: TTarget): TTarget {
  if (Array.isArray(target)) return [...target] as TTarget;
  if (target !== null && typeof target === 'object') return { ...target };
  return target;
}

function triggerElement(event: MouseEvent | KeyboardEvent): HTMLElement | null {
  return event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}

function keyboardMenuPosition(element: HTMLElement | null): { x: number; y: number } {
  if (!element) return { x: 0, y: 0 };
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom };
}

function contextMenuBoundarySize(element: HTMLElement | null): { width: number; height: number } {
  const surfaceHost = element?.closest<HTMLElement>('[data-floe-dialog-surface-host="true"]');
  return {
    width: surfaceHost?.clientWidth || document.documentElement.clientWidth || window.innerWidth,
    height: surfaceHost?.clientHeight || document.documentElement.clientHeight || window.innerHeight,
  };
}

export function createGitEntityContextMenuController<TTarget>(
  options: GitEntityContextMenuControllerOptions<TTarget> = {},
): GitEntityContextMenuController<TTarget> {
  const [state, setState] = createSignal<GitEntityContextMenuState<TTarget> | null>(null);
  let menuElement: HTMLDivElement | null = null;

  const close = () => setState(null);

  const open = (position: { x: number; y: number }, target: TTarget, restoreFocusTo: HTMLElement | null) => {
    const snapshotTarget = options.snapshotTarget ?? defaultTargetSnapshot;
    setState({
      ...position,
      boundarySize: contextMenuBoundarySize(restoreFocusTo),
      target: snapshotTarget(target),
      restoreFocusTo,
    });
  };

  const openFromContextMenu = (event: MouseEvent, target: TTarget) => {
    event.preventDefault();
    open({ x: event.clientX, y: event.clientY }, target, triggerElement(event));
  };

  const openFromKeyboard = (event: KeyboardEvent, target: TTarget) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const element = triggerElement(event);
    open(keyboardMenuPosition(element), target, element);
  };

  createEffect(() => {
    if (!state()) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuElement?.contains(event.target as Node)) return;
      close();
    };
    const onScroll = () => close();
    const onBlur = () => close();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onBlur);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onBlur);
    });
  });

  onCleanup(() => {
    setState(null);
  });

  return {
    state,
    openFromContextMenu,
    openFromKeyboard,
    close,
    setMenuElement: (element) => {
      menuElement = element;
    },
  };
}

export function composeGitContextMenuItems(
  actions: readonly GitContextMenuActionItem[],
): FloatingContextMenuItem[] {
  const actionsByGroup = new Map<GitContextActionGroup, GitContextMenuActionItem[]>();
  for (const action of actions) {
    const groupActions = actionsByGroup.get(action.group) ?? [];
    groupActions.push(action);
    actionsByGroup.set(action.group, groupActions);
  }

  const items: FloatingContextMenuItem[] = [];
  for (const group of GIT_CONTEXT_ACTION_GROUPS) {
    const groupActions = actionsByGroup.get(group);
    if (!groupActions?.length) continue;
    if (items.length > 0) items.push({ id: `separator-${group}`, kind: 'separator' });
    items.push(...groupActions.sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id)));
  }
  return items;
}

export interface GitEntityContextMenuProps<TTarget> {
  controller: GitEntityContextMenuController<TTarget>;
  items: (target: TTarget) => readonly GitContextMenuActionItem[];
}

export function GitEntityContextMenu<TTarget>(props: GitEntityContextMenuProps<TTarget>): JSX.Element {
  const i18n = useI18n();
  return (
    <Show when={props.controller.state()} keyed>
      {(menu) => (
        <FloatingContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={i18n.t('git.common.action')}
          focusAnchor={menu.restoreFocusTo}
          boundarySize={menu.boundarySize}
          width={FLOATING_CONTEXT_MENU_WIDTH_PX}
          focusDisabledItems
          restoreFocusOnEscape
          restoreFocusOnTab
          items={composeGitContextMenuItems(props.items(menu.target)).map((item) => (
            item.kind === 'action'
              ? {
                  ...item,
                  onSelect: () => {
                    props.controller.close();
                    item.onSelect();
                  },
                }
              : item
          ))}
          menuRef={props.controller.setMenuElement}
          onDismiss={props.controller.close}
        />
      )}
    </Show>
  );
}
