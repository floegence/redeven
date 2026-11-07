import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  type Component,
} from 'solid-js';
import { Button, FeedbackIndicator, capturePromptCardAnchor } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy, Download, Loader2, MoreHorizontal, Pencil, Save, Search, X } from '@floegence/floe-webapp-core/icons';
import { FlowerNavigationIcon } from '../icons/FlowerSoftAuraIcon';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { useI18n } from '../i18n';
import { FloatingContextMenu, type FloatingContextMenuItem } from './FloatingContextMenu';
import { isTextFilePreview } from '../utils/filePreview';
import { bindPreviewSearchShortcut } from './previewSearchShortcut';
import { useFilePreviewSearch } from './FilePreviewSearch';
import type { FilePreviewContentProps } from './FilePreviewContent';

export interface FilePreviewActionsProps extends Pick<
  FilePreviewContentProps,
  | 'active'
  | 'item'
  | 'descriptor'
  | 'canEdit'
  | 'editing'
  | 'dirty'
  | 'saving'
  | 'saveError'
  | 'loading'
  | 'selectedText'
  | 'onCopyPath'
  | 'onStartEdit'
  | 'onSave'
  | 'onDiscard'
  | 'onAskFlower'
  | 'onDownload'
> {
  compact?: boolean;
  presentation?: 'icons' | 'menu' | 'header';
  contentElement?: HTMLDivElement;
}

const PREVIEW_HEADER_ICON_BUTTON_CLASS = [
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent',
  'text-muted-foreground transition-colors duration-150',
  'hover:border-border/70 hover:bg-accent hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ');

type PreviewAction = {
  id: string;
  label: () => string;
  icon: Component<{ class?: string }>;
  visible?: () => boolean;
  disabled?: () => boolean;
  run: (selection?: string, anchor?: { x: number; y: number }) => void;
};

