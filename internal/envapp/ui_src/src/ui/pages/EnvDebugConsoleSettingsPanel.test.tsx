// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvDebugConsoleSettingsPanel } from './EnvDebugConsoleSettingsPanel';

vi.mock('./settings/SettingsPrimitives', () => ({
  SettingRow: (props: any) => (
    <div>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div>{props.control}</div>
      <div>{props.children}</div>
    </div>
  ),
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

    expect(host.textContent).toContain('Frontend only');
    expect(host.textContent).not.toContain('collect_ui_metrics');
    expect(host.textContent).not.toContain('Show the floating debug console in this Env App session.');
    expect(host.textContent).not.toContain('Debug Console');
    expect(host.textContent).not.toContain('No runtime config writes');
    expect(host.textContent).not.toContain('Console hidden');
    expect(host.textContent).not.toContain('UI metrics start on open');
    expect(host.textContent).not.toContain('Open floating console');

    const switchButton = host.querySelector('input[role="switch"]') as HTMLInputElement | null;
    expect(switchButton).not.toBeNull();
    expect(switchButton?.checked).toBe(false);
    expect(switchButton?.getAttribute('aria-checked')).toBe('false');
    expect(switchButton?.getAttribute('aria-label')).toBeTruthy();
    expect(host.querySelector('[data-floe-surface-part="switch-thumb"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(1);
  });

  it('uses the native checked state for the shared switch', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDebugConsoleSettingsPanel
        enabled
        canInteract
        onEnabledChange={() => undefined}
      />
    ), host);

    const switchButton = host.querySelector('input[role="switch"]') as HTMLInputElement | null;
    expect(switchButton).not.toBeNull();
    expect(switchButton?.checked).toBe(true);
    expect(switchButton?.getAttribute('aria-checked')).toBe('true');
  });

  it('forwards the native toggle immediately', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onEnabledChange = vi.fn();
    render(() => <EnvDebugConsoleSettingsPanel enabled={false} canInteract onEnabledChange={onEnabledChange} />, host);
    const input = host.querySelector<HTMLInputElement>('input[role="switch"]')!;
    input.click();
    expect(onEnabledChange).toHaveBeenCalledOnce();
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it('disables the switch when the session cannot interact', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onEnabledChange = vi.fn();

    render(() => (
      <EnvDebugConsoleSettingsPanel
        enabled={false}
        canInteract={false}
        onEnabledChange={onEnabledChange}
      />
    ), host);

    const switchButton = host.querySelector('input[role="switch"]') as HTMLInputElement | null;
    expect(switchButton).not.toBeNull();
    expect(switchButton?.disabled).toBe(true);
    switchButton?.click();

    expect(onEnabledChange).not.toHaveBeenCalled();
  });
});
