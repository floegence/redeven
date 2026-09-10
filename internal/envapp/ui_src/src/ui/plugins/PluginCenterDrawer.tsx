import { untrack, type JSX } from 'solid-js';
import { DialogPlacementProvider, type DialogProps } from '@floegence/floe-webapp-core/ui';
import { Dialog } from '../primitives/EnvAppModal';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export function PluginCenterDrawer(props: DialogProps): JSX.Element {
  return <DialogPlacementProvider mode="global" globalZIndex={ENV_APP_FLOATING_LAYER.productModal}>
    <PersistentDrawer {...props} />
  </DialogPlacementProvider>;
}

function PersistentDrawer(props: DialogProps): JSX.Element {
  // Keep the content owner inside the global placement context so its nested
  // confirmations share the same modal contract and survive drawer recreation.
  const content = untrack(() => props.children);
  return <Dialog {...props} presentation="bottom-drawer" header={null} escapeKeyPhase="bubble"
    class="redeven-plugin-center-drawer" contentClass="overflow-hidden p-0">
    {content}
  </Dialog>;
}
