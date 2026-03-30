// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeRuntimeSettingsCard, type CodeRuntimeSettingsCardProps } from './CodeRuntimeSettingsCard';

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Code: (props: any) => <span class={props.class} data-testid="code-icon" />,
  RefreshIcon: (props: any) => <span class={props.class} data-testid="refresh-icon" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  ConfirmDialog: (props: any) => (
    <Show when={props.open}>
      <div>
        <div>{props.title}</div>
        <div>{props.children}</div>
        <button type="button" onClick={() => props.onConfirm?.()} disabled={props.loading}>
          {props.confirmText}
        </button>
      </div>
    </Show>
  ),
}));

vi.mock('./SettingsPrimitives', () => ({
  SettingsCard: (props: any) => (
    <section>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div>{props.actions}</div>
      {props.children}
    </section>
  ),
  SettingsKeyValueTable: (props: any) => (
    <table>
      <tbody>
        {props.rows.map((row: any) => (
          <tr>
            <td>{row.label}</td>
            <td>{row.value}</td>
            <td>{row.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  SettingsPill: (props: any) => <span>{props.children}</span>,
}));

function makeStatus(overrides: any = {}) {
  const managedPrefix = '/Users/test/.redeven/apps/code/runtime/managed';
  return {
    ...overrides,
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${managedPrefix}/bin/code-server`,
      ...(overrides.active_runtime ?? {}),
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${managedPrefix}/bin/code-server`,
      ...(overrides.managed_runtime ?? {}),
    },
    managed_prefix: managedPrefix,
    installer_script_url: 'https://code-server.dev/install.sh',
    operation: {
      state: 'idle',
      log_tail: [],
      ...(overrides.operation ?? {}),
    },
    updated_at_unix_ms: 1,
  };
}

function renderCard(host: HTMLElement, overrides: Partial<CodeRuntimeSettingsCardProps> = {}) {
  const props: CodeRuntimeSettingsCardProps = {
    status: makeStatus(),
    loading: false,
    error: null,
    canInteract: true,
    canManage: true,
    actionLoading: false,
    uninstallLoading: false,
    cancelLoading: false,
    onRefresh: () => undefined,
    onInstall: () => undefined,
    onUninstall: () => undefined,
    onCancel: () => undefined,
    ...overrides,
  };

  render(() => <CodeRuntimeSettingsCard {...props} />, host);
  return props;
}

describe('CodeRuntimeSettingsCard', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('collapses to a single current runtime section when the managed runtime is healthy and selected', () => {
    renderCard(host);

    expect(host.textContent).toContain('Current runtime');
    expect(host.textContent).not.toContain('Codespaces selection');
    expect(host.textContent).toContain('Managed location');
    expect(host.querySelectorAll('table')).toHaveLength(1);
  });

  it('shows managed runtime details when a host runtime is active instead of the managed runtime', () => {
    renderCard(host, {
      status: makeStatus({
        active_runtime: { source: 'system', binary_path: '/usr/local/bin/code-server' },
      }),
    });

    expect(host.textContent).toContain('Update to latest');
    expect(host.textContent).toContain('Current runtime');
    expect(host.textContent).toContain('Managed runtime');
    expect(host.textContent).toContain('higher-priority runtime is currently active');
    expect(host.querySelectorAll('table')).toHaveLength(2);
  });

  it('renders a compact installable state when no compatible runtime is installed', () => {
    renderCard(host, {
      status: makeStatus({
        active_runtime: {
          detection_state: 'missing',
          present: false,
          source: 'none',
          binary_path: '',
        },
        managed_runtime: {
          detection_state: 'missing',
          present: false,
          source: 'managed',
          binary_path: '',
        },
      }),
    });

    expect(host.textContent).toContain('No runtime installed');
    expect(host.textContent).toContain('Codespaces needs a usable code-server runtime before it can start.');
    expect(host.textContent).not.toContain('Current runtime');
    expect(host.textContent).not.toContain('Managed runtime');
    expect(host.querySelectorAll('table')).toHaveLength(0);
  });

  it('shows a focused uninstall progress panel while runtime removal is running', () => {
    renderCard(host, {
      status: makeStatus({
        operation: {
          action: 'uninstall',
          state: 'running',
          stage: 'removing',
          log_tail: ['Preparing managed code-server uninstall.', 'Managed runtime has been removed.'],
        },
      }),
    });

    expect(host.textContent).toContain('Removing managed runtime');
    expect(host.textContent).toContain('Removing managed runtime files...');
    expect(host.textContent).toContain('Recent runtime output');
    expect(host.textContent).not.toContain('Current runtime');
    expect(host.textContent).not.toContain('Codespaces selection');
    expect(host.querySelectorAll('table')).toHaveLength(0);
  });

  it('returns to the compact steady state after a successful uninstall', () => {
    renderCard(host, {
      status: makeStatus({
        active_runtime: {
          detection_state: 'missing',
          present: false,
          source: 'none',
          binary_path: '',
        },
        managed_runtime: {
          detection_state: 'missing',
          present: false,
          source: 'managed',
          binary_path: '',
        },
        operation: {
          action: 'uninstall',
          state: 'succeeded',
          log_tail: ['Preparing managed code-server uninstall.', 'Managed runtime has been removed.'],
        },
      }),
    });

    expect(host.textContent).toContain('No runtime installed');
    expect(host.textContent).not.toContain('Uninstall completed');
    expect(host.textContent).not.toContain('Recent runtime output');
    expect(host.querySelectorAll('table')).toHaveLength(0);
  });

  it('shows an attention panel with output when uninstall fails', () => {
    renderCard(host, {
      status: makeStatus({
        operation: {
          action: 'uninstall',
          state: 'failed',
          last_error: 'permission denied',
          log_tail: ['Preparing managed code-server uninstall.', 'permission denied'],
        },
      }),
    });

    expect(host.textContent).toContain('Unable to remove managed runtime');
    expect(host.textContent).toContain('permission denied');
    expect(host.textContent).toContain('Recent runtime output');
    expect(host.textContent).toContain('Current runtime');
    expect(host.querySelectorAll('table')).toHaveLength(1);
  });

  it('opens the explicit install confirmation and calls the install action', async () => {
    const onInstall = vi.fn(async () => undefined);

    renderCard(host, {
      status: makeStatus({
        active_runtime: {
          detection_state: 'missing',
          present: false,
          source: 'none',
          binary_path: '',
        },
        managed_runtime: {
          detection_state: 'missing',
          present: false,
          source: 'managed',
          binary_path: '',
        },
      }),
      onInstall,
    });

    const installButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Install latest');
    installButton?.click();

    expect(host.textContent).toContain('Redeven will run the official latest-stable code-server installer');
    expect(host.textContent).toContain('https://code-server.dev/install.sh');

    const confirmButton = Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent === 'Install latest')
      .at(-1);
    confirmButton?.click();

    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('opens the explicit uninstall confirmation and calls the uninstall action', () => {
    const onUninstall = vi.fn(async () => undefined);

    renderCard(host, { onUninstall });

    expect(host.textContent).not.toContain('Uninstall managed runtime');
    expect(host.textContent).toContain('Current runtime');
    expect(host.querySelectorAll('table')).toHaveLength(1);

    const uninstallButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Uninstall');
    uninstallButton?.click();

    expect(host.textContent).toContain('This removes only the Redeven-managed code-server runtime');

    const confirmButton = Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent === 'Uninstall')
      .at(-1);
    confirmButton?.click();

    expect(onUninstall).toHaveBeenCalledTimes(1);
  });
});
