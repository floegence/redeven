import { Show } from 'solid-js';
import { Bot, Check } from '@floegence/floe-webapp-core/icons';
import type { ComposerModelOption } from '../composerModelOption';
import { FlowerProviderBrandIcon } from '../settings/FlowerProviderBrandIcon';

/** Shared model identity and availability presentation for Flower pickers. */
export function FlowerModelOptionContent(props: { option: ComposerModelOption; selected?: boolean; pendingLabel: string; unavailableLabel: string }) {
  return <>
    <span class="flower-model-menu-avatar" aria-hidden="true">
      {props.option.providerType ? <FlowerProviderBrandIcon type={props.option.providerType} class="flower-model-menu-icon" /> : <Bot class="flower-model-menu-icon" />}
    </span>
    <span class="flower-model-menu-copy"><span class="flower-model-menu-name" title={props.option.label}>{props.option.name || props.option.label}</span></span>
    <Show when={props.option.disabled}><span class="flower-model-menu-unavailable">{props.option.pending ? props.pendingLabel : props.unavailableLabel}</span></Show>
    <Show when={props.selected}><span class="flower-model-menu-selection" aria-hidden="true"><Check class="flower-model-menu-check" /></span></Show>
  </>;
}
