import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { ChevronLeft, Menu } from '@floegence/floe-webapp-core/icons';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS } from './surface/workbenchWheelInteractive';

const INLINE_RAIL_COMPACT_BREAKPOINT_PX = 960;

export function EnvWorkbenchConversationShell(props: {
  railLabel: string;
  rail: JSX.Element;
  workbench: JSX.Element;
}) {
  const [hostEl, setHostEl] = createSignal<HTMLDivElement | null>(null);
  const [compact, setCompact] = createSignal(false);
  const [railOpen, setRailOpen] = createSignal(true);

  createEffect(() => {
    const host = hostEl();
    if (!host || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? host.clientWidth;
      setCompact(width < INLINE_RAIL_COMPACT_BREAKPOINT_PX);
    });
    observer.observe(host);
    setCompact(host.clientWidth < INLINE_RAIL_COMPACT_BREAKPOINT_PX);

    onCleanup(() => observer.disconnect());
  });

  const showInlineRail = createMemo(() => railOpen() && !compact());
  const showOverlayRail = createMemo(() => railOpen() && compact());

  return (
    <div
      ref={setHostEl}
      {...REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS}
      class="relative flex h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_92%,var(--muted)_8%),color-mix(in_srgb,var(--background)_98%,transparent))]"
    >
      <Show when={showOverlayRail()}>
        <button
          type="button"
          class="absolute inset-0 z-20 cursor-pointer bg-black/18 backdrop-blur-[1px]"
          aria-label={`Close ${props.railLabel.toLowerCase()}`}
          onClick={() => setRailOpen(false)}
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
              onClick={() => setRailOpen(false)}
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
              onClick={() => setRailOpen(false)}
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">{props.rail}</div>
        </aside>
      </Show>

      <div class="relative min-h-0 min-w-0 flex-1">
        <Show when={!railOpen()}>
          <button
            type="button"
            class="absolute left-3 top-3 z-10 inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-background/92 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted/80"
            onClick={() => setRailOpen(true)}
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
