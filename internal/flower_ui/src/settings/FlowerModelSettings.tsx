import { For, Show, createMemo, createSignal, createUniqueId, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, ChevronDown, Pencil, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Select } from '@floegence/floe-webapp-core/ui';
import type { FlowerSettingsCopy } from '../copy';
import type { FlowerProvider, FlowerReasoningSelection } from '../contracts/flowerSurfaceContracts';
import { flowerModelSupportsImage, formatFlowerTokenCount } from '../flowerModelLabel';
import { flowerProviderSearchSummary } from '../webSearchCapability';
import { FlowerReasoningControl } from '../ReasoningControl';
import { reasoningCapabilitySupportsControl } from '../reasoning';
import { flowerProviderUsesCustomName } from './providerCatalog';
import { FlowerProviderBrandIcon } from './FlowerProviderBrandIcon';
import { FlowerSubSectionHeader } from './FlowerSettingsPrimitives';

export type FlowerModelSettingsProps = Readonly<{
  copy: FlowerSettingsCopy;
  providers: readonly FlowerProvider[];
  currentModelID: string;
  disabled?: boolean;
  providerReady: (provider: FlowerProvider) => boolean;
  onChooseModel: (id: string) => void;
  onChangeReasoning: (selection: FlowerReasoningSelection | undefined) => void;
  onAddProvider: () => void;
  onEditProvider: (index: number) => void;
  onRemoveProvider: (index: number) => void;
  onToggleProvider: (index: number, enabled: boolean) => void | Promise<void>;
}>;

