import {
  FeedbackIndicator,
  type FeedbackIndicatorEntry,
  StableText,
  Tag,
  Button,
  SettingsSection as FloeSettingsSection,
  SettingsList as FloeSettingsList,
  SettingRow as FloeSettingRow,
  type SettingRowProps,
  type TagProps,
} from '@floegence/floe-webapp-core/ui';
import { writeTextToClipboard } from '../../utils/clipboard';
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
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
    <span style={{ visibility: label() ? 'visible' : 'hidden' }}>
      <span role="status" class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
        <span aria-hidden="true" class={cn('inline-block h-1.5 w-1.5 rounded-full bg-current', dotColor())} />
        <StableText reserve={[i18n.t('settings.autoSave.saving'), i18n.t('settings.autoSave.paused'), i18n.t('settings.autoSave.needsAttention'), i18n.t('settings.autoSave.unsavedChanges'), i18n.t('settings.autoSave.saved'), ...[11, 23].map(hour => i18n.t('settings.autoSave.savedAt', { time: formatSavedTime(new Date(2000, 0, 1, hour, 59, 59).getTime()) }))]}>{label()}</StableText>
      </span>
    </span>
  );
}

export interface SettingsSectionProps {
  variant?: 'page' | 'section';
  icon: (props: { class?: string }) => JSX.Element;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'warning' | 'success';
  actions?: JSX.Element;
  error?: string | null;
  feedback?: readonly FeedbackIndicatorEntry[];
  children: JSX.Element;
}

export function SettingsSection(props: SettingsSectionProps) {
  const i18n = useI18n();
  let actionsRef: HTMLDivElement | undefined;
  return (
    <FloeSettingsSection
      class="redeven-settings-section"
      data-settings-card={props.title}
      variant={props.variant}
      title={props.title}
      description={props.description}
      actions={<Show when={props.actions || props.feedback !== undefined}><div ref={actionsRef} tabIndex={-1} class="flex flex-wrap items-center gap-2">
        <Show when={props.feedback !== undefined}>
          <FeedbackIndicator label={props.title} closeLabel={i18n.t('common.actions.close')} restoreFocus={() => actionsRef} entries={props.feedback ?? []} />
        </Show>
        {props.actions}
      </div></Show>}
      badge={<Show when={props.badge}><Tag variant={settingsTagVariant(props.badgeVariant ?? 'default')} tone="soft" size="sm">{props.badge}</Tag></Show>}
    >
      <Show when={props.error}>
        <div role="alert" class="redeven-settings-alert redeven-settings-alert--danger rounded-lg border p-3 text-xs">{props.error}</div>
      </Show>
      {props.children}
    </FloeSettingsSection>
  );
}

export function FieldLabel(props: { children: string; hint?: string }) {
  return (
    <div class="mb-1.5">
      <label class="text-[length:var(--floe-type-control)] leading-[var(--floe-line-control)] font-medium text-foreground">{props.children}</label>
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
        <h2 class="redeven-settings-label whitespace-nowrap text-[11px] font-medium uppercase tracking-wide">{props.title}</h2>
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
        <div class="text-[length:var(--floe-type-body)] font-medium text-foreground">{props.title}</div>
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
        'redeven-settings-control w-full resize-y rounded-lg border px-3 py-2.5 font-mono text-xs disabled:opacity-50',
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
  return <FloeSettingsList class={cn('redeven-settings-list', props.class)}>{props.children}</FloeSettingsList>;
}

export function SettingRow(props: SettingRowProps) {
  return <FloeSettingRow {...props} class={cn('redeven-setting-row', props.class)} />;
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
          <span class="block text-[length:var(--floe-type-body)] font-medium text-foreground">{props.title}</span>
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
        <div class="text-[length:var(--floe-type-body)] font-medium tracking-tight text-foreground">{props.value}</div>
        <div class="redeven-settings-note truncate text-[11px]">{props.label}</div>
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
        <span class="flex-shrink-0 text-[11px] text-muted-foreground">{props.note}</span>
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

export function CopyButton(props: { value: string; label?: string; iconOnly?: boolean }) {
  const i18n = useI18n();
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout>;

  const handleCopy = async () => {
    try {
      await writeTextToClipboard(props.value);
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
      class="redeven-copy-action"
      data-icon-only={props.iconOnly || !props.label || undefined}
      data-copied={copied() || undefined}
      icon={copied() ? Check : Copy}
      onClick={handleCopy}
      disabled={!props.value}
      aria-label={copied() ? i18n.t('common.actions.copied') : props.label ?? i18n.t('settings.copyValue', { value: props.value })}
      title={copied() ? i18n.t('common.actions.copied') : props.label ?? i18n.t('settings.copyValue', { value: props.value })}
    >
      <Show when={!props.iconOnly && props.label}><StableText reserve={[i18n.t('common.actions.copied'), props.label ?? '']}>{copied() ? i18n.t('common.actions.copied') : props.label ?? ''}</StableText></Show>
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
        <div class={cn('min-w-0 flex-1 text-[length:var(--floe-type-body)]', props.mono && 'font-mono text-xs')}>{props.children}</div>
        <Show when={props.copyValue}>
          <div class="flex-shrink-0">
            <CopyButton value={props.copyValue!} />
          </div>
        </Show>
      </div>
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
