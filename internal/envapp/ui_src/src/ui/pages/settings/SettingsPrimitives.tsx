import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Tag, Button, type TagProps } from '@floegence/floe-webapp-core/ui';
import { Copy, Check } from '@floegence/floe-webapp-core/icons';
import { redevenSegmentedItemClass, redevenSurfaceRoleClass } from '../../utils/redevenSurfaceRoles';
import { useI18n } from '../../i18n';

export type ViewMode = 'ui' | 'json';

function settingsTagVariant(tone: 'default' | 'success' | 'warning' | 'danger' = 'default'): TagProps['variant'] {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'danger':
      return 'error';
    case 'default':
    default:
      return 'neutral';
  }
}

export function ViewToggle(props: { value: () => ViewMode; disabled?: boolean; onChange: (v: ViewMode) => void }) {
  const i18n = useI18n();
  const btnClass = (active: boolean) => {
    const base = 'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150';
    if (active) return cn(base, redevenSegmentedItemClass(true), 'text-foreground shadow-sm');
    return cn(base, redevenSegmentedItemClass(false), 'text-muted-foreground hover:text-foreground');
  };
  const disabledClass = () => (props.disabled ? 'opacity-50 pointer-events-none' : '');

  return (
    <div class={cn('inline-flex items-center gap-0.5 rounded-lg border p-0.5', redevenSurfaceRoleClass('segmented'), disabledClass())}>
      <button type="button" class={btnClass(props.value() === 'ui')} onClick={() => props.onChange('ui')}>
        {i18n.t('settings.viewMode.ui')}
      </button>
      <button type="button" class={btnClass(props.value() === 'json')} onClick={() => props.onChange('json')}>
        {i18n.t('settings.viewMode.json')}
      </button>
    </div>
  );
}

