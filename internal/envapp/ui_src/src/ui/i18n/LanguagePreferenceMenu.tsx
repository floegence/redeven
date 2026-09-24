import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Check, Globe } from '@floegence/floe-webapp-core/icons';
import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';
import { observeViewport, readViewportSnapshot } from '@floegence/floe-webapp-core/viewport';
import { cn, useResizeObserver } from '@floegence/floe-webapp-core';

import {
  LOCALE_OPTIONS,
  SYSTEM_LOCALE_PREFERENCE,
  localeDisplayName,
  normalizeLocalePreference,
  type RedevenLocalePreference,
} from './localeMeta';
import { useI18n } from './I18nProvider';

export type LanguagePreferenceMenuVariant = 'topbar' | 'access_gate' | 'inline';

export type LanguagePreferenceMenuProps = Readonly<{
  variant: LanguagePreferenceMenuVariant;
  openRequestSeq?: () => number;
  notify?: Readonly<{
    success: (title: string, message: string) => void;
  }>;
  class?: string;
}>;

type LanguagePreferenceOption = Readonly<{
  value: RedevenLocalePreference;
  label: string;
}>;

function languagePreferenceLabel(preference: RedevenLocalePreference, systemLabel: string): string {
  return preference === SYSTEM_LOCALE_PREFERENCE
    ? systemLabel
    : localeDisplayName(preference);
}

