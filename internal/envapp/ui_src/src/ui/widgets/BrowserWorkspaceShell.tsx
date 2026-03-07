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
        <div class="flex h-full min-h-0 flex-col bg-gradient-to-b from-background via-background to-muted/[0.08]">
          <div class="sticky top-0 z-10 shrink-0 border-b border-border/70 bg-background/95 px-2.5 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div class="space-y-3">
              <div class="rounded-2xl border border-border/70 bg-muted/20 p-2 shadow-sm">
                <div class="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Mode</div>
                {props.modeSwitcher}
              </div>

              <Show when={props.navigation}>
                <div class="rounded-2xl border border-border/70 bg-muted/15 p-2 shadow-sm">
                  <div class="px-1 pb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">{props.navigationLabel || 'Navigate'}</div>
                  {props.navigation}
                </div>
              </Show>
            </div>
          </div>

          <div class="min-h-0 flex-1 px-2.5 py-2">
            <div class="h-full min-h-0 rounded-2xl border border-border/60 bg-background/75 p-2 shadow-sm">
              {props.sidebarBody}
            </div>
          </div>
        </div>
      </SidebarPane>

      <div class="min-w-0 min-h-0 flex-1 bg-muted/[0.03]">
        {props.content}
      </div>
    </div>
  );
}
