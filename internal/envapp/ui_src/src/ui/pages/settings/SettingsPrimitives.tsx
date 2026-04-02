import { For, Show, createMemo, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Card, Tag, type TagProps } from '@floegence/floe-webapp-core/ui';
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
