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
      ? 'border-error/30 bg-error/10 text-error'
      : 'border-warning/40 bg-warning/15 text-warning'
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
    <main class="redeven-confirmation-surface flex min-h-screen items-center justify-center p-3">
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            submit('cancel');
          }
        }}
        title={props.model.title}
        class="redeven-confirmation-dialog w-[min(28rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)]"
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
        <div class="flex items-start gap-3">
          <div class={`redeven-confirmation-icon ${toneClass()}`}>
            <AlertTriangle class="h-4 w-4" />
          </div>
          <div class="min-w-0 space-y-1.5">
            <p class="text-sm leading-6 text-foreground">
              {props.model.message}
            </p>
            <Show when={props.model.detail !== ''}>
              <p class="text-xs leading-5 text-muted-foreground">
                {props.model.detail}
              </p>
            </Show>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
