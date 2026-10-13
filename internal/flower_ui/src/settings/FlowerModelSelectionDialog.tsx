import { For, Show, createEffect, createMemo, createSignal, createUniqueId } from 'solid-js';
import { Check, Search } from '@floegence/floe-webapp-core/icons';
import { Dialog, Input } from '@floegence/floe-webapp-core/ui';
import type { FlowerSettingsCopy } from '../copy';
import type { FlowerProviderModel, FlowerProviderType } from '../contracts/flowerSurfaceContracts';
import { flowerModelSupportsImage, formatFlowerTokenCount } from '../flowerModelLabel';
import { reasoningCapabilitySupportsControl } from '../reasoning';
import { FlowerProviderBrandIcon } from './FlowerProviderBrandIcon';

type ModelGroup = Readonly<{ id: string; type: FlowerProviderType; label: string; models: readonly FlowerProviderModel[] }>;

export function FlowerModelSelectionDialog(props: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly ModelGroup[];
  currentModelID: string;
  copy: FlowerSettingsCopy;
  disabled?: boolean;
  onChooseModel: (id: string) => void;
}>) {
  const [query, setQuery] = createSignal('');
  const [focusedID, setFocusedID] = createSignal('');
  const listID = createUniqueId();
  let list: HTMLDivElement | undefined;
  const visibleGroups = createMemo(() => {
    const terms = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return props.groups.map(group => ({ ...group, models: group.models.filter(model => {
      const text = [group.label, group.id, model.display_name, model.model_name, model.wire_model_name].join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    }) })).filter(group => group.models.length > 0);
  });
  const tabStopID = createMemo(() => {
    const ids = visibleGroups().flatMap(group => group.models.map(model => `${group.id}/${model.model_name}`));
    return ids.includes(focusedID()) ? focusedID() : ids.includes(props.currentModelID) ? props.currentModelID : ids[0];
  });
  createEffect(() => { if (!props.open) { setQuery(''); setFocusedID(''); } });
  const choose = (id: string) => {
    if (props.disabled || !props.groups.some(group => group.models.some(model => `${group.id}/${model.model_name}` === id))) return;
    if (id !== props.currentModelID) props.onChooseModel(id);
    props.onOpenChange(false);
  };
  const moveFocus = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...list?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(event.target as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : current < 0 ? event.key === 'ArrowUp' ? options.length - 1 : 0
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[index].focus();
  };

  return <Dialog open={props.open} onOpenChange={props.onOpenChange} title={props.copy.changeModel}
    closeLabel={props.copy.closeModelSelection} class="flower-model-selection-dialog"
    contentClass="flower-model-selection-content">
    <div class="flower-model-selection-search">
      <Input data-floe-autofocus leftIcon={<Search class="h-4 w-4" aria-hidden="true" />}
        value={query()} onInput={event => setQuery(event.currentTarget.value)}
        placeholder={props.copy.dialog.catalog.search} aria-label={props.copy.dialog.catalog.search}
        aria-controls={listID} onKeyDown={event => {
          if (event.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') moveFocus(event);
          else if (event.key === 'Enter') {
            const models = visibleGroups().flatMap(group => group.models.map(model => `${group.id}/${model.model_name}`));
            if (models.length === 1) { event.preventDefault(); choose(models[0]); }
          }
        }} />
    </div>
    <div ref={list} id={listID} class="flower-model-selection-list flower-scroll" role="listbox"
      aria-label={props.copy.models} aria-busy={props.disabled} onKeyDown={moveFocus}>
      <For each={visibleGroups()}>{group => {
        const headingID = createUniqueId();
        return <div class="flower-model-selection-group" role="group" aria-labelledby={headingID}>
          <div class="flower-model-selection-group-heading" id={headingID}>
            <FlowerProviderBrandIcon type={group.type} class="h-4 w-4" />
            <span>{group.label}</span><span class="flower-model-selection-count">{group.models.length}</span>
          </div>
          <For each={group.models}>{model => {
            const id = `${group.id}/${model.model_name}`;
            const name = model.display_name || model.wire_model_name || model.model_name;
            const selected = () => id === props.currentModelID;
            return <button type="button" role="option" aria-selected={selected()} aria-label={`${group.label} / ${name}`}
              class="flower-model-selection-option" data-model-id={id} disabled={props.disabled}
              tabIndex={tabStopID() === id ? 0 : -1} onFocus={() => setFocusedID(id)} onClick={() => choose(id)}>
              <div class="flower-model-selection-identity">
                <span class="flower-model-selection-name" title={name}>{name}</span>
                <Show when={selected()}><span class="flower-model-selection-current"><Check class="h-3.5 w-3.5" aria-hidden="true" />{props.copy.currentModel}</span></Show>
                <Show when={name !== model.model_name}><code class="flower-model-selection-id">{model.model_name}</code></Show>
              </div>
              <dl class="flower-model-selection-metadata">
                <div><dt>{props.copy.inputCapabilities}</dt><dd>{props.copy.text}<Show when={flowerModelSupportsImage(model.input_modalities)}>{' · '}{props.copy.imageInput}</Show></dd></div>
                <Show when={model.context_window}><div><dt>{props.copy.dialog.contextWindow}</dt><dd>{formatFlowerTokenCount(model.context_window)}</dd></div></Show>
                <Show when={model.max_output_tokens}><div><dt>{props.copy.dialog.maxOutput}</dt><dd>{formatFlowerTokenCount(model.max_output_tokens)}</dd></div></Show>
              </dl>
              <Show when={reasoningCapabilitySupportsControl(model.reasoning_capability)}><span class="flower-model-selection-reasoning">{props.copy.reasoningControl.label}</span></Show>
            </button>;
          }}</For>
        </div>;
      }}</For>
    </div>
    <Show when={!visibleGroups().length}><p role="status" class="flower-model-selection-empty">{props.copy.dialog.catalog.empty}</p></Show>
  </Dialog>;
}
