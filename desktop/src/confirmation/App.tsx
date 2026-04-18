import { createMemo, onCleanup, onMount, Show } from 'solid-js';
import { AlertTriangle } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';

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
      <section
        class="redeven-confirmation-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="redeven-confirmation-title"
        aria-describedby="redeven-confirmation-message"
      >
        <header class="redeven-confirmation-header">
          <h1 id="redeven-confirmation-title" class="redeven-confirmation-title">
            {props.model.title}
          </h1>
          <button
            type="button"
            class="redeven-confirmation-close"
            aria-label="Cancel confirmation"
            onClick={() => submit('cancel')}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="redeven-confirmation-close-icon">
              <path d="M4 4L12 12" />
              <path d="M12 4L4 12" />
            </svg>
          </button>
        </header>

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

        <footer class="redeven-confirmation-footer">
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
        </footer>
      </section>
    </main>
  );
}
