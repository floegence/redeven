// @vitest-environment jsdom

import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18nTestState = vi.hoisted(() => ({
  locale: 'en-US' as 'en-US' | 'zh-CN',
}));

import { CodeRuntimeSettingsCard, type CodeRuntimeSettingsCardProps } from './CodeRuntimeSettingsCard';
import { browserEditorLocalFailureFromError } from '../../services/browserEditorSetupActivity';
import { BrowserEditorSetupError } from '../../services/browserEditorSetupError';

vi.mock('../../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../i18n')>();
  const { createTestI18nHelpers } = await import('../../i18n/locales/testDictionaries');
  return {
    ...actual,
    useI18n: () => ({
      ...createTestI18nHelpers(i18nTestState.locale),
      snapshot: () => ({
        preference: i18nTestState.locale,
        resolved_locale: i18nTestState.locale,
        source: 'explicit',
        system_candidates: [],
      }),
      locale: () => i18nTestState.locale,
      localePreference: () => i18nTestState.locale,
      source: () => 'browser',
      setLocalePreference: vi.fn(),
    }),
  };
});

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: (props: any) => <span class={props.class} data-testid="alert-triangle-icon" />,
  ChevronDown: (props: any) => <span class={props.class} data-testid="chevron-down-icon" />,
  ChevronRight: (props: any) => <span class={props.class} data-testid="chevron-right-icon" />,
  Check: (props: any) => <span class={props.class} data-testid="check-icon" />,
  Code: (props: any) => <span class={props.class} data-testid="code-icon" />,
  Cloud: (props: any) => <span class={props.class} data-testid="cloud-icon" />,
  Cpu: (props: any) => <span class={props.class} data-testid="cpu-icon" />,
  RefreshIcon: (props: any) => <span class={props.class} data-testid="refresh-icon" />,
  X: (props: any) => <span class={props.class} data-testid="x-icon" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  ConfirmDialog: (props: any) => (
    <Show when={props.open}>
      <div role="dialog">
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
  Tag: (props: any) => <span>{props.children}</span>,
}));

vi.mock('../../primitives/Tooltip', () => ({
  Tooltip: (props: any) => (
    <div data-testid="tooltip" data-content={String(props.content ?? '')}>
      {props.children}
    </div>
  ),
}));

