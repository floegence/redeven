import type { JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { BottomBar, TopBar } from '@floegence/floe-webapp-core/layout';

export type DesktopLauncherShellProps = Readonly<{
  mainContentId: string;
  skipLinkLabel: string;
  topBarLabel: string;
  logo: JSX.Element;
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

      <TopBar
        ariaLabel={props.topBarLabel}
        logo={props.logo}
        actions={props.trailingActions}
      />

      <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">{props.children}</div>

      <BottomBar class="safe-left safe-right">
        <div class="flex min-w-0 items-center gap-2">{props.bottomBarLeading}</div>
        <div class="flex items-center gap-2">{props.bottomBarTrailing}</div>
      </BottomBar>
    </div>
  );
}
