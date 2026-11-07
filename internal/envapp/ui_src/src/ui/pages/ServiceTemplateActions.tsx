import { cn } from '@floegence/floe-webapp-core';
import type { JSX } from 'solid-js';
import './service-template-actions.css';

/** Keep navigation and secondary actions before the final action in reading order. */
export function ServiceTemplateActions(props: {
  secondary: JSX.Element;
  children: JSX.Element;
  class?: string;
}): JSX.Element {
  return (
    <div class={cn('service-template-actions', props.class)}>
      <div class="service-template-actions__secondary">{props.secondary}</div>
      <div class="service-template-actions__primary">{props.children}</div>
    </div>
  );
}
