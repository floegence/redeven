import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from 'solid-js';
import {
  builtInShellThemePresets,
  getShellThemePresetsForMode,
  type FloeShellThemeMode,
  type FloeThemePreset,
} from '@floegence/floe-webapp-core';
import { Check, Highlighter, X } from '@floegence/floe-webapp-core/icons';
import { TopBarIconButton } from '@floegence/floe-webapp-core/layout';

import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';
import type { DesktopThemeSource } from '../shared/desktopTheme';
import { DesktopAnchoredOverlaySurface } from './DesktopAnchoredOverlaySurface';

export type DesktopThemePickerSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: FloeShellThemeMode;
  shellThemes: Readonly<Record<FloeShellThemeMode, string>>;
}>;

export type DesktopThemePickerProps = Readonly<{
  openRequest: number;
  snapshot: DesktopThemePickerSnapshot;
  i18n: DesktopI18n;
  onSourceChange: (source: DesktopThemeSource) => DesktopThemePickerSnapshot;
  onShellThemeChange: (mode: FloeShellThemeMode, presetName: string) => DesktopThemePickerSnapshot;
}>;

const THEME_SOURCE_OPTIONS = ['system', 'light', 'dark'] as const satisfies readonly DesktopThemeSource[];

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
} as const satisfies Readonly<Record<string, string>>;

function translationKey(value: string): DesktopTranslationKey {
  return value as DesktopTranslationKey;
}

function sourceLabelKey(source: DesktopThemeSource): DesktopTranslationKey {
  return translationKey(`shell.themePicker.mode.${source}`);
}

export function desktopThemePresetLabel(i18n: DesktopI18n, preset: FloeThemePreset): string {
  const key = PRESET_TRANSLATION_KEYS[preset.name as keyof typeof PRESET_TRANSLATION_KEYS];
  return key ? i18n.t(translationKey(key)) : preset.displayName;
}

export function desktopThemePresetsForMode(mode: FloeShellThemeMode): readonly FloeThemePreset[] {
  return getShellThemePresetsForMode(builtInShellThemePresets, mode);
}

