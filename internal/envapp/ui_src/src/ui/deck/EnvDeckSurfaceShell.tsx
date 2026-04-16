import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { ChevronLeft, Menu } from '@floegence/floe-webapp-core/icons';
import { useDeck } from '@floegence/floe-webapp-core';

const INLINE_RAIL_OPEN_STATE_KEY = 'redeven.inlineRailOpen';
const INLINE_RAIL_COMPACT_BREAKPOINT_PX = 960;

function DeckSurfaceNotice(props: {
  eyebrow: string;
  title: string;
  description: string;
  action?: JSX.Element;
}) {
  return (
    <div class="flex h-full min-h-0 items-center justify-center bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,_var(--primary)_8%,_transparent),_transparent_52%)] p-5">
      <div class="w-full max-w-md rounded-2xl border border-border/70 bg-background/92 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">{props.eyebrow}</div>
        <div class="mt-2 text-base font-semibold text-foreground">{props.title}</div>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">{props.description}</p>
        <Show when={props.action}>
          <div class="mt-4 flex items-center gap-2">{props.action}</div>
        </Show>
      </div>
    </div>
  );
}

export function EnvDeckSingletonSurface(props: {
  widgetId: string;
  widgetType: string;
  surfaceLabel: string;
  available?: boolean;
  unavailableTitle?: string;
  unavailableDescription?: string;
  children: JSX.Element;
}) {
  const deck = useDeck();

  const primaryWidgetId = createMemo(() => {
    const widgets = deck.activeLayout()?.widgets ?? [];
    return widgets.find((widget) => widget.type === props.widgetType)?.id ?? '';
  });
  const duplicate = createMemo(() => {
    const primary = primaryWidgetId();
    return Boolean(primary) && primary !== props.widgetId;
  });
  const scrollToPrimary = () => {
    const primary = primaryWidgetId();
    if (!primary || typeof document === 'undefined') return;
    const host = document.querySelector<HTMLElement>(`[data-widget-drag-handle="${primary}"]`);
    host?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  };

  return (
    <Show
      when={props.available ?? true}
      fallback={(
        <DeckSurfaceNotice
          eyebrow={props.surfaceLabel}
          title={props.unavailableTitle || `${props.surfaceLabel} is unavailable`}
          description={props.unavailableDescription || 'This surface cannot be rendered in the current environment.'}
        />
      )}
    >
      <Show
        when={!duplicate()}
        fallback={(
          <DeckSurfaceNotice
            eyebrow={`${props.surfaceLabel} duplicate`}
            title={`Keep one ${props.surfaceLabel.toLowerCase()} surface on the canvas`}
            description={`Redeven routes handoffs and live state to a single ${props.surfaceLabel.toLowerCase()} widget. Remove this duplicate or jump to the active surface.`}
            action={(
              <Button size="sm" variant="secondary" onClick={scrollToPrimary}>
                Reveal active widget
              </Button>
            )}
          />
        )}
      >
        {props.children}
      </Show>
    </Show>
  );
}

export function EnvDeckConversationShell(props: {
  widgetId: string;
  railLabel: string;
  rail: JSX.Element;
  workbench: JSX.Element;
}) {
  const deck = useDeck();
  const [hostEl, setHostEl] = createSignal<HTMLDivElement | null>(null);
  const [compact, setCompact] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(true);
  let initialized = false;

  createEffect(() => {
    if (initialized) return;
    const persisted = deck.getWidgetState(props.widgetId)[INLINE_RAIL_OPEN_STATE_KEY];
    if (typeof persisted === 'boolean') {
      setRailOpen(persisted);
    }
    initialized = true;
  });

  createEffect(() => {
    const host = hostEl();
    if (!host || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? host.clientWidth;
      setCompact(width < INLINE_RAIL_COMPACT_BREAKPOINT_PX);
    });
    observer.observe(host);
    setCompact(host.clientWidth < INLINE_RAIL_COMPACT_BREAKPOINT_PX);

    onCleanup(() => observer.disconnect());
  });

  const setPersistentRailOpen = (next: boolean) => {
    setRailOpen(next);
    deck.updateWidgetState(props.widgetId, INLINE_RAIL_OPEN_STATE_KEY, next);
  };
  const showInlineRail = createMemo(() => railOpen() && !compact());
  const showOverlayRail = createMemo(() => railOpen() && compact());

  return (
    <div
      ref={setHostEl}
      class="relative flex h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_92%,var(--muted)_8%),color-mix(in_srgb,var(--background)_98%,transparent))]"
    >
      <Show when={showOverlayRail()}>
        <button
          type="button"
          class="absolute inset-0 z-20 cursor-pointer bg-black/18 backdrop-blur-[1px]"
          aria-label={`Close ${props.railLabel.toLowerCase()}`}
          onClick={() => setPersistentRailOpen(false)}
        />
      </Show>

      <Show when={showInlineRail()}>
        <aside class="flex h-full min-h-0 w-[19rem] shrink-0 flex-col border-r border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sidebar)_90%,transparent),color-mix(in_srgb,var(--sidebar)_96%,transparent))]">
          <div class="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">{props.railLabel}</div>
            <button
              type="button"
              class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              aria-label={`Hide ${props.railLabel.toLowerCase()}`}
              onClick={() => setPersistentRailOpen(false)}
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">{props.rail}</div>
        </aside>
      </Show>

      <Show when={showOverlayRail()}>
        <aside class="absolute inset-y-0 left-0 z-30 flex h-full min-h-0 w-[min(22rem,calc(100%-1rem))] flex-col border-r border-border/80 bg-sidebar shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
          <div class="flex items-center justify-between border-b border-sidebar-border px-3 py-2">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{props.railLabel}</div>
            <button
              type="button"
              class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/80 hover:text-foreground"
              aria-label={`Close ${props.railLabel.toLowerCase()}`}
              onClick={() => setPersistentRailOpen(false)}
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">{props.rail}</div>
        </aside>
      </Show>

      <div class="relative min-w-0 min-h-0 flex-1">
        <Show when={!railOpen()}>
          <button
            type="button"
            class="absolute left-3 top-3 z-10 inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-background/92 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted/80"
            onClick={() => setPersistentRailOpen(true)}
          >
            <Menu class="h-3.5 w-3.5" />
            {props.railLabel}
          </button>
        </Show>
        {props.workbench}
      </div>
    </div>
  );
}