function formatSavedTime(unixMs: number | null): string {
  if (!unixMs) return '';
  try {
    return new Date(unixMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function AutoSaveIndicator(props: { dirty: boolean; saving: boolean; error?: string | null; savedAt: number | null; enabled?: boolean }) {
  const i18n = useI18n();
  const dotColor = createMemo(() => {
    if (props.saving) return 'text-primary';
    if (!props.enabled) return 'text-muted-foreground/40';
    if (props.error) return 'text-destructive';
    if (props.dirty) return 'text-warning';
    if (props.savedAt) return 'text-success';
    return 'text-muted-foreground/40';
  });

  const label = createMemo(() => {
    if (props.saving) return i18n.t('settings.autoSave.saving');
    if (!props.enabled) return i18n.t('settings.autoSave.paused');
    if (props.error) return i18n.t('settings.autoSave.needsAttention');
    if (props.dirty) return i18n.t('settings.autoSave.unsavedChanges');
    if (props.savedAt) {
      const t = formatSavedTime(props.savedAt);
      return t ? i18n.t('settings.autoSave.savedAt', { time: t }) : i18n.t('settings.autoSave.saved');
    }
    return '';
  });

  return (
    <span class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
      <span class={cn('inline-block h-1.5 w-1.5 rounded-full', dotColor())} />
      {label()}
    </span>
  );
}

export interface SettingsCardProps {
  icon: (props: { class?: string }) => JSX.Element;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'warning' | 'success';
  actions?: JSX.Element;
  error?: string | null;
  children: JSX.Element;
}

export function SettingsSection(props: SettingsCardProps) {
  return (
    <section class="redeven-settings-section rounded-lg border p-5" data-settings-card={props.title}>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex min-w-0 items-start gap-3">
          <span class="redeven-settings-section__icon mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md">
            <props.icon class="h-4 w-4" />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold tracking-tight text-foreground">{props.title}</h3>
              <Show when={props.badge}>
                <Tag variant={settingsTagVariant(props.badgeVariant ?? 'default')} tone="soft" size="sm">
                  {props.badge}
                </Tag>
              </Show>
            </div>
            <p class="redeven-settings-note mt-0.5 break-words text-xs leading-relaxed">{props.description}</p>
          </div>
        </div>
        <Show when={props.actions}>
          <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">{props.actions}</div>
        </Show>
      </div>

      <div class="mt-4 space-y-4">
        <Show when={props.error}>
          <div class="redeven-settings-alert redeven-settings-alert--danger flex items-start gap-2.5 rounded-lg border p-3">
            <div class="min-h-4 h-full w-1 flex-shrink-0 rounded-full bg-destructive/60" />
            <div class="break-words text-xs text-destructive">{props.error}</div>
          </div>
        </Show>
        {props.children}
      </div>
    </section>
  );
}

/** @deprecated Use SettingsSection instead. */
export const SettingsCard = SettingsSection;

export function FieldLabel(props: { children: string; hint?: string }) {
  return (
    <div class="mb-1.5">
      <label class="text-xs font-medium text-foreground">{props.children}</label>
      <Show when={props.hint}>
        <span class="redeven-settings-note ml-1.5 text-xs">({props.hint})</span>
      </Show>
    </div>
  );
}

export function CodeBadge(props: { children: string }) {
  return <code class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{props.children}</code>;
}

export function SectionGroup(props: { title: string; children: JSX.Element; groupId?: string }) {
  return (
    <div class="space-y-4" data-settings-group={props.groupId}>
      <div class="flex items-center gap-3 pt-2">
        <h2 class="redeven-settings-label whitespace-nowrap text-[11px] font-semibold uppercase tracking-widest">{props.title}</h2>
        <div class="h-px flex-1 bg-[var(--redeven-settings-divider)]" />
      </div>
      {props.children}
    </div>
  );
}

export function SubSectionHeader(props: { title: string; description?: string; actions?: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div class="text-sm font-semibold text-foreground">{props.title}</div>
        <Show when={props.description}>
          <p class="redeven-settings-note mt-0.5 text-xs">{props.description}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex-shrink-0">{props.actions}</div>
      </Show>
    </div>
  );
}

export function JSONEditor(props: { value: string; onChange: (v: string) => void; disabled?: boolean; rows?: number }) {
  return (
    <textarea
      class={cn(
        'redeven-settings-control w-full resize-y rounded-lg border px-3 py-2.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--redeven-settings-selection-indicator)_24%,transparent)] disabled:opacity-50',
      )}
      style={{ 'min-height': `${(props.rows ?? 6) * 1.5}rem` }}
      value={props.value}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      spellcheck={false}
      disabled={props.disabled}
    />
  );
}

export function SettingsPill(props: { tone?: 'default' | 'success' | 'warning' | 'danger'; children: JSX.Element }) {
  return (
    <Tag variant={settingsTagVariant(props.tone ?? 'default')} tone="soft" size="sm">
      {props.children}
    </Tag>
  );
}

export function SettingsList(props: { children: JSX.Element; class?: string }) {
  return <div class={cn('redeven-settings-list overflow-hidden rounded-lg border', props.class)}>{props.children}</div>;
}

export function SettingRow(props: {
  icon?: (props: { class?: string }) => JSX.Element;
  title: string;
  description?: string;
  control?: JSX.Element;
  children?: JSX.Element;
  tone?: 'default' | 'info' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = () => {
    switch (props.tone) {
      case 'info': return 'redeven-setting-row--info';
      case 'success': return 'redeven-setting-row--success';
      case 'warning': return 'redeven-setting-row--warning';
      case 'danger': return 'redeven-setting-row--danger';
      default: return '';
    }
  };

  return (
    <div class={cn('redeven-setting-row rounded-lg border px-4 py-3', toneClass())}>
      <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-start gap-3">
          <Show when={props.icon}>
            {(Icon) => {
              const RowIcon = Icon();
              return (
                <span class="redeven-setting-row__icon mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md">
                  <RowIcon class="h-3.5 w-3.5" />
                </span>
              );
            }}
          </Show>
          <div class="min-w-0">
            <div class="text-sm font-semibold tracking-tight text-foreground">{props.title}</div>
            <Show when={props.description}>
              <p class="redeven-settings-note mt-0.5 text-xs leading-relaxed">{props.description}</p>
            </Show>
          </div>
        </div>
        <Show when={props.control}>
          <div class="flex min-w-0 flex-shrink-0 items-center justify-end gap-2">{props.control}</div>
        </Show>
      </div>
      <Show when={props.children}>
        <div class="mt-3 min-w-0">{props.children}</div>
      </Show>
    </div>
  );
}

export function CapabilityTag(props: { active?: boolean; children: JSX.Element }) {
  return (
    <Tag variant={props.active ? 'success' : 'neutral'} tone="soft" size="sm" class="whitespace-nowrap">
      {props.children}
    </Tag>
  );
}

export function SectionCollapse(props: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <div class="redeven-settings-inset rounded-lg border">
      <button
        type="button"
        class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--redeven-settings-row-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => props.onOpenChange(!props.open)}
      >
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-foreground">{props.title}</span>
          <Show when={props.description}>
            <span class="redeven-settings-note mt-0.5 block text-xs">{props.description}</span>
          </Show>
        </span>
        <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border text-xs text-muted-foreground">
          {props.open ? '-' : '+'}
        </span>
      </button>
      <Show when={props.open}>
        <div class="border-t border-[var(--redeven-settings-divider)] p-3">{props.children}</div>
      </Show>
    </div>
  );
}

export const AdvancedCollapse = SectionCollapse;

export function SettingsTable(props: { children: JSX.Element; minWidthClass?: string; class?: string; stickyHeader?: boolean }) {
  return (
    <div class={cn('redeven-settings-table overflow-auto rounded-lg border', props.class)}>
      <table class={`w-full text-xs align-top ${props.minWidthClass ?? ''}`}>
        {props.children}
      </table>
    </div>
  );
}

export function SettingsTableHead(props: { children: JSX.Element; sticky?: boolean }) {
  return <thead class={props.sticky ? 'sticky top-0 z-10' : ''}>{props.children}</thead>;
}

export function SettingsTableHeaderRow(props: { children: JSX.Element }) {
  return <tr class="redeven-settings-table__header-row border-b text-left">{props.children}</tr>;
}

export function SettingsTableHeaderCell(props: { children: JSX.Element; align?: 'left' | 'center' | 'right'; class?: string }) {
  const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
  return <th class={`px-3 py-2 font-medium ${alignClass} ${props.class ?? ''}`}>{props.children}</th>;
}

export function SettingsTableBody(props: { children: JSX.Element }) {
  return <tbody>{props.children}</tbody>;
}

export function SettingsTableRow(props: { children: JSX.Element; selected?: boolean; interactive?: boolean; class?: string }) {
  return (
    <tr
      class={cn(
        'redeven-settings-table__row border-b last:border-b-0',
        props.selected && 'redeven-settings-table__row--selected',
        props.interactive && 'redeven-settings-table__row--interactive',
        props.class,
      )}
    >
      {props.children}
    </tr>
  );
}

export function SettingsTableCell(props: { children: JSX.Element; align?: 'left' | 'center' | 'right'; class?: string }) {
  const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
  return <td class={`px-3 py-2.5 ${alignClass} ${props.class ?? ''}`}>{props.children}</td>;
}

export function SettingsTableEmptyRow(props: { colSpan: number; children: JSX.Element }) {
  return (
    <tr>
      <td colSpan={props.colSpan} class="redeven-settings-note px-3 py-8 text-center text-[11px]">
        {props.children}
      </td>
    </tr>
  );
}

export function SettingsKeyValueTable(props: {
  rows: ReadonlyArray<Readonly<{ label: string; value: JSX.Element | string; note?: JSX.Element | string; mono?: boolean }>>;
  minWidthClass?: string;
}) {
  const i18n = useI18n();
  return (
    <SettingsTable minWidthClass={props.minWidthClass}>
      <SettingsTableHead>
        <SettingsTableHeaderRow>
          <SettingsTableHeaderCell class="w-48">{i18n.t('settings.table.setting')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell>{i18n.t('settings.table.value')}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-64">{i18n.t('settings.table.notes')}</SettingsTableHeaderCell>
        </SettingsTableHeaderRow>
      </SettingsTableHead>
      <SettingsTableBody>
        <For each={props.rows}>
          {(row) => (
            <SettingsTableRow>
              <SettingsTableCell class="redeven-settings-label whitespace-nowrap font-medium">{row.label}</SettingsTableCell>
              <SettingsTableCell class={row.mono ? 'font-mono text-[11px] leading-relaxed break-all' : 'break-words'}>{row.value}</SettingsTableCell>
              <SettingsTableCell class="redeven-settings-note break-words text-[11px]">{row.note ?? '—'}</SettingsTableCell>
            </SettingsTableRow>
          )}
        </For>
      </SettingsTableBody>
    </SettingsTable>
  );
}

// ── Summary Bar ──────────────────────────────────────────────

export interface SummaryMetricDef {
  icon: (props: { class?: string }) => JSX.Element;
  value: string;
  label: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
}

export function SummaryBar(props: { metrics: ReadonlyArray<SummaryMetricDef> }) {
  return (
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      <For each={props.metrics}>
        {(m) => <SummaryMetric {...m} />}
      </For>
    </div>
  );
}

export function SummaryMetric(props: SummaryMetricDef) {
  const toneClass = () => {
    switch (props.tone) {
      case 'success': return 'text-success';
      case 'warning': return 'text-warning';
      case 'danger': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <button
      type="button"
      class={cn(
        'flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150',
        'redeven-settings-inset',
        props.onClick ? 'cursor-pointer hover:bg-[var(--redeven-settings-row-hover-bg)]' : 'cursor-default',
      )}
      onClick={() => props.onClick?.()}
      disabled={!props.onClick}
    >
      <div class={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-muted', toneClass())}>
        <props.icon class="h-3.5 w-3.5" />
      </div>
      <div class="min-w-0">
        <div class="text-sm font-semibold tracking-tight text-foreground">{props.value}</div>
        <div class="redeven-settings-note truncate text-[10px]">{props.label}</div>
      </div>
    </button>
  );
}

// ── Field Row (compact single-line field display) ────────────

export function FieldRow(props: {
  icon: (props: { class?: string }) => JSX.Element;
  label: string;
  children: JSX.Element;
  note?: string;
  actions?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <props.icon class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span class="text-xs font-medium text-muted-foreground">{props.label}</span>
        <div class="min-w-0 flex-1">{props.children}</div>
      </div>
      <Show when={props.note}>
        <span class="flex-shrink-0 text-[10px] text-muted-foreground">{props.note}</span>
      </Show>
      <Show when={props.actions}>
        <div class="flex-shrink-0">{props.actions}</div>
      </Show>
    </div>
  );
}

// ── Info Row (compact read-only key-value row) ───────────────

export function InfoRow(props: {
  icon: (props: { class?: string }) => JSX.Element;
  label: string;
  children: JSX.Element;
  mono?: boolean;
  actions?: JSX.Element;
}) {
  return (
    <div class="flex items-start gap-2.5 py-1">
      <props.icon class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span class="min-w-[5rem] flex-shrink-0 text-xs text-muted-foreground">{props.label}</span>
      <div class={cn('min-w-0 flex-1 break-all text-xs', props.mono && 'font-mono text-[11px]')}>{props.children}</div>
      <Show when={props.actions}>
        <div class="flex-shrink-0">{props.actions}</div>
      </Show>
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────

export function EmptyState(props: {
  icon: (props: { class?: string }) => JSX.Element;
  message: string;
  action?: JSX.Element;
}) {
  return (
    <div class="flex flex-col items-center gap-2.5 py-8 text-center">
      <props.icon class="h-8 w-8 text-muted-foreground/40" />
      <p class="text-xs text-muted-foreground">{props.message}</p>
      <Show when={props.action}>
        <div>{props.action}</div>
      </Show>
    </div>
  );
}

// ── Copy Button ──────────────────────────────────────────────

export function CopyButton(props: { value: string; label?: string }) {
  const i18n = useI18n();
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout>;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      icon={copied() ? Check : Copy}
      onClick={handleCopy}
      aria-label={props.label ?? i18n.t('settings.copyValue', { value: props.value })}
    >
      {copied() ? i18n.t('common.actions.copied') : (props.label ?? '')}
    </Button>
  );
}

// ── Compact Field (editable field with icon) ─────────────────

export function CompactField(props: {
  icon: (props: { class?: string }) => JSX.Element;
  label: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex items-center gap-2">
      <props.icon class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <label class="flex-shrink-0 text-xs font-medium text-muted-foreground">{props.label}</label>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

// ── Dot Indicator (status dot + label) ─────────────────────

export function DotIndicator(props: {
  active: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        'inline-flex items-center gap-1.5 text-xs',
        props.onClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
      )}
      onClick={() => props.onClick?.()}
      disabled={!props.onClick}
    >
      <span
        class={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          props.active ? 'bg-success' : 'border border-muted-foreground/30',
        )}
      />
      <span class={props.active ? 'text-foreground' : 'text-muted-foreground'}>{props.label}</span>
    </button>
  );
}

// ── Property Row (clean label-above-value read-only row) ────

export function PropertyRow(props: {
  label: string;
  children: JSX.Element;
  mono?: boolean;
  copyValue?: string;
}) {
  return (
    <div class="group py-2.5 first:pt-0 last:pb-0">
      <div class="text-[11px] text-muted-foreground mb-1">{props.label}</div>
      <div class="flex items-center gap-2">
        <div class={cn('min-w-0 flex-1 text-sm', props.mono && 'font-mono text-xs')}>{props.children}</div>
        <Show when={props.copyValue}>
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <CopyButton value={props.copyValue!} />
          </div>
        </Show>
      </div>
    </div>
  );
}

// ── Permission Dot (read / write / execute indicator group) ─

export function PermissionDot(props: {
  read: boolean;
  write: boolean;
  execute: boolean;
  onReadChange?: (v: boolean) => void;
  onWriteChange?: (v: boolean) => void;
  onExecuteChange?: (v: boolean) => void;
  readonly?: boolean;
}) {
  const i18n = useI18n();

  return (
    <div class="redeven-permission-segmented inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        class={cn('redeven-permission-segment', props.read && 'redeven-permission-segment--active')}
        onClick={props.readonly ? undefined : () => props.onReadChange?.(!props.read)}
        disabled={props.readonly || !props.onReadChange}
        aria-pressed={props.read}
      >
        <span>{i18n.t('permissionPolicy.permission.read')}</span>
        <span>{props.read ? i18n.t('permissionPolicy.allowed') : i18n.t('permissionPolicy.denied')}</span>
      </button>
      <button
        type="button"
        class={cn('redeven-permission-segment', props.write && 'redeven-permission-segment--active')}
        onClick={props.readonly ? undefined : () => props.onWriteChange?.(!props.write)}
        disabled={props.readonly || !props.onWriteChange}
        aria-pressed={props.write}
      >
        <span>{i18n.t('permissionPolicy.permission.write')}</span>
        <span>{props.write ? i18n.t('permissionPolicy.allowed') : i18n.t('permissionPolicy.denied')}</span>
      </button>
      <button
        type="button"
        class={cn('redeven-permission-segment', props.execute && 'redeven-permission-segment--active')}
        onClick={props.readonly ? undefined : () => props.onExecuteChange?.(!props.execute)}
        disabled={props.readonly || !props.onExecuteChange}
        aria-pressed={props.execute}
      >
        <span>{i18n.t('permissionPolicy.permission.execute')}</span>
        <span>{props.execute ? i18n.t('permissionPolicy.allowed') : i18n.t('permissionPolicy.denied')}</span>
      </button>
    </div>
  );
}

// ── Card Row (lightweight card for editable list items) ─────

export function CardRow(props: {
  label: JSX.Element;
  badge?: string;
  badgeTone?: 'default' | 'success' | 'warning';
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="redeven-settings-inset rounded-lg border p-3">
      <div class="flex items-center justify-between gap-3 mb-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs font-medium text-foreground truncate">{props.label}</span>
          <Show when={props.badge}>
            <Tag variant={settingsTagVariant(props.badgeTone ?? 'default')} tone="soft" size="sm">
              {props.badge}
            </Tag>
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="flex items-center gap-1 flex-shrink-0">{props.actions}</div>
        </Show>
      </div>
      <div class="text-xs">{props.children}</div>
    </div>
  );
}
