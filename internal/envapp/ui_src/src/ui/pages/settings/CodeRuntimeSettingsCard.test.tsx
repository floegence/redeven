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
  HighlightBlock: (props: any) => (
    <div class={['highlight-block', props.class].filter(Boolean).join(' ')} data-highlight-variant={props.variant}>
      <div>{props.title}</div>
      {props.children}
    </div>
  ),
}));

vi.mock('../../primitives/Tooltip', () => ({
  Tooltip: (props: any) => (
    <div data-testid="tooltip" data-content={String(props.content ?? '')}>
      {props.children}
    </div>
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
  const sharedRoot = '/Users/test/.redeven/shared/code-server/darwin-arm64';
  const managedPrefix = '/Users/test/.redeven/local-environment/apps/code/runtime/managed';
  return {
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
      ...(overrides.active_runtime ?? {}),
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
      ...(overrides.managed_runtime ?? {}),
    },
    managed_prefix: managedPrefix,
    shared_runtime_root: sharedRoot,
    managed_runtime_version: '4.109.1',
    managed_runtime_source: 'managed',
    installed_versions: [
      {
        version: '4.109.1',
        binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
        selected_by_local_environment: true,
        removable: false,
        detection_state: 'ready',
      },
      ...(overrides.installed_versions ?? []),
    ],
    installer_script_url: 'https://code-server.dev/install.sh',
    operation: {
      state: 'idle',
      log_tail: [],
      ...(overrides.operation ?? {}),
    },
    updated_at_unix_ms: 1,
    ...overrides,
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
    cancelLoading: false,
    selectionLoadingVersion: null,
    removeVersionLoading: null,
    onRefresh: () => undefined,
    onInstall: () => undefined,
    onSelectVersion: () => undefined,
    onRemoveVersion: () => undefined,
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

  it('renders current Local Environment and inventory sections with scope-explicit wording', () => {
    renderCard(host);

    expect(host.textContent).toContain('Current Local Environment');
    expect(host.textContent).toContain('Installed for this Local Environment');
    expect(host.textContent).toContain('Current Local Environment selection');
    expect(host.textContent).toContain('Shared runtime root');
    expect(host.textContent).toContain('Refresh');
    expect(host.textContent).toContain('Install latest');
    expect(host.textContent).toContain('Use for this Local Environment');

    const tooltipContents = Array.from(host.querySelectorAll('[data-testid="tooltip"]')).map((node) => node.getAttribute('data-content'));
    expect(tooltipContents).toContain('Re-scan the Local Environment inventory and the active runtime.');
    expect(tooltipContents).toContain('Install the latest stable managed code-server for this Local Environment, then select it.');
  });

  it('shows an empty-state warning when no managed versions are installed for this Local Environment', () => {
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
        installed_versions: [],
        managed_runtime_source: 'none',
        managed_runtime_version: '',
      }),
    });

    expect(host.textContent).toContain('No managed versions installed');
    expect(host.textContent).toContain('Install the latest stable managed runtime for this Local Environment');
  });

  it('opens the install confirmation and calls the install action', () => {
    const onInstall = vi.fn(async () => undefined);
    renderCard(host, { onInstall });

    const installButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Install latest');
    installButton?.click();

    expect(host.textContent).toContain('Install latest runtime');
    expect(host.textContent).toContain('Redeven will install the latest stable managed code-server runtime');

    const confirmButton = Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === 'Install latest').at(-1);
    confirmButton?.click();

    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});
