import { Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { type DesktopOverlayPlacement } from './desktopOverlayPosition';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';

export type DesktopTooltipPlacement = DesktopOverlayPlacement;

export type DesktopTooltipProps = Readonly<{
  content: string | JSX.Element;
  children: JSX.Element;
  placement?: DesktopTooltipPlacement;
  delay?: number;
  class?: string;
  anchorClass?: string;
  anchorTabIndex?: number;
  anchorRole?: JSX.HTMLAttributes<HTMLSpanElement>['role'];
  anchorAriaLabel?: string;
  anchorAriaDisabled?: boolean;
}>;

function cn(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(' ');
}

export function DesktopTooltip(props: DesktopTooltipProps) {
  const [visible, setVisible] = createSignal(false);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let anchorRef: HTMLSpanElement | undefined;

  const clearTimeoutHandle = () => {
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    timeout = undefined;
  };

  const show = () => {
    clearTimeoutHandle();
    const delay = props.delay ?? 300;
    if (delay <= 0) {
      setVisible(true);
      return;
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    clearTimeoutHandle();
    setVisible(false);
  };

  onCleanup(() => {
    clearTimeoutHandle();
  });

  return (
    <span
      ref={anchorRef}
      data-redeven-tooltip-anchor=""
      class={cn('relative inline-block max-w-full', props.anchorClass)}
      tabIndex={props.anchorTabIndex}
      role={props.anchorRole}
      aria-label={props.anchorAriaLabel}
      aria-disabled={props.anchorAriaDisabled === true ? true : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusIn={show}
      onFocusOut={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) {
          return;
        }
        hide();
      }}
    >
      {props.children}

      <Show when={visible()}>
        <DesktopAnchoredOverlaySurface
          open={visible()}
          anchorRef={anchorRef}
          placement={props.placement}
          role="tooltip"
          class={cn(
            'z-[220] max-w-[min(24rem,calc(100vw-1rem))] rounded border border-border/80 bg-popover px-2 py-1 text-xs leading-snug text-popover-foreground shadow-md',
            'whitespace-normal break-words',
            props.class,
          )}
        >
          <>
            {props.content}
          </>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </span>
  );
}
