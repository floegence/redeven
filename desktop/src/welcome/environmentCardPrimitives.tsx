import { type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export function EnvironmentStatusIndicator(props: Readonly<{
  tone: 'neutral' | 'primary' | 'success' | 'warning';
  title?: string;
  children: JSX.Element;
}>) {
  return (
    <span class="redeven-status-indicator" data-tone={props.tone} title={props.title}>
      <span class="redeven-status-indicator__dot" aria-hidden="true" />
      <span class="redeven-control-label">{props.children}</span>
    </span>
  );
}

export function ConsoleActionIconButton(props: Readonly<{
  title: string;
  'aria-label': string;
  onClick: () => void;
  active?: boolean;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: JSX.AriaAttributes['aria-haspopup'];
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  children: JSX.Element;
}>) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props['aria-label']}
      aria-pressed={props.active}
      aria-expanded={props['aria-expanded']}
      aria-haspopup={props['aria-haspopup']}
      data-active={props.active === true}
      disabled={props.disabled || props.loading}
      aria-busy={props.loading === true ? 'true' : undefined}
      class={cn(
        'redeven-console-icon-button',
        props.danger && 'redeven-console-icon-button--danger',
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
