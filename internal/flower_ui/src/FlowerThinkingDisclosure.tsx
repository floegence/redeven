import type { Accessor, Component } from 'solid-js';
import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { FlowerThinkingIcon } from './icons/FlowerThinkingIcon';
import { useFlowerActivityTitleReveal } from './flowerActivityTitleReveal';

export type FlowerThinkingDisclosureView = 'expanded' | 'collapsed';

export type FlowerThinkingDisclosureProps = Readonly<{
  contentID: string;
  content: Accessor<string>;
  live: Accessor<boolean>;
  liveConfirmed: Accessor<boolean>;
  preserveOnEnd: Accessor<boolean>;
  label: Accessor<string>;
  elapsed?: Accessor<string>;
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
  let viewport: HTMLDivElement | undefined;
  let toggleButton: HTMLButtonElement | undefined;
  let following = true;
  const contentID = `flower-thinking-content-${safeContentID(props.contentID)}`;
  const active = () => props.live() && props.liveConfirmed();
  const revealTitle = useFlowerActivityTitleReveal(() => props.contentID, props.label);
  const collapse = () => {
    if (viewport?.contains(document.activeElement)) toggleButton?.focus({ preventScroll: true });
    setView('collapsed');
  };

  createEffect(on(props.live, (isLive, wasLive) => {
    if (isLive && !wasLive) setView(props.manualExpanded?.() ? 'expanded' : 'collapsed');
    else if (!isLive && wasLive && !props.preserveOnEnd()) {
      props.onManualExpanded?.(false);
      collapse();
    }
  }));

  createEffect(() => {
    props.content();
    const currentView = view();
    const isActive = active();
    if (!viewport || currentView === 'collapsed') {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!viewport) return;
      if (isActive && following) viewport.scrollTop = viewport.scrollHeight;
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const toggle = () => {
    following = true;
    if (props.live()) {
      setView((current) => current === 'expanded'
        ? 'collapsed'
        : 'expanded');
      return;
    }
    const expanded = view() !== 'expanded';
    props.onManualExpanded?.(expanded);
    if (expanded) setView('expanded');
    else collapse();
  };

  return (
    <div
      class="flower-thinking-disclosure flower-activity-inline"
      data-state={view() === 'collapsed' ? 'closed' : 'open'}
      data-flower-thinking-view={view()}
      data-flower-thinking-id={props.contentID}
      data-flower-thinking-active={active() ? 'true' : 'false'}
    >
      <div class="flower-activity-inline-row flower-activity-inline-row-thinking" data-state={view() === 'collapsed' ? 'closed' : 'open'}>
        <div class="flower-activity-inline-line">
          <button
            ref={toggleButton}
            type="button"
            class="flower-thinking-toggle flower-activity-inline-button"
            data-flower-manual-open={view() === 'expanded' ? 'true' : undefined}
            aria-controls={contentID}
            aria-expanded={view() !== 'collapsed'}
            aria-label={view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
            onClick={toggle}
          >
            <span class="flower-activity-inline-icon"><FlowerThinkingIcon /></span>
            <span ref={revealTitle} class="flower-activity-inline-title">{props.label()}</span>
            <Show when={active() && props.elapsed?.()}>
              <span class="flower-activity-inline-duration">{props.elapsed?.()}</span>
            </Show>
            <ChevronRight class="flower-thinking-toggle-icon" aria-hidden="true" />
            <span class="flower-visually-hidden">
              {view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
            </span>
          </button>
        </div>
        <Show when={view() !== 'collapsed'}>
          <div
            id={contentID}
            class="flower-thinking-content"
            data-flower-thinking-view={view()}
            ref={viewport}
            tabIndex={0}
            role="region"
            aria-label={props.label()}
            onScroll={event => {
              const node = event.currentTarget;
              following = node.scrollHeight - node.clientHeight - node.scrollTop <= 24;
              node.toggleAttribute('data-flower-reading-paused', !following);
            }}
          >
            <div class="flower-thinking-content-body"><props.contentBody /></div>
          </div>
        </Show>
      </div>
    </div>
  );
};
