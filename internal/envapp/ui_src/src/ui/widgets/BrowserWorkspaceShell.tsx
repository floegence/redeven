import './adaptive-sidebar.css';
import { Show, createEffect, createSignal, type Accessor, type JSX } from 'solid-js';
import { cn, createAdaptiveSidebar, createRetainedContent, useLayout } from '@floegence/floe-webapp-core';
import { Dialog, DialogPlacementProvider } from '@floegence/floe-webapp-core/ui';
import { SidebarPane } from '@floegence/floe-webapp-core/layout';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { useI18n } from '../i18n';

/**
 * Fixed mobile sidebar width in px.
 * Desktop uses the caller-provided (resizable) width;
 * mobile always uses this constant so a desktop resize never leaks into mobile.
 */
const MOBILE_SIDEBAR_WIDTH = 288;

export interface BrowserWorkspaceShellProps {
  title?: JSX.Element;
  width?: number;
  open?: boolean;
  resizable?: boolean;
  onResize?: (delta: number) => void;
  onClose?: () => void;
  rootRef?: (el: HTMLDivElement) => void;
  bodyRef?: (el: HTMLDivElement) => void;
  modeSwitcher: JSX.Element;
  navigation?: JSX.Element;
  sidebarBody: JSX.Element;
  sidebarBodyClass?: string;
  content: (navigation: { overlay: Accessor<boolean>; open: Accessor<boolean>; toggle: () => void }) => JSX.Element;
  class?: string;
}

export function BrowserWorkspaceShell(props: BrowserWorkspaceShellProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const isMobile = () => layout.isMobile();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [desktopOpen, setDesktopOpen] = createSignal(false);
  const [desktopPresent, setDesktopPresent] = createSignal(false);
  const presentation = createAdaptiveSidebar({ container: root, sidebarWidth: () => props.width ?? 240, minContentWidth: () => 480 });
  const desktopOverlay = () => !isMobile() && presentation() === 'overlay';
  createEffect(() => { if (!desktopOverlay()) setDesktopOpen(false); });

  const SidebarContent = createRetainedContent(() => (
    <SidebarPane
      title={<span class="text-muted-foreground">{props.title ?? i18n.t('files.title')}</span>}
      headerActions={
        <>
          <Show when={isMobile() && props.onClose}>
            <button
              type="button"
              onClick={() => props.onClose?.()}
              class="flex items-center justify-center w-5 h-5 rounded cursor-pointer hover:bg-sidebar-accent/80 transition-colors"
              aria-label={i18n.t('uiCopy.shell.closeSidebar')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-3.5 h-3.5"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </Show>
        </>
      }
      width={isMobile() ? MOBILE_SIDEBAR_WIDTH : props.width}
      open={desktopOverlay() || props.open}
      resizable={!isMobile() && !desktopOverlay() && props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      mobileOverlay={false}
      mobileBackdrop={false}
      class={cn(
        'h-full',
        desktopOverlay() && '!w-full !min-w-0 !max-w-full',
        // On mobile the aside must ALWAYS be absolutely positioned —
        // not just when open — so the closing width-transition never
        // pushes the content area.  SidebarPane's built-in overlay
        // ties `position:absolute` to `open`, which causes a push
        // during the close animation.
        isMobile() && 'absolute inset-y-0 left-0 z-30 shadow-xl max-w-[80vw]',
      )}
      innerClass={desktopOverlay() ? '!w-full' : undefined}
      bodyClass={cn('py-0', props.sidebarBodyClass)}
      bodyRef={props.bodyRef}
    >
      <div class="flex h-full min-h-0 flex-col bg-sidebar">
        <div class="sticky top-0 z-10 shrink-0 border-b border-sidebar-border bg-sidebar/95 px-2.5 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-sidebar/90">
          {props.modeSwitcher}

          <Show when={props.navigation}>
            <div class="mt-1.5">
              {props.navigation}
            </div>
          </Show>
        </div>

        <div class="min-h-0 flex-1 px-2.5 py-2">
          {props.sidebarBody}
        </div>
      </div>
    </SidebarPane>

  ));

  return (
    <div ref={el => { setRoot(el); props.rootRef?.(el); }} data-browser-workspace
      style={{ '--redeven-sidebar-width': `${props.width ?? 240}px` }}
      data-browser-sidebar-presentation={desktopOverlay() ? 'overlay' : 'inline'}
      class={cn('relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background', props.class)}>
      <Show when={isMobile() && props.open}>
        <div class="absolute inset-0 z-20 cursor-pointer bg-[var(--redeven-overlay-scrim)]" onClick={() => props.onClose?.()} />
      </Show>
      <Show when={desktopOverlay()} fallback={<SidebarContent />}>
        <div class={cn('absolute inset-0 z-30', desktopPresent() ? 'pointer-events-auto' : 'pointer-events-none')} data-floe-dialog-surface-host="true" data-floe-surface-portal-layer="true">
          <DialogPlacementProvider mode="auto">
            <Dialog open={desktopOpen()} onOpenChange={setDesktopOpen} onPresenceChange={setDesktopPresent} title={props.title ?? i18n.t('files.title')}
              presentation="side-drawer" drawerSide="left" escapeKeyPhase="bubble"
              class="redeven-adaptive-sidebar-drawer" contentClass="flex min-h-0 flex-col overflow-hidden p-0">
              <SidebarContent />
            </Dialog>
          </DialogPlacementProvider>
        </div>
      </Show>
      <div inert={desktopPresent()} class={cn('min-w-0 min-h-0 flex-1', redevenSurfaceRoleClass('main'))}>
        {props.content({ overlay: desktopOverlay, open: desktopOpen, toggle: () => setDesktopOpen(value => !value) })}
      </div>
    </div>
  );
}
