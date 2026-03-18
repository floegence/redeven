import { For, Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog, NumberInput } from '@floegence/floe-webapp-core/ui';
import type { TerminalMobileInputMode } from '../services/terminalPreferences';

type TerminalThemeOptionId = 'system' | 'dark' | 'light' | 'solarizedDark' | 'monokai' | 'tokyoNight';

const TERMINAL_THEME_ITEMS: Array<{ id: TerminalThemeOptionId; label: string }> = [
  { id: 'system', label: 'System Theme' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'solarizedDark', label: 'Solarized Dark' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'tokyoNight', label: 'Tokyo Night' },
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
  return TERMINAL_FONT_OPTIONS.find((option) => option.id === id)?.family ?? TERMINAL_FONT_OPTIONS[0]!.family;
}

type TerminalSettingsDialogProps = {
  open: boolean;
  userTheme: string;
  fontSize: number;
  fontFamilyId: string;
  mobileInputMode: TerminalMobileInputMode;
  minFontSize: number;
  maxFontSize: number;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (value: string) => void;
  onFontSizeChange: (value: number) => void;
  onFontFamilyChange: (value: string) => void;
  onMobileInputModeChange: (value: TerminalMobileInputMode) => void;
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
          {props.selected ? 'Selected' : 'Tap to use'}
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
  const layout = useLayout();
  const isMobile = () => layout.isMobile();

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Terminal settings"
      description="Customize the default theme, font, and mobile input behavior for terminal sessions."
      class={cn(
        'flex flex-col overflow-hidden rounded-md p-0',
        '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:gap-5',
        isMobile()
          ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none max-w-none'
          : 'w-[min(30rem,92vw)]'
      )}
      footer={
        <Button size="sm" variant="primary" onClick={() => props.onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <Show when={isMobile()}>
        <section class="space-y-3">
          <SectionTitle
            title="Mobile input"
            description="Choose one default input mode for every mobile terminal session."
          />
          <div class="rounded-md border border-border/70 bg-muted/[0.14] p-3">
            <p class="text-xs leading-5 text-muted-foreground">
              Only one mode can be active at a time. Use Floe Keyboard to keep the system keyboard hidden until you
              explicitly switch back to System IME.
            </p>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MobileInputOptionCard
              selected={props.mobileInputMode === 'floe'}
              label="Floe Keyboard"
              description="Keeps terminal taps focused on the terminal surface and shows Floe suggestions, quick inserts, scripts, and path completions."
              onClick={() => props.onMobileInputModeChange('floe')}
            />
            <MobileInputOptionCard
              selected={props.mobileInputMode === 'system'}
              label="System IME"
              description="Focuses the native terminal input so you can use the device keyboard, IME candidate bar, and platform text features."
              onClick={() => props.onMobileInputModeChange('system')}
            />
          </div>
        </section>
      </Show>

      <section class="space-y-3">
        <SectionTitle
          title="Theme"
          description="Choose how terminal colors should be rendered."
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
                {item.label}
              </Button>
            )}
          </For>
        </div>
      </section>

      <section class="space-y-3">
        <SectionTitle
          title="Font"
          description="Pick the terminal font family and adjust the global font size."
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
              <div class="text-xs font-medium text-foreground">Font size</div>
              <p class="text-xs text-muted-foreground">
                Use a readable size that still keeps enough terminal history on screen.
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
