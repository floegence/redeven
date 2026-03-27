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
}));

vi.mock('./settings/SettingsPrimitives', () => ({
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
  it('renders frontend-only debug-console controls and disables the open button when off', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDebugConsoleSettingsPanel
        enabled={false}
        canInteract
        onEnabledChange={() => undefined}
        onOpenConsole={() => undefined}
      />
    ), host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('Frontend only');
    expect(host.textContent).toContain('No agent config writes');
    expect(host.textContent).not.toContain('collect_ui_metrics');
    const buttons = host.querySelectorAll('button');
    const openButton = buttons[buttons.length - 1] as HTMLButtonElement | undefined;
    expect(openButton?.disabled).toBe(true);
  });
});
