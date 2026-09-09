import { Button, DirectoryPicker, type PickerPanelProps } from '@floegence/floe-webapp-core/ui';
import { FolderOpen } from '@floegence/floe-webapp-core/icons';
import { createEffect, createSignal } from 'solid-js';

import type { TerminalGroup } from '../protocol/redeven_v1/sdk/terminal';
import { useI18n } from '../i18n';
import { ConfirmDialog, Dialog } from '../primitives/EnvAppModal';

export function defaultTerminalGroupNameFromPath(path: string): string {
  const raw = String(path ?? '').trim();
  const normalized = raw.replace(/[\\/]+$/u, '');
  if (!normalized) return raw ? '/' : '';
  const segments = normalized.split(/[\\/]/u).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

export function TerminalGroupEditorDialog(props: {
  open: boolean;
  group: TerminalGroup | null;
  defaultWorkingDir: string;
  pickerProps?: PickerPanelProps;
  onCancel: () => void;
  onSubmit: (name: string, defaultWorkingDir: string) => void;
}) {
  const i18n = useI18n();
  const [name, setName] = createSignal('');
  const [workingDir, setWorkingDir] = createSignal('');
  const [nameTracksPath, setNameTracksPath] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  createEffect(() => {
    if (!props.open) return;
    const initialWorkingDir = props.group?.defaultWorkingDir ?? props.defaultWorkingDir;
    setWorkingDir(initialWorkingDir);
    setName(props.group?.name ?? defaultTerminalGroupNameFromPath(initialWorkingDir));
    setNameTracksPath(!props.group);
    setPickerOpen(false);
  });
  const updateWorkingDir = (value: string) => {
    setWorkingDir(value);
    if (!props.group && nameTracksPath()) {
      setName(defaultTerminalGroupNameFromPath(value));
    }
  };
  const submit = () => {
    if (!name().trim() || !workingDir().trim()) return;
    props.onSubmit(name().trim(), workingDir().trim());
  };
  return (
    <>
      <Dialog
        open={props.open && !pickerOpen()}
        onOpenChange={(open) => { if (!open && !pickerOpen()) props.onCancel(); }}
        title={props.group ? i18n.t('terminal.editGroup') : i18n.t('terminal.newGroup')}
        footer={(
          <div class="flex justify-end gap-2">
            <Button class="cursor-pointer" size="sm" variant="outline" onClick={props.onCancel}>{i18n.t('common.actions.cancel')}</Button>
            <Button class="cursor-pointer disabled:cursor-not-allowed" size="sm" disabled={!name().trim() || !workingDir().trim()} onClick={submit}>{i18n.t('common.actions.confirm')}</Button>
          </div>
        )}
      >
        <div class="space-y-3">
          <label class="block text-xs font-medium text-foreground">
            {i18n.t('terminal.groupName')}
            <input
              class="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none disabled:opacity-60"
              value={name()}
              maxlength={64}
              disabled={props.group?.isDefault}
              onInput={(event) => {
                setNameTracksPath(false);
                setName(event.currentTarget.value);
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
              autofocus={!props.group?.isDefault}
            />
          </label>
          <label class="block text-xs font-medium text-foreground">
            {i18n.t('terminal.groupDefaultPath')}
            <span class="mt-1 flex items-stretch gap-1.5">
              <input
                class="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none"
                value={workingDir()}
                onInput={(event) => updateWorkingDir(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
                autofocus={props.group?.isDefault}
                data-testid="terminal-group-path-input"
              />
              <Button
                type="button"
                variant="outline"
                class="h-9 cursor-pointer gap-1.5 px-2.5 text-xs"
                title={i18n.t('terminal.browseGroupPath')}
                aria-label={i18n.t('terminal.browseGroupPath')}
                data-testid="terminal-group-path-picker-trigger"
                onClick={() => {
                  setPickerOpen(true);
                }}
              >
                <FolderOpen class="h-3.5 w-3.5" />
                <span>{i18n.t('terminal.browseGroupPath')}</span>
              </Button>
            </span>
          </label>
          <p class="text-[11px] leading-4 text-muted-foreground">{i18n.t('terminal.groupDefaultPathHint')}</p>
        </div>
      </Dialog>
      <DirectoryPicker
        open={props.open && pickerOpen()}
        onOpenChange={setPickerOpen}
        {...props.pickerProps}
        initialPath={workingDir()}
        title={i18n.t('terminal.selectGroupPath')}
        confirmText={i18n.t('common.actions.confirm')}
        cancelText={i18n.t('common.actions.cancel')}
        onSelect={updateWorkingDir}
      />
    </>
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
