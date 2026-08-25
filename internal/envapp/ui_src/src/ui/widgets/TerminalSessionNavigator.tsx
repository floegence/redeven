import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Sidebar, SidebarContent, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { Check, Copy, FolderOpen, FolderPlus, Link, MoreHorizontal, Plus, Refresh, Search, Terminal, X } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import {
  TERMINAL_AGENT_CLI_PRESENTATIONS,
  type TerminalSessionOutputState,
} from './terminalAgentSessionPresentation';
import type { TerminalAgentCliIdentity } from '@floegence/floeterm-terminal-web/sessions';
import type { TerminalSessionChromeAvatar } from '../services/terminalSessionChrome';

export type TerminalSessionTransitionIndicator = 'none' | 'spinner' | 'failed';
export type TerminalSessionAttentionState = 'none' | 'waiting' | 'unread';
export type TerminalSessionTransitionState = 'none' | 'creating' | 'reconnecting' | 'opening' | 'failed';
export type TerminalSessionFailureKind = 'none' | 'creation' | 'runtime';
export type TerminalFilesAvailability = 'available' | 'remote' | 'verifying' | 'invalid' | 'permission';

export type TerminalSessionNavigationItem = Readonly<{
  id: string;
  label: string;
  title: string;
  avatarInitial: string;
  avatarTone: Readonly<{
    background: string;
    border: string;
    foreground: string;
  }>;
  avatar: TerminalSessionChromeAvatar;
  subtitleIcon: 'none' | 'link';
  subtitle: string;
  fullPath: string;
  localWorkingDir: string;
  transitionIndicator: TerminalSessionTransitionIndicator;
  processRunning: boolean;
  transitionState: TerminalSessionTransitionState;
  failureKind: TerminalSessionFailureKind;
  outputState: TerminalSessionOutputState;
  activitySource: 'none' | 'semantic' | 'output';
  attentionState: TerminalSessionAttentionState;
  remote: boolean;
  canBrowsePath: boolean;
  filesAvailability: TerminalFilesAvailability;
  canClear: boolean;
  canDuplicate: boolean;
  closable: boolean;
}>;

export type TerminalSessionNavigationGroup = Readonly<{
  id: string;
  name: string;
  defaultWorkingDir: string;
  isDefault: boolean;
  pending?: boolean;
  expanded: boolean;
  itemIds: readonly string[];
  totalSessionCount: number;
}>;

export type TerminalSessionNavigatorProps = Readonly<{
  accessibilityIdPrefix: string;
  mobile: boolean;
  drawerOpen: boolean;
  connected: boolean;
  refreshing: boolean;
  activeTitle: string;
  activeAvatar: TerminalSessionChromeAvatar;
  filterQuery: string;
  itemIds: readonly string[];
  itemById: ReadonlyMap<string, TerminalSessionNavigationItem>;
  groups?: readonly TerminalSessionNavigationGroup[];
  sidebarActiveSessionId: string | null;
  activeSessionId: string | null;
  copiedPathSessionId: string | null;
  emptyListLoading: boolean;
  ownedLayerIds?: readonly string[];
  isFocusWithinOwnedLayer?: (target: Node | null) => boolean;
  onCloseDrawer: () => void;
  onCreateSessionInGroup?: (groupId: string) => void;
  onCreateGroup?: () => void;
  onToggleGroup?: (groupId: string) => void;
  onRelocateSession?: (sessionId: string, groupId: string, beforeSessionId: string | null) => void;
  onReorderGroup?: (groupId: string, beforeGroupId: string | null) => void;
  onOpenGroupContextMenu?: (event: MouseEvent, groupId: string) => void;
  onOpenTreeContextMenu?: (event: MouseEvent) => void;
  onRefresh: () => void;
  onFilterQueryChange: (value: string) => void;
  onPreviewSession: (event: PointerEvent, sessionId: string) => void;
  onResetSessionPreview: () => void;
  onSelectSession: (sessionId: string) => void;
  onOpenKeyboardMenu: (event: KeyboardEvent, item: TerminalSessionNavigationItem) => void;
  onOpenContextMenu: (event: MouseEvent, item: TerminalSessionNavigationItem) => void;
  onCopyPath: (item: TerminalSessionNavigationItem) => void;
  onCloseSession: (sessionId: string) => void;
  onOpenFiles: (item: TerminalSessionNavigationItem) => void;
}>;

export function TerminalSessionTransitionBadge(props: { state: TerminalSessionTransitionIndicator }) {
  return (
    <>
      <Show when={props.state === 'spinner'}>
        <span
          class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-sidebar-foreground shadow-sm"
          data-terminal-transition-indicator="spinner"
          data-terminal-tab-status="spinner"
          aria-hidden="true"
        >
          <svg class="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
            <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
      </Show>
      <Show when={props.state === 'failed'}>
        <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-error shadow-sm" data-terminal-transition-indicator="failed" data-terminal-tab-status="failed" aria-hidden="true" />
      </Show>
      <Show when={props.state === 'none'}>
        <span class="hidden" data-terminal-transition-indicator="none" aria-hidden="true" />
      </Show>
    </>
  );
}

function TerminalAgentIdentity(props: {
  identity: TerminalAgentCliIdentity;
  sessionId: string;
  transitionIndicator: TerminalSessionTransitionIndicator;
}) {
  const presentation = createMemo(() => TERMINAL_AGENT_CLI_PRESENTATIONS[props.identity]);
  const themeAdaptiveImage = createMemo(() => Boolean(presentation().lightIconPath && presentation().darkIconPath));
  return (
    <span
      class="pointer-events-none relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border/70 bg-[var(--redeven-surface-control)] text-sidebar-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,var(--background)_18%,transparent)]"
      data-terminal-session-avatar={props.sessionId}
      data-terminal-agent-identity={props.identity}
      aria-hidden="true"
    >
      <Show
        when={presentation().render === 'mask'}
        fallback={(
          <Show
            when={themeAdaptiveImage()}
              fallback={<img style={{ width: `${presentation().opticalSizePx}px`, height: `${presentation().opticalSizePx}px` }} class="object-contain" src={presentation().iconPath} alt="" draggable={false} />}
          >
            <img style={{ width: `${presentation().opticalSizePx}px`, height: `${presentation().opticalSizePx}px` }} class="object-contain dark:hidden" src={presentation().lightIconPath} alt="" draggable={false} />
            <img style={{ width: `${presentation().opticalSizePx}px`, height: `${presentation().opticalSizePx}px` }} class="hidden object-contain dark:block" src={presentation().darkIconPath} alt="" draggable={false} />
          </Show>
        )}
      >
        <span
          class="bg-current"
          style={{
            width: `${presentation().opticalSizePx}px`,
            height: `${presentation().opticalSizePx}px`,
            'mask-image': `url(${presentation().iconPath})`,
            '-webkit-mask-image': `url(${presentation().iconPath})`,
            'mask-position': 'center',
            '-webkit-mask-position': 'center',
            'mask-repeat': 'no-repeat',
            '-webkit-mask-repeat': 'no-repeat',
            'mask-size': 'contain',
            '-webkit-mask-size': 'contain',
          }}
        />
      </Show>
      <TerminalSessionTransitionBadge state={props.transitionIndicator} />
    </span>
  );
}

