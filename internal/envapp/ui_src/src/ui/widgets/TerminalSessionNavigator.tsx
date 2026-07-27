import { For, Show, createMemo } from 'solid-js';
import { Sidebar, SidebarContent, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { Check, Copy, ExternalLink, Link, Plus, Refresh, Search, Terminal, X } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import {
  TERMINAL_AGENT_CLI_PRESENTATIONS,
  type TerminalSessionOutputState,
} from './terminalAgentSessionPresentation';
import type { TerminalAgentCliIdentity } from '@floegence/floeterm-terminal-web/sessions';
import type { TerminalSessionChromeAvatar } from '../services/terminalSessionChrome';

export type TerminalSessionProcessState = 'none' | 'running' | 'creating' | 'failed';
export type TerminalSessionAttentionState = 'none' | 'waiting' | 'unread';
export type TerminalSessionTransitionState = 'none' | 'creating' | 'reconnecting' | 'opening' | 'failed';
export type TerminalSessionFailureKind = 'none' | 'creation' | 'runtime';

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
  processState: TerminalSessionProcessState;
  transitionState: TerminalSessionTransitionState;
  failureKind: TerminalSessionFailureKind;
  outputState: TerminalSessionOutputState;
  activitySource: 'none' | 'semantic' | 'output';
  attentionState: TerminalSessionAttentionState;
  remote: boolean;
  canBrowsePath: boolean;
  canClear: boolean;
  canDuplicate: boolean;
  closable: boolean;
}>;

