import type { Accessor, Component } from 'solid-js';
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { FlowerThinkingIcon } from './icons/FlowerThinkingIcon';
import { useFlowerActivityTitleReveal } from './flowerActivityTitleReveal';
import { FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS } from './flowerScrollTail';
import type { FlowerScrollTailController } from './flowerScrollTail';
import { createFlowerActivityDisclosureMotion } from './activityDisclosure';

export type FlowerThinkingDisclosureView = 'expanded' | 'collapsed';

export type FlowerThinkingDisclosureProps = Readonly<{
  contentID: string;
  content: Accessor<string>;
  live: Accessor<boolean>;
  liveConfirmed: Accessor<boolean>;
  label: Accessor<string>;
  elapsed?: Accessor<string>;
  elapsedTitle?: Accessor<string>;
  expandLabel: Accessor<string>;
  collapseLabel: Accessor<string>;
  contentBody: Component;
  manualExpanded?: Accessor<boolean | undefined>;
  onManualExpanded?: (expanded: boolean) => void;
  scroll?: FlowerScrollTailController;
}>;

function safeContentID(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export const FlowerThinkingDisclosure: Component<FlowerThinkingDisclosureProps> = (props) => {
  const [view, setView] = createSignal<FlowerThinkingDisclosureView>(props.manualExpanded?.() ? 'expanded' : 'collapsed');
  const [inspected, setInspected] = createSignal(props.manualExpanded?.() === true);
  let viewport: HTMLDivElement | undefined;
  let toggleButton: HTMLButtonElement | undefined;
  let following = true;
  let savedReadingTop = 0;
  let writtenTop = 0;
  let followFrame = 0;
  let restoreFrame = 0;
  let followStart: { top: number; at: number } | undefined;
  const cancelFollow = () => { cancelAnimationFrame(followFrame); followFrame = 0; followStart = undefined; };
  const writeTop = (top: number) => { if (viewport) { viewport.scrollTop = top; writtenTop = viewport.scrollTop; } };
  const follow = () => {
    if (!viewport || followStart) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { writeTop(viewport.scrollHeight); return; }
    followStart = { top: viewport.scrollTop, at: performance.now() };
    const advance = (now: number) => {
      if (!viewport || !followStart) return;
      const progress = Math.min(1, Math.max(0, (now - followStart.at) / FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS));
      const bottom = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      writeTop(followStart.top + (bottom - followStart.top) * (1 - (1 - progress) ** 3));
      if (progress < 1) followFrame = requestAnimationFrame(advance);
      else cancelFollow();
    };
    followFrame = requestAnimationFrame(advance);
  };
  onCleanup(() => { cancelFollow(); cancelAnimationFrame(restoreFrame); });
  const contentID = `flower-thinking-content-${safeContentID(props.contentID)}`;
  const active = () => props.live() && props.liveConfirmed();
  const revealTitle = useFlowerActivityTitleReveal(() => props.contentID);
  const collapse = () => {
    savedReadingTop = viewport?.scrollTop ?? savedReadingTop;
    cancelFollow();
    if (viewport?.contains(document.activeElement)) toggleButton?.focus({ preventScroll: true });
    setView('collapsed');
  };
  const motion = createFlowerActivityDisclosureMotion(() => view() === 'expanded', {
    initialOpen: props.manualExpanded?.() === true,
    onLayoutFrame: () => props.scroll?.measureAfterLayout(),
    onMotionEnd: () => { if (toggleButton) props.scroll?.finishDisclosure(toggleButton); },
  });
  onCleanup(() => { if (toggleButton) props.scroll?.releaseDisclosure(toggleButton); });

  // Completion, reconnect and source hydration cannot change a user's choice.
  // Each new segment starts collapsed; only its own disclosure changes it.

  createEffect(() => {
    props.content();
    const currentView = view();
    const isActive = active();
    if (!isActive) cancelFollow();
    if (!viewport || currentView === 'collapsed' || motion.state() !== 'open') {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!viewport) return;
      if (isActive && following) follow();
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const toggle = () => {
    if (toggleButton) props.scroll?.activateDisclosure(toggleButton);
    const expanded = view() !== 'expanded';
    props.onManualExpanded?.(expanded);
    if (expanded) {
      setInspected(true); setView('expanded');
      cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(() => { restoreFrame = 0; if (view() === 'expanded') writeTop(savedReadingTop); });
    }
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
      <div class="flower-activity-inline-row flower-activity-inline-row-thinking" data-state={view() === 'collapsed' ? 'closed' : 'open'} data-flower-activity-active={active() ? 'true' : undefined}>
        <div class="flower-activity-inline-line">
          <button
            ref={toggleButton}
            type="button"
            class="flower-thinking-toggle flower-activity-inline-button"
            data-flower-disclosure-trigger
            data-flower-manual-open={view() === 'expanded' ? 'true' : undefined}
            aria-controls={contentID}
            aria-expanded={view() !== 'collapsed'}
            aria-label={view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
            onClick={toggle}
          >
            <span class="flower-activity-inline-icon"><FlowerThinkingIcon /></span>
            <span ref={revealTitle.bind} class="flower-activity-inline-title" data-floe-progress-shimmer={active() && !revealTitle.revealing() ? 'text' : undefined}>{props.label()}</span>
            <Show when={(!props.live() || active()) && props.elapsed?.()}>
              <span class="flower-activity-inline-duration" title={props.elapsedTitle?.()}>{props.elapsed?.()}</span>
            </Show>
            <ChevronRight class="flower-thinking-toggle-icon" aria-hidden="true" />
            <span class="flower-visually-hidden">
              {view() === 'expanded' ? props.collapseLabel() : props.expandLabel()}
            </span>
          </button>
        </div>
        <Show when={inspected()}>
          <div ref={motion.bindViewport} class="flower-thinking-viewport" data-state={motion.state()}
            style={{ height: motion.height(), display: motion.state() === 'closed' ? 'none' : undefined, overflow: 'hidden' }}
            aria-hidden={view() === 'collapsed' ? 'true' : undefined} inert={view() === 'collapsed'}>
          <div ref={motion.bindContent} style={{ display: 'flow-root' }}>
          <div
            id={contentID}
            class="flower-thinking-content"
            data-flower-thinking-view="expanded"
            aria-hidden={view() === 'collapsed' ? 'true' : undefined}
            inert={view() === 'collapsed'}
            ref={viewport}
            tabIndex={0}
            role="region"
            aria-label={props.label()}
            onScroll={event => {
              const node = event.currentTarget;
              if (view() === 'collapsed' || node.scrollTop === writtenTop) return;
              cancelFollow();
              savedReadingTop = node.scrollTop;
              writtenTop = node.scrollTop;
              following = node.scrollHeight - node.clientHeight - node.scrollTop <= 24;
              node.toggleAttribute('data-flower-reading-paused', !following);
            }}
          >
            <div class="flower-thinking-content-body"><props.contentBody /></div>
          </div>
          </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
