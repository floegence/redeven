import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { FlowerProviderType } from '../contracts/flowerSurfaceContracts';
import { FLOWER_PROVIDER_ICON_DEFINITIONS } from './providerBrandIcons';

export const FlowerProviderBrandIcon: Component<{ type: FlowerProviderType; class?: string }> = (props) => {
  const icon = () => FLOWER_PROVIDER_ICON_DEFINITIONS[props.type] ?? FLOWER_PROVIDER_ICON_DEFINITIONS.openai_compatible;
  return (
    <span
      class={cn('flower-provider-brand-icon inline-flex shrink-0 items-center justify-center', props.class)}
      role="img"
      aria-label={icon().title}
      data-flower-provider-brand={props.type}
    >
      <Show when={icon().monochrome} fallback={<img src={icon().src} alt="" draggable={false} />}>
        <span class="flower-provider-brand-mask" aria-hidden="true" style={{ 'mask-image': 'url("' + icon().src + '")' }} />
      </Show>
    </span>
  );
};
