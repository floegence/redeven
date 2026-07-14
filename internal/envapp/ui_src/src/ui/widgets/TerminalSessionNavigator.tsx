import { For, Show, createMemo } from 'solid-js';
import { Sidebar, SidebarContent, SidebarItemList, SidebarSection } from '@floegence/floe-webapp-core/layout';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { Check, Copy, ExternalLink, Plus, Refresh, Search, Terminal, X } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

export type TerminalSessionNavigationStatus = 'none' | 'running' | 'unread' | 'creating' | 'failed';

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
  fullPath: string;
  status: TerminalSessionNavigationStatus;
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

function TerminalSidebarStatusBadge(props: { status: TerminalSessionNavigationStatus }) {
  return (
    <>
      <Show when={props.status === 'running'}>
        <span
          class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-sidebar-foreground shadow-sm"
          data-terminal-tab-status="running"
          aria-hidden="true"
        >
          <svg class="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
            <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
      </Show>
      <Show when={props.status === 'unread'}>
        <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-primary/75 shadow-sm" data-terminal-tab-status="unread" aria-hidden="true" />
      </Show>
      <Show when={props.status === 'creating'}>
        <span
          class="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-sidebar bg-sidebar text-muted-foreground shadow-sm"
          data-terminal-tab-status="creating"
          aria-hidden="true"
        >
          <svg class="h-2.5 w-2.5 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
            <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
      </Show>
      <Show when={props.status === 'failed'}>
        <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar bg-error shadow-sm" data-terminal-tab-status="failed" aria-hidden="true" />
      </Show>
      <Show when={props.status === 'none'}>
        <span class="hidden" data-terminal-tab-status="none" aria-hidden="true" />
      </Show>
    </>
  );
}

export function TerminalSessionNavigator(props: TerminalSessionNavigatorProps) {
  const i18n = useI18n();
  const sidebarWidth = () => (props.mobile ? 232 : 286);

  return (
    <>
      <Show when={props.mobile && props.drawerOpen}>
        <button
          type="button"
          class="absolute inset-0 z-30 cursor-default bg-black/45"
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
              ? 'absolute inset-y-0 left-0 z-40 !w-[min(88vw,320px)] shadow-2xl'
              : 'hidden'
            : ''}`}
        >
          <SidebarContent class="flex h-full min-h-0 flex-col overflow-hidden">
            <div class="shrink-0 space-y-2">
              <div class="flex items-center gap-2 px-0.5">
                <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/55 text-sidebar-accent-foreground">
                  <Terminal class="h-3.5 w-3.5" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{i18n.t('terminal.title')}</div>
                  <div class="truncate text-xs font-semibold text-sidebar-foreground">{props.activeTitle}</div>
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
                      return (
                        <div
                          class={`group relative rounded-md border px-2.5 py-2 pr-9 text-xs transition-colors duration-75 ${sidebarActive()
                            ? 'border-border/20 bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_1px_3px_rgba(0,0,0,0.06)]'
                            : 'border-transparent text-sidebar-foreground/80 hover:border-border/15 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`}
                          onContextMenu={(event) => props.onOpenContextMenu(event, item())}
                        >
                          <button
                            type="button"
                            class="absolute inset-0 z-0 w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                            data-terminal-session-id={sessionId}
                            data-terminal-session-active={sidebarActive() ? 'true' : 'false'}
                            data-terminal-session-index={index() + 1}
                            aria-label={`${item().label}: ${item().title}${item().fullPath ? ` ${item().fullPath}` : ''}`}
                            aria-current={committedActive() ? 'page' : undefined}
                            title={item().fullPath || item().title}
                            onPointerDown={(event) => props.onPreviewSession(event, sessionId)}
                            onPointerUp={() => queueMicrotask(props.onResetSessionPreview)}
                            onPointerCancel={props.onResetSessionPreview}
                            onClick={() => props.onSelectSession(sessionId)}
                            onKeyDown={(event) => props.onOpenKeyboardMenu(event, item())}
                          >
                            <span class="sr-only">{item().label}</span>
                            <span class="sr-only" data-terminal-tab-status={item().status}>{item().status}</span>
                          </button>
                          <Show when={sidebarActive()}>
                            <span class="absolute left-0 top-2 bottom-2 z-10 w-[2px] rounded-full bg-primary" aria-hidden="true" />
                          </Show>
                          <div class="relative z-10 flex min-w-0 items-start gap-2.5 pointer-events-none">
                            <span
                              class="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold uppercase leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                              style={{
                                background: item().avatarTone.background,
                                'border-color': item().avatarTone.border,
                                color: item().avatarTone.foreground,
                              }}
                              data-terminal-session-avatar={sessionId}
                              aria-hidden="true"
                            >
                              {item().avatarInitial}
                              <TerminalSidebarStatusBadge status={item().status} />
                            </span>
                            <span class="min-w-0 flex-1 text-left">
                              <span class="flex min-w-0 items-center gap-1.5">
                                <span class="truncate text-sm font-semibold leading-5">{item().title}</span>
                                <span class="shrink-0 rounded border border-sidebar-border/80 bg-sidebar/35 px-1 py-[1px] text-[9px] leading-none text-muted-foreground/80">{index() + 1}</span>
                              </span>
                              <Show when={item().fullPath}>
                                <span class="mt-0.5 flex h-6 min-w-0 max-w-full items-center gap-1.5">
                                  <span
                                    class="pointer-events-none min-w-0 flex-1 cursor-pointer truncate text-[11px] leading-6 text-muted-foreground/75"
                                    title={item().fullPath}
                                    data-terminal-session-path={sessionId}
                                    data-testid={`terminal-session-path-${sessionId}`}
                                  >
                                    {item().fullPath}
                                  </span>
                                  <button
                                    type="button"
                                    class={`pointer-events-auto flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors duration-75 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${props.copiedPathSessionId === sessionId
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
                                </span>
                              </Show>
                            </span>
                          </div>
                          <div class="pointer-events-none absolute right-1.5 top-1.5 z-20 flex w-5 flex-col items-center gap-1 group-hover:pointer-events-auto focus-within:pointer-events-auto">
                            <Show when={item().closable}>
                              <button
                                type="button"
                                class="pointer-events-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded text-[11px] text-muted-foreground/70 opacity-0 transition-opacity duration-75 hover:bg-error/10 hover:text-error focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
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
                            <Show when={item().canBrowsePath}>
                              <button
                                type="button"
                                class="pointer-events-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity duration-75 hover:bg-sidebar-accent hover:text-sidebar-foreground focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover:opacity-100"
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
