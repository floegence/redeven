import type { Component } from 'solid-js';
import { For, Match, Switch } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { FlowerProviderType } from '../contracts/flowerSurfaceContracts';
import { FLOWER_PROVIDER_ICON_DEFINITIONS } from './providerBrandIcons';

export const FlowerProviderBrandIcon: Component<{ type: FlowerProviderType; class?: string }> = (props) => {
  const icon = () => FLOWER_PROVIDER_ICON_DEFINITIONS[props.type] ?? FLOWER_PROVIDER_ICON_DEFINITIONS.openai_compatible;
  const iconClass = () => cn('inline-flex shrink-0 items-center justify-center', props.class);

  return (
    <Switch>
      <Match when={icon().svgContent}>
        <span
          class={iconClass()}
          role="img"
          aria-label={icon().title}
          data-flower-provider-brand={props.type}
          innerHTML={icon().svgContent}
        />
      </Match>
      <Match when={icon().paths}>
        <svg
          viewBox={icon().viewBox}
          role="img"
          aria-label={icon().title}
          data-flower-provider-brand={props.type}
          class={iconClass()}
          style={{ color: icon().color }}
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{icon().title}</title>
          <For each={icon().paths}>
            {(path, index) => (
              <path
                d={path}
                fill={icon().fills ? icon().fills![index()] : 'currentColor'}
                fill-rule={icon().fillRule}
                clip-rule={icon().fillRule}
              />
            )}
          </For>
        </svg>
      </Match>
    </Switch>
  );
};
