import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { SidebarPane } from '@floegence/floe-webapp-core/layout';

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
  headerActions?: JSX.Element;
  class?: string;
}

export function BrowserWorkspaceShell(props: BrowserWorkspaceShellProps) {
  return (
    <div class={cn('relative flex h-full min-h-0 overflow-hidden bg-background', props.class)}>
      <SidebarPane
        title={props.title ?? 'Browser'}
        headerActions={props.headerActions}
        width={props.width}
        open={props.open}
        resizable={props.resizable}
        onResize={props.onResize}
        onClose={props.onClose}
        class="h-full"
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
