import { For, Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Checkbox, Dialog, NumberInput } from '@floegence/floe-webapp-core/ui';
import {
  DEFAULT_TERMINAL_FONT_FAMILY_ID,
  type TerminalMobileInputMode,
} from '../services/terminalPreferences';
import { useI18n, type I18nHelpers } from '../i18n';

type TerminalThemeOptionId = 'system' | 'dark' | 'light' | 'solarizedDark' | 'monokai' | 'tokyoNight';

const TERMINAL_THEME_ITEMS: Array<{ id: TerminalThemeOptionId; labelKey: Parameters<I18nHelpers['t']>[0] }> = [
  { id: 'system', labelKey: 'terminal.settings.systemTheme' },
  { id: 'dark', labelKey: 'terminal.settings.dark' },
  { id: 'light', labelKey: 'terminal.settings.light' },
  { id: 'solarizedDark', labelKey: 'terminal.settings.solarizedDark' },
  { id: 'monokai', labelKey: 'terminal.settings.monokai' },
  { id: 'tokyoNight', labelKey: 'terminal.settings.tokyoNight' },
];

export const TERMINAL_FONT_OPTIONS: Array<{ id: string; label: string; family: string }> = [
  {
    id: 'iosevka',
    label: 'Iosevka',
    family: '"Iosevka", "JetBrains Mono", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", "Iosevka", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'sfmono',
    label: 'SF Mono',
    family: '"SF Mono", Menlo, Monaco, "JetBrains Mono", "Iosevka", monospace',
  },
  {
    id: 'menlo',
    label: 'Menlo',
    family: 'Menlo, Monaco, "SF Mono", "JetBrains Mono", "Iosevka", monospace',
  },
  {
    id: 'monaco',
    label: 'Monaco',
    family: 'Monaco, Menlo, "SF Mono", "JetBrains Mono", "Iosevka", monospace',
  },
];

export function resolveTerminalFontFamily(id: string): string {
  const fallback = TERMINAL_FONT_OPTIONS.find((option) => option.id === DEFAULT_TERMINAL_FONT_FAMILY_ID) ?? TERMINAL_FONT_OPTIONS[0]!;
  return TERMINAL_FONT_OPTIONS.find((option) => option.id === id)?.family ?? fallback.family;
}

type TerminalSettingsDialogProps = {
  open: boolean;
  userTheme: string;
  fontSize: number;
  fontFamilyId: string;
  mobileInputMode: TerminalMobileInputMode;
  workIndicatorEnabled: boolean;
  fontScope?: 'local' | 'shared-workbench';
  minFontSize: number;
  maxFontSize: number;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (value: string) => void;
  onFontSizeChange: (value: number) => void;
  onFontFamilyChange: (value: string) => void;
  onMobileInputModeChange: (value: TerminalMobileInputMode) => void;
  onWorkIndicatorEnabledChange: (value: boolean) => void;
};

function SectionTitle(props: { title: string; description: string }) {
  return (
    <div class="space-y-1">
      <div class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{props.title}</div>
      <p class="text-xs text-muted-foreground">{props.description}</p>
    </div>
  );
}

type MobileInputOptionCardProps = {
  selected: boolean;
  label: string;
  description: string;
  selectedLabel: string;
  tapToUseLabel: string;
  onClick: () => void;
};

function MobileInputOptionCard(props: MobileInputOptionCardProps) {
  return (
    <Button
      size="sm"
      variant={props.selected ? 'primary' : 'outline'}
      class={cn(
        'h-auto w-full flex-col items-start gap-2 px-3 py-3 text-left',
        props.selected ? 'shadow-sm' : 'bg-transparent',
      )}
      onClick={props.onClick}
    >
      <span class="flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>{props.label}</span>
        <span class="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
          {props.selected ? props.selectedLabel : props.tapToUseLabel}
        </span>
      </span>
      <span
        class={cn(
          'whitespace-normal text-xs leading-5',
          props.selected ? 'text-primary-foreground/90' : 'text-muted-foreground',
        )}
      >
        {props.description}
      </span>
    </Button>
  );
}

