import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, type JSX } from 'solid-js';
import {
  getShellThemePresetsForMode,
  resolveThemeTokenOverrides,
  useTheme,
  type FloeShellThemeMode,
  type FloeThemePreset,
  type ThemeType,
} from '@floegence/floe-webapp-core';
import { Check, Highlighter, X } from '@floegence/floe-webapp-core/icons';
import { cn } from '@floegence/floe-webapp-core';
import { TopBarIconButton } from '@floegence/floe-webapp-core/layout';

import { useI18n, type EnvAppTranslationKey } from './i18n';

export type EnvAppThemePickerProps = Readonly<{
  openRequestSeq?: () => number;
  tooltip?: string | false;
  onSourceChange: (source: ThemeType) => boolean;
  onShellThemeChange: (mode: FloeShellThemeMode, presetName: string) => boolean;
}>;

const THEME_SOURCE_OPTIONS = ['system', 'light', 'dark'] as const satisfies readonly ThemeType[];

const PRESET_TRANSLATION_KEYS = {
  'classic-light': 'shell.themePicker.presets.classic-light',
  paper: 'shell.themePicker.presets.paper',
  mist: 'shell.themePicker.presets.mist',
  meadow: 'shell.themePicker.presets.meadow',
  citrus: 'shell.themePicker.presets.citrus',
  lilac: 'shell.themePicker.presets.lilac',
  'light-plus': 'shell.themePicker.presets.light-plus',
  'quiet-light': 'shell.themePicker.presets.quiet-light',
  'solarized-light': 'shell.themePicker.presets.solarized-light',
  'github-light': 'shell.themePicker.presets.github-light',
  'hc-light': 'shell.themePicker.presets.hc-light',
  'classic-dark': 'shell.themePicker.presets.classic-dark',
  ink: 'shell.themePicker.presets.ink',
  slate: 'shell.themePicker.presets.slate',
  forest: 'shell.themePicker.presets.forest',
  ember: 'shell.themePicker.presets.ember',
  ocean: 'shell.themePicker.presets.ocean',
  'dark-plus': 'shell.themePicker.presets.dark-plus',
  monokai: 'shell.themePicker.presets.monokai',
  nord: 'shell.themePicker.presets.nord',
  dracula: 'shell.themePicker.presets.dracula',
  abyss: 'shell.themePicker.presets.abyss',
} as const satisfies Readonly<Record<string, EnvAppTranslationKey>>;

