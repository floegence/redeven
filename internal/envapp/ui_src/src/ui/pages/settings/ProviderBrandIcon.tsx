import { For, Match, Switch } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { providerBrandForType } from './aiCatalog';
import type { AIProviderType } from './types';

export function ProviderBrandIcon(props: { type: AIProviderType; class?: string }) {
  const brand = () => providerBrandForType(props.type);
  const def = () => brand().icon;

  const iconClass = () => cn('shrink-0', props.class);

  return (
    <Switch>
      <Match when={def().svgContent}>
        <span
          class={iconClass()}
          aria-label={def().title}
          role="img"
          data-provider-brand={brand().type}
          // eslint-disable-next-line solid/no-innerhtml -- trusted provider SVG
          innerHTML={def().svgContent}
        />
      </Match>
      <Match when={def().paths}>
        <svg
          viewBox={def().viewBox}
          role="img"
          aria-label={def().title}
          data-provider-brand={brand().type}
          class={iconClass()}
          style={{ color: def().color }}
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{def().title}</title>
          <For each={def().paths}>
            {(path, index) => (
              <path
                d={path}
                fill={def().fills ? def().fills![index()] : 'currentColor'}
                fill-rule={def().fillRule}
                clip-rule={def().fillRule}
              />
            )}
          </For>
        </svg>
      </Match>
    </Switch>
  );
}
