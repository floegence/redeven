import type { Component, JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { FlowerIcon } from './FlowerIcon';
import './flower-icon.css';

export interface FlowerSoftAuraIconProps {
  class?: string;
  iconClass?: string;
  tone?: 'primary' | 'current';
  style?: JSX.CSSProperties;
}

export const FlowerSoftAuraIcon: Component<FlowerSoftAuraIconProps> = (props) => (
  <span
    class={cn(
      'redeven-flower-soft-aura',
      props.tone === 'current' ? 'redeven-flower-soft-aura-current' : 'redeven-flower-soft-aura-primary',
      props.class,
    )}
    style={props.style}
  >
    <FlowerIcon class={cn('redeven-flower-soft-aura-svg', props.iconClass)} />
  </span>
);

export function FlowerNavigationIcon(props: { class?: string }) {
  return (
    <FlowerSoftAuraIcon
      class={props.class}
      tone="primary"
      iconClass="redeven-flower-soft-aura-nav-svg"
      style={{
        width: '1.5rem',
        height: '1.5rem',
      }}
    />
  );
}

export function FlowerWorkbenchIcon(props: { class?: string }) {
  return (
    <FlowerSoftAuraIcon
      class={props.class}
      tone="primary"
      iconClass="redeven-flower-soft-aura-workbench-svg"
    />
  );
}

export function FlowerContextMenuIcon(props: { class?: string }) {
  return <FlowerWorkbenchIcon class={props.class} />;
}
