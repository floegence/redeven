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
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy, Download, Loader2, MoreHorizontal, Pencil, Save, X } from '@floegence/floe-webapp-core/icons';
import { FlowerNavigationIcon } from '../icons/FlowerSoftAuraIcon';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { useI18n } from '../i18n';
import { FloatingContextMenu, type FloatingContextMenuItem } from './FloatingContextMenu';
import type { FilePreviewContentProps } from './FilePreviewContent';

export interface FilePreviewActionsProps extends Pick<
  FilePreviewContentProps,
  | 'item'
  | 'descriptor'
  | 'canEdit'
  | 'editing'
  | 'dirty'
  | 'saving'
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
  presentation?: 'icons' | 'menu';
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
  run: (selection?: string) => void;
};

export function FilePreviewActions(props: FilePreviewActionsProps) {
  const i18n = useI18n();
  const resolvedPath = () => String(props.item?.path ?? '').trim();
  const buttonClass = () => cn(PREVIEW_HEADER_ICON_BUTTON_CLASS, props.compact ? 'size-7' : 'size-8');
  const showEditorActions = () =>
    ['text', 'markdown', 'pdf'].includes(props.descriptor.mode) && Boolean(props.canEdit);
  const [pathCopied, setPathCopied] = createSignal(false);
  const [menu, setMenu] = createSignal<{ x: number; y: number; selection: string } | null>(null);
  const menuId = createUniqueId();
  let trigger: HTMLButtonElement | undefined;
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
  const actions: PreviewAction[] = [
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
      run: (selection) => {
        void props.onAskFlower?.(selection ?? readSelection());
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
    visibleActions().map((action) => ({
      id: action.id,
      kind: 'action',
      label: action.label(),
      icon: action.icon,
      disabled: action.disabled?.(),
      onSelect: () => {
        const selection = menu()?.selection ?? '';
        closeMenu();
        trigger?.focus({ preventScroll: true });
        action.run(selection);
      },
    })),
  );

  return (
    <div class="flex shrink-0 items-center justify-end gap-1">
      <Show
        when={props.presentation === 'menu'}
        fallback={
          <For each={visibleActions()}>
            {(action) => (
              <button
                type="button"
                class={cn(buttonClass(), action.id === 'copy' && pathCopied() && 'bg-primary/10 text-primary')}
                disabled={action.disabled?.()}
                aria-label={action.label()}
                title={action.label()}
                onClick={() => action.run()}
              >
                <action.icon class={action.id === 'flower' ? 'size-5' : 'size-3.5'} />
              </button>
            )}
          </For>
        }
      >
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
