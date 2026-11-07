import { createSignal, onCleanup, onMount } from 'solid-js';

/** Product decoration only; never overlays or interacts with a live plugin surface. */
export function PluginCreationCanvasBackground(props: { active: boolean }) {
  const [documentVisible, setDocumentVisible] = createSignal(!document.hidden);
  onMount(() => {
    const syncVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', syncVisibility);
    onCleanup(() => document.removeEventListener('visibilitychange', syncVisibility));
  });
  return (
    <div class="plugin-creation-atmosphere" aria-hidden="true" data-active={props.active && documentVisible()}>
      <span class="plugin-creation-atmosphere-grid" />
      <span class="plugin-creation-atmosphere-light" />
    </div>
  );
}
