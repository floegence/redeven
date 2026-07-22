import { createSignal, For, Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Checkbox, Dialog, NumberInput } from '@floegence/floe-webapp-core/ui';
import { Check } from '@floegence/floe-webapp-core/icons';
import {
  getThemeColors,
  isTerminalThemeName,
  TERMINAL_THEME_DEFINITIONS,
  type TerminalThemeColors,
  type TerminalThemeName,
} from '@floegence/floeterm-terminal-web';
import {
  DEFAULT_TERMINAL_FONT_FAMILY_ID,
  type TerminalMobileInputMode,
} from '../services/terminalPreferences';
import { useI18n, type I18nHelpers } from '../i18n';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

type TerminalThemeOptionId = 'system' | TerminalThemeName;

const LEGACY_THEME_LABEL_KEYS: Partial<Record<TerminalThemeName, Parameters<I18nHelpers['t']>[0]>> = {
  dark: 'terminal.settings.dark',
  light: 'terminal.settings.light',
  solarizedDark: 'terminal.settings.solarizedDark',
  monokai: 'terminal.settings.monokai',
  tokyoNight: 'terminal.settings.tokyoNight',
};

const TERMINAL_THEME_ITEMS: Array<{
  id: TerminalThemeOptionId;
  labelKey?: Parameters<I18nHelpers['t']>[0];
  definition?: (typeof TERMINAL_THEME_DEFINITIONS)[number];
}> = [
  { id: 'system', labelKey: 'terminal.settings.systemTheme' },
  ...TERMINAL_THEME_DEFINITIONS.map((definition) => ({
    id: definition.id,
    labelKey: LEGACY_THEME_LABEL_KEYS[definition.id],
    definition,
  })),
];

const SYSTEM_THEME_ITEM = TERMINAL_THEME_ITEMS[0]!;
const TERMINAL_THEME_GROUPS = [
  {
    appearance: 'dark',
    labelKey: 'terminal.settings.dark' as const,
    items: TERMINAL_THEME_ITEMS.filter((item) => item.definition?.appearance === 'dark'),
  },
  {
    appearance: 'light',
    labelKey: 'terminal.settings.light' as const,
    items: TERMINAL_THEME_ITEMS.filter((item) => item.definition?.appearance === 'light'),
  },
] as const;

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
  systemAppearance?: 'dark' | 'light';
  workIndicatorEnabled: boolean;
  fontScope?: 'local' | 'shared-workbench';
  minFontSize: number;
  maxFontSize: number;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (value: string) => boolean;
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

function TerminalThemePreview(props: { colors: TerminalThemeColors }) {
  const normalAnsi = [
    props.colors.black,
    props.colors.red,
    props.colors.green,
    props.colors.yellow,
    props.colors.blue,
    props.colors.magenta,
    props.colors.cyan,
    props.colors.white,
  ];
  const brightAnsi = [
    props.colors.brightBlack,
    props.colors.brightRed,
    props.colors.brightGreen,
    props.colors.brightYellow,
    props.colors.brightBlue,
    props.colors.brightMagenta,
    props.colors.brightCyan,
    props.colors.brightWhite,
  ];
  return (
    <div
      class="mt-2 overflow-hidden rounded border p-2 font-mono text-[10px] leading-4 shadow-inner"
      style={{
        'background-color': props.colors.background,
        'border-color': props.colors.brightBlack,
        color: props.colors.foreground,
      }}
      aria-hidden="true"
    >
      <div class="flex items-center gap-1 whitespace-nowrap">
        <span style={{ color: props.colors.green }}>~/redeven</span>
        <span style={{ color: props.colors.blue }}>&gt;</span>
        <span>pnpm dev</span>
        <span
          class="ml-auto inline-block h-3 w-1.5 align-middle"
          style={{
            'background-color': props.colors.cursor,
            'box-shadow': `0 0 0 1px ${props.colors.cursorAccent}`,
          }}
        />
      </div>
      <div class="mt-0.5 whitespace-nowrap" style={{ color: props.colors.cyan }}>
        <span data-theme-preview-role="success" style={{ color: props.colors.green }}>✓</span>
        <span class="ml-1" data-theme-preview-role="warning" style={{ color: props.colors.yellow }}>!</span>
        <span class="ml-1" data-theme-preview-role="error" style={{ color: props.colors.red }}>×</span>
        <span
          class="ml-1 underline"
          data-theme-preview-role="link"
          style={{ color: props.colors.blue }}
        >
          127.0.0.1:4173
        </span>
      </div>
      <div class="mt-0.5 inline-block px-1" style={{
        'background-color': props.colors.selectionBackground,
        color: props.colors.selectionForeground,
      }}>
        200  12ms
      </div>
      <div class="mt-1 space-y-1" data-theme-preview-palette>
        <div class="flex h-1.5 gap-1" data-theme-preview-ansi="normal">
          <For each={normalAnsi}>
            {(color) => <span class="min-w-0 flex-1 rounded-sm" style={{ 'background-color': color }} />}
          </For>
        </div>
        <div class="flex h-1.5 gap-1" data-theme-preview-ansi="bright">
          <For each={brightAnsi}>
            {(color) => <span class="min-w-0 flex-1 rounded-sm" style={{ 'background-color': color }} />}
          </For>
        </div>
      </div>
    </div>
  );
}

