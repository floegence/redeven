import { For } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { providerBrandForType } from './aiCatalog';
import type { AIProviderType } from './types';

export function ProviderBrandIcon(props: { type: AIProviderType; class?: string }) {
  const brand = () => providerBrandForType(props.type);

  return (
    <svg
      viewBox={brand().icon.viewBox}
      role="img"
      aria-label={brand().icon.title}
      data-provider-brand={brand().type}
      class={cn('shrink-0', props.class)}
      style={{ color: brand().icon.color }}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{brand().icon.title}</title>
      <For each={brand().icon.paths}>
        {(path) => <path d={path} fill-rule={brand().icon.fillRule} clip-rule={brand().icon.fillRule} />}
      </For>
    </svg>
  );
}