export function LanguagePreferenceMenu(props: LanguagePreferenceMenuProps): JSX.Element {
  const i18n = useI18n();
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined;
  const [placement, setPlacement] = createSignal({ x: 0, y: 0, width: 256, height: 480 });
  const surfaceSize = useResizeObserver(() => triggerEl?.closest<HTMLElement>('[data-floe-surface-portal-layer]') ?? undefined);
  let lastOpenRequestSeq = props.openRequestSeq?.() ?? 0;

  const options = createMemo<readonly LanguagePreferenceOption[]>(() => [
    { value: SYSTEM_LOCALE_PREFERENCE, label: i18n.t('language.systemDefault') },
    ...LOCALE_OPTIONS.map((meta) => ({ value: meta.id, label: localeDisplayName(meta.id) })),
  ]);

  const selectedLabel = createMemo(() => languagePreferenceLabel(
    i18n.localePreference(),
    i18n.t('language.systemDefault'),
  ));

  const closeMenu = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) {
      queueMicrotask(() => triggerEl?.focus());
    }
  };

  const optionButtons = () => Array.from(menuEl?.querySelectorAll<HTMLButtonElement>('[data-envapp-language-option]') ?? []);

  const focusSelectedOption = () => {
    const items = optionButtons();
    if (!items.length) {
      return;
    }
    const selectedIndex = items.findIndex((item) => item.getAttribute('aria-checked') === 'true');
    items[(selectedIndex >= 0 ? selectedIndex : 0)]?.focus();
  };

  const focusOptionAt = (index: number) => {
    const items = optionButtons();
    if (!items.length) {
      return;
    }
    const nextIndex = ((index % items.length) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const moveFocus = (delta: number) => {
    const items = optionButtons();
    if (!items.length) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const selectedIndex = items.findIndex((item) => item.getAttribute('aria-checked') === 'true');
    const baseIndex = currentIndex >= 0 ? currentIndex : (selectedIndex >= 0 ? selectedIndex : 0);
    focusOptionAt(baseIndex + delta);
  };

  const handleOptionsKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key === 'Tab' && props.variant !== 'inline') closeMenu();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusOptionAt(event.key === 'Home' ? 0 : optionButtons().length - 1);
    }
  };

  createEffect(() => {
    const nextSeq = props.openRequestSeq?.() ?? 0;
    if (nextSeq <= 0 || nextSeq === lastOpenRequestSeq) {
      return;
    }
    lastOpenRequestSeq = nextSeq;
    setOpen(true);
  });

  createEffect(() => {
    if (!open()) {
      return;
    }

    void surfaceSize();
    const place = () => {
      const anchor = triggerEl?.getBoundingClientRect();
      if (!anchor) return;
      const { visible, safeArea } = readViewportSnapshot(window);
      const ownerBoundary = triggerEl?.closest<HTMLElement>('[data-floe-surface-portal-layer]')?.getBoundingClientRect();
      const boundary = ownerBoundary ? {
        left: ownerBoundary.left,
        top: ownerBoundary.top,
        right: ownerBoundary.right,
        bottom: ownerBoundary.bottom,
        width: ownerBoundary.width,
        height: ownerBoundary.height,
      } : {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const width = Math.min(256, Math.max(1, Math.min(boundary.width, visible.width - safeArea.left - safeArea.right) - 16));
      const height = Math.min(560, Math.max(1, Math.min(boundary.height, visible.height - safeArea.top - safeArea.bottom) - 16));
      setPlacement({ x: anchor.right - width, y: anchor.bottom + 8, width, height });
    };
    onCleanup(observeViewport(window, place));
    place();
  });

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => focusSelectedOption());

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (rootEl?.contains(target) || menuEl?.contains(target))) {
        return;
      }
      closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu(true);
      }
    };

    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    onCleanup(() => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    });
  });

  createEffect(() => {
    if (i18n.source() !== 'browser') {
      setOpen(false);
    }
  });

  const selectLanguage = async (value: RedevenLocalePreference) => {
    const preference = normalizeLocalePreference(value);
    await i18n.setLocalePreference(preference);
    if (props.variant !== 'inline') closeMenu(true);
    props.notify?.success(
      i18n.t('language.updatedTitle'),
      i18n.t('language.updatedMessage', {
        language: languagePreferenceLabel(preference, i18n.t('language.systemDefault')),
      }),
    );
  };

  const languageOptions = () => (
            <For each={options()}>
              {(option) => {
                const selected = () => i18n.localePreference() === option.value;
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected()}
                    data-envapp-language-option={option.value}
                    class={cn(
                      'flex min-h-[44px] w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-75',
                      'hover:bg-accent focus:bg-accent focus:outline-none',
                      selected() && 'font-medium text-foreground',
                    )}
                  onClick={() => void selectLanguage(option.value)}
                  >
                    <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {selected() ? <Check class="h-3 w-3" /> : null}
                    </span>
                    <span class="min-w-0 flex-1 truncate">{option.label}</span>
                  </button>
                );
              }}
            </For>
  );

  return (
    <Show when={i18n.source() === 'browser'}>
      <Show when={props.variant === 'inline'} fallback={
      <div ref={(el) => { rootEl = el; }} class="relative shrink-0">
        <button
          ref={(el) => { triggerEl = el; }}
          type="button"
          data-envapp-language-trigger={props.variant}
          class={cn(
            'inline-flex cursor-pointer items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors duration-150',
            'hover:border-border/70 hover:bg-accent hover:text-foreground',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
            open() && 'border-border/70 bg-accent text-foreground',
            props.variant === 'topbar' ? 'h-8 w-8 max-md:h-11 max-md:w-11' : 'h-11 gap-1.5 px-2 text-xs',
            props.class,
          )}
          aria-label={i18n.t('language.label')}
          aria-haspopup="menu"
          aria-expanded={open()}
          title={i18n.t('language.currentResolved', { language: selectedLabel() })}
          onClick={() => setOpen((current) => !current)}
        >
          <Globe class={props.variant === 'topbar' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          {props.variant === 'access_gate' ? <span>{selectedLabel()}</span> : null}
        </button>

        <Show when={open()}>
          <SurfaceFloatingLayer owner={triggerEl} position={placement()} estimatedSize={placement()} class="z-[90]">
          <div
            ref={(el) => { menuEl = el; }}
            data-envapp-language-menu={props.variant}
            role="menu"
            aria-label={i18n.t('language.optionsLabel')}
            class={cn(
              'overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
              'animate-in fade-in [animation-duration:150ms] transition-none',
            )}
            style={{ width: `${placement().width}px`, 'max-height': `${placement().height}px` }}
            onKeyDown={handleOptionsKeyDown}
          >
            <div class="px-2 py-1.5">
              <div class="text-[11px] font-semibold text-foreground">{i18n.t('language.label')}</div>
              <div class="truncate text-[10px] text-muted-foreground">
                {i18n.t('language.currentResolved', { language: selectedLabel() })}
              </div>
            </div>
            <div class="my-1 h-px bg-border" />
            {languageOptions()}
          </div>
          </SurfaceFloatingLayer>
        </Show>
      </div>
      }>
        <div ref={(el) => { menuEl = el; }} role="menu" aria-label={i18n.t('language.optionsLabel')}
          data-envapp-language-menu="inline" class="p-2" onKeyDown={handleOptionsKeyDown}>
          {languageOptions()}
        </div>
      </Show>
    </Show>
  );
}
