import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import type { BarItemContextMenuRequest } from '@floegence/floe-webapp-core/layout';
import { Info, Pin } from '@floegence/floe-webapp-core/icons';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import { FloatingContextMenu, type FloatingContextMenuItem } from '../widgets/FloatingContextMenu';

export type PluginPinContextMenuProps = Readonly<{
  request: BarItemContextMenuRequest | null;
  ariaLabel: string;
  informationLabel: string;
  pinLabel: string;
  onSelectInformation: () => void;
  onSelectPin: () => void | Promise<void>;
  onClose: () => void;
  onLayerRef?: (element: HTMLDivElement | null) => void;
}>;

export function PluginPinContextMenu(props: PluginPinContextMenuProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  let restoreFocus = false;

  const close = (shouldRestoreFocus = true) => {
    restoreFocus = shouldRestoreFocus;
    props.onClose();
  };

  const selectPin = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await props.onSelectPin();
    } finally {
      setBusy(false);
      close();
    }
  };

  const items = createMemo<readonly FloatingContextMenuItem[]>(() => [
    {
      id: 'plugin-information',
      kind: 'action',
      label: props.informationLabel,
      icon: Info,
      onSelect: () => {
        props.onSelectInformation();
        close(false);
      },
    },
    { id: 'plugin-menu-separator', kind: 'separator' },
    {
      id: 'plugin-pin-toggle',
      kind: 'action',
      label: props.pinLabel,
      icon: Pin,
      disabled: busy(),
      onSelect: () => void selectPin(),
    },
  ]);

  createEffect(() => {
    const request = props.request;
    if (!request) return;
    restoreFocus = false;
    onCleanup(() => {
      props.onLayerRef?.(null);
      if (restoreFocus && request.trigger.isConnected) {
        request.trigger.focus({ preventScroll: true });
      }
    });
  });

  return (
    <Show when={props.request}>
      {(request) => (
        <FloatingContextMenu
          x={request().clientX}
          y={request().clientY}
          focusAnchor={request().trigger}
          ariaLabel={props.ariaLabel}
          contextMenuKind="plugin-pin"
          zIndex={request().trigger.closest('[data-floe-dialog-surface-host="true"]')
            ? undefined
            : ENV_APP_FLOATING_LAYER.pluginContextMenu}
          items={items()}
          menuRef={(element) => {
            props.onLayerRef?.(element);
          }}
          restoreFocusOnEscape
          restoreFocusOnTab
          onDismiss={(reason) => close(
            reason === 'escape' || reason === 'tab' || reason === 'shift-tab',
          )}
        />
      )}
    </Show>
  );
}
