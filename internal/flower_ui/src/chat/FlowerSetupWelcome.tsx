import { For, Show, type Component } from 'solid-js';
import { ChevronRight, Globe, MonitorPointer, Refresh, Settings } from '@floegence/floe-webapp-core/icons';
import type { FlowerSurfaceAction } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { FlowerIcon } from '../icons/FlowerIcon';

export const FlowerSetupWelcome: Component<{
  copy: FlowerSurfaceCopy;
  actions: readonly { id: string; action: FlowerSurfaceAction }[];
  onOpenSettings: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onAction: (action: FlowerSurfaceAction) => void;
}> = (props) => (
  <section class="flower-setup-welcome">
    <div class="flower-setup-brand" aria-hidden="true"><FlowerIcon /></div>
    <h2>{props.copy.emptyState.title}</h2>
    <p class="flower-setup-description">{props.copy.chat.configureProviderBeforeChat}</p>
    <div class="flower-setup-actions">
      <For each={props.actions} fallback={(
        <button type="button" class="flower-setup-action flower-setup-action-primary" onClick={props.onOpenSettings}>
          <Settings class="flower-setup-action-icon" aria-hidden="true" />
          <span>{props.copy.chat.settingsLabel}</span>
          <ChevronRight class="flower-setup-action-arrow" aria-hidden="true" />
        </button>
      )}>
        {(item) => (
          <button type="button" class="flower-setup-action" data-model-source-action={item.id}
            onClick={() => props.onAction(item.action)}>
            <Show when={item.id === 'local_settings'} fallback={<Globe class="flower-setup-action-icon" aria-hidden="true" />}>
              <MonitorPointer class="flower-setup-action-icon" aria-hidden="true" />
            </Show>
            <span>{item.action.label}</span>
            <ChevronRight class="flower-setup-action-arrow" aria-hidden="true" />
          </button>
        )}
      </For>
    </div>
    <button type="button" class="flower-setup-refresh" aria-busy={props.refreshing} disabled={props.refreshing} onClick={props.onRefresh}>
      <Refresh class="h-3.5 w-3.5" aria-hidden="true" />
      {props.copy.settings.dialog.catalog.refresh}
    </button>
    <div class="flower-setup-preview">
      <For each={props.copy.emptyState.suggestions}>{(item) => <span>{item.title}</span>}</For>
    </div>
  </section>
);
