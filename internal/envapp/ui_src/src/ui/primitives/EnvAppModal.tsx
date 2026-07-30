import {
  ConfirmDialog as FloeConfirmDialog,
  Dialog as FloeDialog,
  type ConfirmDialogProps,
  type DialogProps,
} from '@floegence/floe-webapp-core/ui';
import type { JSX } from 'solid-js';

import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export function Dialog(props: Omit<DialogProps, 'globalZIndex'>): JSX.Element {
  return <FloeDialog {...props} globalZIndex={ENV_APP_FLOATING_LAYER.productModal} />;
}

export function ConfirmDialog(props: Omit<ConfirmDialogProps, 'globalZIndex'>): JSX.Element {
  return (
    <FloeConfirmDialog
      {...props}
      globalZIndex={ENV_APP_FLOATING_LAYER.productModal}
    />
  );
}
