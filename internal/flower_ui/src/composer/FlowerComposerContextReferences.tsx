import { Show, type JSX } from 'solid-js';
import { X } from '@floegence/floe-webapp-core/icons';

export function FlowerComposerContextReferences(props: {
  label: string;
  children: JSX.Element;
  localScrollProps?: Record<string, unknown>;
}) {
  return <section class="flower-composer-context-references" aria-label={props.label}>
    <div {...props.localScrollProps} class="flower-composer-context-list">{props.children}</div>
  </section>;
}

export function FlowerComposerContextReference(props: {
  label: string;
  title?: string;
  icon: JSX.Element;
  disabled?: boolean;
  onPreview?: () => void;
  actions?: JSX.Element;
  removeLabel?: string;
  removalDisabled?: boolean;
  onRemove?: () => void;
}) {
  const remove = (button: HTMLButtonElement) => {
    const list = button.closest('.flower-composer-context-list');
    const input = button.closest('.flower-composer, .flower-turn-launcher-editor-shell');
    const index = [...(list?.querySelectorAll('.flower-composer-context-remove') ?? [])].indexOf(button);
    props.onRemove?.();
    requestAnimationFrame(() => {
      if (!input?.isConnected) return;
      if (document.activeElement !== button && document.activeElement !== document.body) return;
      const remaining = [...(list?.querySelectorAll<HTMLButtonElement>('.flower-composer-context-remove') ?? [])]
        .filter(element => element.isConnected);
      const next = remaining[Math.min(index, remaining.length - 1)];
      (next ?? input.querySelector<HTMLTextAreaElement>('textarea'))?.focus({ preventScroll: true });
    });
  };
  const content = () => <>
    <span class="flower-composer-context-icon" aria-hidden="true">{props.icon}</span>
    <span class="flower-composer-context-label">{props.label}</span>
  </>;
  return <div class="flower-composer-context-reference">
    <Show when={props.onPreview} fallback={
      <div class="flower-composer-context-source" title={props.title}>{content()}</div>
    }>
      <button type="button" class="flower-composer-context-source" title={props.title}
        disabled={props.disabled} onClick={() => props.onPreview?.()}>{content()}</button>
    </Show>
    {props.actions}
    <Show when={props.onRemove}>
      <button type="button" class="flower-composer-context-action flower-composer-context-remove"
        aria-label={props.removeLabel} title={props.removeLabel}
        disabled={props.disabled || props.removalDisabled}
        onClick={event => { event.stopPropagation(); remove(event.currentTarget); }}><X aria-hidden="true" /></button>
    </Show>
  </div>;
}
