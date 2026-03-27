// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvDebugConsoleSettingsPanel } from './EnvDebugConsoleSettingsPanel';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Checkbox: (props: any) => (
    <input
      type="checkbox"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.(event.currentTarget.checked)}
    />
  ),
}));

vi.mock('./settings/SettingsPrimitives', () => ({
  AutoSaveIndicator: (props: any) => <span>{props.error ? props.error : props.saving ? 'saving' : props.dirty ? 'dirty' : 'saved'}</span>,
  SettingsPill: (props: any) => <span>{props.children}</span>,
  SettingsTable: (props: any) => <table>{props.children}</table>,
  SettingsTableBody: (props: any) => <tbody>{props.children}</tbody>,
  SettingsTableCell: (props: any) => <td>{props.children}</td>,
  SettingsTableHead: (props: any) => <thead>{props.children}</thead>,
  SettingsTableHeaderCell: (props: any) => <th>{props.children}</th>,
  SettingsTableHeaderRow: (props: any) => <tr>{props.children}</tr>,
  SettingsTableRow: (props: any) => <tr>{props.children}</tr>,
  SubSectionHeader: (props: any) => (
    <div>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div>{props.actions}</div>
    </div>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EnvDebugConsoleSettingsPanel', () => {
  it('renders independent debug-console controls and disables the open button when off', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDebugConsoleSettingsPanel
        enabled={false}
        collectUIMetrics={false}
        dirty={false}
        saving={false}
        error={null}
        savedAt={null}
        canInteract
        onEnabledChange={() => undefined}
        onCollectUIMetricsChange={() => undefined}
        onOpenConsole={() => undefined}
      />
    ), host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('Independent from');
    const openButton = host.querySelector('button');
    expect(openButton?.disabled).toBe(true);
  });
});
