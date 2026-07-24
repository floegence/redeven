// @vitest-environment jsdom

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExternalPluginInstallDialog } from './ExternalPluginInstallDialog';
import { ExternalPackageInspectionTerminalError } from './pluginApi';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  PluginInventoryItem,
} from './pluginTypes';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: {
    open: boolean;
    title: string;
    description?: string;
    children: JSX.Element;
    footer?: JSX.Element;
    onOpenChange: (open: boolean) => void;
  }) => props.open ? (
    <section role="dialog" aria-label={props.title}>
      <button data-dialog-dismiss type="button" onClick={() => props.onOpenChange(false)}>Dismiss</button>
      <div>{props.description}</div>
      {props.children}
      <footer>{props.footer}</footer>
    </section>
  ) : null,
}));

const packageHash = 'sha256:8ecf6c0d206ee557c5528e2192b2594b5d097912b83028d43ff1336532b06d13';
const manifestHash = 'sha256:f96534ca709165d0e30f6e7713a57ec0754f84f84ccadc2edc000f19dde7cc3d';
const entriesHash = 'sha256:8a0048517719d934e52406dc6e9964d9ca165728d3e530d2c4df16f619bf17fa';
const confirmationDigest = 'sha256:684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function inspection(
  signatureState: ExternalPluginInspection['signature_assessment']['state'] = 'absent',
  approvalState: ExternalPluginInspection['execution_approval']['state'] = 'pending',
): ExternalPluginInspection {
  return {
    inspection_id: 'inspection_external_12345678',
    expires_at: '2026-07-24T12:00:00Z',
    intent: { action: 'install', plugin_instance_id: 'plugini_external_12345678' },
    publisher_id: 'com.example.publisher',
    plugin_id: 'com.example.toolbox',
    version: '1.2.3',
    inspected_hashes: {
      package_sha256: packageHash,
      manifest_sha256: manifestHash,
      entries_sha256: entriesHash,
    },
    signature_assessment: {
      state: signatureState,
      reason_codes: [],
      assessed_hashes: {
        package_sha256: packageHash,
        manifest_sha256: manifestHash,
        entries_sha256: entriesHash,
      },
      assessed_at: '2026-07-24T10:00:00Z',
    },
    source_provenance: {
      kind: 'package_url',
      source_origin: 'https://plugins.example.com',
      source_path: '/toolbox.redevplugin',
      redirect_chain: [],
      package_sha256: packageHash,
      resolved_at: '2026-07-24T10:00:00Z',
    },
    execution_approval: {
      state: approvalState,
      reason_codes: [],
      assessed_at: '2026-07-24T10:00:00Z',
    },
    update_eligibility: {
      state: signatureState === 'verified' ? 'automatic_eligible' : 'manual_only',
      reason_codes: [],
      assessed_at: '2026-07-24T10:00:00Z',
    },
    security_summary: {
      summary_sha256: 'sha256:9b30eca232030072294fcabdc98df492609672c92d2d04a545d5790119d1822b',
      permissions: [],
      methods: [],
      capability_contracts: [],
      workers: [],
      network: [],
      storage: [],
      secret_refs: [],
      core_actions: [],
      intents: [],
      surfaces: [],
    },
    confirmation_digest: confirmationDigest,
  };
}