export function TerminalSessionChromeIcon(props: {
  avatar: TerminalSessionChromeAvatar;
  class?: string;
}) {
  const agentPresentation = createMemo(() => (
    props.avatar.kind === 'agent' ? TERMINAL_AGENT_CLI_PRESENTATIONS[props.avatar.identity] : null
  ));
  const themeAdaptiveImage = createMemo(() => Boolean(
    agentPresentation()?.lightIconPath && agentPresentation()?.darkIconPath,
  ));
  const iconClass = () => props.class ?? 'h-3.5 w-3.5';

  return (
    <Show
      when={agentPresentation()}
      fallback={props.avatar.kind === 'link'
        ? <Link class={iconClass()} />
        : <Terminal class={iconClass()} />}
    >
      {(presentation) => (
        <Show
          when={presentation().render === 'mask'}
          fallback={(
            <Show
              when={themeAdaptiveImage()}
              fallback={<img class={`${iconClass()} object-contain`} src={presentation().iconPath} alt="" draggable={false} />}
            >
              <img class={`${iconClass()} object-contain dark:hidden`} src={presentation().lightIconPath} alt="" draggable={false} />
              <img class={`hidden ${iconClass()} object-contain dark:block`} src={presentation().darkIconPath} alt="" draggable={false} />
            </Show>
          )}
        >
          <span
            class={`${iconClass()} bg-current`}
            style={{
              'mask-image': `url(${presentation().iconPath})`,
              '-webkit-mask-image': `url(${presentation().iconPath})`,
              'mask-position': 'center',
              '-webkit-mask-position': 'center',
              'mask-repeat': 'no-repeat',
              '-webkit-mask-repeat': 'no-repeat',
              'mask-size': 'contain',
              '-webkit-mask-size': 'contain',
            }}
          />
        </Show>
      )}
    </Show>
  );
}

export function TerminalOutputStatusGlyph(props: {
  state: Exclude<TerminalSessionOutputState, 'none'>;
}) {
  return (
    <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" data-terminal-output-state={props.state} aria-hidden="true">
      <rect class="redeven-terminal-output-wave-bar" x="2" y="5" width="2" height="6" rx="1" />
      <rect class="redeven-terminal-output-wave-bar" x="7" y="2.5" width="2" height="11" rx="1" />
      <rect class="redeven-terminal-output-wave-bar" x="12" y="4" width="2" height="8" rx="1" />
    </svg>
  );
}

export function terminalStatusSentence(
  value: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const normalized = value.trim();
  if (!normalized || /[.!?…。！？]$/u.test(normalized)) return normalized;
  return t('terminal.statusSentence', { status: normalized });
}

export function joinTerminalStatusAnnouncements(
  values: readonly string[],
  t: ReturnType<typeof useI18n>['t'],
): string {
  return values.reduce((combined, current) => (
    combined
      ? t('terminal.statusAnnouncementPair', { first: combined, second: current })
      : current
  ), '');
}

function terminalActivityTooltip(
  source: 'semantic' | 'output',
  unread: boolean,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const activity = source === 'semantic'
    ? t('terminalAgentActivity.working')
    : t('terminal.outputStreaming');
  return unread
    ? t('terminal.activityWithUnreadOutput', {
      activity,
      unread: t('terminal.unreadOutputDescription'),
    })
    : activity;
}

function terminalFilesTooltip(
  item: TerminalSessionNavigationItem,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (item.filesAvailability) {
    case 'remote': return t('terminal.remotePathActionsUnavailable');
    case 'verifying': return t('terminal.localPathVerificationPending');
    case 'invalid': return t('terminal.localPathUnavailable');
    case 'permission': return t('terminal.filesReadPermissionRequired');
    case 'available': return `${t('terminal.files')}: ${item.localWorkingDir}`;
  }
}

export function describeTerminalSessionNavigationItem(
  item: TerminalSessionNavigationItem,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const agentPresentation = item.avatar.kind === 'agent'
    ? TERMINAL_AGENT_CLI_PRESENTATIONS[item.avatar.identity]
    : null;
  const descriptions = [
    agentPresentation ? t('terminal.agentCliDescription', { name: agentPresentation.label }) : '',
    item.transitionState === 'creating' ? t('terminal.creatingStatus') : '',
    item.transitionState === 'reconnecting' ? t('terminal.reconnecting') : '',
    item.transitionState === 'opening' ? t('terminal.remoteOpeningStatus') : '',
    item.failureKind === 'creation' ? t('terminal.creationFailedStatus') : '',
    item.failureKind === 'runtime' ? t('terminal.terminalUnavailable') : '',
    item.processRunning && item.transitionState === 'none' ? t('terminal.processRunningDescription') : '',
    item.outputState !== 'none' && item.activitySource === 'semantic' ? t('terminalAgentActivity.working') : '',
    item.outputState !== 'none' && item.activitySource === 'output' ? t('terminal.outputStreaming') : '',
    item.attentionState === 'waiting' ? t('terminalAgentActivity.userInputRequired') : '',
    item.attentionState === 'unread' ? t('terminal.unreadOutputDescription') : '',
  ].filter(Boolean).map((description) => terminalStatusSentence(description, t));
  return joinTerminalStatusAnnouncements(descriptions, t);
}

function installCompactDragPreview(event: DragEvent, kind: 'session' | 'group') {
  if (typeof document === 'undefined'
    || !event.dataTransfer
    || typeof event.dataTransfer.setDragImage !== 'function') return;
  const preview = document.createElement('span');
  preview.className = 'fixed -left-[999px] -top-[999px] z-[9999] flex h-9 w-9 items-center justify-center rounded-[10px] border border-border/60 bg-popover/95 shadow-[0_8px_22px_color-mix(in_srgb,var(--foreground)_18%,transparent)]';
  preview.dataset.terminalDragPreview = kind;
  preview.setAttribute('aria-hidden', 'true');
  const glyph = document.createElement('span');
  glyph.className = kind === 'group'
    ? 'relative block h-3.5 w-[18px] rounded-[4px] bg-primary/75 before:absolute before:-top-1 before:left-0.5 before:h-1.5 before:w-2 before:rounded-t-[3px] before:bg-primary/75'
    : 'grid grid-cols-2 gap-[3px]';
  if (kind === 'session') {
    for (let index = 0; index < 6; index += 1) {
      const dot = document.createElement('span');
      dot.className = 'h-[3px] w-[3px] rounded-full bg-primary/80';
      glyph.append(dot);
    }
  }
  preview.append(glyph);
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 18, 18);
  requestAnimationFrame(() => preview.remove());
}