function TerminalThemeOptionCard(props: {
  item: (typeof TERMINAL_THEME_ITEMS)[number];
  label: string;
  colors: TerminalThemeColors;
  selected: boolean;
  onSelect: () => void;
  inputRef: (input: HTMLInputElement) => void;
}) {
  return (
    <label class="group relative block min-w-0 cursor-pointer">
      <input
        type="radio"
        name="terminal-theme"
        value={props.item.id}
        checked={props.selected}
        data-floe-autofocus={props.selected ? 'true' : undefined}
        onChange={props.onSelect}
        onFocus={(event) => {
          const card = event.currentTarget.closest('label');
          if (typeof card?.scrollIntoView === 'function') {
            card.scrollIntoView({ block: 'nearest' });
          }
        }}
        ref={props.inputRef}
        class="peer sr-only"
      />
      <span
        class={cn(
          'redeven-terminal-theme-option block min-h-[7.25rem] rounded-md border p-2.5 transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
          props.selected
            ? 'border-primary bg-primary/[0.08] shadow-sm'
            : 'border-border/70 bg-muted/[0.08] hover:border-primary/50 hover:bg-muted/[0.18]',
        )}
      >
        <span class="flex items-start justify-between gap-2">
          <span class="min-w-0 break-words text-sm font-medium leading-5 text-foreground">{props.label}</span>
          <Show when={props.selected}>
            <Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
          </Show>
        </span>
        <TerminalThemePreview colors={props.colors} />
      </span>
    </label>
  );
}

export function TerminalSettingsDialog(props: TerminalSettingsDialogProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const isMobile = () => layout.isMobile();
  const [themeAnnouncement, setThemeAnnouncement] = createSignal('');
  const themeInputs = new Map<TerminalThemeOptionId, HTMLInputElement>();

  const itemLabel = (item: (typeof TERMINAL_THEME_ITEMS)[number]): string => {
    if (item.labelKey) return i18n.t(item.labelKey);
    if (item.definition) return item.definition.label;
    return i18n.t('terminal.settings.systemTheme');
  };

  const itemColors = (item: (typeof TERMINAL_THEME_ITEMS)[number]): TerminalThemeColors => (
    item.definition?.colors ?? getThemeColors(props.systemAppearance ?? 'dark')
  );

  const isThemeSelected = (id: TerminalThemeOptionId): boolean => {
    if (props.userTheme === id) return true;
    return id === 'dark' && props.userTheme !== 'system' && !isTerminalThemeName(props.userTheme);
  };

  const selectTheme = (id: TerminalThemeOptionId) => {
    const label = itemLabel(TERMINAL_THEME_ITEMS.find((item) => item.id === id)!);
    if (props.onThemeChange(id)) {
      setThemeAnnouncement(`${label}: ${i18n.t('terminal.settings.themeApplied')}`);
      return;
    }
    const previousId = TERMINAL_THEME_ITEMS.find((item) => isThemeSelected(item.id))?.id ?? 'dark';
    const attemptedInput = themeInputs.get(id);
    const previousInput = themeInputs.get(previousId);
    if (attemptedInput) attemptedInput.checked = false;
    if (previousInput) previousInput.checked = true;
    setThemeAnnouncement(`${label}: ${i18n.t('terminal.settings.themeApplyFailed')}`);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={i18n.t('terminal.settings.title')}
      description={i18n.t('terminal.settings.description')}
      class={cn(
        'flex flex-col overflow-hidden rounded-md p-0',
        '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:overflow-hidden [&>div:nth-child(2)]:p-0',
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
      <div
        {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-5"
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
        <div
          class="grid grid-cols-1 gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label={i18n.t('terminal.settings.themeTitle')}
        >
          <div class="sm:col-span-2">
            <TerminalThemeOptionCard
              item={SYSTEM_THEME_ITEM}
              label={itemLabel(SYSTEM_THEME_ITEM)}
              colors={itemColors(SYSTEM_THEME_ITEM)}
              selected={isThemeSelected(SYSTEM_THEME_ITEM.id)}
              onSelect={() => selectTheme(SYSTEM_THEME_ITEM.id)}
              inputRef={(input) => themeInputs.set(SYSTEM_THEME_ITEM.id, input)}
            />
          </div>
          <For each={TERMINAL_THEME_GROUPS}>
            {(group) => {
              const labelId = `terminal-theme-${group.appearance}-group-label`;
              return (
                <div
                  class="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2"
                  role="group"
                  aria-labelledby={labelId}
                  data-theme-appearance-group={group.appearance}
                >
                  <div
                    id={labelId}
                    class="mt-1 text-xs font-semibold uppercase text-muted-foreground sm:col-span-2"
                  >
                    {i18n.t(group.labelKey)}
                  </div>
                <For each={group.items}>
                  {(item) => (
                    <TerminalThemeOptionCard
                      item={item}
                      label={itemLabel(item)}
                      colors={itemColors(item)}
                      selected={isThemeSelected(item.id)}
                      onSelect={() => selectTheme(item.id)}
                      inputRef={(input) => themeInputs.set(item.id, input)}
                    />
                  )}
                </For>
                </div>
              );
            }}
          </For>
        </div>
        <div class="sr-only" aria-live="polite">{themeAnnouncement()}</div>
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
      </div>
    </Dialog>
  );
}
