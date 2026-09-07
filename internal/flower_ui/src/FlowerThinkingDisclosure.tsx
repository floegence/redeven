import type { Accessor, Component } from 'solid-js';
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { ChevronDown } from '@floegence/floe-webapp-core/icons';

export type FlowerThinkingDisclosureView = 'preview' | 'expanded' | 'collapsed';

export type FlowerThinkingDisclosureProps = Readonly<{
  contentID: string;
  content: Accessor<string>;
  streaming: Accessor<boolean>;
  live: Accessor<boolean>;
  label: Accessor<string>;
  expandLabel: Accessor<string>;
  collapseLabel: Accessor<string>;
  contentBody: Component;
}>;

function safeContentID(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export const FlowerThinkingDisclosure: Component<FlowerThinkingDisclosureProps> = (props) => {
  const [view, setView] = createSignal<FlowerThinkingDisclosureView>('collapsed');
  const [overflowing, setOverflowing] = createSignal(false);
  let viewport: HTMLDivElement | undefined;
  let previousActive = false;
  const contentID = `flower-thinking-content-${safeContentID(props.contentID)}`;
  const active = () => props.streaming() || props.live();

  createEffect(() => {
    const isActive = active();
    if (isActive && !previousActive) setView('preview');
    if (!isActive && previousActive) setView('collapsed');
    previousActive = isActive;
  });

  createEffect(() => {
    props.content();
    const currentView = view();
    const isActive = active();
    if (!viewport || currentView === 'collapsed') {
      setOverflowing(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!viewport) return;
      setOverflowing(viewport.scrollHeight > viewport.clientHeight + 1);
      if (isActive && currentView === 'preview') viewport.scrollTop = viewport.scrollHeight;
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const toggle = () => {
    if (active()) {
      setView((current) => current === 'expanded' ? 'preview' : 'expanded');
      return;
    }
    setView((current) => current === 'expanded' ? 'collapsed' : 'expanded');
  };

  return (
    <div
      class="flower-thinking-disclosure"
      data-state={view() === 'collapsed' ? 'closed' : 'open'}
      data-flower-thinking-view={view()}
      data-flower-thinking-active={active() ? 'true' : 'false'}
    >
      <button
        type="button"
        class="flower-thinking-toggle"
        aria-controls={contentID}
        aria-expanded={view() !== 'collapsed'}
        aria-label={view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
        onClick={toggle}
      >
        <ChevronDown class="flower-thinking-toggle-icon" aria-hidden="true" />
        <span>{props.label()}</span>
        <span class="flower-visually-hidden">
          {view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
        </span>
      </button>
      <Show when={view() !== 'collapsed'}>
        <div
          id={contentID}
          class="flower-thinking-content"
          data-flower-thinking-view={view()}
          data-overflow={overflowing() ? 'true' : 'false'}
          ref={viewport}
        >
          <div class="flower-thinking-content-body"><props.contentBody /></div>
        </div>
      </Show>
    </div>
  );
};