export function TerminalSessionNavigator(props: TerminalSessionNavigatorProps) {
  const i18n = useI18n();
  const sidebarWidth = () => (props.mobile ? 232 : 286);
  let drawerDialogEl: HTMLDivElement | undefined;
  const navigationGroups = createMemo<readonly TerminalSessionNavigationGroup[]>(() => props.groups ?? [{
    id: 'default',
    name: 'Default',
    defaultWorkingDir: '',
    isDefault: true,
    expanded: true,
    itemIds: props.itemIds,
    totalSessionCount: props.itemIds.length,
  }]);
  const [draggedSessionId, setDraggedSessionId] = createSignal<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = createSignal<string | null>(null);
  const [dropIntent, setDropIntent] = createSignal<Readonly<{
    groupId: string;
    beforeSessionId: string | null;
    targetSessionId: string | null;
    position: 'group' | 'before' | 'after';
  }> | null>(null);
  const [groupDropIntent, setGroupDropIntent] = createSignal<Readonly<{
    beforeGroupId: string | null;
    targetGroupId: string | null;
    position: 'before' | 'after';
  }> | null>(null);
  const clearDragState = () => {
    setDraggedSessionId(null);
    setDraggedGroupId(null);
    setDropIntent(null);
    setGroupDropIntent(null);
  };
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const clearNativeDragState = () => clearDragState();
    document.addEventListener('dragend', clearNativeDragState);
    document.addEventListener('drop', clearNativeDragState);
    window.addEventListener('blur', clearNativeDragState);
    onCleanup(() => {
      document.removeEventListener('dragend', clearNativeDragState);
      document.removeEventListener('drop', clearNativeDragState);
      window.removeEventListener('blur', clearNativeDragState);
    });
  }
  const draggedSessionTitle = createMemo(() => {
    const sessionId = draggedSessionId();
    return sessionId ? props.itemById.get(sessionId)?.title ?? '' : '';
  });
  const dropAnnouncement = createMemo(() => {
    const intent = dropIntent();
    if (!intent) return i18n.t('terminal.draggingSession', { session: draggedSessionTitle() });
    const group = navigationGroups().find((candidate) => candidate.id === intent.groupId);
    if (intent.position === 'group') {
      return i18n.t('terminal.moveToGroupNamed', { group: group?.name ?? '' });
    }
    const target = intent.targetSessionId ? props.itemById.get(intent.targetSessionId) : null;
    return i18n.t(
      intent.position === 'before' ? 'terminal.placeBeforeSession' : 'terminal.placeAfterSession',
      { session: target?.title ?? '' },
    );
  });
  const draggedSessionFromEvent = (event: DragEvent): string => (
    draggedSessionId()
    || event.dataTransfer?.getData('application/x-redeven-terminal-session').trim()
    || ''
  );
  const acceptsTerminalSessionDrag = (event: DragEvent): boolean => Boolean(
    draggedSessionId()
    || event.dataTransfer?.types.includes('application/x-redeven-terminal-session'),
  );
  const draggedGroupFromEvent = (event: DragEvent): string => (
    draggedGroupId()
    || event.dataTransfer?.getData('application/x-redeven-terminal-group').trim()
    || ''
  );
  const acceptsTerminalGroupDrag = (event: DragEvent): boolean => Boolean(
    draggedGroupId()
    || event.dataTransfer?.types.includes('application/x-redeven-terminal-group'),
  );
  const commitDrop = (event: DragEvent) => {
    const intent = dropIntent();
    const sessionId = draggedSessionFromEvent(event);
    clearDragState();
    if (!intent || !sessionId) return;
    event.preventDefault();
    event.stopPropagation();
    props.onRelocateSession?.(sessionId, intent.groupId, intent.beforeSessionId);
  };
  const commitGroupDrop = (event: DragEvent) => {
    const intent = groupDropIntent();
    const groupId = draggedGroupFromEvent(event);
    clearDragState();
    if (!intent || !groupId) return;
    event.preventDefault();
    event.stopPropagation();
    props.onReorderGroup?.(groupId, intent.beforeGroupId);
  };

  const drawerFocusableElements = () => {
    if (!drawerDialogEl) return [];
    return Array.from(drawerDialogEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
  };

  createEffect(() => {
    if (!props.mobile || !props.drawerOpen) return;
    queueMicrotask(() => {
      if (!props.mobile || !props.drawerOpen || !drawerDialogEl) return;
      const initialFocus = drawerDialogEl.querySelector<HTMLElement>('[data-testid="terminal-session-filter"]')
        ?? drawerFocusableElements()[0];
      initialFocus?.focus({ preventScroll: true });
    });
  });

  const handleDrawerKeyDown = (event: KeyboardEvent) => {
    if (!props.mobile || !props.drawerOpen) return;
    if (props.isFocusWithinOwnedLayer?.(event.target as Node | null)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onCloseDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = drawerFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !drawerDialogEl?.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !drawerDialogEl?.contains(active))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  let previousItemIds: readonly string[] = props.itemIds;
  let lastFocusedSessionId: string | null = null;
  let focusOwnedByNavigator = false;
  const focusSessionOrFallback = (sessionId: string | null) => {
    const replacement = sessionId
      ? Array.from(drawerDialogEl?.querySelectorAll<HTMLButtonElement>('button[data-terminal-session-id]') ?? [])
          .find((button) => button.dataset.terminalSessionId === sessionId)
      : null;
    const fallback = replacement
      ?? drawerDialogEl?.querySelector<HTMLElement>('[data-testid="terminal-session-filter"]')
      ?? drawerFocusableElements()[0];
    fallback?.focus({ preventScroll: true });
  };
  createEffect(() => {
    const trackFocusOwnership = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (drawerDialogEl?.contains(target)) {
        const row = target instanceof Element
          ? target.closest<HTMLElement>('[data-terminal-session-row]')
          : null;
        if (row?.dataset.terminalSessionRow) {
          lastFocusedSessionId = row.dataset.terminalSessionRow;
        }
        focusOwnedByNavigator = true;
        return;
      }
      if (props.isFocusWithinOwnedLayer?.(target)) {
        focusOwnedByNavigator = true;
        return;
      }
      if (props.mobile && props.drawerOpen) {
        focusOwnedByNavigator = true;
        const fallback = drawerDialogEl?.querySelector<HTMLElement>('[data-testid="terminal-session-filter"]')
          ?? drawerFocusableElements()[0];
        fallback?.focus({ preventScroll: true });
        return;
      }
      focusOwnedByNavigator = false;
    };
    document.addEventListener('keydown', handleDrawerKeyDown);
    document.addEventListener('focusin', trackFocusOwnership);
    onCleanup(() => {
      document.removeEventListener('keydown', handleDrawerKeyDown);
      document.removeEventListener('focusin', trackFocusOwnership);
    });
  });

  createEffect(() => {
    const nextItemIds = props.itemIds;
    const previousIds = previousItemIds;
    previousItemIds = nextItemIds;
    if (!focusOwnedByNavigator || !lastFocusedSessionId) return;
    const previousIndex = previousIds.indexOf(lastFocusedSessionId);
    if (previousIndex < 0 || nextItemIds.includes(lastFocusedSessionId)) return;
    const replacementSessionId = nextItemIds[Math.min(previousIndex, nextItemIds.length - 1)] ?? null;
    lastFocusedSessionId = replacementSessionId;
    queueMicrotask(() => {
      if (!focusOwnedByNavigator) return;
      const active = document.activeElement;
      if (drawerDialogEl?.contains(active) || props.isFocusWithinOwnedLayer?.(active)) return;
      focusSessionOrFallback(replacementSessionId);
    });
  });

  createEffect(() => {
    const focusTopology = props.itemIds.map((sessionId) => {
      const item = props.itemById.get(sessionId);
      return [
        sessionId,
        item?.attentionState,
        item?.outputState,
        item?.closable,
        Boolean(item?.fullPath),
        item?.canBrowsePath,
      ].join(':');
    }).join('|');
    if (!focusTopology || !focusOwnedByNavigator) return;
    queueMicrotask(() => {
      if (!focusOwnedByNavigator) return;
      const active = document.activeElement;
      if (drawerDialogEl?.contains(active) || props.isFocusWithinOwnedLayer?.(active)) return;
      focusSessionOrFallback(lastFocusedSessionId);
    });
  });

  return (
    <>
      <Show when={props.mobile && props.drawerOpen}>
        <div
          class="absolute inset-0 z-30 cursor-default bg-[var(--redeven-overlay-scrim)]"
          aria-hidden="true"
          data-testid="terminal-session-drawer-backdrop"
          onClick={props.onCloseDrawer}
        />
      </Show>
      <div
        ref={drawerDialogEl}
        class="contents"
        role={props.mobile && props.drawerOpen ? 'dialog' : undefined}
        aria-modal={props.mobile && props.drawerOpen ? 'true' : undefined}
        aria-label={props.mobile && props.drawerOpen ? i18n.t('terminal.sessions') : undefined}
        aria-owns={props.mobile && props.drawerOpen && props.ownedLayerIds?.length
          ? props.ownedLayerIds.join(' ')
          : undefined}
      >
        <Sidebar
          width={sidebarWidth()}
          ariaLabel={i18n.t('terminal.title')}
          class={`redeven-terminal-session-sidebar ${props.mobile
            ? props.drawerOpen
              ? 'absolute inset-y-0 left-0 z-40 !h-full !max-h-full !min-h-0 !w-[min(88vw,320px)] overflow-hidden shadow-2xl'
              : 'hidden'
            : '!w-[286px] !min-w-[286px] !max-w-[286px] overflow-hidden'}`}
        >
          <SidebarContent class="flex h-full min-h-0 flex-col overflow-hidden">
            <div class="shrink-0 space-y-2">
              <div class="flex items-center gap-2 px-0.5">
                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/55 text-sidebar-accent-foreground">
                  <TerminalSessionChromeIcon avatar={props.activeAvatar} class="h-3.5 w-3.5" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{i18n.t('terminal.title')}</div>
                  <div class="truncate text-xs font-semibold text-sidebar-foreground" title={props.activeTitle}>{props.activeTitle}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-7 w-7 cursor-pointer p-0 disabled:cursor-not-allowed"
                  data-testid="terminal-sidebar-refresh"
                  onClick={props.onRefresh}
                  disabled={!props.connected || props.refreshing}
                  loading={props.refreshing}
                  title={i18n.t('terminal.refresh')}
                >
                  <Refresh class="h-3.5 w-3.5" />
                </Button>
                <Show when={props.mobile}>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-7 w-7 cursor-pointer p-0"
                    data-testid="terminal-session-drawer-close"
                    onClick={props.onCloseDrawer}
                    title={i18n.t('terminal.closeSessions')}
                  >
                    <X class="h-3.5 w-3.5" />
                  </Button>
                </Show>
              </div>
              <div class="relative">
                <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  size="sm"
                  value={props.filterQuery}
                  class="w-full pl-7 pr-7"
                  placeholder={i18n.t('terminal.searchSessions')}
                  aria-label={i18n.t('terminal.searchSessions')}
                  data-testid="terminal-session-filter"
                  onInput={(event) => props.onFilterQueryChange(event.currentTarget.value)}
                />
                <Show when={props.filterQuery.length > 0}>
                  <button
                    type="button"
                    class="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={i18n.t('terminal.clearSessionSearch')}
                    title={i18n.t('terminal.clearSessionSearch')}
                    onClick={() => props.onFilterQueryChange('')}
                  >
                    <X class="h-3.5 w-3.5" />
                  </button>
                </Show>
              </div>
            </div>

            <SidebarSection
              title={i18n.t('terminal.title')}
              actions={(
                <button
                  type="button"
                  class="flex h-6 max-w-[96px] cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="terminal-sidebar-add-group"
                  onClick={() => props.onCreateGroup?.()}
                  disabled={!props.connected}
                  title={i18n.t('terminal.newGroup')}
                >
                  <FolderPlus class="h-3.5 w-3.5 shrink-0" />
                  <span class="truncate">{i18n.t('terminal.newGroup')}</span>
                </button>
              )}
              class="min-h-0 flex flex-1 flex-col overflow-hidden [&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:overflow-hidden"
            >
              <div
                data-testid="terminal-session-list"
                class="min-h-0 flex-1 overflow-hidden"
                onContextMenu={(event) => {
                  const target = event.target instanceof Element ? event.target : null;
                  if (!target || target.closest('[data-terminal-tree-group], button, input, [role="menu"]')) return;
                  props.onOpenTreeContextMenu?.(event);
                }}
              >
                <SidebarItemList
                  {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
                  class="flex min-h-0 h-full flex-col overflow-y-auto overflow-x-hidden pr-0.5 [scrollbar-gutter:stable]"
                >
                  <Index each={navigationGroups()}>
                    {(navigationGroup) => (
                      <div
                        class="group/tree relative mb-3 transition-opacity duration-150"
                        classList={{
                          'opacity-35': draggedGroupId() === navigationGroup().id,
                        }}
                        data-terminal-group-id={navigationGroup().id}
                        data-terminal-tree-group={navigationGroup().id}
                        data-terminal-group-pending={navigationGroup().pending ? 'true' : 'false'}
                        aria-busy={navigationGroup().pending ? 'true' : undefined}
                        onDragLeave={(event) => {
                          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                          if (dropIntent()?.groupId === navigationGroup().id) setDropIntent(null);
                          if (groupDropIntent()?.targetGroupId === navigationGroup().id) setGroupDropIntent(null);
                        }}
                      >
                        <Show when={groupDropIntent()?.targetGroupId === navigationGroup().id}>
                          <span
                            class={`pointer-events-none absolute left-1 right-1 z-40 flex items-center ${groupDropIntent()?.position === 'before' ? '-top-1.5' : '-bottom-1.5'}`}
                            data-terminal-group-order-drop-hint={navigationGroup().id}
                            data-terminal-group-order-drop-position={groupDropIntent()?.position}
                            aria-hidden="true"
                          >
                            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span class="h-px min-w-2 flex-1 bg-primary" />
                          </span>
                        </Show>
                        <div
                          class="relative flex min-h-11 items-center gap-1 rounded-lg border border-transparent bg-[color-mix(in_srgb,var(--primary)_7%,var(--sidebar))] px-1.5 text-sidebar-foreground transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--sidebar))]"
                          data-terminal-group-header={navigationGroup().id}
                          data-terminal-group-drop-target={dropIntent()?.groupId === navigationGroup().id ? dropIntent()?.position : undefined}
                          data-terminal-group-draggable={!navigationGroup().isDefault && !navigationGroup().pending ? 'true' : 'false'}
                          draggable={!navigationGroup().isDefault && !navigationGroup().pending}
                          aria-grabbed={draggedGroupId() === navigationGroup().id ? 'true' : 'false'}
                          classList={{
                            'opacity-65': navigationGroup().pending,
                            '!bg-[color-mix(in_srgb,var(--primary)_15%,var(--sidebar))]': dropIntent()?.groupId === navigationGroup().id,
                            'cursor-grab active:cursor-grabbing': !navigationGroup().isDefault && !navigationGroup().pending,
                            '!cursor-grabbing [&_*]:!cursor-grabbing': draggedSessionId() !== null || draggedGroupId() !== null,
                          }}
                          onContextMenu={(event) => props.onOpenGroupContextMenu?.(event, navigationGroup().id)}
                          onDragStart={(event) => {
                            if (navigationGroup().isDefault || navigationGroup().pending || !event.dataTransfer) return;
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('application/x-redeven-terminal-group', navigationGroup().id);
                            installCompactDragPreview(event, 'group');
                            setDraggedGroupId(navigationGroup().id);
                            setDraggedSessionId(null);
                            setDropIntent(null);
                            setGroupDropIntent(null);
                          }}
                          onDragEnd={clearDragState}
                          onDragOver={(event) => {
                            if (acceptsTerminalGroupDrag(event)) {
                              const draggedId = draggedGroupFromEvent(event);
                              if (!draggedId || draggedId === navigationGroup().id) {
                                setGroupDropIntent(null);
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                              const orderedTargets = navigationGroups()
                                .filter((group) => !group.isDefault && !group.pending && group.id !== draggedId);
                              if (navigationGroup().isDefault) {
                                const firstTarget = orderedTargets[0];
                                if (!firstTarget) {
                                  setGroupDropIntent(null);
                                  return;
                                }
                                setGroupDropIntent({
                                  beforeGroupId: firstTarget.id,
                                  targetGroupId: firstTarget.id,
                                  position: 'before',
                                });
                                return;
                              }
                              const targetIndex = orderedTargets.findIndex((group) => group.id === navigationGroup().id);
                              if (targetIndex < 0) {
                                setGroupDropIntent(null);
                                return;
                              }
                              const rect = event.currentTarget.getBoundingClientRect();
                              const useUpperBoundary = event.clientY < rect.top + rect.height / 2;
                              const nextTarget = orderedTargets[targetIndex + 1];
                              const nextIntent = useUpperBoundary || !nextTarget
                                ? {
                                    beforeGroupId: useUpperBoundary ? navigationGroup().id : null,
                                    targetGroupId: navigationGroup().id,
                                    position: useUpperBoundary ? 'before' as const : 'after' as const,
                                  }
                                : {
                                    beforeGroupId: nextTarget.id,
                                    targetGroupId: nextTarget.id,
                                    position: 'before' as const,
                                  };
                              const originalOrder = navigationGroups()
                                .filter((group) => !group.isDefault && !group.pending)
                                .map((group) => group.id);
                              const projected = originalOrder.filter((groupId) => groupId !== draggedId);
                              const projectedIndex = nextIntent.beforeGroupId
                                ? projected.indexOf(nextIntent.beforeGroupId)
                                : -1;
                              projected.splice(projectedIndex >= 0 ? projectedIndex : projected.length, 0, draggedId);
                              if (projected.every((groupId, index) => groupId === originalOrder[index])) {
                                setGroupDropIntent(null);
                                return;
                              }
                              setGroupDropIntent(nextIntent);
                              return;
                            }
                            if (navigationGroup().pending || !acceptsTerminalSessionDrag(event)) return;
                            const draggedId = draggedSessionFromEvent(event);
                            if (!draggedId) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                            const sourceGroup = navigationGroups().find((group) => group.itemIds.includes(draggedId));
                            if (sourceGroup?.id === navigationGroup().id && navigationGroup().itemIds.at(-1) === draggedId) {
                              setDropIntent(null);
                              return;
                            }
                            setDropIntent({
                              groupId: navigationGroup().id,
                              beforeSessionId: null,
                              targetSessionId: null,
                              position: 'group',
                            });
                          }}
                          onDrop={(event) => {
                            if (acceptsTerminalGroupDrag(event)) commitGroupDrop(event);
                            else commitDrop(event);
                          }}
                        >
                          <Show when={navigationGroup().expanded && navigationGroup().itemIds.length > 0}>
                            <span
                              class="pointer-events-none absolute bottom-[-5px] left-[18px] top-1/2 w-px bg-[color-mix(in_srgb,var(--primary)_27%,var(--sidebar-border))]"
                              data-terminal-tree-trunk={navigationGroup().id}
                              aria-hidden="true"
                            />
                          </Show>
                          <button
                            type="button"
                            class="relative z-10 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-[color-mix(in_srgb,var(--primary)_28%,var(--sidebar-border))] bg-sidebar text-[13px] font-semibold leading-none text-primary shadow-[0_1px_2px_color-mix(in_srgb,var(--foreground)_7%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_48%,var(--sidebar-border))] hover:bg-primary/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                            data-testid={`terminal-group-toggle-${navigationGroup().id}`}
                            aria-expanded={navigationGroup().expanded}
                            aria-label={navigationGroup().expanded ? i18n.t('terminal.collapseGroup') : i18n.t('terminal.expandGroup')}
                            onClick={() => props.onToggleGroup?.(navigationGroup().id)}
                          >
                            {navigationGroup().expanded ? '−' : '+'}
                          </button>
                          <button
                            type="button"
                            class="min-w-0 flex-1 cursor-pointer text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                            data-terminal-group-drag-handle={navigationGroup().id}
                            title={draggedSessionId() || draggedGroupId()
                              ? undefined
                              : `${navigationGroup().name}\n${navigationGroup().defaultWorkingDir}`}
                            onClick={() => props.onToggleGroup?.(navigationGroup().id)}
                          >
                            <span class="flex items-center gap-1.5">
                              <span class="min-w-0 flex-1 truncate text-[12px] font-semibold">{navigationGroup().name}</span>
                              <span class="rounded-full bg-primary/10 px-1.5 text-[9px] tabular-nums text-primary/80">{navigationGroup().pending ? '…' : navigationGroup().totalSessionCount}</span>
                            </span>
                            <span class="block truncate text-[9px] leading-3 text-muted-foreground/65">{navigationGroup().defaultWorkingDir}</span>
                          </button>
                          <button
                            type="button"
                            class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:cursor-not-allowed"
                            title={i18n.t('terminal.newSessionInGroup', { group: navigationGroup().name })}
                            aria-label={i18n.t('terminal.newSessionInGroup', { group: navigationGroup().name })}
                            onClick={() => props.onCreateSessionInGroup?.(navigationGroup().id)}
                            disabled={navigationGroup().pending}
                          >
                            <Plus class="h-3.5 w-3.5" />
                          </button>
                          <Show when={!navigationGroup().pending}>
                            <button
                              type="button"
                              class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                              aria-label={i18n.t('terminal.groupActions', { group: navigationGroup().name })}
                              aria-haspopup="menu"
                              data-testid={`terminal-group-actions-${navigationGroup().id}`}
                              onClick={(event) => props.onOpenGroupContextMenu?.(event, navigationGroup().id)}
                            >
                              <MoreHorizontal class="h-3.5 w-3.5" />
                            </button>
                          </Show>
                        </div>
                        <Show when={navigationGroup().expanded}>
                          <div
                            class="relative ml-[18px] mt-1 pl-5"
                            data-terminal-group-sessions={navigationGroup().id}
                            data-terminal-tree-children={navigationGroup().id}
                          >
                            <Show when={navigationGroup().itemIds.length > 0}>
                              <span
                                class={`pointer-events-none absolute left-0 top-0 w-px bg-[color-mix(in_srgb,var(--primary)_27%,var(--sidebar-border))] ${props.mobile ? 'bottom-[34px]' : 'bottom-[26px]'}`}
                                data-terminal-tree-rail={navigationGroup().id}
                                aria-hidden="true"
                              />
                            </Show>
                            <For each={navigationGroup().itemIds}>
                    {(sessionId) => {
                      const navigationIndex = createMemo(() => props.itemIds.indexOf(sessionId));
                      const item = createMemo(() => props.itemById.get(sessionId)!);
                      const sidebarActive = () => props.sidebarActiveSessionId === sessionId;
                      const committedActive = () => props.activeSessionId === sessionId;
                      const agentIdentity = createMemo<TerminalAgentCliIdentity | null>(() => {
                        const avatar = item().avatar;
                        return avatar.kind === 'agent' ? avatar.identity : null;
                      });
                      const agentPresentation = createMemo(() => agentIdentity()
                        ? TERMINAL_AGENT_CLI_PRESENTATIONS[agentIdentity()!]
                        : null);
                      const statusDescription = createMemo(() => describeTerminalSessionNavigationItem(item(), i18n.t));
                      const filesTooltip = createMemo(() => terminalFilesTooltip(item(), i18n.t));
                      const rowDropIntent = createMemo(() => {
                        const intent = dropIntent();
                        return intent?.targetSessionId === sessionId ? intent : null;
                      });
                      return (
                        <div
                          class="relative mb-0.5 transition-[transform,opacity] duration-150 last:mb-0"
                          classList={{
                            'opacity-35': draggedSessionId() === sessionId,
                            'translate-y-[3px]': rowDropIntent()?.position === 'before',
                            '-translate-y-[3px]': rowDropIntent()?.position === 'after',
                          }}
                          data-terminal-tree-child={sessionId}
                          data-terminal-session-drop-position={rowDropIntent()?.position}
                          onDragOver={(event) => {
                            if (!acceptsTerminalSessionDrag(event)) return;
                            const draggedId = draggedSessionFromEvent(event);
                            if (!draggedId || draggedId === sessionId) {
                              setDropIntent(null);
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                            const rect = event.currentTarget.getBoundingClientRect();
                            const useUpperBoundary = event.clientY < rect.top + rect.height / 2;
                            const orderedTargets = navigationGroup().itemIds.filter((candidate) => candidate !== draggedId);
                            const targetIndex = orderedTargets.indexOf(sessionId);
                            const nextTargetSessionId = orderedTargets[targetIndex + 1] ?? null;
                            const nextIntent = useUpperBoundary || !nextTargetSessionId
                              ? {
                                  beforeSessionId: useUpperBoundary ? sessionId : null,
                                  targetSessionId: sessionId,
                                  position: useUpperBoundary ? 'before' as const : 'after' as const,
                                }
                              : {
                                  beforeSessionId: nextTargetSessionId,
                                  targetSessionId: nextTargetSessionId,
                                  position: 'before' as const,
                                };
                            if (navigationGroup().itemIds.includes(draggedId)) {
                              const projected = [...orderedTargets];
                              const projectedIndex = nextIntent.beforeSessionId ? projected.indexOf(nextIntent.beforeSessionId) : -1;
                              projected.splice(projectedIndex >= 0 ? projectedIndex : projected.length, 0, draggedId);
                              if (projected.every((candidate, index) => candidate === navigationGroup().itemIds[index])) {
                                setDropIntent(null);
                                return;
                              }
                            }
                            setDropIntent({
                              groupId: navigationGroup().id,
                              ...nextIntent,
                            });
                          }}
                          onDrop={commitDrop}
                        >
                          <span
                            class="pointer-events-none absolute -left-5 top-1/2 h-px w-5 bg-[color-mix(in_srgb,var(--primary)_27%,var(--sidebar-border))]"
                            data-terminal-tree-connector={sessionId}
                            aria-hidden="true"
                          />
                          <span
                            class="pointer-events-none absolute -left-[23px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full border border-[color-mix(in_srgb,var(--primary)_38%,var(--sidebar-border))] bg-sidebar"
                            data-terminal-tree-junction={sessionId}
                            aria-hidden="true"
                          />
                          <Show when={rowDropIntent()} keyed>
                            {(intent) => (
                              <span
                                class={`pointer-events-none absolute -left-[22px] right-0 z-30 flex items-center ${intent.position === 'before' ? '-top-px' : '-bottom-px'}`}
                                data-terminal-session-drop-hint={sessionId}
                                data-terminal-session-drop-hint-position={intent.position}
                                aria-hidden="true"
                              >
                                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                <span class="h-px min-w-2 flex-1 bg-primary" />
                              </span>
                            )}
                          </Show>
                        <div
                          data-terminal-session-row={sessionId}
                          aria-grabbed={draggedSessionId() === sessionId ? 'true' : 'false'}
                          class={`group relative grid cursor-pointer items-center overflow-hidden rounded-md border border-transparent text-xs transition-[background-color,border-color,color,transform,opacity] duration-150 ${props.mobile
                            ? 'min-h-[68px] grid-cols-[36px_minmax(0,1fr)_60px] gap-x-2 px-2.5 py-1'
                            : 'min-h-[52px] grid-cols-[36px_minmax(0,1fr)_40px] gap-x-1.5 px-1.5 py-1'} ${sidebarActive()
                            ? 'border-primary/15 bg-[color-mix(in_srgb,var(--primary)_6%,var(--sidebar))] text-sidebar-accent-foreground'
                            : 'bg-transparent text-sidebar-foreground/78 hover:bg-sidebar-accent/45 hover:text-sidebar-accent-foreground'}`}
                          onContextMenu={(event) => props.onOpenContextMenu(event, item())}
                        >
                          <Tooltip
                            content={(
                              <span class="flex max-w-[min(82vw,360px)] flex-col gap-0.5 text-left">
                                <span class="break-words font-semibold">{item().title}</span>
                                <Show when={item().subtitle}>
                                  <span class="break-all text-popover-foreground/75">{item().subtitle}</span>
                                </Show>
                              </span>
                            )}
                            placement="right"
                            anchorClass="!absolute inset-0 z-0 !block"
                            disabled={draggedSessionId() !== null || draggedGroupId() !== null}
                          >
                            <button
                              type="button"
                              class="h-full w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                              data-terminal-session-id={sessionId}
                              data-terminal-session-active={sidebarActive() ? 'true' : 'false'}
                              data-terminal-session-index={navigationIndex() + 1}
                              aria-label={`${item().label}: ${item().title}${agentPresentation() ? `, ${agentPresentation()!.label}` : ''}${item().subtitle ? ` ${item().subtitle}` : ''}`}
                              aria-describedby={statusDescription() ? `${props.accessibilityIdPrefix}-session-status-${sessionId}` : undefined}
                              aria-current={committedActive() ? 'page' : undefined}
                              onPointerDown={(event) => props.onPreviewSession(event, sessionId)}
                              onPointerUp={() => queueMicrotask(props.onResetSessionPreview)}
                              onPointerCancel={props.onResetSessionPreview}
                              onClick={() => props.onSelectSession(sessionId)}
                              onKeyDown={(event) => props.onOpenKeyboardMenu(event, item())}
                            >
                              <span class="sr-only">{item().label}</span>
                              <Show when={item().transitionIndicator !== 'none'}>
                                <span class="sr-only" data-terminal-tab-status={item().transitionIndicator} />
                              </Show>
                              <Show when={item().attentionState !== 'none'}>
                                <span class="sr-only" data-terminal-tab-status={item().attentionState} />
                              </Show>
                              <Show when={item().transitionIndicator === 'none' && item().attentionState === 'none'}>
                                <span class="sr-only" data-terminal-tab-status="none" />
                              </Show>
                              <Show when={statusDescription()}>
                                <span class="sr-only" id={`${props.accessibilityIdPrefix}-session-status-${sessionId}`}>{statusDescription()}</span>
                              </Show>
                            </button>
                          </Tooltip>
                          <Show when={sidebarActive()}>
                            <span class="absolute left-0 top-2.5 bottom-2.5 z-10 w-[2px] rounded-full bg-primary" aria-hidden="true" />
                          </Show>
                          <button
                            type="button"
                            tabIndex={-1}
                            draggable={item().transitionState === 'none'}
                            class="relative z-10 flex h-9 w-9 shrink-0 cursor-grab select-none items-center justify-center rounded-full transition-colors duration-150 hover:bg-sidebar-accent/60 focus:outline-none active:cursor-grabbing"
                            classList={{ '!cursor-grabbing': draggedSessionId() === sessionId }}
                            data-terminal-session-drag-handle={sessionId}
                            aria-label={`${item().label}: ${item().title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onSelectSession(sessionId);
                            }}
                            onDragStart={(event) => {
                              if (!event.dataTransfer) return;
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('application/x-redeven-terminal-session', sessionId);
                              installCompactDragPreview(event, 'session');
                              setDraggedSessionId(sessionId);
                              setDraggedGroupId(null);
                              setDropIntent(null);
                              setGroupDropIntent(null);
                            }}
                            onDragEnd={clearDragState}
                          >
                            <Show
                              when={agentIdentity()}
                              fallback={(
                                <span
                                  class="pointer-events-none relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold uppercase leading-none shadow-[inset_0_1px_0_color-mix(in_srgb,var(--background)_18%,transparent)]"
                                  style={{
                                    background: item().avatarTone.background,
                                    'border-color': item().avatarTone.border,
                                    color: item().avatarTone.foreground,
                                  }}
                                  data-terminal-session-avatar={sessionId}
                                  aria-hidden="true"
                                >
                                  <Show
                                    when={item().avatar.kind === 'link'}
                                    fallback={item().avatarInitial}
                                  >
                                    <Link class="h-4 w-4" />
                                  </Show>
                                  <TerminalSessionTransitionBadge state={item().transitionIndicator} />
                                </span>
                              )}
                            >
                              {(identity) => (
                                <TerminalAgentIdentity
                                  identity={identity()}
                                  sessionId={sessionId}
                                  transitionIndicator={item().transitionIndicator}
                                />
                              )}
                            </Show>
                          </button>
                          <span
                            class="pointer-events-none relative z-10 grid min-h-11 min-w-0 content-center overflow-hidden text-left"
                            data-terminal-session-content={sessionId}
                          >
                            <span class="flex h-7 min-w-0 items-center gap-1">
                              <span
                                class="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5"
                                data-terminal-session-title={sessionId}
                              >
                                {item().title}
                              </span>
                              <span class="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center" data-terminal-output-slot={sessionId} data-terminal-attention-slot={sessionId}>
                                <Show
                                  when={item().outputState !== 'none'}
                                  fallback={(
                                    <Show
                                      when={item().attentionState === 'waiting'}
                                      fallback={(
                                        <Show when={item().attentionState === 'unread'}>
                                          <span
                                            class="h-1.5 w-1.5 rounded-full bg-primary forced-colors:border forced-colors:border-current"
                                            data-terminal-attention-state={item().attentionState}
                                            data-terminal-tab-status={item().attentionState}
                                          />
                                        </Show>
                                      )}
                                    >
                                      <Tooltip
                                        content={i18n.t('terminalAgentActivity.userInputRequired')}
                                        placement="top"
                                        delay={0}
                                        clickToToggle
                                        disabled={draggedSessionId() !== null || draggedGroupId() !== null}
                                      >
                                        <button
                                          type="button"
                                          class="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-warning transition-colors duration-75 hover:bg-warning/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring forced-colors:border forced-colors:border-current"
                                          aria-label={i18n.t('terminalAgentActivity.userInputRequired')}
                                          data-terminal-attention-trigger={sessionId}
                                        >
                                          <span
                                            class="h-2 w-2 rounded-full bg-current shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_14%,transparent)]"
                                            data-terminal-attention-state="waiting"
                                            data-terminal-tab-status="waiting"
                                            aria-hidden="true"
                                          />
                                        </button>
                                      </Tooltip>
                                    </Show>
                                  )}
                                >
                                  <Tooltip
                                    content={terminalActivityTooltip(
                                      item().activitySource === 'semantic' ? 'semantic' : 'output',
                                      item().attentionState === 'unread',
                                      i18n.t,
                                    )}
                                    placement="top"
                                    delay={0}
                                    clickToToggle
                                    disabled={draggedSessionId() !== null || draggedGroupId() !== null}
                                  >
                                    <button
                                      type="button"
                                      class="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-primary transition-colors duration-75 hover:bg-primary/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring forced-colors:border forced-colors:border-current"
                                      aria-label={terminalActivityTooltip(
                                        item().activitySource === 'semantic' ? 'semantic' : 'output',
                                        item().attentionState === 'unread',
                                        i18n.t,
                                      )}
                                      data-terminal-activity-source={item().activitySource}
                                      data-terminal-output-trigger={sessionId}
                                    >
                                      <TerminalOutputStatusGlyph
                                        state={item().outputState as Exclude<TerminalSessionOutputState, 'none'>}
                                      />
                                    </button>
                                  </Tooltip>
                                </Show>
                              </span>
                            </span>
                            <Show when={item().subtitle}>
                              <span class="flex h-4 min-w-0 max-w-full items-center">
                                <Show when={item().subtitleIcon === 'link'}>
                                  <Link class="mr-1 h-3 w-3 shrink-0 text-muted-foreground/75" aria-hidden="true" />
                                </Show>
                                <span
                                  class="pointer-events-none min-w-0 flex-1 cursor-pointer truncate text-[11px] leading-4 text-muted-foreground/75"
                                  data-terminal-session-path={sessionId}
                                  data-testid={`terminal-session-path-${sessionId}`}
                                >
                                  {item().subtitle}
                                </span>
                              </span>
                            </Show>
                          </span>
                          <div
                            class={`pointer-events-none relative z-20 grid self-center justify-self-end gap-1 ${props.mobile
                              ? 'grid-cols-[28px_28px] grid-rows-[28px_28px]'
                              : 'grid-cols-[20px_20px] grid-rows-[20px_20px]'}`}
                            data-terminal-session-actions={sessionId}
                          >
                            <span
                              class={`col-start-1 row-start-1 flex items-center justify-center ${props.mobile ? 'h-7 w-7' : 'h-5 w-5'}`}
                              data-terminal-session-action-cell="index"
                              aria-hidden="true"
                            >
                              <Show when={!props.mobile && navigationIndex() >= 0 && navigationIndex() < 9}>
                                <span class="flex h-5 w-5 items-center justify-center rounded bg-sidebar-accent/45 text-[9px] font-medium leading-none tabular-nums text-muted-foreground/75">
                                  {navigationIndex() + 1}
                                </span>
                              </Show>
                            </span>
                            <span
                              class={`col-start-2 row-start-1 flex items-center justify-center ${props.mobile ? 'h-7 w-7' : 'h-5 w-5'}`}
                              data-terminal-session-action-cell="close"
                            >
                              <Show when={item().closable}>
                                <button
                                  type="button"
                                  class={`flex cursor-pointer items-center justify-center rounded text-[11px] text-muted-foreground/70 transition-[opacity,color,background-color] duration-75 hover:bg-error/10 hover:text-error focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${props.mobile
                                    ? 'h-7 w-7'
                                    : 'h-5 w-5'} ${props.mobile
                                    ? 'pointer-events-auto opacity-100'
                                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'}`}
                                  data-testid={`close-session-${sessionId}`}
                                  aria-label={`${i18n.t('terminal.deleteSession')} ${item().title}`}
                                  title={i18n.t('terminal.deleteSession')}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    props.onCloseSession(sessionId);
                                  }}
                                >
                                  <X class="h-3 w-3" />
                                </button>
                              </Show>
                            </span>
                            <span
                              class={`col-start-1 row-start-2 flex items-center justify-center ${props.mobile ? 'h-7 w-7' : 'h-5 w-5'}`}
                              data-terminal-session-action-cell="copy"
                            >
                              <Show when={item().fullPath}>
                                <button
                                  type="button"
                                  class={`pointer-events-auto flex cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors duration-75 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${props.mobile ? 'h-7 w-7' : 'h-5 w-5'} ${props.copiedPathSessionId === sessionId
                                    ? 'bg-primary/10 text-primary'
                                    : 'hover:bg-sidebar-accent hover:text-sidebar-foreground'}`}
                                  title={props.copiedPathSessionId === sessionId ? i18n.t('terminal.pathCopied') : i18n.t('terminal.copyPath')}
                                  aria-label={`${props.copiedPathSessionId === sessionId ? i18n.t('terminal.pathCopied') : i18n.t('terminal.copyPath')}: ${item().fullPath}`}
                                  data-testid={`terminal-session-path-copy-${sessionId}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    props.onCopyPath(item());
                                  }}
                                >
                                  <Show when={props.copiedPathSessionId === sessionId} fallback={<Copy class="h-3 w-3" />}>
                                    <Check class="h-3 w-3" />
                                  </Show>
                                </button>
                              </Show>
                            </span>
                            <span
                              class={`col-start-2 row-start-2 flex items-center justify-center ${props.mobile ? 'h-7 w-7' : 'h-5 w-5'}`}
                              data-terminal-session-action-cell="files"
                            >
                              <Tooltip content={filesTooltip()} placement="top" delay={0} disabled={draggedSessionId() !== null || draggedGroupId() !== null}>
                                <button
                                  type="button"
                                  class={`flex items-center justify-center rounded text-muted-foreground/70 transition-[opacity,color,background-color] duration-75 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${item().canBrowsePath
                                    ? 'cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-foreground'
                                    : 'cursor-not-allowed opacity-45'} ${props.mobile ? 'h-7 w-7' : 'h-5 w-5'} ${props.mobile
                                    ? 'pointer-events-auto opacity-100'
                                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'}`}
                                  data-testid={`terminal-session-files-${sessionId}`}
                                  data-terminal-files-availability={item().filesAvailability}
                                  aria-disabled={item().canBrowsePath ? undefined : 'true'}
                                  aria-label={filesTooltip()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!item().canBrowsePath) return;
                                    props.onOpenFiles(item());
                                  }}
                                >
                                  <FolderOpen class="h-3 w-3" />
                                </button>
                              </Tooltip>
                            </span>
                          </div>
                        </div>
                        </div>
                      );
                    }}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </Index>
                  <div
                    class="relative min-h-6 flex-1"
                    data-terminal-group-list-end
                    onDragOver={(event) => {
                      if (!acceptsTerminalGroupDrag(event)) return;
                      const draggedId = draggedGroupFromEvent(event);
                      const originalOrder = navigationGroups()
                        .filter((group) => !group.isDefault && !group.pending)
                        .map((group) => group.id);
                      if (!draggedId || !originalOrder.includes(draggedId) || originalOrder.at(-1) === draggedId) {
                        setGroupDropIntent(null);
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                      setGroupDropIntent({
                        beforeGroupId: null,
                        targetGroupId: null,
                        position: 'after',
                      });
                    }}
                    onDragLeave={(event) => {
                      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                      if (groupDropIntent()?.targetGroupId === null) setGroupDropIntent(null);
                    }}
                    onDrop={commitGroupDrop}
                  >
                    <Show when={groupDropIntent()?.targetGroupId === null}>
                      <span
                        class="pointer-events-none absolute left-1 right-1 top-1 z-40 flex items-center"
                        data-terminal-group-list-end-drop-hint
                        aria-hidden="true"
                      >
                        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span class="h-px min-w-2 flex-1 bg-primary" />
                      </span>
                    </Show>
                  </div>
                  <Show when={navigationGroups().length === 0}>
                    <div class="rounded-md border border-sidebar-border/70 bg-sidebar-accent/25 px-2.5 py-3 text-xs text-muted-foreground">
                      {props.emptyListLoading
                        ? i18n.t('terminal.loadingSessions')
                        : props.filterQuery.trim()
                          ? i18n.t('terminal.noMatchingSessions')
                          : i18n.t('terminal.noSessionsTitle')}
                    </div>
                  </Show>
                </SidebarItemList>
              </div>
            </SidebarSection>
            <span class="sr-only" aria-live="polite" data-terminal-drag-announcement>
              {draggedSessionId() ? dropAnnouncement() : ''}
            </span>
          </SidebarContent>
        </Sidebar>
      </div>
    </>
  );
}
