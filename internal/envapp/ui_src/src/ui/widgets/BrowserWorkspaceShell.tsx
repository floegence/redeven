import { Show, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { SidebarPane } from '@floegence/floe-webapp-core/layout';

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
  bodyRef?: (el: HTMLDivElement) => void;
  modeSwitcher: JSX.Element;
  navigation?: JSX.Element;
  navigationLabel?: string;
  sidebarBody: JSX.Element;
  sidebarBodyClass?: string;
  content: JSX.Element;
  class?: string;
}

export function BrowserWorkspaceShell(props: BrowserWorkspaceShellProps) {
  const layout = useLayout();
  const isMobile = () => layout.isMobile();

  return (
    <div class={cn('relative flex h-full min-h-0 overflow-hidden bg-background', props.class)}>
      {/* Mobile backdrop — rendered independently so it is never affected by
          SidebarPane's own overlay logic.  z-20 sits between the content (z-auto)
          and the sidebar (z-30). */}
      <Show when={isMobile() && props.open}>
        <div
          class="absolute inset-0 z-20 bg-black/30"
          onClick={() => props.onClose?.()}
        />
      </Show>

      <SidebarPane
        title={props.title ?? 'Browser'}
        headerActions={
          <>
            <Show when={isMobile() && props.onClose}>
              <button
                type="button"
                onClick={() => props.onClose?.()}
                class="flex items-center justify-center w-5 h-5 rounded cursor-pointer hover:bg-sidebar-accent/80 transition-colors"
                aria-label="Close sidebar"
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
        open={props.open}
        resizable={!isMobile() && props.resizable}
        onResize={props.onResize}
        onClose={props.onClose}
        mobileOverlay={false}
        mobileBackdrop={false}
        class={cn(
          'h-full',
          // On mobile the aside must ALWAYS be absolutely positioned —
          // not just when open — so the closing width-transition never
          // pushes the content area.  SidebarPane's built-in overlay
          // ties `position:absolute` to `open`, which causes a push
          // during the close animation.
          isMobile() && 'absolute inset-y-0 left-0 z-30 shadow-xl max-w-[80vw]',
        )}
        bodyClass={cn('py-0', props.sidebarBodyClass)}
        bodyRef={props.bodyRef}
      >
        <div class="flex h-full min-h-0 flex-col bg-sidebar">
          <div class="sticky top-0 z-10 shrink-0 border-b border-sidebar-border bg-sidebar/95 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-sidebar/90">
            <div>
              <div class="px-0.5 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">Mode</div>
              {props.modeSwitcher}
            </div>

            <Show when={props.navigation}>
              <div class="mt-2 border-t border-sidebar-border pt-2">
                <div class="px-0.5 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">{props.navigationLabel || 'Navigate'}</div>
                {props.navigation}
              </div>
            </Show>
          </div>

          <div class="min-h-0 flex-1 px-2.5 py-2">
            {props.sidebarBody}
          </div>
        </div>
      </SidebarPane>

      <div class="min-w-0 min-h-0 flex-1 bg-background">
        {props.content}
      </div>
    </div>
  );
}
