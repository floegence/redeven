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
    <div class={cn('relative flex h-full min-h-0 overflow-hidden bg-muted/[0.02]', props.class)}>
      <SidebarPane
        title={props.title ?? 'Browser'}
        headerActions={props.headerActions}
        width={props.width}
        open={props.open}
        resizable={props.resizable}
        onResize={props.onResize}
        onClose={props.onClose}
        class="h-full border-r border-border/70 bg-background"
        bodyClass={cn('py-0', props.sidebarBodyClass)}
        bodyRef={props.bodyRef}
      >
        <div class="flex h-full min-h-0 flex-col bg-background">
          <div class="sticky top-0 z-10 shrink-0 border-b border-border/70 bg-background/95 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/90">
            <section class="rounded-xl border border-border/60 bg-muted/[0.05] p-1.5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
              <div class="space-y-1.5">
                <div>
                  <div class="px-1 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Mode</div>
                  {props.modeSwitcher}
                </div>

                <Show when={props.navigation}>
                  <div class="border-t border-border/60 pt-1.5">
                    <div class="px-1 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">{props.navigationLabel || 'Navigate'}</div>
                    {props.navigation}
                  </div>
                </Show>
              </div>
            </section>
          </div>

          <div class="min-h-0 flex-1 px-2 pb-2 pt-1.5">
            <div class="h-full min-h-0 rounded-2xl border border-border/60 bg-gradient-to-b from-background to-muted/[0.04] p-1.5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
              {props.sidebarBody}
            </div>
          </div>
        </div>
      </SidebarPane>

      <div class="min-w-0 min-h-0 flex-1 bg-background">
        {props.content}
      </div>
    </div>
  );
}
