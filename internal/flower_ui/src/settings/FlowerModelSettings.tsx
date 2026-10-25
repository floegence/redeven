import { For, Show, createMemo, createSignal, createUniqueId, type Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, ChevronDown, Pencil, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerSettingsCopy } from '../copy';
import type { FlowerProvider, FlowerReasoningSelection } from '../contracts/flowerSurfaceContracts';
import { flowerModelSupportsImage, formatFlowerTokenCount } from '../flowerModelLabel';
import { flowerWebSearchLabel } from '../webSearchCapability';
import { FlowerReasoningControl } from '../ReasoningControl';
import { reasoningCapabilitySupportsControl } from '../reasoning';
import { flowerProviderDisplayName, isKimiProviderType } from './providerCatalog';
import { FlowerProviderBrandIcon } from './FlowerProviderBrandIcon';
import { FlowerSubSectionHeader } from './FlowerSettingsPrimitives';
import { FlowerModelSelectionDialog } from './FlowerModelSelectionDialog';
import { createFlowerActivityDisclosureMotion } from '../activityDisclosure';

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
  const displayName = (provider: FlowerProvider) => flowerProviderDisplayName(provider, copy().providerTypeLabels[provider.type]);
  const modelGroups = createMemo(() => props.providers.filter(provider => provider.enabled !== false)
    .map(provider => ({ id: provider.id, type: provider.type, label: displayName(provider), models: provider.models.filter(model => !model.unavailable) }))
    .filter(group => group.models.length > 0));
  const activeProvider = createMemo(() => props.providers.find(provider => props.currentModelID.startsWith(`${provider.id}/`)));
  const activeModel = createMemo(() => activeProvider()?.models.find(model => `${activeProvider()?.id}/${model.model_name}` === props.currentModelID));
  const [modelDialogOpen, setModelDialogOpen] = createSignal(false);

  return <>
    <section class="flower-settings-section flower-settings-current-model" aria-label={copy().currentModel}>
      <FlowerSubSectionHeader title={copy().models} />
      <div class="flower-settings-section-content flower-settings-model-group">
        <Show when={props.currentModelID || modelGroups().length} fallback={<p class="flower-body-copy text-muted-foreground">{copy().noModelSelected}</p>}>
          <div class="flower-settings-model-field">
            <div class="flower-settings-provider-brand"><Show when={activeProvider()}>{provider => <FlowerProviderBrandIcon type={provider().type} class="h-6 w-6" />}</Show></div>
            <div class="flower-settings-model-identity">
              <div class="flower-settings-model-name">{activeModel()?.display_name || activeModel()?.wire_model_name || activeModel()?.model_name || props.currentModelID || copy().noModelSelected}</div>
              <div class="flower-settings-model-provider">{activeProvider() && displayName(activeProvider()!)}</div>
            </div>
            <Button size="sm" variant="ghost" icon={Pencil}
              class="flower-settings-model-edit" aria-haspopup="dialog" aria-expanded={modelDialogOpen()}
              aria-label={copy().changeModel} title={copy().changeModel}
              disabled={props.disabled || modelGroups().length === 0}
              onClick={() => setModelDialogOpen(true)}>
              <span class="flower-settings-model-edit-label">{copy().changeModel}</span>
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
    <FlowerModelSelectionDialog open={modelDialogOpen()} onOpenChange={setModelDialogOpen}
      groups={modelGroups()} currentModelID={props.currentModelID} copy={copy()} disabled={props.disabled}
      onChooseModel={props.onChooseModel} />
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
              const toggleLabel = () => enabled() ? copy().disableProvider(displayName(provider())) : copy().enableProvider(displayName(provider()));
              const [expanded, setExpanded] = createSignal(false);
              const detailsID = `flower-provider-models-${createUniqueId()}`;
              let trigger: HTMLButtonElement | undefined;
              let viewport: HTMLDivElement | undefined;
              const motion = createFlowerActivityDisclosureMotion(expanded, {
                openDurationMs: 240,
                closeDurationMs: 180,
                onBeforeClose: () => {
                  if (viewport?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
                },
              });
              return <div class="flower-settings-provider-card" data-provider-enabled={enabled()}>
                <div class="flower-settings-provider-brand"><FlowerProviderBrandIcon type={provider().type} class="h-6 w-6" /></div>
                <div class="flower-settings-provider-body">
                  <div class="flower-settings-provider-title">
                    <span class="truncate flower-body-copy font-semibold text-foreground" title={displayName(provider())}>{displayName(provider())}</span>
                    <Show when={displayName(provider()) !== copy().providerTypeLabels[provider().type]}><span class="text-xs text-muted-foreground">{copy().providerTypeLabels[provider().type]}</span></Show>
                    <Show when={isKimiProviderType(provider().type)}><span class="text-xs text-muted-foreground" data-flower-kimi-access>{provider().type === 'moonshot' ? copy().dialog.kimiCode.platform : copy().dialog.kimiCode.code}</span></Show>
                    <Show when={props.currentModelID.startsWith(`${provider().id}/`)}><span class="flower-settings-provider-default">{copy().defaultProvider}</span></Show>
                  </div>
                  <button ref={trigger} type="button" class="flower-settings-provider-disclosure" aria-expanded={expanded()} aria-controls={detailsID}
                    aria-label={`${displayName(provider())} · ${copy().models} · ${provider().models.length}`} onClick={() => setExpanded(value => !value)}>
                    <span>{copy().models}</span><span class="flower-settings-provider-count">{provider().models.length}</span><ChevronDown class="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                <div class="flower-settings-provider-status"><span class={cn('flower-settings-dot-pill', enabled() && ready() && 'flower-settings-dot-pill-active')}>
                  {enabled() ? ready() ? copy().ready : props.providerReady(provider()) && provider().models.length === 0 ? copy().dialog.catalog.configuredWithoutSelection : copy().providerNeedsSetup : copy().providerDisabled}
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
                  <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => props.onRemoveProvider(index())} disabled={props.disabled} aria-label={copy().removeProvider}><Trash class="h-3.5 w-3.5" /></Button>
                </div>
                <div id={detailsID} class="flower-settings-provider-details" ref={node => { viewport = node; motion.bindViewport(node); }}
                  data-state={motion.state()} aria-hidden={!expanded()} inert={!expanded()}
                  style={{ height: motion.height(), display: motion.state() === 'closed' ? 'none' : undefined }}>
                  <div class="flower-settings-provider-detail-body" ref={motion.bindContent}>
                    <div class="flower-settings-provider-table-scroll flower-scroll" role="region" tabindex="0" aria-label={`${displayName(provider())} · ${copy().models}`}>
                      <table class="flower-settings-provider-model-table">
                        <caption class="sr-only">{displayName(provider())} · {copy().models}</caption>
                        <colgroup><col /><col /><col /><col /><col /></colgroup>
                        <thead><tr>
                          <th scope="col">{copy().dialog.modelName}</th><th scope="col">{copy().inputCapabilities}</th>
                          <th scope="col" class="flower-settings-provider-token-cell">{copy().dialog.contextWindow}</th>
                          <th scope="col" class="flower-settings-provider-token-cell">{copy().dialog.maxOutput}</th><th scope="col">{copy().dialog.webSearch}</th>
                        </tr></thead>
                        <tbody><For each={provider().models} fallback={<tr><td colspan="5" class="text-muted-foreground">{copy().dialog.noSelectedModels}</td></tr>}>{model => <tr data-current-model={props.currentModelID === `${provider().id}/${model.model_name}`}>
                          <th scope="row">
                            <div class="flower-settings-provider-model-heading">
                              <span class="flower-settings-provider-model-name" title={model.display_name || model.wire_model_name || model.model_name}>{model.display_name || model.wire_model_name || model.model_name}</span>
                              <Show when={props.currentModelID === `${provider().id}/${model.model_name}`}><span class="flower-settings-provider-model-current"><Check class="h-3 w-3" aria-hidden="true" />{copy().currentModel}</span></Show>
                              <Show when={model.unavailable}><span class="flower-settings-provider-model-unavailable">{copy().dialog.catalog.unavailableModel}</span></Show>
                            </div>
                            <Show when={(model.display_name || model.wire_model_name) && (model.display_name || model.wire_model_name) !== model.model_name}><code class="flower-settings-provider-model-id">{model.model_name}</code></Show>
                          </th>
                          <td>{copy().text}<Show when={flowerModelSupportsImage(model.input_modalities)}>{' · '}{copy().imageInput}</Show></td>
                          <td class="flower-settings-provider-token-cell">{model.context_window ? formatFlowerTokenCount(model.context_window) : '—'}</td>
                          <td class="flower-settings-provider-token-cell">{model.max_output_tokens ? formatFlowerTokenCount(model.max_output_tokens) : '—'}</td>
                          <td><span class="flower-settings-provider-model-search" data-web-search={model.web_search?.status ?? 'pending'}>{flowerWebSearchLabel(model.web_search, copy().dialog.catalog)}</span></td>
                        </tr>}</For></tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>;
            }}
          </For>
        </div>
      </div>
    </section>
  </>;
};