function moveIndex(event: KeyboardEvent, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

function presetLabel(i18n: ReturnType<typeof useI18n>, preset: FloeThemePreset): string {
  const key = PRESET_TRANSLATION_KEYS[preset.name as keyof typeof PRESET_TRANSLATION_KEYS];
  return key ? i18n.t(key) : preset.displayName;
}

function presetColor(
  preset: FloeThemePreset,
  mode: FloeShellThemeMode,
  token: `--${string}`,
  fallback: string,
): string {
  return resolveThemeTokenOverrides(preset.tokens, mode)[token] ?? fallback;
}

function ThemePreview(props: Readonly<{ preset: FloeThemePreset; mode: FloeShellThemeMode }>) {
  const preview = () => props.preset.preview;
  const background = () =>
    preview()?.background ?? presetColor(props.preset, props.mode, '--background', 'transparent');
  const border = () => preview()?.border ?? presetColor(props.preset, props.mode, '--border', 'currentColor');
  const sidebar = () => preview()?.sidebar ?? presetColor(props.preset, props.mode, '--sidebar', background());
  const surface = () => preview()?.surface ?? presetColor(props.preset, props.mode, '--card', background());
  const primary = () => preview()?.primary ?? presetColor(props.preset, props.mode, '--primary', 'currentColor');

  return (
    <div
      class="relative h-12 overflow-hidden rounded border"
      style={{ 'background-color': background(), 'border-color': border() }}
      aria-hidden="true"
    >
      <div class="absolute inset-y-1.5 left-1.5 w-3 rounded-sm" style={{ 'background-color': sidebar() }} />
      <div
        class="absolute inset-y-1.5 right-1.5 left-6 overflow-hidden rounded-sm border"
        style={{ 'background-color': surface(), 'border-color': border() }}
      >
        <span class="absolute top-1.5 left-1.5 h-2 w-7 rounded-full" style={{ 'background-color': primary() }} />
        <span class="absolute right-1.5 bottom-1.5 left-1.5 flex gap-0.5">
          <For each={(preview()?.colors ?? []).slice(0, 4)}>
            {(color) => <span class="h-1.5 flex-1 rounded-full" style={{ 'background-color': color }} />}
          </For>
        </span>
      </div>
    </div>
  );
}

export function EnvAppThemePicker(props: EnvAppThemePickerProps): JSX.Element {
  const theme = useTheme();
  const i18n = useI18n();
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal('');
  const [themeGroupFocused, setThemeGroupFocused] = createSignal(false);
  const id = `redeven-env-theme-picker-${createUniqueId()}`;
  const dialogID = `${id}-dialog`;
  const modeGroupID = `${id}-mode`;
  const themeGroupID = `${id}-themes`;
  let rootEl: HTMLDivElement | undefined;
  let dialogEl: HTMLDivElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;
  let themeGridEl: HTMLDivElement | undefined;
  let lastOpenRequest = props.openRequestSeq?.() ?? 0;
  let previousMode: FloeShellThemeMode | undefined;

  const activeMode = createMemo<FloeShellThemeMode>(() => theme.resolvedTheme());
  const presets = createMemo(() => getShellThemePresetsForMode(theme.shellPresets(), activeMode()));
  const selectedPresetName = createMemo(() => theme.shellPresetForMode(activeMode())?.name);
  const selectedPreset = createMemo(() => presets().find((preset) => preset.name === selectedPresetName()));
  const isPresetReplacedByModeChange = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    const presetName = target.closest<HTMLElement>('[data-envapp-theme-preset]')?.dataset.envappThemePreset;
    return Boolean(presetName && !presets().some((preset) => preset.name === presetName));
  };

  const closePicker = (restoreFocus = false) => {
    setOpen(false);
    setError('');
    if (restoreFocus) {
      queueMicrotask(() => triggerEl?.focus());
    }
  };

  const focusById = (targetID: string) => {
    queueMicrotask(() => document.getElementById(targetID)?.focus());
  };

  const openPicker = () => {
    setError('');
    setOpen(true);
    focusById(`${modeGroupID}-${theme.theme()}`);
  };

  const scrollSelectedThemeIntoView = (focus = false) => {
    queueMicrotask(() => {
      const selected = themeGridEl?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
      selected?.scrollIntoView?.({ block: 'nearest' });
      if (focus) selected?.focus();
    });
  };

  createEffect(() => {
    const nextRequest = props.openRequestSeq?.() ?? 0;
    if (nextRequest <= 0 || nextRequest === lastOpenRequest) return;
    lastOpenRequest = nextRequest;
    openPicker();
  });

  createEffect(() => {
    const nextMode = activeMode();
    void selectedPresetName();
    if (!open()) {
      previousMode = nextMode;
      return;
    }
    const modeChanged = previousMode !== undefined && previousMode !== nextMode;
    previousMode = nextMode;
    scrollSelectedThemeIntoView(modeChanged && themeGroupFocused());
  });

  createEffect(() => {
    if (!open()) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootEl?.contains(target)) return;
      closePicker();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePicker(true);
    };
    document.addEventListener('pointerdown', closeOnPointerDown, true);
    document.addEventListener('keydown', closeOnKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true);
      document.removeEventListener('keydown', closeOnKeyDown, true);
    });
  });

  const showUpdateFailure = () => setError(i18n.t('shell.themePicker.changeFailed'));
  const selectSource = (source: ThemeType) => {
    if (source === theme.theme()) {
      setError('');
      return;
    }
    try {
      if (!props.onSourceChange(source)) {
        showUpdateFailure();
        return;
      }
      setError('');
    } catch {
      showUpdateFailure();
    }
  };
  const selectPreset = (preset: FloeThemePreset) => {
    if (preset.name === selectedPresetName()) {
      setError('');
      return;
    }
    try {
      if (!props.onShellThemeChange(activeMode(), preset.name)) {
        showUpdateFailure();
        return;
      }
      setError('');
    } catch {
      showUpdateFailure();
    }
  };
  const activePreviewColor = () => {
    const preset = selectedPreset();
    return (
      preset?.preview?.primary ??
      (preset ? presetColor(preset, activeMode(), '--primary', 'var(--primary)') : 'var(--primary)')
    );
  };

  return (
    <div
      ref={(element) => {
        rootEl = element;
      }}
      class="relative shrink-0"
    >
      <TopBarIconButton
        ref={(element) => {
          triggerEl = element;
        }}
        label={i18n.t('shell.themePicker.openLabel')}
        tooltip={props.tooltip}
        class={cn(
          'border border-transparent text-muted-foreground',
          open() && 'border-border/70 bg-accent text-foreground',
        )}
        aria-haspopup="dialog"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={dialogID}
        data-envapp-theme-trigger="topbar"
        onClick={() => (open() ? closePicker(true) : openPicker())}
      >
        <span class="relative inline-flex h-4 w-4 items-center justify-center">
          <Highlighter class="h-4 w-4" />
          <span
            class="absolute right-0 bottom-0 h-1.5 w-1.5 rounded-full border border-background"
            style={{ 'background-color': activePreviewColor() }}
            aria-hidden="true"
          />
        </span>
      </TopBarIconButton>

      <Show when={open()}>
        <div
          ref={(element) => {
            dialogEl = element;
          }}
          id={dialogID}
          role="dialog"
          aria-modal="false"
          aria-label={i18n.t('shell.themePicker.title')}
          data-envapp-theme-menu="topbar"
          class="absolute top-[calc(100%+0.5rem)] right-0 z-[90] w-[min(30rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl max-sm:fixed max-sm:top-12 max-sm:right-2 max-sm:left-2 max-sm:w-auto"
          onFocusOut={(event) => {
            const nextTarget = event.relatedTarget;
            // A resolved system-mode change removes the focused preset before
            // the replacement side can receive focus, yielding no related target.
            if (isPresetReplacedByModeChange(event.target) || !(nextTarget instanceof Node)) return;
            queueMicrotask(() => {
              if (!open() || dialogEl?.contains(nextTarget) || isPresetReplacedByModeChange(nextTarget)) return;
              closePicker();
            });
          }}
        >
          <div class="mb-3 min-w-0 pr-9">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-foreground">{i18n.t('shell.themePicker.title')}</h2>
              <p class="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                {selectedPreset() ? presetLabel(i18n, selectedPreset()!) : activeMode()}
              </p>
            </div>
          </div>

          <div class="mb-3">
            <div
              id={`${modeGroupID}-label`}
              class="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground"
            >
              {i18n.t('shell.themePicker.modeLabel')}
            </div>
            <div
              role="radiogroup"
              aria-labelledby={`${modeGroupID}-label`}
              class="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1"
            >
              <For each={THEME_SOURCE_OPTIONS}>
                {(source, index) => {
                  const selected = () => theme.theme() === source;
                  return (
                    <button
                      type="button"
                      id={`${modeGroupID}-${source}`}
                      role="radio"
                      aria-checked={selected() ? 'true' : 'false'}
                      tabIndex={selected() ? 0 : -1}
                      class={cn(
                        'h-7 cursor-pointer rounded-md px-2 text-[11px] font-medium transition-colors',
                        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        selected()
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                      onClick={() => selectSource(source)}
                      onKeyDown={(event) => {
                        const nextIndex = moveIndex(event, index(), THEME_SOURCE_OPTIONS.length);
                        if (nextIndex !== null) {
                          event.preventDefault();
                          const nextSource = THEME_SOURCE_OPTIONS[nextIndex]!;
                          selectSource(nextSource);
                          focusById(`${modeGroupID}-${nextSource}`);
                        }
                      }}
                    >
                      {i18n.t(`shell.themePicker.mode.${source}` as EnvAppTranslationKey)}
                    </button>
                  );
                }}
              </For>
            </div>
            <Show when={theme.theme() === 'system'}>
              <p class="mt-1.5 text-[10px] text-muted-foreground">
                {i18n.t(
                  `shell.themePicker.systemResolved${activeMode() === 'light' ? 'Light' : 'Dark'}` as EnvAppTranslationKey,
                )}
              </p>
            </Show>
          </div>

          <div class="mb-1.5 flex items-center justify-between gap-2">
            <div
              id={`${themeGroupID}-label`}
              class="text-[10px] font-semibold uppercase text-muted-foreground"
            >
              {i18n.t('shell.themePicker.themesLabel')}
            </div>
            <span class="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {presets().length}
            </span>
          </div>

          <div
            ref={(element) => {
              themeGridEl = element;
            }}
            role="radiogroup"
            aria-labelledby={`${themeGroupID}-label`}
            class="max-h-[min(28rem,calc(100vh-12rem))] overflow-y-auto pr-0.5"
            onFocusIn={() => setThemeGroupFocused(true)}
            onFocusOut={(event) => {
              if (isPresetReplacedByModeChange(event.target)) return;
              if (!(event.relatedTarget instanceof Node) || !themeGridEl?.contains(event.relatedTarget)) {
                setThemeGroupFocused(false);
              }
            }}
            onKeyDown={(event) => {
              const current = event.target;
              if (!(current instanceof HTMLElement)) return;
              const buttons = Array.from(themeGridEl?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
              const index = buttons.indexOf(current as HTMLButtonElement);
              if (index < 0) return;
              const nextIndex = moveIndex(event, index, buttons.length);
              if (nextIndex === null) return;
              event.preventDefault();
              const nextPreset = presets()[nextIndex];
              if (!nextPreset) return;
              selectPreset(nextPreset);
              buttons[nextIndex]?.focus();
            }}
          >
            <div data-envapp-theme-grid="presets" class="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <For each={presets()}>
                {(preset) => {
                  const selected = () => preset.name === selectedPresetName();
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected() ? 'true' : 'false'}
                      tabIndex={selected() ? 0 : -1}
                      data-envapp-theme-preset={preset.name}
                      class={cn(
                        'group min-w-0 cursor-pointer rounded-lg border p-1.5 text-left transition-colors motion-reduce:transition-none',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-popover',
                        selected()
                          ? 'border-primary bg-accent/60 shadow-sm'
                          : 'border-border bg-card/80 hover:border-input hover:bg-accent/40',
                      )}
                      aria-label={presetLabel(i18n, preset)}
                      onClick={() => selectPreset(preset)}
                    >
                      <ThemePreview preset={preset} mode={activeMode()} />
                      <span class="mt-1.5 flex min-h-7 min-w-0 items-start justify-between gap-1 px-0.5">
                        <span
                          data-envapp-theme-preset-label={preset.name}
                          class="min-w-0 break-words text-[11px] font-medium leading-tight text-foreground"
                        >
                          {presetLabel(i18n, preset)}
                        </span>
                        <span
                          class={cn(
                            'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity',
                            selected() ? 'opacity-100' : 'opacity-0',
                          )}
                          aria-hidden="true"
                        >
                          <Check class="h-2.5 w-2.5" />
                        </span>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
          <Show when={error()}>
            <p role="alert" class="mt-2 pr-9 text-[11px] leading-snug text-destructive">
              {error()}
            </p>
          </Show>
          <button
            type="button"
            class="absolute top-3 right-3 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={i18n.t('shell.themePicker.closeLabel')}
            title={i18n.t('shell.themePicker.closeLabel')}
            onClick={() => closePicker(true)}
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </Show>
    </div>
  );
}
