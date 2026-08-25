import { Button } from '@floegence/floe-webapp-core/ui';
import { createEffect, createSignal } from 'solid-js';

import type { TerminalGroup } from '../protocol/redeven_v1/sdk/terminal';
import { useI18n } from '../i18n';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';

export function TerminalGroupEditorDialog(props: {
  open: boolean;
  group: TerminalGroup | null;
  defaultWorkingDir: string;
  onCancel: () => void;
  onSubmit: (name: string, defaultWorkingDir: string) => void;
}) {
  const i18n = useI18n();
  const [name, setName] = createSignal('');
  const [workingDir, setWorkingDir] = createSignal('');
  createEffect(() => {
    if (!props.open) return;
    setName(props.group?.name ?? '');
    setWorkingDir(props.group?.defaultWorkingDir ?? props.defaultWorkingDir);
  });
  const submit = () => {
    if (!name().trim() || !workingDir().trim()) return;
    props.onSubmit(name().trim(), workingDir().trim());
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) props.onCancel(); }}
      title={props.group ? i18n.t('terminal.editGroup') : i18n.t('terminal.newGroup')}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.onCancel}>{i18n.t('common.actions.cancel')}</Button>
          <Button size="sm" disabled={!name().trim() || !workingDir().trim()} onClick={submit}>{i18n.t('common.actions.confirm')}</Button>
        </div>
      )}
    >
      <div class="space-y-3">
        <label class="block text-xs font-medium text-foreground">
          {i18n.t('terminal.groupName')}
          <input
            class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            value={name()}
            maxlength={64}
            disabled={props.group?.isDefault}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
            autofocus={!props.group?.isDefault}
          />
        </label>
        <label class="block text-xs font-medium text-foreground">
          {i18n.t('terminal.groupDefaultPath')}
          <input
            class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-primary"
            value={workingDir()}
            onInput={(event) => setWorkingDir(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
            autofocus={props.group?.isDefault}
          />
        </label>
        <p class="text-[11px] leading-4 text-muted-foreground">{i18n.t('terminal.groupDefaultPathHint')}</p>
      </div>
    </Dialog>
  );
}

export function TerminalGroupDeleteDialog(props: {
  open: boolean;
  group: TerminalGroup | null;
  sessionCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const i18n = useI18n();
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={(open) => { if (!open) props.onCancel(); }}
      title={i18n.t('terminal.deleteGroup')}
      confirmText={i18n.t('terminal.deleteGroupConfirm')}
      cancelText={i18n.t('common.actions.cancel')}
      variant="destructive"
      onConfirm={props.onConfirm}
    >
      <p class="text-sm leading-5">{i18n.t('terminal.deleteGroupDescription', {
        group: props.group?.name ?? '',
        count: props.sessionCount,
      })}</p>
    </ConfirmDialog>
  );
}