export type TerminalSessionNavigatorProps = Readonly<{
  mobile: boolean;
  drawerOpen: boolean;
  connected: boolean;
  refreshing: boolean;
  activeTitle: string;
  activeAvatar: TerminalSessionChromeAvatar;
  shortcutModLabel: string;
  filterQuery: string;
  itemIds: readonly string[];
  itemById: ReadonlyMap<string, TerminalSessionNavigationItem>;
  sidebarActiveSessionId: string | null;
  activeSessionId: string | null;
  copiedPathSessionId: string | null;
  emptyListLoading: boolean;
  onCloseDrawer: () => void;
  onCreateSession: () => void;
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

export function TerminalSessionProcessBadge(props: { state: TerminalSessionProcessState }) {
  return (
    <>
      <Show when={props.state === 'running'}>
        <span
          class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-sidebar-foreground shadow-sm"
          data-terminal-process-state="running"
          data-terminal-tab-status="running"
          aria-hidden="true"
        >
          <svg class="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
            <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
      </Show>
      <Show when={props.state === 'creating'}>
        <span
          class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-muted-foreground shadow-sm"
          data-terminal-process-state="creating"
          data-terminal-tab-status="creating"
          aria-hidden="true"
        >
          <svg class="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
            <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
      </Show>
      <Show when={props.state === 'failed'}>
        <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-error shadow-sm" data-terminal-process-state="failed" data-terminal-tab-status="failed" aria-hidden="true" />
      </Show>
      <Show when={props.state === 'none'}>
        <span class="hidden" data-terminal-process-state="none" aria-hidden="true" />
      </Show>
    </>
  );
}

function TerminalAgentIdentity(props: {
  identity: TerminalAgentCliIdentity;
  sessionId: string;
  processState: TerminalSessionProcessState;
}) {
  const presentation = createMemo(() => TERMINAL_AGENT_CLI_PRESENTATIONS[props.identity]);
  const themeAdaptiveImage = createMemo(() => Boolean(presentation().lightIconPath && presentation().darkIconPath));
  return (
    <span
      class={`relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sidebar-border/70 text-sidebar-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,var(--background)_18%,transparent)] ${presentation().render === 'mask' || themeAdaptiveImage()
        ? 'bg-sidebar/65'
        : 'bg-[var(--redeven-surface-control)]'}`}
      data-terminal-session-avatar={props.sessionId}
      data-terminal-agent-identity={props.identity}
      aria-hidden="true"
    >
      <Show
        when={presentation().render === 'mask'}
        fallback={(
          <Show
            when={themeAdaptiveImage()}
            fallback={<img class="h-5 w-5 object-contain" src={presentation().iconPath} alt="" draggable={false} />}
          >
            <img class="h-5 w-5 object-contain dark:hidden" src={presentation().lightIconPath} alt="" draggable={false} />
            <img class="hidden h-5 w-5 object-contain dark:block" src={presentation().darkIconPath} alt="" draggable={false} />
          </Show>
        )}
      >
        <span
          class="h-5 w-5 bg-current"
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
      <TerminalSessionProcessBadge state={props.processState} />
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

function terminalActivityTooltip(
  source: 'semantic' | 'output',
  unread: boolean,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const activity = source === 'semantic'
    ? t('codexActivity.status.working')
    : t('terminal.outputStreaming');
  return unread ? `${activity}. ${t('terminal.unreadOutputDescription')}` : activity;
}

export function describeTerminalSessionNavigationItem(
  item: TerminalSessionNavigationItem,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const agentPresentation = item.avatar.kind === 'agent'
    ? TERMINAL_AGENT_CLI_PRESENTATIONS[item.avatar.identity]
    : null;
  return [
    agentPresentation ? t('terminal.agentCliDescription', { name: agentPresentation.label }) : '',
    item.transitionState === 'creating' ? `${t('terminal.creatingStatus')}.` : '',
    item.transitionState === 'reconnecting' ? `${t('terminal.reconnecting')}.` : '',
    item.transitionState === 'opening' ? `${t('terminal.remoteOpeningStatus')}.` : '',
    item.failureKind === 'creation' ? `${t('terminal.creationFailedStatus')}.` : '',
    item.failureKind === 'runtime' ? `${t('terminal.terminalUnavailable')}.` : '',
    item.processState === 'running' && item.transitionState === 'none' ? t('terminal.processRunningDescription') : '',
    item.outputState !== 'none' && item.activitySource === 'semantic' ? `${t('codexActivity.status.working')}.` : '',
    item.outputState !== 'none' && item.activitySource === 'output' ? `${t('terminal.outputStreaming')}.` : '',
    item.attentionState === 'waiting' ? t('codex.pendingRequests.titleByType.userInput') : '',
    item.attentionState === 'unread' ? t('terminal.unreadOutputDescription') : '',
  ].filter(Boolean).join(' ');
}

export function TerminalSessionNavigator(props: TerminalSessionNavigatorProps) {
  const i18n = useI18n();
  const sidebarWidth = () => (props.mobile ? 232 : 286);

  return (
    <>
      <Show when={props.mobile && props.drawerOpen}>
        <button
          type="button"
          class="absolute inset-0 z-30 cursor-default bg-[var(--redeven-overlay-scrim)]"
          aria-label={i18n.t('terminal.closeSessions')}
          data-testid="terminal-session-drawer-backdrop"
          onClick={props.onCloseDrawer}
        />
      </Show>
      <div
        class="contents"
        role={props.mobile && props.drawerOpen ? 'dialog' : undefined}
        aria-modal={props.mobile && props.drawerOpen ? 'true' : undefined}
        aria-label={props.mobile && props.drawerOpen ? i18n.t('terminal.sessions') : undefined}
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
                  data-testid="terminal-sidebar-add-session"
                  onClick={props.onCreateSession}
                  disabled={!props.connected}
                  title={i18n.t('terminal.newSession')}
                >
                  <Plus class="h-3.5 w-3.5" />
                </Button>
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
                    class="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
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
              actions={<span class="text-[9px] font-medium normal-case tracking-normal text-muted-foreground/60">{props.shortcutModLabel}+1-9</span>}
              class="min-h-0 flex flex-1 flex-col overflow-hidden [&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:overflow-hidden"
            >
              <div data-testid="terminal-session-list" class="min-h-0 flex-1 overflow-hidden">
                <SidebarItemList
                  {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
                  class="min-h-0 h-full overflow-y-auto overflow-x-hidden pr-0.5 [scrollbar-gutter:stable]"
                >
                  <For
                    each={props.itemIds}
                    fallback={
                      <div class="rounded-md border border-sidebar-border/70 bg-sidebar-accent/25 px-2.5 py-3 text-xs text-muted-foreground">
                        {props.emptyListLoading
                          ? i18n.t('terminal.loadingSessions')
                          : props.filterQuery.trim()
                            ? i18n.t('terminal.noMatchingSessions')
                            : i18n.t('terminal.noSessionsTitle')}
                      </div>
                    }
                  >
                    {(sessionId, index) => {
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
                      return (
                        <div
                          data-terminal-session-row={sessionId}
                          class={`group relative overflow-hidden rounded-md border px-2.5 py-2 pr-16 text-xs transition-colors duration-75 ${sidebarActive()
                            ? 'border-border/20 bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_1px_3px_color-mix(in_srgb,var(--foreground)_6%,transparent)]'
                            : 'border-transparent text-sidebar-foreground/80 hover:border-border/15 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`}
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
                          >
                            <button
                              type="button"
                              class="h-full w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                              data-terminal-session-id={sessionId}
                              data-terminal-session-active={sidebarActive() ? 'true' : 'false'}
                              data-terminal-session-index={index() + 1}
                              aria-label={`${item().label}: ${item().title}${agentPresentation() ? `, ${agentPresentation()!.label}` : ''}${item().subtitle ? ` ${item().subtitle}` : ''}`}
                              aria-describedby={statusDescription() ? `terminal-session-status-${sessionId}` : undefined}
                              aria-current={committedActive() ? 'page' : undefined}
                              onPointerDown={(event) => props.onPreviewSession(event, sessionId)}
                              onPointerUp={() => queueMicrotask(props.onResetSessionPreview)}
                              onPointerCancel={props.onResetSessionPreview}
                              onClick={() => props.onSelectSession(sessionId)}
                              onKeyDown={(event) => props.onOpenKeyboardMenu(event, item())}
                            >
                              <span class="sr-only">{item().label}</span>
                              <Show when={item().processState !== 'none'}>
                                <span class="sr-only" data-terminal-tab-status={item().processState} />
                              </Show>
                              <Show when={item().attentionState !== 'none'}>
                                <span class="sr-only" data-terminal-tab-status={item().attentionState} />
                              </Show>
                              <Show when={item().processState === 'none' && item().attentionState === 'none'}>
                                <span class="sr-only" data-terminal-tab-status="none" />
                              </Show>
                              <Show when={statusDescription()}>
                                <span class="sr-only" id={`terminal-session-status-${sessionId}`}>{statusDescription()}</span>
                              </Show>
                            </button>
                          </Tooltip>
                          <Show when={sidebarActive()}>
                            <span class="absolute left-0 top-2 bottom-2 z-10 w-[2px] rounded-full bg-primary" aria-hidden="true" />
                          </Show>
                          <div class="relative z-10 flex min-w-0 items-start gap-2.5 pointer-events-none">
                            <Show
                              when={agentIdentity()}
                              fallback={(
                                <span
                                  class="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold uppercase leading-none shadow-[inset_0_1px_0_color-mix(in_srgb,var(--background)_18%,transparent)]"
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
                                  <TerminalSessionProcessBadge state={item().processState} />
                                </span>
                              )}
                            >
                              {(identity) => (
                                <TerminalAgentIdentity
                                  identity={identity()}
                                  sessionId={sessionId}
                                  processState={item().processState}
                                />
                              )}
                            </Show>
                            <span class="min-w-0 flex-1 overflow-hidden text-left">
                              <span class="flex min-w-0 items-center gap-1">
                                <span
                                  class="min-w-0 flex-1 truncate text-sm font-semibold leading-5"
                                  data-terminal-session-title={sessionId}
                                >
                                  {item().title}
                                </span>
                                <span class="flex h-7 w-2 shrink-0 items-center justify-center" data-terminal-attention-slot={sessionId} aria-hidden="true">
                                  <Show when={item().attentionState === 'unread' && item().outputState === 'none'}>
                                    <span
                                      class="h-1.5 w-1.5 rounded-full bg-primary forced-colors:border forced-colors:border-current"
                                      data-terminal-attention-state={item().attentionState}
                                      data-terminal-tab-status={item().attentionState}
                                    />
                                  </Show>
                                </span>
                                <span class="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center" data-terminal-output-slot={sessionId}>
                                  <Show
                                    when={item().outputState !== 'none'}
                                    fallback={(
                                      <Show when={item().attentionState === 'waiting'}>
                                        <Tooltip
                                          content={i18n.t('codex.pendingRequests.titleByType.userInput')}
                                          placement="top"
                                          delay={0}
                                          clickToToggle
                                        >
                                          <button
                                            type="button"
                                            class="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-warning transition-colors duration-75 hover:bg-warning/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring forced-colors:border forced-colors:border-current"
                                            aria-label={i18n.t('codex.pendingRequests.titleByType.userInput')}
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
                                <span class="mt-0.5 flex h-6 min-w-0 max-w-full items-center">
                                  <Show when={item().subtitleIcon === 'link'}>
                                    <Link class="mr-1 h-3 w-3 shrink-0 text-muted-foreground/75" aria-hidden="true" />
                                  </Show>
                                  <span
                                    class="pointer-events-none min-w-0 flex-1 cursor-pointer truncate text-[11px] leading-6 text-muted-foreground/75"
                                    data-terminal-session-path={sessionId}
                                    data-testid={`terminal-session-path-${sessionId}`}
                                  >
                                    {item().subtitle}
                                  </span>
                                </span>
                              </Show>
                            </span>
                          </div>
                          <div
                            class="pointer-events-none absolute right-1.5 top-1.5 z-20 grid grid-cols-[20px_20px] grid-rows-[20px_20px] gap-1"
                            data-terminal-session-actions={sessionId}
                          >
                            <span
                              class="col-start-1 row-start-1 flex h-5 w-5 items-center justify-center"
                              data-terminal-session-action-cell="index"
                              aria-hidden="true"
                            >
                              <Show when={!props.mobile && index() < 9}>
                                <span class="flex h-5 w-5 items-center justify-center rounded border border-sidebar-border/80 bg-sidebar/35 text-[9px] font-medium leading-none tabular-nums text-muted-foreground/80">
                                  {index() + 1}
                                </span>
                              </Show>
                            </span>
                            <span
                              class="col-start-2 row-start-1 flex h-5 w-5 items-center justify-center"
                              data-terminal-session-action-cell="close"
                            >
                              <Show when={item().closable}>
                                <button
                                  type="button"
                                  class={`flex h-5 w-5 cursor-pointer items-center justify-center rounded text-[11px] text-muted-foreground/70 transition-[opacity,color,background-color] duration-75 hover:bg-error/10 hover:text-error focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${props.mobile
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
                              class="col-start-1 row-start-2 flex h-5 w-5 items-center justify-center"
                              data-terminal-session-action-cell="copy"
                            >
                              <Show when={item().fullPath}>
                                <button
                                  type="button"
                                  class={`pointer-events-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors duration-75 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${props.copiedPathSessionId === sessionId
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
                              class="col-start-2 row-start-2 flex h-5 w-5 items-center justify-center"
                              data-terminal-session-action-cell="files"
                            >
                              <Show when={item().canBrowsePath}>
                                <button
                                  type="button"
                                  class={`flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-[opacity,color,background-color] duration-75 hover:bg-sidebar-accent hover:text-sidebar-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${props.mobile
                                    ? 'pointer-events-auto opacity-100'
                                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'}`}
                                  data-testid={`terminal-session-files-${sessionId}`}
                                  aria-label={`${i18n.t('terminal.files')}: ${item().fullPath}`}
                                  title={`${i18n.t('terminal.files')}: ${item().fullPath}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    props.onOpenFiles(item());
                                  }}
                                >
                                  <ExternalLink class="h-3 w-3" />
                                </button>
                              </Show>
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </SidebarItemList>
              </div>
            </SidebarSection>
          </SidebarContent>
        </Sidebar>
      </div>
    </>
  );
}
