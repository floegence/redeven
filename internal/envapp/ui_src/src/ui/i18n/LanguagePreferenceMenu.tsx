import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Check, Globe } from '@floegence/floe-webapp-core/icons';
import { cn } from '@floegence/floe-webapp-core';

import {
  LOCALE_OPTIONS,
  SYSTEM_LOCALE_PREFERENCE,
  localeDisplayName,
  normalizeLocalePreference,
  type RedevenLocalePreference,
} from './localeMeta';
import { useI18n } from './I18nProvider';

export type LanguagePreferenceMenuVariant = 'topbar' | 'access_gate';

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

    queueMicrotask(() => focusSelectedOption());

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootEl?.contains(target)) {
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
    closeMenu(true);
    props.notify?.success(
      i18n.t('language.updatedTitle'),
      i18n.t('language.updatedMessage', {
        language: languagePreferenceLabel(preference, i18n.t('language.systemDefault')),
      }),
    );
  };

  return (
    <Show when={i18n.source() === 'browser'}>
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
            props.variant === 'topbar' ? 'h-8 w-8' : 'h-8 gap-1.5 px-2 text-xs',
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
          <div
            ref={(el) => { menuEl = el; }}
            data-envapp-language-menu={props.variant}
            role="menu"
            aria-label={i18n.t('language.optionsLabel')}
            class={cn(
              'absolute top-[calc(100%+0.5rem)] z-[90] w-64 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
              'animate-in fade-in zoom-in-95 duration-150',
              props.variant === 'topbar' ? 'right-0 max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:top-12 max-sm:w-auto' : 'left-0',
            )}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveFocus(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveFocus(-1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                focusOptionAt(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                const items = optionButtons();
                if (items.length > 0) {
                  items[items.length - 1]?.focus();
                }
              }
            }}
          >
            <div class="px-2 py-1.5">
              <div class="text-[11px] font-semibold text-foreground">{i18n.t('language.label')}</div>
              <div class="truncate text-[10px] text-muted-foreground">
                {i18n.t('language.currentResolved', { language: selectedLabel() })}
              </div>
            </div>
            <div class="my-1 h-px bg-border" />
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
                      'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors duration-75',
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
          </div>
        </Show>
      </div>
    </Show>
  );
}
