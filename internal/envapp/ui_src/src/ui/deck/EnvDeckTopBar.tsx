import { createMemo } from 'solid-js';
import { useDeck, useLayout } from '@floegence/floe-webapp-core';
import { ChevronDown, Check, Pencil, Plus } from '@floegence/floe-webapp-core/icons';
import { LayoutSelector } from '@floegence/floe-webapp-core/deck';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { ENV_SURFACE_LABELS, type EnvSurfaceId, envWidgetTypeForSurface } from '../envViewMode';

export interface EnvDeckTopBarProps {
  availableSurfaces: readonly EnvSurfaceId[];
  onAddSurface: (surfaceId: EnvSurfaceId) => void;
}

export function EnvDeckTopBar(props: EnvDeckTopBarProps) {
  const deck = useDeck();
  const layout = useLayout();

  const missingSurfaces = createMemo<EnvSurfaceId[]>(() => {
    const widgets = deck.activeLayout()?.widgets ?? [];
    return props.availableSurfaces.filter((surfaceId) => (
      !widgets.some((widget) => widget.type === envWidgetTypeForSurface(surfaceId))
    ));
  });
  const addItems = createMemo<DropdownItem[]>(() => {
    const missing = missingSurfaces();
    if (missing.length === 0) {
      return [{
        id: 'all-surfaces-present',
        label: 'All available surfaces are already on the canvas',
        disabled: true,
      }];
    }
    return missing.map((surfaceId) => ({
      id: surfaceId,
      label: ENV_SURFACE_LABELS[surfaceId],
    }));
  });

  return (
    <div class="flex h-8 items-center gap-1.5 border-b border-border/40 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_98%,transparent),color-mix(in_srgb,var(--muted)_22%,transparent))] px-2">
      <LayoutSelector />

      <div class="h-4 w-px bg-border/50" />

      <Dropdown
        trigger={(
          <button
            type="button"
            class="inline-flex h-6 items-center gap-1.5 rounded-md border border-border/65 bg-background/92 px-2 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={missingSurfaces().length === 0}
          >
            <Plus class="h-3 w-3" />
            Add surface
            <ChevronDown class="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        items={addItems()}
        onSelect={(value) => props.onAddSurface(value as EnvSurfaceId)}
        align="start"
        disabled={missingSurfaces().length === 0}
      />

      <div class="text-[11px] text-muted-foreground/70">
        {missingSurfaces().length === 0 ? 'Canvas complete' : `${missingSurfaces().length} surface${missingSurfaces().length === 1 ? '' : 's'} available`}
      </div>

      <div class="flex-1" />

      <button
        type="button"
        class={`inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors ${
          deck.editMode()
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border border-border/65 bg-background/92 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
        }`}
        onClick={() => deck.toggleEditMode()}
        disabled={layout.isMobile()}
        title={layout.isMobile() ? 'Deck editing is desktop-only.' : undefined}
      >
        {deck.editMode() ? <Check class="h-3 w-3" /> : <Pencil class="h-3 w-3" />}
        {deck.editMode() ? 'Done' : 'Edit layout'}
      </button>
    </div>
  );
}
