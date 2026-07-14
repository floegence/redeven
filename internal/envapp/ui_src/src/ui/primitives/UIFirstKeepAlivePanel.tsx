import { Show, createEffect, createSignal, type JSX } from 'solid-js';

export type UIFirstKeepAlivePanelProps = Readonly<{
  active: boolean;
  render: () => JSX.Element;
  class?: string;
  testId?: string;
}>;

/** Lazily mounts a panel on first activation and preserves its DOM thereafter. */
export function UIFirstKeepAlivePanel(props: UIFirstKeepAlivePanelProps) {
  const [mounted, setMounted] = createSignal(props.active);

  createEffect(() => {
    if (props.active) setMounted(true);
  });

  return (
    <Show when={mounted()}>
      <div
        class={props.class}
        data-testid={props.testId}
        aria-hidden={props.active ? undefined : 'true'}
        style={{ display: props.active ? undefined : 'none' }}
      >
        {props.render()}
      </div>
    </Show>
  );
}
