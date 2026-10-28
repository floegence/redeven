import { createSignal, onCleanup, Show } from 'solid-js';
import type { Key } from './i18n';

/** Clipboard denial stays local to the descriptor; manual selection remains available. */
export function BindingDescriptor(props: { value: string; t: (key: Key) => string }) {
  const [copyState, setCopyState] = createSignal<'idle' | 'copying' | 'copied' | 'unavailable'>('idle');
  let content!: HTMLPreElement;
  let active = true;
  onCleanup(() => { active = false; });
  async function copy() {
    if (copyState() === 'copying') return;
    const value = props.value;
    setCopyState('copying');
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (active && value === props.value) setCopyState('copied');
    } catch {
      if (active && value === props.value) setCopyState('unavailable');
    }
  }
  function select() {
    content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return <section class="binding-descriptor">
    <pre ref={content} class="secret" tabIndex={0} aria-label={props.t('bind')}>{props.value}</pre>
    <div class="binding-copy-actions"><button disabled={copyState() === 'copying'} onClick={() => void copy()}>{props.t('copy')}</button><button onClick={select}>{props.t('selectText')}</button></div>
    <p role="status" aria-live="polite"><Show when={copyState() === 'unavailable'}>{props.t('copyUnavailable')}</Show><Show when={copyState() === 'copied'}>{props.t('copied')}</Show></p>
  </section>;
}
