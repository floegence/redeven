import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface DesktopDetachedWindowFrameProps {
  title: string;
  subtitle?: string;
  headerActions?: JSX.Element;
  banner?: JSX.Element;
  footer?: JSX.Element;
  bodyClass?: string;
  children: JSX.Element;
}

export function DesktopDetachedWindowFrame(props: DesktopDetachedWindowFrameProps) {
  const subtitle = () => String(props.subtitle ?? '').trim();

  return (
    <div data-testid="desktop-detached-window-frame" class="flex h-full min-h-0 flex-col bg-background">
      <header
        data-redeven-desktop-window-titlebar="true"
        data-redeven-desktop-titlebar-drag-region="true"
        class="redeven-desktop-detached-window-titlebar shrink-0 border-b border-border/70 bg-background/94 backdrop-blur supports-[backdrop-filter]:bg-background/88"
      >
        <div
          data-redeven-desktop-window-titlebar-content="true"
          class="redeven-desktop-detached-window-titlebar-content"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-foreground">{props.title}</div>
            <Show when={subtitle()}>
              <div class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{subtitle()}</div>
            </Show>
          </div>

          <Show when={props.headerActions}>
            <div
              data-redeven-desktop-titlebar-no-drag="true"
              class="flex shrink-0 flex-wrap items-center justify-end gap-2"
            >
              {props.headerActions}
            </div>
          </Show>
        </div>
      </header>

      <Show when={props.banner}>
        <div class="shrink-0">{props.banner}</div>
      </Show>

      <div class={cn('flex-1 min-h-0 overflow-hidden', props.bodyClass)}>
        {props.children}
      </div>

      <Show when={props.footer}>
        <div class="shrink-0">{props.footer}</div>
      </Show>
    </div>
  );
}
