import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { FlowerIcon } from './FlowerIcon';

export interface FlowerSoftAuraIconProps {
  class?: string;
  iconClass?: string;
  tone?: 'primary' | 'current';
}

export const FlowerSoftAuraIcon: Component<FlowerSoftAuraIconProps> = (props) => (
  <span
    class={cn(
      'redeven-flower-soft-aura',
      props.tone === 'current' ? 'redeven-flower-soft-aura-current' : 'redeven-flower-soft-aura-primary',
      props.class,
    )}
  >
    <span aria-hidden="true" class="redeven-flower-soft-aura-glow" />
    <FlowerIcon class={cn('redeven-flower-soft-aura-svg', props.iconClass)} />
  </span>
);
