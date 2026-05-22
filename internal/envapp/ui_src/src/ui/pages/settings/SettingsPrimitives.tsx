import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Card, Tag, Button, type TagProps } from '@floegence/floe-webapp-core/ui';
import { Copy, Check } from '@floegence/floe-webapp-core/icons';
import { redevenDividerRoleClass, redevenSegmentedItemClass, redevenSurfaceRoleClass } from '../../utils/redevenSurfaceRoles';

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
  const btnClass = (active: boolean) => {
    const base = 'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150';
    if (active) return cn(base, redevenSegmentedItemClass(true), 'text-foreground shadow-sm');
    return cn(base, redevenSegmentedItemClass(false), 'text-muted-foreground hover:text-foreground');
  };
  const disabledClass = () => (props.disabled ? 'opacity-50 pointer-events-none' : '');

  return (
    <div class={cn('inline-flex items-center gap-0.5 rounded-lg border p-0.5', redevenSurfaceRoleClass('segmented'), disabledClass())}>
      <button type="button" class={btnClass(props.value() === 'ui')} onClick={() => props.onChange('ui')}>
        UI
      </button>
      <button type="button" class={btnClass(props.value() === 'json')} onClick={() => props.onChange('json')}>
        JSON
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
  const tagVariant = createMemo<TagProps['variant']>(() => {
    if (props.saving) return 'primary';
    if (!props.enabled) return 'neutral';
    if (props.error) return 'error';
    if (props.dirty) return 'warning';
    if (props.savedAt) return 'success';
    return 'neutral';
  });

  const tagTone = createMemo<'solid' | 'soft'>(() => {
    if (props.saving) return 'solid';
    return 'soft';
  });

  const label = createMemo(() => {
    if (props.saving) return 'Saving...';
    if (!props.enabled) return 'Auto-save paused';
    if (props.error) return 'Needs attention';
    if (props.dirty) return 'Unsaved changes';
    if (props.savedAt) {
      const t = formatSavedTime(props.savedAt);
      return t ? `Saved ${t}` : 'Saved';
    }
    return 'Auto-save on';
  });

  return (
    <Tag
      variant={tagVariant()}
      tone={tagTone()}
      size="sm"
      dot={props.saving || props.dirty || Boolean(props.savedAt)}
      class="whitespace-nowrap"
    >
      {label()}
    </Tag>
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

export function SettingsCard(props: SettingsCardProps) {
  return (
    <Card class={cn('overflow-hidden shadow-sm', redevenSurfaceRoleClass('panelStrong'))}>
      <div class={cn('border-b bg-muted/20 px-4 py-3.5 sm:px-5', redevenDividerRoleClass('strong'))}>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/15">
              <props.icon class="h-4 w-4 text-primary" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-semibold tracking-tight text-foreground">{props.title}</h3>
                <Show when={props.badge}>
                  <Tag variant={settingsTagVariant(props.badgeVariant ?? 'default')} tone="soft" size="sm">
                    {props.badge}
                  </Tag>
                </Show>
              </div>
              <p class="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{props.description}</p>
            </div>
          </div>
          <Show when={props.actions}>
            <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">{props.actions}</div>
          </Show>
        </div>
      </div>

      <div class="space-y-4 p-4 sm:p-5">
        <Show when={props.error}>
          <div class="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3">
            <div class="min-h-4 h-full w-1 flex-shrink-0 rounded-full bg-destructive/60" />
            <div class="break-words text-xs text-destructive">{props.error}</div>
          </div>
        </Show>
        {props.children}
      </div>
    </Card>
  );
}

export function FieldLabel(props: { children: string; hint?: string }) {
  return (
    <div class="mb-1.5">
      <label class="text-xs font-medium text-foreground">{props.children}</label>
      <Show when={props.hint}>
        <span class="ml-1.5 text-xs text-muted-foreground">({props.hint})</span>
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
        <h2 class="whitespace-nowrap text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{props.title}</h2>
        <div class="h-px flex-1 bg-border/50" />
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
          <p class="mt-0.5 text-xs text-muted-foreground">{props.description}</p>
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
        'w-full resize-y rounded-lg border px-3 py-2.5 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-muted/50 disabled:opacity-50',
        redevenSurfaceRoleClass('controlMuted'),
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
    <div class={cn('rounded-lg border', redevenSurfaceRoleClass('panel'))}>
      <button
        type="button"
        class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => props.onOpenChange(!props.open)}
      >
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-foreground">{props.title}</span>
          <Show when={props.description}>
            <span class="mt-0.5 block text-xs text-muted-foreground">{props.description}</span>
          </Show>
        </span>
        <span class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border text-xs text-muted-foreground">
          {props.open ? '-' : '+'}
        </span>
      </button>
      <Show when={props.open}>
        <div class={cn('border-t p-3', redevenDividerRoleClass())}>{props.children}</div>
      </Show>
    </div>
  );
}

export const AdvancedCollapse = SectionCollapse;

export function SettingsTable(props: { children: JSX.Element; minWidthClass?: string; class?: string; stickyHeader?: boolean }) {
  return (
    <div class={cn('overflow-auto rounded-lg border bg-background', redevenSurfaceRoleClass('panel'), props.class)}>
      <table class={`w-full text-xs align-top ${props.minWidthClass ?? ''}`}>
        {props.children}
      </table>
    </div>
  );
}

export function SettingsTableHead(props: { children: JSX.Element; sticky?: boolean }) {
  return <thead class={`${props.sticky ? 'sticky top-0 z-10 bg-background/95 backdrop-blur-sm' : 'bg-background'} text-muted-foreground`}>{props.children}</thead>;
}

export function SettingsTableHeaderRow(props: { children: JSX.Element }) {
  return <tr class={cn('border-b text-left', redevenDividerRoleClass('strong'))}>{props.children}</tr>;
}

export function SettingsTableHeaderCell(props: { children: JSX.Element; align?: 'left' | 'center' | 'right'; class?: string }) {
  const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
  return <th class={`px-3 py-2 font-medium ${alignClass} ${props.class ?? ''}`}>{props.children}</th>;
}

export function SettingsTableBody(props: { children: JSX.Element }) {
  return <tbody>{props.children}</tbody>;
}

export function SettingsTableRow(props: { children: JSX.Element; selected?: boolean; class?: string }) {
  return <tr class={cn('border-b last:border-b-0', redevenDividerRoleClass(), props.selected ? 'bg-muted/30' : '', props.class)}>{props.children}</tr>;
}

export function SettingsTableCell(props: { children: JSX.Element; align?: 'left' | 'center' | 'right'; class?: string }) {
  const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
  return <td class={`px-3 py-2.5 ${alignClass} ${props.class ?? ''}`}>{props.children}</td>;
}

export function SettingsTableEmptyRow(props: { colSpan: number; children: JSX.Element }) {
  return (
    <tr>
      <td colSpan={props.colSpan} class="px-3 py-8 text-center text-[11px] text-muted-foreground">
        {props.children}
      </td>
    </tr>
  );
}

export function SettingsKeyValueTable(props: {
  rows: ReadonlyArray<Readonly<{ label: string; value: JSX.Element | string; note?: JSX.Element | string; mono?: boolean }>>;
  minWidthClass?: string;
}) {
  return (
    <SettingsTable minWidthClass={props.minWidthClass}>
      <SettingsTableHead>
        <SettingsTableHeaderRow>
          <SettingsTableHeaderCell class="w-48">Setting</SettingsTableHeaderCell>
          <SettingsTableHeaderCell>Value</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-64">Notes</SettingsTableHeaderCell>
        </SettingsTableHeaderRow>
      </SettingsTableHead>
      <SettingsTableBody>
        <For each={props.rows}>
          {(row) => (
            <SettingsTableRow>
              <SettingsTableCell class="whitespace-nowrap font-medium text-muted-foreground">{row.label}</SettingsTableCell>
              <SettingsTableCell class={row.mono ? 'font-mono text-[11px] leading-relaxed break-all' : 'break-words'}>{row.value}</SettingsTableCell>
              <SettingsTableCell class="break-words text-[11px] text-muted-foreground">{row.note ?? '—'}</SettingsTableCell>
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
        redevenSurfaceRoleClass('panel'),
        props.onClick ? 'cursor-pointer hover:border-primary/30 hover:bg-muted/30 hover:shadow-sm' : 'cursor-default',
      )}
      onClick={() => props.onClick?.()}
      disabled={!props.onClick}
    >
      <div class={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-muted', toneClass())}>
        <props.icon class="h-3.5 w-3.5" />
      </div>
      <div class="min-w-0">
        <div class="text-sm font-semibold tracking-tight text-foreground">{props.value}</div>
        <div class="truncate text-[10px] text-muted-foreground">{props.label}</div>
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
      aria-label={props.label ?? `Copy ${props.value}`}
    >
      {copied() ? 'Copied' : (props.label ?? '')}
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