vi.mock('./SettingsPrimitives', () => ({
  SettingsSection: (props: any) => (
    <section>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div data-testid="settings-section-badge">{props.badge}</div>
      <div>{props.actions}</div>
      {props.children}
    </section>
  ),
  SettingsCard: (props: any) => (
    <section>
      <div>{props.title}</div>
      <div>{props.description}</div>
      <div>{props.actions}</div>
      {props.children}
    </section>
  ),
  SettingsList: (props: any) => <div>{props.children}</div>,
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
  const [installMethod, setInstallMethod] = createSignal(overrides.installMethod ?? 'desktop_transfer');
  const onInstallMethodChange = overrides.onInstallMethodChange ?? (() => undefined);
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
    installMethod: installMethod(),
    desktopTransferAvailable: true,
    onInstallMethodChange,
    onRefresh: () => undefined,
    onPrepare: () => undefined,
    onSelectVersion: () => undefined,
    onRemoveVersion: () => undefined,
    onCancel: () => undefined,
    ...overrides,
  };

  render(() => (
    <CodeRuntimeSettingsCard
      {...props}
      installMethod={installMethod()}
      onInstallMethodChange={(method) => {
        setInstallMethod(method);
        onInstallMethodChange(method);
      }}
    />
  ), host);
  return props;
}

describe('CodeRuntimeSettingsCard', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    i18nTestState.locale = 'en-US';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('renders Browser Editor inventory sections with update wording', () => {
    renderCard(host);

    expect(host.textContent).toContain('Browser Editor');
    expect(host.textContent).toContain('Shared runtime root');
    expect(host.textContent).toContain('Refresh');
    expect(host.textContent).toContain('Update Browser Editor');

    const tooltipContents = Array.from(host.querySelectorAll('[data-testid="tooltip"]')).map((node) => node.getAttribute('data-content'));
    expect(tooltipContents).toContain('Re-scan the Browser Editor inventory and active runtime.');
    expect(tooltipContents).toContain('Desktop downloads and verifies the Browser Editor package, then sends it through the current connection to this environment.');
  });

  it('renders Browser Editor inventory sections with zh-CN settings copy', () => {
    i18nTestState.locale = 'zh-CN';
    renderCard(host);

    expect(host.textContent).toContain('Browser Editor');
    expect(host.textContent).toContain('当前编辑器');
    expect(host.textContent).toContain('托管编辑器来源');
    expect(host.textContent).toContain('已选择托管版本');
    expect(host.textContent).toContain('Codespaces 使用选定的托管 Browser Editor 版本。');
    expect(host.textContent).toContain('共享运行时根');
    expect(host.textContent).toContain('已安装的编辑器版本');
    expect(host.textContent).toContain('二进制路径');
    expect(host.textContent).toContain('使用此版本');
    expect(host.textContent).toContain('移除版本');
    expect(host.textContent).not.toContain('Managed editor source');
    expect(host.textContent).not.toContain('Use this version');

    const tooltipContents = Array.from(host.querySelectorAll('[data-testid="tooltip"]')).map((node) => node.getAttribute('data-content'));
    expect(tooltipContents).toContain('重新扫描 Browser Editor 库存和活动运行时。');
    expect(tooltipContents).toContain('Desktop 下载并校验 Browser Editor 软件包，再通过当前连接将其发送到此环境。');
  });

  it('renders unsupported platform diagnostics in zh-CN without a retry action', () => {
    i18nTestState.locale = 'zh-CN';
    renderCard(host, {
      status: makeStatus({
        active_runtime: { detection_state: 'missing', present: false, source: 'none', binary_path: '' },
        managed_runtime: { detection_state: 'missing', present: false, source: 'managed', binary_path: '' },
        installed_versions: [],
        managed_runtime_source: 'none',
        managed_runtime_version: '',
        platform: {
          os: 'linux',
          arch: 'amd64',
          libc: 'musl',
          platform_id: 'linux-amd64-musl',
          supported: false,
          unsupported_code: 'unsupported_libc',
        },
      }),
    });

    const activity = host.querySelector('[data-testid="browser-editor-setup-activity"]');
    expect(activity?.getAttribute('data-layout')).toBe('compact');
    expect(activity?.textContent).toContain('环境不受支持');
    expect(activity?.textContent).toContain('此环境暂不支持托管 Browser Editor。');
    expect(activity?.textContent).toContain('检测到');
    expect(activity?.textContent).toContain('linux / amd64 / musl');
    expect(activity?.textContent).toContain('Linux amd64/arm64 · glibc');
    expect(activity?.textContent).not.toContain('重试设置');
    expect(activity?.textContent).not.toContain('Detected');
    expect(activity?.textContent).not.toContain('Required');
    expect(host.textContent).not.toContain('设置 Browser Editor');

    const dismiss = Array.from(activity?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('关闭'));
    expect(dismiss).toBeTruthy();
    dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('[data-testid="browser-editor-setup-activity"]')).toBeNull();
  });

  it('uses the setup activity as the single setup surface when no managed versions are installed', () => {
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

    expect(host.textContent).toContain('Set up Browser Editor');
    expect(host.textContent).not.toContain('Browser Editor setup required');
    expect(Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === 'Set up Browser Editor')).toHaveLength(1);
  });

  it('selects the Browser Editor update method in the confirmation before preparing', () => {
    const onPrepare = vi.fn(async () => undefined);
    const onInstallMethodChange = vi.fn();
    renderCard(host, { onPrepare, onInstallMethodChange });

    const prepareButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Update Browser Editor');
    prepareButton?.click();

    expect(host.textContent).toContain('Update Browser Editor');
    expect(host.textContent).toContain('Desktop downloads and verifies the Browser Editor package');
    expect(onInstallMethodChange).toHaveBeenCalledWith('desktop_transfer');

    const methodButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(methodButtons).toHaveLength(2);
    expect(methodButtons[0].getAttribute('aria-checked')).toBe('true');

    methodButtons[1].click();

    expect(onInstallMethodChange).toHaveBeenLastCalledWith('remote_download');
    expect(methodButtons[1].getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Environment network → Redeven package service');
    expect(host.textContent).toContain('This environment downloads and verifies the Browser Editor package directly');

    const confirmButton = Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === 'Update Browser Editor').at(-1);
    confirmButton?.click();

    expect(onPrepare).toHaveBeenCalledTimes(1);
  });

  it('dismisses the update confirmation before Browser Editor setup completes', async () => {
    let resolvePrepare!: () => void;
    const preparePending = new Promise<void>((resolve) => {
      resolvePrepare = resolve;
    });
    const onPrepare = vi.fn(() => preparePending);
    renderCard(host, { onPrepare });

    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Update Browser Editor')
      ?.click();

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent === 'Update Browser Editor')
      .at(-1)
      ?.click();

    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    resolvePrepare();
    await preparePending;
  });

  it('shows Desktop unavailability and selects environment download for the update dialog', () => {
    const onInstallMethodChange = vi.fn();
    renderCard(host, {
      desktopTransferAvailable: false,
      installMethod: 'remote_download',
      onInstallMethodChange,
    });

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Update Browser Editor')?.click();

    const methodButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(methodButtons).toHaveLength(2);
    expect(methodButtons[0].disabled).toBe(true);
    expect(methodButtons[0].tabIndex).toBe(-1);
    expect(methodButtons[1].getAttribute('aria-checked')).toBe('true');
    expect(methodButtons[1].tabIndex).toBe(0);
    expect(host.textContent).toContain('Desktop transfer is unavailable because this session does not include the Desktop package bridge.');
    expect(onInstallMethodChange).toHaveBeenCalledWith('remote_download');
  });

  it('shows Retry setup after the last Browser Editor setup action failed', () => {
    renderCard(host, {
      status: makeStatus({
        operation: {
          state: 'failed',
          action: 'prepare_workspace_engine',
          last_error: 'Download failed.',
          log_tail: ['Download failed.'],
        },
      }),
    });

    expect(host.textContent).toContain('Retry setup');
    expect(host.textContent).toContain('Download failed.');
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[data-testid="browser-editor-setup-activity"]')?.getAttribute('data-layout')).toBe('compact');
    expect(Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === 'Retry setup')).toHaveLength(1);
  });

  it('locks the method and keeps one cancel action while Browser Editor setup is running', () => {
    renderCard(host, {
      status: makeStatus({
        operation: {
          state: 'running',
          action: 'prepare_workspace_engine',
          install_method: 'desktop_transfer',
          stage: 'receiving',
          log_tail: [],
        },
      }),
    });

    const methodButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(methodButtons).toHaveLength(2);
    expect(methodButtons.every((button) => button.disabled)).toBe(true);
    expect(Array.from(host.querySelectorAll('button')).filter((button) => button.textContent === 'Cancel')).toHaveLength(1);
    expect(host.textContent).not.toContain('Update Browser Editor');
  });

  it('uses the Runtime operation stage for the badge while the current editor stays usable', () => {
    renderCard(host, {
      status: makeStatus({
        operation: {
          operation_id: 'browser-editor:remote',
          state: 'running',
          action: 'prepare_workspace_engine',
          install_method: 'remote_download',
          stage: 'downloading',
          log_tail: [],
        },
      }),
      installMethod: 'remote_download',
    });

    expect(host.querySelector('[data-testid="settings-section-badge"]')?.textContent)
      .toBe('This environment is downloading the Browser Editor...');
    expect(host.querySelector('[data-testid="settings-section-badge"]')?.textContent).not.toBe('Ready');
  });

  it('shows local Desktop preparation failures before the runtime records an operation failure', () => {
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
      localPrepareFailure: browserEditorLocalFailureFromError(new BrowserEditorSetupError('desktop_release_lookup', 'Redeven Browser Editor catalog lookup failed with HTTP 503.'), 'desktop_transfer', () => 123),
    });

    expect(host.textContent).toContain('Browser Editor');
    expect(host.textContent).toContain('Setup failed');
    expect(host.textContent).toContain('Couldn’t check the latest Browser Editor.');
    expect(host.textContent).toContain('Redeven Browser Editor catalog lookup failed with HTTP 503.');
  });

  it('does not expose retry or cancel actions without Browser Editor management permission', () => {
    const onPrepare = vi.fn();
    const onCancel = vi.fn();
    renderCard(host, {
      canManage: false,
      onPrepare,
      onCancel,
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
      localPrepareFailure: browserEditorLocalFailureFromError(new BrowserEditorSetupError('desktop_release_lookup', 'Redeven Browser Editor catalog lookup failed with HTTP 503.'), 'desktop_transfer', () => 123),
    });

    expect(host.textContent).toContain('Setup failed');
    expect(host.textContent).not.toContain('Retry setup');
    expect(host.textContent).not.toContain('Cancel');
    expect(onPrepare).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
