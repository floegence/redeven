import { createMemo, For } from 'solid-js';
import { Refresh, Sparkles } from '@floegence/floe-webapp-core/icons';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { Tooltip } from '../primitives/Tooltip';
import {
  WORKBENCH_APPEARANCE_TEXTURES,
  WORKBENCH_APPEARANCE_TONES,
  type WorkbenchAppearance,
  type WorkbenchAppearanceTexture,
  type WorkbenchAppearanceTone,
  workbenchAppearanceTextureMeta,
  workbenchAppearanceToneMeta,
} from './workbenchAppearance';

export interface WorkbenchAppearanceButtonProps {
  appearance: WorkbenchAppearance;
  onToneSelect: (tone: WorkbenchAppearanceTone) => void;
  onTextureSelect: (texture: WorkbenchAppearanceTexture) => void;
  onReset: () => void;
}

function tonePreviewStyle(tone: WorkbenchAppearanceTone): string {
  switch (tone) {
    case 'paper':
      return 'linear-gradient(135deg, #fcfbf7 0%, #f0eadb 100%)';
    case 'ivory':
      return 'linear-gradient(135deg, #f3ead9 0%, #dbc7a3 100%)';
    case 'mist':
      return 'linear-gradient(135deg, #eef2f5 0%, #d6dde4 100%)';
    case 'slate':
      return 'linear-gradient(135deg, #526173 0%, #243244 100%)';
  }
}

function texturePreviewStyle(texture: WorkbenchAppearanceTexture): string {
  switch (texture) {
    case 'solid':
      return 'linear-gradient(135deg, #eef2f5 0%, #dde4eb 100%)';
    case 'grid':
      return [
        'linear-gradient(to right, rgba(67, 85, 104, 0.14) 1px, transparent 1px)',
        'linear-gradient(to bottom, rgba(67, 85, 104, 0.14) 1px, transparent 1px)',
        'linear-gradient(135deg, #eff3f6 0%, #dae2ea 100%)',
      ].join(', ');
    case 'pin_dot':
      return [
        'radial-gradient(circle at 8px 8px, rgba(56, 72, 90, 0.26) 0 1.25px, transparent 1.35px)',
        'radial-gradient(circle at 8px 8px, rgba(255, 255, 255, 0.75) 0 0.55px, transparent 0.65px)',
        'linear-gradient(135deg, #eef2f5 0%, #dce3ea 100%)',
      ].join(', ');
  }
}

function ToneSection(props: {
  appearance: WorkbenchAppearance;
  onToneSelect: (tone: WorkbenchAppearanceTone) => void;
}) {
  return (
    <div class="space-y-2">
      <div class="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        Surface Tone
      </div>
      <div class="grid grid-cols-2 gap-2">
        <For each={WORKBENCH_APPEARANCE_TONES}>
          {(tone) => {
            const selected = () => props.appearance.tone === tone.id;
            return (
              <button
                type="button"
                class="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors"
                classList={{
                  'border-blue-400/70 bg-blue-500/10 shadow-[0_8px_20px_-14px_rgba(37,99,235,0.55)]': selected(),
                  'border-border/70 bg-background/85 hover:border-border hover:bg-muted/35': !selected(),
                }}
                aria-pressed={selected()}
                onClick={() => props.onToneSelect(tone.id)}
              >
                <span
                  class="h-6 w-6 shrink-0 rounded-md border border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
                  style={{
                    background: tonePreviewStyle(tone.id),
                  }}
                />
                <span class="min-w-0">
                  <span class="block truncate text-[12px] font-medium text-foreground">{tone.label}</span>
                  <span class="block truncate text-[10px] text-muted-foreground">{tone.description}</span>
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function TextureSection(props: {
  appearance: WorkbenchAppearance;
  onTextureSelect: (texture: WorkbenchAppearanceTexture) => void;
}) {
  return (
    <div class="space-y-2">
      <div class="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        Texture
      </div>
      <div class="grid grid-cols-1 gap-2">
        <For each={WORKBENCH_APPEARANCE_TEXTURES}>
          {(texture) => {
            const selected = () => props.appearance.texture === texture.id;
            return (
              <button
                type="button"
                class="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors"
                classList={{
                  'border-blue-400/70 bg-blue-500/10 shadow-[0_8px_20px_-14px_rgba(37,99,235,0.55)]': selected(),
                  'border-border/70 bg-background/85 hover:border-border hover:bg-muted/35': !selected(),
                }}
                aria-pressed={selected()}
                onClick={() => props.onTextureSelect(texture.id)}
              >
                <span
                  class="h-6 w-8 shrink-0 rounded-md border border-black/10 bg-center shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]"
                  style={{
                    background: texturePreviewStyle(texture.id),
                    'background-size': texture.id === 'grid'
                      ? '12px 12px, 12px 12px, 100% 100%'
                      : texture.id === 'pin_dot'
                        ? '14px 14px, 14px 14px, 100% 100%'
                        : '100% 100%',
                  }}
                />
                <span class="min-w-0">
                  <span class="block truncate text-[12px] font-medium text-foreground">{texture.label}</span>
                  <span class="block truncate text-[10px] text-muted-foreground">{texture.description}</span>
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export function WorkbenchAppearanceButton(props: WorkbenchAppearanceButtonProps) {
  const tooltipLabel = createMemo(() => {
    const tone = workbenchAppearanceToneMeta(props.appearance.tone).label;
    const texture = workbenchAppearanceTextureMeta(props.appearance.texture).label;
    return `Workbench appearance (${tone} / ${texture})`;
  });

  const items = createMemo<DropdownItem[]>(() => ([
    {
      id: 'tone-section',
      label: 'Surface tone',
      keepOpen: true,
      content: () => (
        <ToneSection
          appearance={props.appearance}
          onToneSelect={props.onToneSelect}
        />
      ),
    },
    { id: 'divider-tone-texture', separator: true, label: '' },
    {
      id: 'texture-section',
      label: 'Texture',
      keepOpen: true,
      content: () => (
        <TextureSection
          appearance={props.appearance}
          onTextureSelect={props.onTextureSelect}
        />
      ),
    },
    { id: 'divider-reset', separator: true, label: '' },
    {
      id: 'reset',
      label: 'Reset to default',
      icon: () => <Refresh class="h-3.5 w-3.5" />,
    },
  ]));

  return (
    <Tooltip content={tooltipLabel()} placement="bottom" delay={0}>
      <Dropdown
        trigger={
          <span class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded transition-colors hover:bg-muted/60 active:bg-muted/80">
            <Sparkles class="h-4 w-4" />
          </span>
        }
        triggerAriaLabel={tooltipLabel()}
        triggerClass="rounded focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        items={items()}
        onSelect={(id) => {
          if (id === 'reset') {
            props.onReset();
          }
        }}
        align="end"
        class="shrink-0"
      />
    </Tooltip>
  );
}
