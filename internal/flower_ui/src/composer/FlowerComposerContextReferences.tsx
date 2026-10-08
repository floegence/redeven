import { Show, type JSX } from 'solid-js';

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
}) {
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
  </div>;
}
