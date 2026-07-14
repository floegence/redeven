import { createEffect, createSignal } from 'solid-js';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';

export interface InputDialogProps {
  open: boolean;
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog(props: InputDialogProps) {
  const i18n = useI18n();
  const [inputValue, setInputValue] = createSignal(props.value);

  createEffect(() => {
    if (props.open) {
      setInputValue(props.value);
    }
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={props.title}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.onCancel} disabled={props.loading}>
            {props.cancelText ?? i18n.t('common.actions.cancel')}
          </Button>
          <Button size="sm" variant="default" onClick={() => props.onConfirm(inputValue())} loading={props.loading}>
            {props.confirmText ?? i18n.t('common.actions.confirm')}
          </Button>
        </div>
      )}
    >
      <div>
        <label class="block text-xs text-muted-foreground mb-1">{props.label}</label>
        <input
          type="text"
          class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={inputValue()}
          placeholder={props.placeholder}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !props.loading) {
              props.onConfirm(inputValue());
            } else if (e.key === 'Escape') {
              props.onCancel();
            }
          }}
          autofocus
        />
      </div>
    </Dialog>
  );
}
