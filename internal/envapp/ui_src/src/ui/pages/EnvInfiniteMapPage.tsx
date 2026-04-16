import { Button } from '@floegence/floe-webapp-core/ui';
import { Grid3x3, LayoutDashboard, Terminal } from '@floegence/floe-webapp-core/icons';

import { useEnvContext } from './EnvContext';

export function EnvInfiniteMapPage() {
  const env = useEnvContext();

  return (
    <div class="flex h-full min-h-0 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_13%,transparent),_transparent_42%),linear-gradient(180deg,color-mix(in_srgb,var(--background)_96%,transparent),color-mix(in_srgb,var(--muted)_24%,transparent))] p-6">
      <div class="w-full max-w-4xl rounded-[28px] border border-border/70 bg-background/92 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur">
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div>
            <div class="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/55 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/75">
              <Grid3x3 class="h-3.5 w-3.5" />
              Infinite map
            </div>
            <h1 class="mt-4 text-3xl font-semibold tracking-tight text-foreground">Spatial composition is reserved here</h1>
            <p class="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              The future infinite map mode will let you place env surfaces on an open canvas, keep notes in context, and move between
              related work areas without collapsing everything into a single screen. The mode contract is live now so routing, state,
              and persistence stay stable while the canvas itself is still under construction.
            </p>
            <div class="mt-5 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="primary"
                onClick={() => env.setViewMode('deck', { surfaceId: env.activeSurface(), focusSurface: true })}
              >
                <LayoutDashboard class="mr-1 h-3.5 w-3.5" />
                Open Deck
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => env.setViewMode('tab', { surfaceId: env.lastTabSurface() })}
              >
                <Terminal class="mr-1 h-3.5 w-3.5" />
                Return to Tabs
              </Button>
            </div>
          </div>

          <div class="rounded-2xl border border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--muted)_45%,transparent),color-mix(in_srgb,var(--background)_96%,transparent))] p-4">
            <div class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">Planned behavior</div>
            <ul class="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>Drop any env surface onto an infinite canvas without losing runtime continuity.</li>
              <li>Pin notes and conversation context next to the exact terminal, file tree, or monitor you are working with.</li>
              <li>Persist spatial layout as a first-class part of the environment workspace.</li>
            </ul>
            <div class="mt-5 rounded-2xl border border-dashed border-border/75 bg-background/75 p-4 text-xs leading-6 text-muted-foreground">
              Current placeholder behavior keeps the mode selectable, preserves your desktop preference, and falls back to tab routing
              whenever a feature needs a concrete surface today.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
