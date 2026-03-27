// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvDebugConsoleSettingsPanel } from './EnvDebugConsoleSettingsPanel';

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
  it('renders only the debug-console switch row without redundant helper UI', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDebugConsoleSettingsPanel
        enabled={false}
        canInteract
        onEnabledChange={() => undefined}
      />
    ), host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('Frontend only');
    expect(host.textContent).toContain('No agent config writes');
    expect(host.textContent).not.toContain('collect_ui_metrics');
    expect(host.textContent).not.toContain('Show the floating debug console in this Env App session.');
    expect(host.textContent).not.toContain('Console hidden');
    expect(host.textContent).not.toContain('UI metrics start on open');
    expect(host.textContent).not.toContain('Open floating console');

    const switchButton = host.querySelector('button[role="switch"]') as HTMLButtonElement | null;
    expect(switchButton).not.toBeNull();
    expect(switchButton?.getAttribute('data-state')).toBe('unchecked');
    expect(switchButton?.className).toContain('env-debug-console-switch');
    expect(switchButton?.className).toContain('shrink-0');
    expect(switchButton?.className).toContain('flex-none');
    expect(switchButton?.className).toContain('cursor-pointer');
    expect(switchButton?.className).toContain('focus-visible:ring-2');
    expect(host.querySelector('.env-debug-console-switch__thumb')).not.toBeNull();
    expect(host.querySelectorAll('button')).toHaveLength(1);
  });

  it('marks the enabled state for the theme-aware switch styles', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDebugConsoleSettingsPanel
        enabled
        canInteract
        onEnabledChange={() => undefined}
      />
    ), host);

    const switchButton = host.querySelector('button[role="switch"]') as HTMLButtonElement | null;
    expect(switchButton).not.toBeNull();
    expect(switchButton?.getAttribute('data-state')).toBe('checked');
    expect(switchButton?.getAttribute('aria-checked')).toBe('true');
  });
});
