import { For, createUniqueId, type Component } from 'solid-js';
import { ArrowRight } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerSurfaceAction } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { FlowerIcon } from '../icons/FlowerIcon';

export const FlowerSetupWelcome: Component<{
  copy: FlowerSurfaceCopy;
  actions: readonly { id: 'local_settings' | 'remote_settings'; action: FlowerSurfaceAction }[];
  onOpenSettings: () => void;
  onAction: (action: FlowerSurfaceAction) => void;
}> = (props) => {
  const titleID = createUniqueId();
  return (
    <section class="flower-setup-welcome" aria-labelledby={titleID}>
      <div class="flower-setup-content">
        <div class="flower-setup-brand" aria-hidden="true"><FlowerIcon /></div>
        <div class="flower-setup-copy">
          <h2 id={titleID}>{props.copy.chat.setupNeeded}</h2>
          <p class="flower-setup-description">{props.copy.chat.configureProviderBeforeChat}</p>
          <div class="flower-setup-actions">
            <For each={props.actions} fallback={(
              <Button size="lg" variant="ghost" class="flower-setup-action min-w-0" onClick={props.onOpenSettings}>
                <span class="flower-setup-action-label">{props.copy.chat.settingsLabel}</span>
                <ArrowRight class="flower-setup-action-arrow" aria-hidden="true" />
              </Button>
            )}>
              {(item) => (
                <Button size="lg" variant="ghost" class="flower-setup-action min-w-0" data-model-source-action={item.id} title={item.action.label}
                  onClick={() => props.onAction(item.action)}>
                  <span class="flower-setup-action-label">{item.id === 'local_settings' ? props.copy.chat.setupDesktopSettings : props.copy.chat.setupEnvironmentSettings}</span>
                  <ArrowRight class="flower-setup-action-arrow" aria-hidden="true" />
                </Button>
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  );
};