function committedResult(source: ExternalPluginInspection): ExternalPluginCommitResult {
  return {
    status: 'committed',
    inspection_id: source.inspection_id,
    intent: source.intent,
    receipt: {
      commit_id: 'commit_external_12345678',
      inspection_id: source.inspection_id,
      package_sha256: packageHash,
      management_revision: 1,
      committed_at: '2026-07-24T10:01:00Z',
    },
    plugin: {
      plugin_instance_id: source.intent.plugin_instance_id,
      publisher_id: source.publisher_id,
      plugin_id: source.plugin_id,
      version: source.version,
      active_fingerprint: packageHash,
      package_hash: packageHash,
      manifest_hash: manifestHash,
      entries_hash: entriesHash,
      trust_state: 'unsigned_local',
      trust_assessment: {
        trust_state: 'unsigned_local',
        verified_hashes: source.inspected_hashes,
      },
      signature_assessment: source.signature_assessment,
      source_provenance: source.source_provenance,
      execution_approval: { ...source.execution_approval, state: 'user_approved' },
      update_eligibility: source.update_eligibility,
      security_summary: source.security_summary,
      enable_state: 'disabled',
      policy_revision: 1,
      management_revision: 1,
      revoke_epoch: 0,
      manifest: {
        schema_version: 'redevplugin.manifest.v5',
        publisher: { publisher_id: source.publisher_id, display_name: 'Example Publisher' },
        plugin: {
          plugin_id: source.plugin_id,
          display_name: 'Example Toolbox',
          version: source.version,
          api_version: 'plugin-v1',
          min_runtime_version: '0.6.9',
          ui_protocol_version: 'plugin-ui-v5',
        },
        surfaces: [],
      },
      package_entries: [],
      installed_at: '2026-07-24T10:01:00Z',
      updated_at: '2026-07-24T10:01:00Z',
    },
    signature_assessment: source.signature_assessment,
    source_provenance: source.source_provenance,
    execution_approval: { ...source.execution_approval, state: 'user_approved' },
    update_eligibility: source.update_eligibility,
    security_summary: source.security_summary,
  };
}