function moveIndex(event: KeyboardEvent, current: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
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

function focusElementByID(id: string): void {
  requestAnimationFrame(() => {
    document.getElementById(id)?.focus();
  });
}

function DesktopThemePreview(props: Readonly<{ preset: FloeThemePreset }>) {
  const preview = () => props.preset.preview;

  return (
    <div
      class="redeven-theme-picker__preview"
      style={{
        'background-color': preview()?.background,
        'border-color': preview()?.border,
      }}
      aria-hidden="true"
    >
      <div
        class="redeven-theme-picker__preview-sidebar"
        style={{ 'background-color': preview()?.sidebar ?? preview()?.surface }}
      />
      <div class="redeven-theme-picker__preview-content">
        <div
          class="redeven-theme-picker__preview-surface"
          style={{
            'background-color': preview()?.surface,
            'border-color': preview()?.border,
          }}
        >
          <span style={{ 'background-color': preview()?.primary }} />
          <span style={{ 'background-color': preview()?.border }} />
        </div>
        <div class="redeven-theme-picker__preview-spectrum">
          <For each={preview()?.colors ?? []}>
            {(color) => <span style={{ 'background-color': color }} />}
          </For>
        </div>
      </div>
    </div>
  );
}

export function DesktopThemePicker(props: DesktopThemePickerProps) {
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal('');
  const [themeGroupFocused, setThemeGroupFocused] = createSignal(false);
  const id = createUniqueId();
  const dialogID = `redeven-desktop-theme-picker-${id}`;
  const modeGroupID = `${dialogID}-mode`;
  const themeGroupID = `${dialogID}-themes`;
  let buttonRef: HTMLButtonElement | undefined;
  let overlayRef: HTMLDivElement | undefined;
  let themeGridRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let previousMode: FloeShellThemeMode | undefined;

  const activeMode = createMemo<FloeShellThemeMode>(() => (
    props.snapshot.source === 'system' ? props.snapshot.resolvedTheme : props.snapshot.source
  ));
  const presets = createMemo(() => desktopThemePresetsForMode(activeMode()));
  const selectedPresetName = createMemo(() => props.snapshot.shellThemes[activeMode()]);

  const clearScrollFrame = () => {
    if (!scrollFrame) {
      return;
    }
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  };

  const scrollSelectedThemeIntoView = (focus = false) => {
    clearScrollFrame();
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const selected = themeGridRef?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
      selected?.scrollIntoView({ block: 'nearest' });
      if (focus) {
        selected?.focus();
      }
    });
  };

  const focusCurrentSource = () => {
    focusElementByID(`${modeGroupID}-${props.snapshot.source}`);
  };

  const openPicker = () => {
    setError('');
    setOpen(true);
    focusCurrentSource();
  };

  const closePicker = (restoreTrigger: boolean) => {
    setOpen(false);
    setError('');
    if (restoreTrigger) {
      requestAnimationFrame(() => buttonRef?.focus());
    }
  };

  const showUpdateFailure = () => {
    setError(props.i18n.t(translationKey('shell.themePicker.changeFailed')));
  };

  const selectSource = (source: DesktopThemeSource) => {
    if (source === props.snapshot.source) {
      setError('');
      return;
    }
    try {
      const result = props.onSourceChange(source);
      if (result.source !== source) {
        showUpdateFailure();
        return;
      }
      setError('');
    } catch {
      showUpdateFailure();
    }
  };

  const selectPreset = (preset: FloeThemePreset) => {
    const mode = activeMode();
    if (preset.name === props.snapshot.shellThemes[mode]) {
      setError('');
      return;
    }
    try {
      const result = props.onShellThemeChange(mode, preset.name);
      if (result.shellThemes[mode] !== preset.name) {
        showUpdateFailure();
        return;
      }
      setError('');
    } catch {
      showUpdateFailure();
    }
  };

  createEffect(on(
    () => props.openRequest,
    (next, previous) => {
      if (next !== previous) {
        openPicker();
      }
    },
    { defer: true },
  ));

  createEffect(() => {
    if (!open()) {
      previousMode = activeMode();
      return;
    }
    const nextMode = activeMode();
    const modeChanged = previousMode !== undefined && previousMode !== nextMode;
    previousMode = nextMode;
    void selectedPresetName();
    scrollSelectedThemeIntoView(modeChanged && themeGroupFocused());
  });

  createEffect(() => {
    if (!open()) {
      return;
    }
    const containsPickerTarget = (target: EventTarget | null): boolean => (
      target instanceof Node
      && (buttonRef?.contains(target) === true || overlayRef?.contains(target) === true)
    );
    const handleMouseDown = (event: MouseEvent) => {
      if (!containsPickerTarget(event.target)) {
        closePicker(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePicker(true);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  onCleanup(clearScrollFrame);

  return (
    <>
      <TopBarIconButton
        ref={(element) => {
          buttonRef = element;
        }}
        label={props.i18n.t(translationKey('shell.themePicker.openLabel'))}
        tooltip={props.i18n.t(translationKey('shell.themePicker.openLabel'))}
        aria-haspopup="dialog"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={dialogID}
        onClick={() => {
          if (open()) {
            closePicker(true);
          } else {
            openPicker();
          }
        }}
      >
        <Highlighter class="h-4 w-4" />
      </TopBarIconButton>

      <Show when={open()}>
        <DesktopAnchoredOverlaySurface
          open={open()}
          anchorRef={buttonRef}
          placement="bottom"
          role="dialog"
          ariaModal={false}
          ariaLabel={props.i18n.t(translationKey('shell.themePicker.title'))}
          interactive
          hideArrow
          class="redeven-theme-picker"
          onOverlayRef={(element) => {
            overlayRef = element;
          }}
          onFocusOut={(event) => {
            const nextTarget = event.relatedTarget;
            queueMicrotask(() => {
              if (!open() || (nextTarget instanceof Node && overlayRef?.contains(nextTarget))) {
                return;
              }
              closePicker(false);
            });
          }}
        >
          <div id={dialogID} class="redeven-theme-picker__panel">
            <div class="redeven-theme-picker__header">
              <h2 class="redeven-theme-picker__title">
                {props.i18n.t(translationKey('shell.themePicker.title'))}
              </h2>
            </div>

            <div class="redeven-theme-picker__mode-section">
              <div id={`${modeGroupID}-label`} class="redeven-theme-picker__section-label">
                {props.i18n.t(translationKey('shell.themePicker.modeLabel'))}
              </div>
              <div
                role="radiogroup"
                aria-labelledby={`${modeGroupID}-label`}
                class="redeven-theme-picker__mode-group"
              >
                <For each={THEME_SOURCE_OPTIONS}>
                  {(source, index) => {
                    const selected = () => props.snapshot.source === source;
                    return (
                      <button
                        type="button"
                        id={`${modeGroupID}-${source}`}
                        role="radio"
                        aria-checked={selected() ? 'true' : 'false'}
                        tabIndex={selected() ? 0 : -1}
                        class="redeven-theme-picker__mode"
                        onClick={() => selectSource(source)}
                        onKeyDown={(event) => {
                          const nextIndex = moveIndex(event, index(), THEME_SOURCE_OPTIONS.length);
                          if (nextIndex !== null) {
                            event.preventDefault();
                            const nextSource = THEME_SOURCE_OPTIONS[nextIndex]!;
                            selectSource(nextSource);
                            focusElementByID(`${modeGroupID}-${nextSource}`);
                          } else if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectSource(source);
                          }
                        }}
                      >
                        {props.i18n.t(sourceLabelKey(source))}
                      </button>
                    );
                  }}
                </For>
              </div>
              <Show when={props.snapshot.source === 'system'}>
                <p class="redeven-theme-picker__system-status">
                  {props.i18n.t(translationKey(
                    props.snapshot.resolvedTheme === 'light'
                      ? 'shell.themePicker.systemResolvedLight'
                      : 'shell.themePicker.systemResolvedDark',
                  ))}
                </p>
              </Show>
            </div>

            <div class="redeven-theme-picker__themes-header">
              <div id={`${themeGroupID}-label`} class="redeven-theme-picker__section-label">
                {props.i18n.t(translationKey('shell.themePicker.themesLabel'))}
              </div>
              <span class="redeven-theme-picker__theme-count">{presets().length}</span>
            </div>

            <div
              ref={(element) => {
                themeGridRef = element;
              }}
              role="radiogroup"
              aria-labelledby={`${themeGroupID}-label`}
              class="redeven-theme-picker__theme-scroll"
              onFocusIn={() => setThemeGroupFocused(true)}
              onFocusOut={(event) => {
                if (!(event.relatedTarget instanceof Node) || !themeGridRef?.contains(event.relatedTarget)) {
                  setThemeGroupFocused(false);
                }
              }}
            >
              <div class="redeven-theme-picker__theme-grid">
                <For each={presets()}>
                  {(preset, index) => {
                    const selected = () => preset.name === selectedPresetName();
                    const optionID = `${themeGroupID}-${preset.name}`;
                    return (
                      <button
                        type="button"
                        id={optionID}
                        role="radio"
                        aria-checked={selected() ? 'true' : 'false'}
                        tabIndex={selected() ? 0 : -1}
                        class="redeven-theme-picker__theme"
                        onClick={() => selectPreset(preset)}
                        onKeyDown={(event) => {
                          const nextIndex = moveIndex(event, index(), presets().length);
                          if (nextIndex !== null) {
                            event.preventDefault();
                            const nextPreset = presets()[nextIndex];
                            if (nextPreset) {
                              selectPreset(nextPreset);
                              focusElementByID(`${themeGroupID}-${nextPreset.name}`);
                            }
                          } else if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectPreset(preset);
                          }
                        }}
                      >
                        <DesktopThemePreview preset={preset} />
                        <span class="redeven-theme-picker__theme-footer">
                          <span class="redeven-theme-picker__theme-name">
                            {desktopThemePresetLabel(props.i18n, preset)}
                          </span>
                          <span class="redeven-theme-picker__check" aria-hidden="true">
                            <Check class="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            <Show when={error()}>
              <div class="redeven-theme-picker__error" role="alert">
                {error()}
              </div>
            </Show>

            <button
              type="button"
              class="redeven-theme-picker__close"
              aria-label={props.i18n.t(translationKey('shell.themePicker.closeLabel'))}
              title={props.i18n.t(translationKey('shell.themePicker.closeLabel'))}
              onClick={() => closePicker(true)}
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </DesktopAnchoredOverlaySurface>
      </Show>
    </>
  );
}
