import {
  Button,
  Dialog as FloeDialog,
  type ConfirmDialogProps,
  type DialogProps,
} from '@floegence/floe-webapp-core/ui';
import { useResolvedFloeConfig } from '@floegence/floe-webapp-core';
import type { JSX } from 'solid-js';

import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

export function Dialog(props: Omit<DialogProps, 'globalZIndex'>): JSX.Element {
  return <FloeDialog {...props} globalZIndex={ENV_APP_FLOATING_LAYER.productModal} />;
}

export function ConfirmDialog(props: Omit<ConfirmDialogProps, 'globalZIndex'>): JSX.Element {
  const floe = useResolvedFloeConfig();
  return (
    <FloeDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      bodyDescription={props.bodyDescription}
      globalZIndex={ENV_APP_FLOATING_LAYER.productModal}
      footer={<>
        <Button
          variant="ghost"
          disabled={props.loading}
          onClick={() => props.onOpenChange(false)}
        >
          {props.cancelText ?? floe.config.strings.confirmDialog.cancel}
        </Button>
        <Button
          variant={props.variant === 'destructive' ? 'destructive' : 'primary'}
          disabled={props.loading}
          {...(props.loading ? { loading: true } : {})}
          onClick={props.onConfirm}
        >
          {props.confirmText ?? floe.config.strings.confirmDialog.confirm}
        </Button>
      </>}
    >
      {props.children}
    </FloeDialog>
  );
}
