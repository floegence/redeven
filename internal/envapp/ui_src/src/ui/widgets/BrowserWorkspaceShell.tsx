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
  content: JSX.Element;
  headerActions?: JSX.Element;
  class?: string;
}

export function BrowserWorkspaceShell(props: BrowserWorkspaceShellProps) {
  return (
    <div class={cn('flex h-full min-h-0 overflow-hidden bg-background', props.class)}>
      <SidebarPane
        title={props.title ?? 'Browser'}
        headerActions={props.headerActions}
        width={props.width}
        open={props.open}
        resizable={props.resizable}
        onResize={props.onResize}
        onClose={props.onClose}
        class="h-full border-r border-border/70 bg-background"
        bodyClass="py-0"
        bodyRef={props.bodyRef}
      >
        <div class="flex h-full min-h-0 flex-col">
          <div class="sticky top-0 z-10 shrink-0 border-b border-border/70 bg-background/95 px-2.5 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div class="space-y-3">
              <div class="space-y-1.5">
                <div class="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Mode</div>
                {props.modeSwitcher}
              </div>

              <Show when={props.navigation}>
                <div class="space-y-1.5">
                  <div class="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">{props.navigationLabel || 'Navigate'}</div>
                  {props.navigation}
                </div>
              </Show>
            </div>
          </div>

          <div class="min-h-0 flex-1 px-2.5 py-2">
            {props.sidebarBody}
          </div>
        </div>
      </SidebarPane>

      <div class="flex-1 min-w-0 min-h-0">
        {props.content}
      </div>
    </div>
  );
}