export function FilePreviewActions(props: FilePreviewActionsProps) {
  const i18n = useI18n();
  const search = useFilePreviewSearch();
  const resolvedPath = () => String(props.item?.path ?? '').trim();
  const buttonClass = () => cn(PREVIEW_HEADER_ICON_BUTTON_CLASS, props.compact ? 'size-7' : 'size-8');
  const showEditorActions = () =>
    (isTextFilePreview(props.descriptor) || props.descriptor.mode === 'pdf') && Boolean(props.canEdit);
  const [pathCopied, setPathCopied] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number; selection: string } | null>(null);
  const menuId = createUniqueId();
  let trigger: HTMLButtonElement | undefined;
  let actionsRoot: HTMLDivElement | undefined;
  let pointerSelection: string | undefined;
  let copyResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let disposed = false;

  const closeMenu = () => {
    setMenu(null);
    pointerSelection = undefined;
  };
  const clearCopiedState = () => {
    if (copyResetTimer !== undefined) globalThis.clearTimeout(copyResetTimer);
    copyResetTimer = undefined;
    setPathCopied(false);
  };
  createEffect(() => {
    resolvedPath();
    clearCopiedState();
    closeMenu();
  });
  createEffect(on(() => props.presentation, closeMenu));
  createEffect(() => { if (props.active === false) closeMenu(); });
  onCleanup(() => {
    disposed = true;
    clearCopiedState();
  });

  const handleCopyPath = async () => {
    const path = resolvedPath();
    if (!props.onCopyPath || !path) return;
    let copied: boolean | void = false;
    try {
      copied = await props.onCopyPath();
    } catch {
      return;
    }
    if (copied === false || disposed || resolvedPath() !== path) return;
    setPathCopied(true);
    if (copyResetTimer !== undefined) globalThis.clearTimeout(copyResetTimer);
    copyResetTimer = globalThis.setTimeout(() => {
      copyResetTimer = undefined;
      setPathCopied(false);
    }, 1600);
  };
  const readSelection = () =>
    String(props.selectedText ?? '').trim() ||
    (props.contentElement ? readSelectionTextFromPreview(props.contentElement) : '');
  const openMenu = () => {
    if (menu()) {
      closeMenu();
      return;
    }
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4, selection: pointerSelection ?? readSelection() });
    pointerSelection = undefined;
  };
  const showSearch = () => {
    const action = search?.action();
    if (!action || props.active === false || props.loading || !action.enabled()) return false;
    closeMenu();
    action.show(trigger);
    return true;
  };
  const actions: PreviewAction[] = [
    {
      id: 'find', label: () => i18n.t('filePreview.findInFile'), icon: Search,
      visible: () => !!search?.action(),
      disabled: () => props.active === false || !!props.loading || !search?.action()?.enabled(),
      run: showSearch,
    },
    {
      id: 'copy',
      label: () => i18n.t(pathCopied() ? 'filePreview.pathCopied' : 'filePreview.copyPath'),
      icon: (p) => (
        <Show when={pathCopied()} fallback={<Copy class={p.class} />}>
          <Check class={p.class} />
        </Show>
      ),
      visible: () => Boolean(props.onCopyPath),
      disabled: () => !resolvedPath(),
      run: () => {
        void handleCopyPath();
      },
    },
    {
      id: 'edit',
      label: () => i18n.t('filePreview.editFile'),
      icon: Pencil,
      visible: () => showEditorActions() && !props.editing,
      run: () => props.onStartEdit?.(),
    },
    {
      id: 'discard',
      label: () => i18n.t('filePreview.discardChanges'),
      icon: X,
      visible: () => showEditorActions() && Boolean(props.editing),
      disabled: () => Boolean(props.saving),
      run: () => props.onDiscard?.(),
    },
    {
      id: 'save',
      label: () => i18n.t('filePreview.saveFile'),
      icon: (p) => (
        <Show when={props.saving} fallback={<Save class={p.class} />}>
          <Loader2 class={cn(p.class, 'animate-spin')} />
        </Show>
      ),
      visible: () => showEditorActions() && Boolean(props.editing),
      disabled: () => !props.dirty || Boolean(props.saving),
      run: () => {
        void props.onSave?.();
      },
    },
    {
      id: 'flower',
      label: () => i18n.t('filePreview.askFlower'),
      icon: FlowerNavigationIcon,
      visible: () => Boolean(props.onAskFlower),
      disabled: () => !props.item || Boolean(props.loading),
      run: (selection, anchor) => {
        void props.onAskFlower?.(selection ?? readSelection(), anchor);
      },
    },
    {
      id: 'download',
      label: () => i18n.t(props.descriptor.mode === 'pdf' && props.editing ? 'filePreview.pdf.saveCopy' : 'filePreview.downloadFile'),
      icon: Download,
      disabled: () => !props.item || Boolean(props.loading),
      run: () => props.onDownload?.(),
    },
  ];
  const visibleActions = createMemo(() => actions.filter((action) => !action.visible || action.visible()));
  const menuItems = createMemo<FloatingContextMenuItem[]>(() =>
    visibleActions().filter(action => props.presentation === 'header' ? action.id !== 'flower' : props.presentation === 'menu' || action.id === 'find').map((action) => ({
      id: action.id,
      kind: 'action',
      label: action.label(),
      icon: action.icon,
      disabled: action.disabled?.(),
      onSelect: () => {
        const selection = menu()?.selection ?? '';
        const anchor = menu();
        closeMenu();
        trigger?.focus({ preventScroll: true });
        action.run(selection, anchor ? { x: anchor.x, y: anchor.y } : undefined);
      },
    })),
  );

  return (
    <div ref={element => { actionsRoot = element; onCleanup(bindPreviewSearchShortcut(element, showSearch)); }} tabIndex={-1} class="flex shrink-0 items-center justify-end gap-1">
      <FeedbackIndicator
        label={i18n.t('filePreview.saveFailedTitle')}
        closeLabel={i18n.t('common.actions.close')}
        restoreFocus={() => actionsRoot}
        size={props.compact ? 'sm' : 'md'}
        entries={props.saveError ? [{
          id: 'save', severity: 'error', summary: props.saveError,
          actions: <Button size="sm" variant="outline" disabled={!props.dirty || props.saving || !props.onSave} loading={props.saving} onClick={() => void props.onSave?.()}>{i18n.t('common.actions.retry')}</Button>,
        }] : []}
      />
      <Show when={props.presentation !== 'menu' && props.presentation !== 'header'}>
          <For each={visibleActions().filter(action => action.id !== 'find')}>
            {(action) => (
              <button
                type="button"
                class={cn(buttonClass(), action.id === 'copy' && pathCopied() && 'bg-primary/10 text-primary')}
                disabled={action.disabled?.()}
                aria-label={action.label()}
                title={action.label()}
                onClick={event => action.run(undefined, capturePromptCardAnchor(event.currentTarget) ?? undefined)}
              >
                <action.icon class={action.id === 'flower' ? 'size-5' : 'size-3.5'} />
              </button>
            )}
          </For>
      </Show>
      <Show when={props.presentation === 'menu' || props.presentation === 'header' || !!search?.action()}>
        <Show when={props.presentation === 'header' && props.onAskFlower}>
          <button type="button" class={buttonClass()} disabled={!props.item || props.loading}
            aria-label={i18n.t('filePreview.askFlower')} title={i18n.t('filePreview.askFlower')}
            onClick={event => props.onAskFlower?.(readSelection(), capturePromptCardAnchor(event.currentTarget) ?? undefined)}>
            <FlowerNavigationIcon class="size-5" />
          </button>
        </Show>
        <button
          ref={trigger}
          type="button"
          class={cn(buttonClass(), pathCopied() && 'bg-primary/10 text-primary')}
          aria-label={i18n.t('filePreview.moreActions')}
          title={i18n.t(pathCopied() ? 'filePreview.pathCopied' : 'filePreview.moreActions')}
          aria-haspopup="menu"
          aria-expanded={Boolean(menu())}
          aria-controls={menu() ? menuId : undefined}
          onPointerDown={() => {
            pointerSelection = readSelection();
          }}
          onClick={openMenu}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              openMenu();
            }
          }}
        >
          <Show when={pathCopied()} fallback={<MoreHorizontal class="size-3.5" />}>
            <Check class="size-3.5" />
          </Show>
        </button>
        <Show when={pathCopied()}>
          <span role="status" class="sr-only">
            {i18n.t('filePreview.pathCopied')}
          </span>
        </Show>
      </Show>
      <Show when={menu()}>
        {(position) => (
          <FloatingContextMenu
            id={menuId}
            x={position().x}
            y={position().y}
            ariaLabel={i18n.t('filePreview.moreActions')}
            focusAnchor={trigger}
            toggleAnchor={trigger}
            items={menuItems()}
            restoreFocusOnEscape
            restoreFocusOnTab
            onDismiss={closeMenu}
          />
        )}
      </Show>
    </div>
  );
}