function renderDialog(overrides: Partial<Parameters<typeof ExternalPluginInstallDialog>[0]> = {}) {
  const mount = document.createElement('div');
  document.body.append(mount);
  const inspected = inspection();
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onInspect: vi.fn(async () => inspected),
    onCommit: vi.fn(async () => committedResult(inspected)),
    onCommitted: vi.fn(async () => undefined),
    ...overrides,
  };
  dispose = render(() => <ExternalPluginInstallDialog {...props} />, mount);
  return props;
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function inputWithPlaceholder(placeholder: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!found) throw new Error(`Input not found: ${placeholder}`);
  return found;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ExternalPluginInstallDialog', () => {
  it('provides roving keyboard navigation and labelled source tab panels', async () => {
    renderDialog();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await Promise.resolve();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].tabIndex).toBe(0);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1].id);
    expect(document.activeElement).toBe(tabs[1]);

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(tabs[2]);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('inspects an exact package URL before installation', async () => {
    const props = renderDialog();
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), ' https://plugins.example.com/toolbox.redevplugin ');

    button('Review package').click();
    await flush();

    expect(props.onInspect).toHaveBeenCalledWith({
      sourceKind: 'package_url',
      url: 'https://plugins.example.com/toolbox.redevplugin',
      intent: { action: 'install' },
    }, expect.any(AbortSignal));
  });

  it('inspects a GitHub repository with an optional exact release tag', async () => {
    const props = renderDialog();
    button('GitHub').click();
    typeInto(inputWithPlaceholder('https://github.com/owner/repository'), 'https://github.com/example/toolbox');
    typeInto(inputWithPlaceholder('Latest eligible release'), ' v1.2.3 ');

    button('Review package').click();
    await flush();

    expect(props.onInspect).toHaveBeenCalledWith({
      sourceKind: 'github_repository',
      url: 'https://github.com/example/toolbox',
      tag: 'v1.2.3',
      intent: { action: 'install' },
    }, expect.any(AbortSignal));
  });

  it('requires a selected local package and sends the exact File for inspection', async () => {
    const props = renderDialog();
    button('Plugin package').click();
    expect(button('Review package').disabled).toBe(true);

    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['package'], 'toolbox.redevplugin', { type: 'application/vnd.redevplugin.package+zip' });
    Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    expect(button('Review package').disabled).toBe(false);

    button('Review package').click();
    await flush();

    expect(props.onInspect).toHaveBeenCalledWith({
      sourceKind: 'package_upload',
      file,
      intent: { action: 'install' },
    }, expect.any(AbortSignal));
  });

  it.each(['absent', 'unknown_signer', 'unavailable'] as const)(
    'requires digest confirmation before committing an install with %s signature status',
    async (signatureState) => {
      const inspected = inspection(signatureState);
      const props = renderDialog({
        onInspect: vi.fn(async () => inspected),
        onCommit: vi.fn(async () => committedResult(inspected)),
      });
      typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
      button('Review package').click();
      await flush();

      const install = button('Install plugin');
      expect(install.disabled).toBe(true);
      expect(document.body.textContent).toContain(confirmationDigest);
      const confirmation = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(confirmation.disabled).toBe(false);
      confirmation.click();
      expect(install.disabled).toBe(false);

      install.click();
      await flush();
      expect(props.onCommit).toHaveBeenCalledWith(inspected, expect.any(AbortSignal));
    },
  );

  it('discloses every security declaration and highlights update deltas before confirmation', async () => {
    const inspected = inspection('absent');
    inspected.source_provenance = {
      kind: 'package_url',
      source_origin: 'https://plugins.example.com',
      source_path: '/toolbox.redevplugin',
      redirect_chain: [
        { origin: 'https://downloads.example.com', path: '/releases/toolbox.redevplugin' },
      ],
      package_sha256: packageHash,
      resolved_at: '2026-07-24T10:00:00Z',
    };
    inspected.security_summary = {
      summary_sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      permissions: [{ permission_id: 'workspace.read', methods: ['workspace.list'] }],
      methods: [{
        method: 'workspace.list',
        route: { kind: 'capability', binding_id: 'workspace-v1', target_method: 'files.list' },
        effect: 'read',
        execution: 'sync',
        dangerous: false,
        preflight_only: false,
        required_permissions: ['workspace.read'],
        confirmation: { mode: 'none', request_hash_fields: [], plan_hash_required: false },
      }],
      capability_contracts: [{
        binding_id: 'workspace-v1',
        capability_id: 'redeven.workspace',
        capability_version: '1.0.0',
        contract_sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }],
      workers: [{
        worker_id: 'indexer',
        artifact: 'workers/indexer.wasm',
        abi: 'redevplugin-wasm-worker-v2',
        mode: 'job',
        scope: 'environment',
        memory_limit_bytes: 67108864,
        idle_timeout_ms: 30000,
      }],
      network: [{
        connector_id: 'github-api',
        transport: 'http',
        scope: 'user',
        destinations: ['api.github.com:443'],
        auth_declared: true,
        tls_declared: true,
        method_access: [{ method: 'github.repositories', operations: ['http'], http_methods: ['GET'] }],
      }],
      storage: [{
        store_id: 'index',
        kind: 'sqlite',
        scope: 'environment',
        quota_bytes: 10485760,
        schema_version: 2,
        method_access: [{ method: 'workspace.list', operations: ['query'] }],
      }],
      secret_refs: [{ setting_key: 'github_token', secret_ref: 'github.token', scope: 'user' }],
      core_actions: [{ method: 'shell.open', action_id: 'redeven.shell.open', effect: 'execute' }],
      intents: [{ intent_id: 'open-repository', method: 'workspace.list' }],
      surfaces: [{
        surface_id: 'toolbox.main',
        kind: 'view',
        intent: 'primary',
        label: 'Toolbox',
        entry: 'ui/index.html',
        default_size: { width: 960, height: 640 },
      }],
    };
    const previousSummary = {
      ...inspected.security_summary,
      permissions: [{ permission_id: 'workspace.write', methods: ['workspace.write'] }],
      network: [{
        ...inspected.security_summary.network[0],
        destinations: ['legacy.example.com:443'],
      }],
    };
    const updateItem = {
      inventoryKey: 'instance:plugini_external_12345678',
      pluginID: inspected.plugin_id,
      pluginInstanceID: 'plugini_external_12345678',
      displayName: 'Example Toolbox',
      description: 'External plugin',
      iconFallback: 'generic',
      publisher: 'Example Publisher',
      version: '1.2.2',
      managementRevision: 9,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      pinned: false,
      externalPackage: {
        signatureAssessment: inspected.signature_assessment,
        sourceProvenance: inspected.source_provenance,
        executionApproval: inspected.execution_approval,
        updateEligibility: inspected.update_eligibility,
        securitySummary: previousSummary,
      },
    } satisfies PluginInventoryItem;
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    const copy = document.body.textContent ?? '';
    for (const expected of [
      'workspace.read',
      'route=kind=capability; binding_id=workspace-v1; target_method=files.list',
      'redeven.workspace@1.0.0',
      'workers/indexer.wasm',
      'api.github.com:443',
      'quota_bytes=10485760',
      'github.token',
      'redeven.shell.open',
      'open-repository',
      'toolbox.main',
      'workspace.write',
      'legacy.example.com:443',
      'https://plugins.example.com/toolbox.redevplugin',
      'https://downloads.example.com/releases/toolbox.redevplugin',
      inspected.security_summary.summary_sha256,
    ]) {
      expect(copy).toContain(expected);
    }
    expect(copy).toContain('This update changes the plugin\'s declared access');
    expect(copy).toContain('Added');
    expect(copy).toContain('Changed');
    expect(copy).toContain('Removed');
    expect(copy).toContain('Previous');
  });

  it.each([
    ['invalid', 'pending'],
    ['revoked', 'pending'],
    ['absent', 'policy_blocked'],
  ] as const)('blocks commit for signature %s and approval %s', async (signatureState, approvalState) => {
    const inspected = inspection(signatureState, approvalState);
    if (approvalState === 'policy_blocked') {
      inspected.execution_approval.reason_codes = ['enterprise_source_policy'];
    }
    const props = renderDialog({ onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    const confirmation = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(confirmation.disabled).toBe(true);
    expect(button('Install plugin').disabled).toBe(true);
    if (approvalState === 'policy_blocked') {
      expect(document.body.textContent).toContain('Managed by policy');
      expect(document.body.textContent).toContain('enterprise_source_policy');
    }
    confirmation.click();
    button('Install plugin').click();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('cannot close during commit and refreshes inventory after a successful result', async () => {
    const inspected = inspection('absent');
    let resolveCommit!: (result: ExternalPluginCommitResult) => void;
    const onCommit = vi.fn(() => new Promise<ExternalPluginCommitResult>((resolve) => { resolveCommit = resolve; }));
    const onOpenChange = vi.fn();
    const onCommitted = vi.fn(async () => undefined);
    renderDialog({ onInspect: vi.fn(async () => inspected), onCommit, onOpenChange, onCommitted });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Install plugin').click();
    await flush();

    (document.querySelector('[data-dialog-dismiss]') as HTMLButtonElement).click();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Completing installation...');

    const result = committedResult(inspected);
    resolveCommit(result);
    await flush();
    expect(onCommitted).toHaveBeenCalledWith(result);
    expect(document.body.textContent).toContain('Example Toolbox was installed');
  });

  it('keeps a committed install terminal when the inventory refresh callback fails', async () => {
    const inspected = inspection('absent');
    const committed = committedResult(inspected);
    const onCommit = vi.fn(async () => committed);
    const onCommitted = vi.fn(async () => {
      throw new Error('inventory refresh failed');
    });
    renderDialog({ onInspect: vi.fn(async () => inspected), onCommit, onCommitted });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Install plugin').click();
    await flush();

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledWith(committed);
    expect(document.body.textContent).toContain('Example Toolbox was installed');
    expect(document.body.textContent).toContain('Installation completed, but the plugin list could not be refreshed');
    expect([...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Install plugin')).toBe(false);
  });

  it('requires a fresh inspection after the current inspection reaches failed terminal state', async () => {
    const inspected = inspection('absent');
    const onCommit = vi.fn(async () => {
      throw new ExternalPackageInspectionTerminalError('inspect again');
    });
    renderDialog({ onInspect: vi.fn(async () => inspected), onCommit });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Install plugin').click();
    await flush();

    expect(onCommit).toHaveBeenCalledOnce();
    expect(button('Review package').disabled).toBe(false);
    expect([...document.querySelectorAll('button')]
      .some((candidate) => candidate.textContent?.trim() === 'Install plugin')).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeNull();
  });

  it('starts an upload update from a fresh file selection and inspection bound to the installed revision', async () => {
    const updateItem = {
      inventoryKey: 'instance:plugini_external_12345678',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugini_external_12345678',
      displayName: 'Example Toolbox',
      description: 'External plugin',
      iconFallback: 'generic',
      publisher: 'Example Publisher',
      version: '1.2.3',
      managementRevision: 9,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      pinned: false,
      externalPackage: {
        signatureAssessment: inspection().signature_assessment,
        sourceProvenance: {
          kind: 'package_upload',
          upload_id: 'upload_previous_12345678',
          package_sha256: packageHash,
          resolved_at: '2026-07-23T10:00:00Z',
        },
        executionApproval: inspection().execution_approval,
        updateEligibility: inspection().update_eligibility,
        securitySummary: inspection().security_summary,
      },
    } satisfies PluginInventoryItem;
    const nextInspection = {
      ...inspection(),
      intent: {
        action: 'update' as const,
        plugin_instance_id: updateItem.pluginInstanceID,
        expected_management_revision: updateItem.managementRevision,
      },
    };
    const props = renderDialog({
      updateItem,
      onInspect: vi.fn(async () => nextInspection),
    });

    expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.files).toHaveLength(0);
    expect(button('Review package').disabled).toBe(true);
    expect(document.body.textContent).not.toContain(confirmationDigest);

    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['new package'], 'toolbox-1.2.4.redevplugin');
    Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    button('Review package').click();
    await flush();

    expect(props.onInspect).toHaveBeenCalledWith({
      sourceKind: 'package_upload',
      file,
      intent: {
        action: 'update',
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
    }, expect.any(AbortSignal));
    expect(document.body.textContent).toContain(confirmationDigest);
  });

  it('checks the latest eligible GitHub release instead of pinning the previously resolved tag', async () => {
    const inspected = inspection();
    const updateItem = {
      inventoryKey: 'instance:plugini_external_12345678',
      pluginID: inspected.plugin_id,
      pluginInstanceID: 'plugini_external_12345678',
      displayName: 'Example Toolbox',
      description: 'External plugin',
      iconFallback: 'generic',
      publisher: 'Example Publisher',
      version: '1.2.3',
      managementRevision: 9,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      pinned: false,
      externalPackage: {
        signatureAssessment: inspected.signature_assessment,
        sourceProvenance: {
          kind: 'github_repository' as const,
          repository_id: '123',
          release_id: '456',
          asset_id: '789',
          repository_url: 'https://github.com/example/toolbox',
          owner: 'example',
          repository: 'toolbox',
          resolved_commit_sha: '0123456789abcdef0123456789abcdef01234567',
          release_tag: 'v1.2.3',
          asset_name: 'toolbox.redevplugin',
          package_sha256: packageHash,
          resolved_at: '2026-07-24T10:00:00Z',
        },
        executionApproval: inspected.execution_approval,
        updateEligibility: inspected.update_eligibility,
        securitySummary: inspected.security_summary,
      },
    } satisfies PluginInventoryItem;
    const props = renderDialog({ updateItem });

    expect(inputWithPlaceholder('https://github.com/owner/repository').value).toBe('https://github.com/example/toolbox');
    expect(inputWithPlaceholder('Latest eligible release').value).toBe('');
    button('Review package').click();
    await flush();
    expect(props.onInspect).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'github_repository',
      url: 'https://github.com/example/toolbox',
      tag: undefined,
    }), expect.any(AbortSignal));
  });

  it('requires the package URL again because stored provenance has no query string', () => {
    const inspected = inspection();
    const updateItem = {
      inventoryKey: 'instance:plugini_external_12345678',
      pluginID: inspected.plugin_id,
      pluginInstanceID: 'plugini_external_12345678',
      displayName: 'Example Toolbox',
      description: 'External plugin',
      iconFallback: 'generic',
      publisher: 'Example Publisher',
      version: '1.2.3',
      managementRevision: 9,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      pinned: false,
      externalPackage: {
        signatureAssessment: inspected.signature_assessment,
        sourceProvenance: {
          kind: 'package_url' as const,
          source_origin: 'https://plugins.example.com',
          source_path: '/toolbox.redevplugin',
          redirect_chain: [],
          package_sha256: packageHash,
          resolved_at: '2026-07-24T10:00:00Z',
        },
        executionApproval: inspected.execution_approval,
        updateEligibility: inspected.update_eligibility,
        securitySummary: inspected.security_summary,
      },
    } satisfies PluginInventoryItem;

    renderDialog({ updateItem });

    expect(inputWithPlaceholder('https://example.com/plugin.redevplugin').value).toBe('');
    expect(button('Review package').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('version=1.2.4');
  });
});
