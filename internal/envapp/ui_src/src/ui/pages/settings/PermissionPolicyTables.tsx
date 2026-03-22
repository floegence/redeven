import { For } from 'solid-js';
import { Button, Checkbox, Input } from '@floegence/floe-webapp-core/ui';
import type { PermissionRow } from './types';
import {
  SettingsPill,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableEmptyRow,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
} from './SettingsPrimitives';

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
  return (
    <SettingsTable minWidthClass="min-w-[38rem]">
      <SettingsTableHead>
        <SettingsTableHeaderRow>
          <SettingsTableHeaderCell>{props.keyHeader}</SettingsTableHeaderCell>
          <SettingsTableHeaderCell align="center" class="w-24">Read</SettingsTableHeaderCell>
          <SettingsTableHeaderCell align="center" class="w-24">Write</SettingsTableHeaderCell>
          <SettingsTableHeaderCell align="center" class="w-24">Execute</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-24">Actions</SettingsTableHeaderCell>
        </SettingsTableHeaderRow>
      </SettingsTableHead>
      <SettingsTableBody>
        <For each={props.rows}>
          {(row, index) => (
            <SettingsTableRow>
              <SettingsTableCell>
                <Input
                  value={row.key}
                  onInput={(event) => props.onChangeKey(index(), event.currentTarget.value)}
                  placeholder={props.keyPlaceholder}
                  size="sm"
                  class="w-full font-mono text-xs"
                  disabled={!props.canInteract}
                />
              </SettingsTableCell>
              <SettingsTableCell align="center">
                <Checkbox
                  checked={row.read}
                  onChange={(value) => props.onChangePerm(index(), 'read', value)}
                  disabled={!props.canInteract || !props.readEnabled}
                  label=""
                  size="sm"
                />
              </SettingsTableCell>
              <SettingsTableCell align="center">
                <Checkbox
                  checked={row.write}
                  onChange={(value) => props.onChangePerm(index(), 'write', value)}
                  disabled={!props.canInteract || !props.writeEnabled}
                  label=""
                  size="sm"
                />
              </SettingsTableCell>
              <SettingsTableCell align="center">
                <Checkbox
                  checked={row.execute}
                  onChange={(value) => props.onChangePerm(index(), 'execute', value)}
                  disabled={!props.canInteract || !props.executeEnabled}
                  label=""
                  size="sm"
                />
              </SettingsTableCell>
              <SettingsTableCell>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-muted-foreground hover:text-destructive"
                  onClick={() => props.onRemove(index())}
                  disabled={!props.canInteract}
                >
                  Remove
                </Button>
              </SettingsTableCell>
            </SettingsTableRow>
          )}
        </For>
        {props.rows.length === 0 ? <SettingsTableEmptyRow colSpan={5}>{props.emptyMessage}</SettingsTableEmptyRow> : null}
      </SettingsTableBody>
    </SettingsTable>
  );
}

export function PermissionMatrixTable(props: {
  read: boolean;
  write: boolean;
  execute: boolean;
  canInteract: boolean;
  onChange: (key: 'read' | 'write' | 'execute', value: boolean) => void;
}) {
  const rows = [
    {
      key: 'read' as const,
      label: 'Read',
      description: 'Allow viewing files and reading state.',
      checked: props.read,
    },
    {
      key: 'write' as const,
      label: 'Write',
      description: 'Allow modifying files and local state.',
      checked: props.write,
    },
    {
      key: 'execute' as const,
      label: 'Execute',
      description: 'Allow terminal/process execution.',
      checked: props.execute,
    },
  ];

  return (
    <SettingsTable minWidthClass="min-w-[34rem]">
      <SettingsTableHead>
        <SettingsTableHeaderRow>
          <SettingsTableHeaderCell>Permission</SettingsTableHeaderCell>
          <SettingsTableHeaderCell>Description</SettingsTableHeaderCell>
          <SettingsTableHeaderCell class="w-32">State</SettingsTableHeaderCell>
        </SettingsTableHeaderRow>
      </SettingsTableHead>
      <SettingsTableBody>
        <For each={rows}>
          {(row) => (
            <SettingsTableRow>
              <SettingsTableCell class="font-medium">{row.label}</SettingsTableCell>
              <SettingsTableCell class="text-muted-foreground">{row.description}</SettingsTableCell>
              <SettingsTableCell>
                <div class="flex items-center gap-3">
                  <Checkbox
                    checked={row.checked}
                    onChange={(value) => props.onChange(row.key, value)}
                    disabled={!props.canInteract}
                    label=""
                    size="sm"
                  />
                  <SettingsPill tone={row.checked ? 'success' : 'default'}>{row.checked ? 'Enabled' : 'Disabled'}</SettingsPill>
                </div>
              </SettingsTableCell>
            </SettingsTableRow>
          )}
        </For>
      </SettingsTableBody>
    </SettingsTable>
  );
}
