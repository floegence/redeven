import { For, Index, Show, type JSX } from 'solid-js';
import { Button, Checkbox, Input } from '@floegence/floe-webapp-core/ui';
import { Eye, Pencil, Play, Plus, Trash } from '@floegence/floe-webapp-core/icons';
import { cn } from '@floegence/floe-webapp-core';
import type { PermissionRow } from './types';
import { EmptyState, SettingsPill } from './SettingsPrimitives';
import { redevenSurfaceRoleClass } from '../../utils/redevenSurfaceRoles';
import { useI18n } from '../../i18n';

export function PermissionRuleTable(props: {
  rows: PermissionRow[];
  emptyMessage: string;
  keyHeader: string;
  keyPlaceholder: string;
  canInteract: boolean;
  readEnabled: boolean;
  writeEnabled: boolean;
  executeEnabled: boolean;
  onChangeKey: (index: number, value: string) => void;
  onChangePerm: (index: number, key: 'read' | 'write' | 'execute', value: boolean) => void;
  onRemove: (index: number) => void;
}) {
  const i18n = useI18n();

  return (
    <div class="space-y-1.5">
      <Show
        when={props.rows.length > 0}
        fallback={<EmptyState icon={Plus} message={props.emptyMessage} />}
      >
        <Index each={props.rows}>
          {(row, index) => (
            <div class={cn('flex items-center gap-2 rounded-lg border px-3 py-2', redevenSurfaceRoleClass('panel'))}>
              <Input
                value={row().key}
                onInput={(event) => props.onChangeKey(index, event.currentTarget.value)}
                placeholder={props.keyPlaceholder}
                size="sm"
                class="min-w-0 flex-1 font-mono text-xs"
                disabled={!props.canInteract}
              />
              <div class="flex items-center gap-1.5">
                <PermToggle
                  icon={Eye}
                  label={i18n.t('permissionPolicy.permission.read')}
                  checked={row().read}
                  disabled={!props.canInteract || !props.readEnabled}
                  onChange={(v) => props.onChangePerm(index, 'read', v)}
                />
                <PermToggle
                  icon={Pencil}
                  label={i18n.t('permissionPolicy.permission.write')}
                  checked={row().write}
                  disabled={!props.canInteract || !props.writeEnabled}
                  onChange={(v) => props.onChangePerm(index, 'write', v)}
                />
                <PermToggle
                  icon={Play}
                  label={i18n.t('permissionPolicy.permission.execute')}
                  checked={row().execute}
                  disabled={!props.canInteract || !props.executeEnabled}
                  onChange={(v) => props.onChangePerm(index, 'execute', v)}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                class="text-muted-foreground hover:text-destructive"
                onClick={() => props.onRemove(index)}
                disabled={!props.canInteract}
                icon={Trash}
                aria-label={i18n.t('permissionPolicy.removeRuleAria', { subject: props.keyHeader.toLowerCase() })}
              />
            </div>
          )}
        </Index>
      </Show>
    </div>
  );
}

function PermToggle(props: {
  icon: (props: { class?: string }) => JSX.Element;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const i18n = useI18n();

  return (
    <button
      type="button"
      class={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        props.checked
          ? 'bg-success/10 text-success hover:bg-success/20'
          : 'bg-muted text-muted-foreground hover:bg-muted/80',
        props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      aria-label={i18n.t('permissionPolicy.toggleAria', {
        label: props.label,
        state: props.checked ? i18n.t('permissionPolicy.enabled') : i18n.t('permissionPolicy.disabled'),
      })}
    >
      <props.icon class="h-3 w-3" />
      <span>{props.checked ? '✓' : '✕'}</span>
    </button>
  );
}

export function PermissionMatrixTable(props: {
  read: boolean;
  write: boolean;
  execute: boolean;
  canInteract: boolean;
  onChange: (key: 'read' | 'write' | 'execute', value: boolean) => void;
}) {
  const i18n = useI18n();
  const perms = () => [
    { key: 'read' as const, icon: Eye, label: i18n.t('permissionPolicy.permission.read'), checked: props.read },
    { key: 'write' as const, icon: Pencil, label: i18n.t('permissionPolicy.permission.write'), checked: props.write },
    { key: 'execute' as const, icon: Play, label: i18n.t('permissionPolicy.permission.execute'), checked: props.execute },
  ];

  return (
    <div class="flex flex-wrap gap-2">
      <For each={perms()}>
        {(perm) => (
          <label
            class={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
              redevenSurfaceRoleClass('panel'),
              props.canInteract ? 'cursor-pointer hover:border-primary/30' : 'cursor-not-allowed opacity-50',
            )}
          >
            <Checkbox
              checked={perm.checked}
              onChange={(v) => props.onChange(perm.key, v)}
              disabled={!props.canInteract}
              label=""
              size="sm"
            />
            <perm.icon class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-xs font-medium text-foreground">{perm.label}</span>
            <SettingsPill tone={perm.checked ? 'success' : 'default'}>
              {perm.checked ? i18n.t('permissionPolicy.allowed') : i18n.t('permissionPolicy.denied')}
            </SettingsPill>
          </label>
        )}
      </For>
    </div>
  );
}