export function TerminalSettingsDialog(props: TerminalSettingsDialogProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const isMobile = () => layout.isMobile();

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={i18n.t('terminal.settings.title')}
      description={i18n.t('terminal.settings.description')}
      class={cn(
        'flex flex-col overflow-hidden rounded-md p-0',
        '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:gap-5',
        isMobile()
          ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none max-w-none'
          : 'w-[min(30rem,92vw)]'
      )}
      footer={
        <Button size="sm" variant="primary" onClick={() => props.onOpenChange(false)}>
          {i18n.t('terminal.settings.close')}
        </Button>
      }
    >
      <Show when={isMobile()}>
        <section class="space-y-3">
          <SectionTitle
            title={i18n.t('terminal.settings.mobileInputTitle')}
            description={i18n.t('terminal.settings.mobileInputDescription')}
          />
          <div class="rounded-md border border-border/70 bg-muted/[0.14] p-3">
            <p class="text-xs leading-5 text-muted-foreground">
              {i18n.t('terminal.settings.mobileInputNote')}
            </p>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MobileInputOptionCard
              selected={props.mobileInputMode === 'floe'}
              label={i18n.t('terminal.settings.floeKeyboard')}
              description={i18n.t('terminal.settings.floeKeyboardDescription')}
              selectedLabel={i18n.t('terminal.settings.selected')}
              tapToUseLabel={i18n.t('terminal.settings.tapToUse')}
              onClick={() => props.onMobileInputModeChange('floe')}
            />
            <MobileInputOptionCard
              selected={props.mobileInputMode === 'system'}
              label={i18n.t('terminal.settings.systemIme')}
              description={i18n.t('terminal.settings.systemImeDescription')}
              selectedLabel={i18n.t('terminal.settings.selected')}
              tapToUseLabel={i18n.t('terminal.settings.tapToUse')}
              onClick={() => props.onMobileInputModeChange('system')}
            />
          </div>
        </section>
      </Show>

      <section class="space-y-3">
        <SectionTitle
          title={i18n.t('terminal.settings.themeTitle')}
          description={i18n.t('terminal.settings.themeDescription')}
        />
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <For each={TERMINAL_THEME_ITEMS}>
            {(item) => (
              <Button
                size="sm"
                variant={props.userTheme === item.id ? 'primary' : 'outline'}
                class="w-full justify-start"
                onClick={() => props.onThemeChange(item.id)}
              >
                {i18n.t(item.labelKey)}
              </Button>
            )}
          </For>
        </div>
      </section>

      <section class="space-y-3">
        <SectionTitle
          title={i18n.t('terminal.settings.activityBorderTitle')}
          description={i18n.t('terminal.settings.activityBorderDescription')}
        />
        <div class="rounded-md border border-border/70 bg-muted/[0.14] p-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="space-y-1">
              <div class="text-xs font-medium text-foreground">{i18n.t('terminal.settings.showRunningBorder')}</div>
              <p class="text-xs text-muted-foreground">
                {i18n.t('terminal.settings.statusTrackingUnchanged')}
              </p>
            </div>
            <Checkbox
              checked={props.workIndicatorEnabled}
              onChange={props.onWorkIndicatorEnabledChange}
              label={props.workIndicatorEnabled ? i18n.t('terminal.settings.shown') : i18n.t('terminal.settings.hidden')}
              size="sm"
            />
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <SectionTitle
          title={i18n.t('terminal.settings.fontTitle')}
          description={props.fontScope === 'shared-workbench'
            ? i18n.t('terminal.settings.sharedWorkbenchFontDescription')
            : i18n.t('terminal.settings.localFontDescription')}
        />
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <For each={TERMINAL_FONT_OPTIONS}>
            {(option) => (
              <Button
                size="sm"
                variant={props.fontFamilyId === option.id ? 'primary' : 'outline'}
                class="w-full justify-start"
                onClick={() => props.onFontFamilyChange(option.id)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </div>

        <div class="rounded-md border border-border/70 bg-muted/[0.14] p-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="space-y-1">
              <div class="text-xs font-medium text-foreground">{i18n.t('terminal.settings.fontSize')}</div>
              <p class="text-xs text-muted-foreground">
                {i18n.t('terminal.settings.fontSizeDescription')}
              </p>
            </div>
            <NumberInput
              value={props.fontSize}
              onChange={props.onFontSizeChange}
              min={props.minFontSize}
              max={props.maxFontSize}
              step={1}
              size="sm"
              class="w-full sm:w-36"
            />
          </div>
        </div>
      </section>
    </Dialog>
  );
}
