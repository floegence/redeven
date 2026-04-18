import { createMemo, onCleanup, onMount, Show } from 'solid-js';
import { AlertTriangle } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';

import {
  desktopConfirmationActionURL,
  type DesktopConfirmationDialogModel,
  type DesktopConfirmationResult,
} from '../shared/desktopConfirmationContract';

export function DesktopConfirmationApp(props: Readonly<{
  model: DesktopConfirmationDialogModel;
}>) {
  let cancelButton: HTMLButtonElement | undefined;

  const toneClass = createMemo(() => (
    props.model.confirm_tone === 'danger'
      ? 'text-error'
      : 'text-warning'
  ));

  const confirmVariant = createMemo(() => (
    props.model.confirm_tone === 'danger' ? 'destructive' as const : 'primary' as const
  ));

  const submit = (result: DesktopConfirmationResult): void => {
    window.location.href = desktopConfirmationActionURL(result);
  };

  onMount(() => {
    queueMicrotask(() => cancelButton?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        submit('cancel');
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit('confirm');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <main class="redeven-confirmation-window">
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            submit('cancel');
          }
        }}
        title={props.model.title}
        class="redeven-confirmation-dialog w-[min(26rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)]"
        footer={(
          <div class="flex w-full items-center justify-end gap-2">
            <Button
              ref={(element) => {
                cancelButton = element;
              }}
              size="sm"
              variant="outline"
              class="min-w-20"
              onClick={() => submit('cancel')}
            >
              {props.model.cancel_label}
            </Button>
            <Button
              size="sm"
              variant={confirmVariant()}
              class="min-w-20"
              onClick={() => submit('confirm')}
            >
              {props.model.confirm_label}
            </Button>
          </div>
        )}
      >
        <div class="redeven-confirmation-body">
          <div class={`redeven-confirmation-icon ${toneClass()}`}>
            <AlertTriangle class="h-4 w-4" />
          </div>
          <div class="min-w-0 space-y-1.5">
            <p id="redeven-confirmation-message" class="redeven-confirmation-message">
              {props.model.message}
            </p>
            <Show when={props.model.detail !== ''}>
              <p class="redeven-confirmation-detail">
                {props.model.detail}
              </p>
            </Show>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
