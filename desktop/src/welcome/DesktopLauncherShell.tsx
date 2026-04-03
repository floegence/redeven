import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Search } from '@floegence/floe-webapp-core/icons';
import { BottomBar } from '@floegence/floe-webapp-core/layout';

export type DesktopLauncherShellProps = Readonly<{
  mainContentId: string;
  skipLinkLabel: string;
  topBarLabel: string;
  logo: JSX.Element;
  commandPlaceholder: string;
  commandKeybind?: string;
  commandDisabled?: boolean;
  commandTitle?: string;
  onOpenCommandPalette: () => void;
  trailingActions?: JSX.Element;
  bottomBarLeading?: JSX.Element;
  bottomBarTrailing?: JSX.Element;
  children: JSX.Element;
}>;

function focusMainContent(mainContentId: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const main = document.getElementById(mainContentId);
  if (!main || !(main instanceof HTMLElement)) {
    return;
  }
  try {
    main.focus();
  } catch {
    // Ignore focus failures so the skip link still behaves like a normal anchor.
  }
}

export function DesktopLauncherShell(props: DesktopLauncherShellProps) {
  const commandTitle = () => String(props.commandTitle ?? 'Open command palette').trim() || 'Open command palette';

  return (
    <div
      data-redeven-desktop-launcher-shell=""
      class={cn(
        'h-screen h-[100dvh] w-full flex flex-col overflow-hidden',
        'bg-background text-foreground overscroll-none',
      )}
    >
      <a
        href={`#${props.mainContentId}`}
        class={cn(
          'fixed left-3 top-3 z-[120] rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-md',
          'transition-transform duration-150 motion-reduce:transition-none',
          '-translate-y-[200%] focus:translate-y-0'
        )}
        onClick={() => focusMainContent(props.mainContentId)}
      >
        {props.skipLinkLabel}
      </a>

      <header
        data-redeven-desktop-titlebar-surface="true"
        data-redeven-desktop-titlebar-drag-region="true"
        class="redeven-desktop-titlebar shrink-0 bg-background border-b border-border safe-left safe-right"
        style={{ 'border-bottom-color': 'var(--top-bar-border)' }}
        aria-label={props.topBarLabel}
      >
        <div class="redeven-desktop-titlebar-grid">
          <div data-redeven-desktop-titlebar-region="leading" class="min-w-0" />

          <div
            data-redeven-desktop-titlebar-region="center"
            data-redeven-desktop-titlebar-no-drag="true"
            class="redeven-desktop-titlebar-center-cluster"
          >
            <div class="shrink-0">{props.logo}</div>

            <button
              type="button"
              data-redeven-desktop-command-trigger=""
              disabled={props.commandDisabled}
              class={cn(
                'redeven-desktop-command-trigger flex min-w-0 items-center gap-2 rounded-md border border-transparent',
                'h-7 px-2.5 text-xs text-muted-foreground',
                props.commandDisabled ? 'cursor-not-allowed opacity-60 hover:bg-muted/40' : 'cursor-pointer',
                'bg-muted/40 hover:bg-muted/70 hover:border-border/50',
                'transition-colors duration-100',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
              aria-label={commandTitle()}
              title={commandTitle()}
              onClick={() => {
                if (!props.commandDisabled) {
                  props.onOpenCommandPalette();
                }
              }}
            >
              <Search class="h-3.5 w-3.5 shrink-0" />
              <span class="flex-1 truncate text-left hidden sm:inline">{props.commandPlaceholder}</span>
              <Show when={props.commandKeybind}>
                {(value) => (
                  <kbd class="hidden md:inline rounded border border-border/50 bg-background/80 px-1 py-0.5 text-[10px] font-mono shrink-0">
                    {value()}
                  </kbd>
                )}
              </Show>
            </button>
          </div>

          <div
            data-redeven-desktop-titlebar-region="trailing"
            data-redeven-desktop-titlebar-no-drag="true"
            class="min-w-0 flex items-center justify-self-end gap-1"
          >
            {props.trailingActions}
          </div>
        </div>
      </header>

      <div class="flex-1 min-h-0 flex overflow-hidden relative">{props.children}</div>

      <BottomBar class="safe-left safe-right">
        <div class="flex min-w-0 items-center gap-2">{props.bottomBarLeading}</div>
        <div class="flex items-center gap-2">{props.bottomBarTrailing}</div>
      </BottomBar>
    </div>
  );
}
