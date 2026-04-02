import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tooltip, type TooltipProps } from './primitives/Tooltip';

export interface TopBarBrandButtonProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  label: string;
  children: JSX.Element;
  tooltip?: TooltipProps['content'] | false;
  tooltipPlacement?: TooltipProps['placement'];
  tooltipDelay?: number;
}

export function TopBarBrandButton(props: TopBarBrandButtonProps) {
  const [local, rest] = splitProps(props, [
    'label',
    'children',
    'tooltip',
    'tooltipPlacement',
    'tooltipDelay',
    'class',
    'disabled',
  ]);

  // Keep the visible brand mark on the shell's 24px logo centerline while
  // extending the interactive affordance to a 32px hit target around it.
  const renderButton = () => (
    <button
      type="button"
      class={cn(
        'relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded cursor-pointer overflow-visible',
        "before:absolute before:-inset-1 before:rounded before:content-['']",
        'before:transition-colors hover:before:bg-muted/60 active:before:bg-muted/80',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
        local.class
      )}
      aria-label={local.label}
      disabled={local.disabled}
      {...rest}
    >
      <span class="relative z-10 inline-flex h-full w-full items-center justify-center">
        {local.children}
      </span>
    </button>
  );

  return (
    <Show when={local.tooltip !== false} fallback={renderButton()}>
      <Tooltip
        content={local.tooltip ?? local.label}
        placement={local.tooltipPlacement ?? 'bottom'}
        delay={local.tooltipDelay ?? 0}
      >
        {renderButton()}
      </Tooltip>
    </Show>
  );
}
