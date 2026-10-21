import type { Accessor, Component } from 'solid-js';
import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { Brain } from 'lucide-solid';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';

export type FlowerThinkingDisclosureView = 'preview' | 'expanded' | 'collapsed';

export type FlowerThinkingDisclosureProps = Readonly<{
  contentID: string;
  inline?: Accessor<boolean>;
  content: Accessor<string>;
  live: Accessor<boolean>;
  liveConfirmed: Accessor<boolean>;
  preserveOnEnd: Accessor<boolean>;
  label: Accessor<string>;
  expandLabel: Accessor<string>;
  collapseLabel: Accessor<string>;
  contentBody: Component;
  manualExpanded?: Accessor<boolean | undefined>;
  onManualExpanded?: (expanded: boolean) => void;
}>;

function safeContentID(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export const FlowerThinkingDisclosure: Component<FlowerThinkingDisclosureProps> = (props) => {
  const [view, setView] = createSignal<FlowerThinkingDisclosureView>(props.manualExpanded?.() ? 'expanded' : 'collapsed');
  const [overflowing, setOverflowing] = createSignal(false);
  let viewport: HTMLDivElement | undefined;
  let toggleButton: HTMLButtonElement | undefined;
  const contentID = `flower-thinking-content-${safeContentID(props.contentID)}`;
  const active = () => props.live() && props.liveConfirmed();
  const collapse = () => {
    if (viewport?.contains(document.activeElement)) toggleButton?.focus({ preventScroll: true });
    setView('collapsed');
  };

  createEffect(on(props.live, (isLive, wasLive) => {
    if (isLive) setView('preview');
    else if (wasLive && !props.preserveOnEnd()) {
      props.onManualExpanded?.(false);
      collapse();
    }
  }));

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
    if (props.live()) {
      setView((current) => current === 'expanded' ? 'preview' : 'expanded');
      return;
    }
    const expanded = view() !== 'expanded';
    props.onManualExpanded?.(expanded);
    if (expanded) setView('expanded');
    else collapse();
  };

  return (
    <div
      class="flower-thinking-disclosure"
      classList={{ 'flower-thinking-disclosure-inline': props.inline?.() ?? false }}
      data-state={view() === 'collapsed' ? 'closed' : 'open'}
      data-flower-thinking-view={view()}
      data-flower-thinking-active={active() ? 'true' : 'false'}
    >
      <button
        ref={toggleButton}
        type="button"
        class="flower-thinking-toggle"
        classList={{ 'flower-activity-inline-button': props.inline?.() ?? false }}
        data-flower-manual-open={view() === 'expanded' ? 'true' : undefined}
        aria-controls={contentID}
        aria-expanded={view() !== 'collapsed'}
        aria-label={view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
        onClick={toggle}
      >
        <Show when={props.inline?.()} fallback={<ChevronRight class="flower-thinking-toggle-icon" aria-hidden="true" />}>
          <span class="flower-activity-inline-icon"><Brain size={16} strokeWidth={1.7} aria-hidden="true" /></span>
        </Show>
        <span classList={{ 'flower-activity-inline-title': props.inline?.() ?? false }}>{props.label()}</span>
        <Show when={props.inline?.()}><ChevronRight class="flower-thinking-toggle-icon" aria-hidden="true" /></Show>
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
