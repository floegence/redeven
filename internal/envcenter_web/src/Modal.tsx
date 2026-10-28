import { onCleanup, onMount, type JSX, Show } from 'solid-js';

/** Native modal owns focus containment, Escape, and inert background semantics. */
export function Modal(props: { titleID: string; onClose: () => void; children: JSX.Element; error?: string; errorLabel?: string }) {
  let dialog!: HTMLDialogElement;
  const previous = document.activeElement;
  onMount(() => dialog.showModal());
  onCleanup(() => {
    dialog.close();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  });
  return <dialog ref={dialog} class="center-card modal" aria-labelledby={props.titleID}
    onCancel={event => { event.preventDefault(); props.onClose(); }}><Show when={props.error}><p class="center-error" role="alert"><strong>{props.errorLabel}</strong><code>{props.error}</code></p></Show>{props.children}</dialog>;
}