// Hosts own configuration and persistence; this component owns only editor visibility.
export const FlowerModelSettings: Component<FlowerModelSettingsProps> = (props) => {
  const copy = () => props.copy;
  const displayName = (provider: FlowerProvider) => flowerProviderUsesCustomName(provider.type)
    ? provider.name?.trim() || copy().providerTypeLabels[provider.type]
    : copy().providerTypeLabels[provider.type];
  const modelOptions = createMemo(() => props.providers.filter(provider => provider.enabled !== false)
    .flatMap(provider => provider.models.filter(model => !model.unavailable).map(model => ({
      value: `${provider.id}/${model.model_name}`,
      label: `${displayName(provider)} / ${model.display_name || model.wire_model_name || model.model_name}`,
    }))));
  const activeProvider = createMemo(() => props.providers.find(provider => props.currentModelID.startsWith(`${provider.id}/`)));
  const activeModel = createMemo(() => activeProvider()?.models.find(model => `${activeProvider()?.id}/${model.model_name}` === props.currentModelID));
  const [modelEditing, setModelEditing] = createSignal(false);
  const modelEditorID = createUniqueId();
  let modelEditButton: HTMLButtonElement | undefined;
  let modelEditor: HTMLDivElement | undefined;
  const finishModelEdit = () => {
    setModelEditing(false);
    queueMicrotask(() => modelEditButton?.focus());
  };
  const openModelEditor = () => {
    setModelEditing(true);
    queueMicrotask(() => modelEditor?.querySelector<HTMLElement>('[data-floe-dropdown-trigger]')?.focus());
  };

  return <>
    <section class="flower-settings-section flower-settings-current-model" aria-label={copy().currentModel}>
      <FlowerSubSectionHeader title={copy().models} />
      <div class="flower-settings-section-content flower-settings-model-group">
        <Show when={props.currentModelID || modelOptions().length} fallback={<p class="flower-body-copy text-muted-foreground">{copy().noModelSelected}</p>}>
          <div class="flower-settings-model-field">
            <div class="flower-settings-provider-brand"><Show when={activeProvider()}>{provider => <FlowerProviderBrandIcon type={provider().type} class="h-6 w-6" />}</Show></div>
            <div class="flower-settings-model-identity">
              <Show when={modelEditing()} fallback={<div class="flower-settings-model-name">{activeModel()?.display_name || activeModel()?.wire_model_name || activeModel()?.model_name || props.currentModelID || copy().noModelSelected}</div>}>
                <div ref={modelEditor} id={modelEditorID} class="flower-settings-model-editor" onKeyDown={event => { if (event.key === 'Escape') finishModelEdit(); }}>
                  <Select value={props.currentModelID} options={modelOptions()}
                    onChange={value => { if (modelOptions().some(option => option.value === value)) props.onChooseModel(value); finishModelEdit(); }}
                    placeholder={copy().selectModelPlaceholder} disabled={props.disabled} class="flower-settings-model-select w-full" />
                </div>
              </Show>
              <div class="flower-settings-model-provider">{activeProvider() && displayName(activeProvider()!)}</div>
            </div>
            <Button ref={modelEditButton} size="sm" variant="ghost" icon={modelEditing() ? Check : Pencil}
              class="flower-settings-model-edit" aria-expanded={modelEditing()} aria-controls={modelEditing() ? modelEditorID : undefined}
              aria-label={modelEditing() ? copy().finishModelEdit : copy().changeModel}
              title={modelEditing() ? copy().finishModelEdit : copy().changeModel}
              disabled={props.disabled || modelOptions().length === 0}
              onClick={() => modelEditing() ? finishModelEdit() : openModelEditor()}>
              <span class="flower-settings-model-edit-label">{modelEditing() ? copy().finishModelEdit : copy().changeModel}</span>
            </Button>
          </div>
          <Show when={activeModel()}>{model =>
            <dl class="flower-settings-model-metadata" style={{ '--flower-settings-model-stat-count': 1 + Number(!!model().context_window) + Number(!!model().max_output_tokens) + Number(reasoningCapabilitySupportsControl(model().reasoning_capability)) }}>
              <div class="flower-settings-model-stat"><dt>{copy().inputCapabilities}</dt><dd class="flower-settings-model-capabilities"><span>{copy().text}</span><Show when={flowerModelSupportsImage(model().input_modalities)}><span>{copy().imageInput}</span></Show></dd></div>
              <Show when={model().context_window}><div class="flower-settings-model-stat"><dt>{copy().dialog.contextWindow}</dt><dd>{formatFlowerTokenCount(model().context_window)}</dd></div></Show>
              <Show when={model().max_output_tokens}><div class="flower-settings-model-stat"><dt>{copy().dialog.maxOutput}</dt><dd>{formatFlowerTokenCount(model().max_output_tokens)}</dd></div></Show>
              <Show when={reasoningCapabilitySupportsControl(model().reasoning_capability)}>
                <div class="flower-settings-model-stat flower-settings-reasoning"><dt>{copy().reasoningControl.defaultLabel}</dt><dd>
                  <FlowerReasoningControl variant="badge" copy={copy().reasoningControl} capability={model().reasoning_capability}
                    selection={model().default_reasoning_selection} label={copy().reasoningControl.defaultLabel}
                    readOnly={props.disabled} onChange={props.onChangeReasoning} />
                </dd></div>
              </Show>
            </dl>
          }</Show>
          <Show when={activeProvider()?.enabled === false} fallback={<Show when={props.currentModelID && (!activeModel() || activeModel()?.unavailable)}><p role="alert" class="flower-settings-model-notice text-destructive">{copy().dialog.catalog.unavailable}</p></Show>}>
            <p role="status" class="flower-settings-model-notice text-muted-foreground">{copy().currentProviderDisabled}</p>
          </Show>
        </Show>
      </div>
    </section>
    <section class="flower-settings-section flower-settings-providers-section" aria-label={copy().providersTitle}>
      <FlowerSubSectionHeader title={copy().providersTitle} description={copy().providersDescription}
        actions={<Button size="sm" variant="ghost" icon={Plus} class="flower-settings-provider-add" onClick={props.onAddProvider} disabled={props.disabled}>{copy().addProvider}</Button>} />
      <div class="flower-settings-section-content">
        <div class="flower-settings-provider-gallery">
          <For each={props.providers.map(provider => provider.id)} fallback={<div class="flower-settings-provider-empty">{copy().noProviders}</div>}>
            {(providerID, index) => {
              const provider = createMemo(() => props.providers.find(item => item.id === providerID)!);
              const enabled = () => provider().enabled !== false;
              const ready = () => props.providerReady(provider()) && provider().models.some(model => !model.unavailable) && !provider().catalog_error;
              const webSearch = () => flowerProviderSearchSummary(provider().models, copy().dialog.catalog);
              const toggleLabel = () => enabled() ? copy().disableProvider(displayName(provider())) : copy().enableProvider(displayName(provider()));
              return <div class="flower-settings-provider-card" data-provider-enabled={enabled()}>
                <div class="flower-settings-provider-brand"><FlowerProviderBrandIcon type={provider().type} class="h-6 w-6" /></div>
                <div class="flower-settings-provider-body">
                  <div class="flower-settings-provider-title">
                    <span class="truncate flower-body-copy font-semibold text-foreground" title={displayName(provider())}>{displayName(provider())}</span>
                    <Show when={displayName(provider()) !== copy().providerTypeLabels[provider().type]}><span class="text-xs text-muted-foreground">{copy().providerTypeLabels[provider().type]}</span></Show>
                    <Show when={props.currentModelID.startsWith(`${provider().id}/`)}><span class="flower-settings-provider-default">{copy().defaultProvider}</span></Show>
                  </div>
                  <details class="flower-settings-provider-details">
                    <summary><span>{copy().models}</span><span class="flower-settings-provider-count">{provider().models.length}</span><ChevronDown class="h-3.5 w-3.5" aria-hidden="true" /></summary>
                    <div class="flower-settings-provider-detail-body">
                      <ul class="flower-settings-provider-models"><For each={provider().models}>{model => <li><code>{model.model_name}</code></li>}</For></ul>
                      <div class="flower-settings-provider-fact"><span class="flower-settings-provider-fact-label">{copy().web}</span><span>{webSearch().label}</span></div>
                      <Show when={provider().models.some(model => flowerModelSupportsImage(model.input_modalities))}><div class="flower-settings-provider-fact"><span class="flower-settings-provider-fact-label">{copy().vision}</span><span>{copy().imageInput}</span></div></Show>
                    </div>
                  </details>
                </div>
                <div class="flower-settings-provider-status"><span class={cn('flower-settings-dot-pill', enabled() && ready() && 'flower-settings-dot-pill-active')}>
                  {enabled() ? ready() ? copy().ready : copy().providerNeedsSetup : copy().providerDisabled}
                </span></div>
                <div class="flower-settings-provider-actions">
                  <button type="button" class="flower-settings-provider-toggle" role="switch" aria-checked={enabled()} aria-label={toggleLabel()} title={toggleLabel()}
                    disabled={props.disabled} onClick={async event => {
                      const button = event.currentTarget;
                      await props.onToggleProvider(index(), !enabled());
                      if (button.isConnected && (document.activeElement === document.body || document.activeElement === button)) button.focus();
                    }}>
                    <span class={cn('flower-settings-toggle-track', enabled() && 'flower-settings-toggle-track-on')} aria-hidden="true"><span class="flower-settings-toggle-thumb" /></span>
                  </button>
                  <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => props.onEditProvider(index())} disabled={props.disabled} aria-label={copy().editProvider}><Pencil class="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => props.onRemoveProvider(index())} disabled={props.disabled || props.providers.length <= 1} aria-label={copy().removeProvider}><Trash class="h-3.5 w-3.5" /></Button>
                </div>
              </div>;
            }}
          </For>
        </div>
      </div>
    </section>
  </>;
};
