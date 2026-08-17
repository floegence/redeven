// @vitest-environment jsdom

import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { PluginPlatformRequestError, PluginTransportError } from '@floegence/redevplugin-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExternalPluginInstallDialog } from './ExternalPluginInstallDialog';
import { ExternalPackageInspectionTerminalError } from './pluginApi';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  PluginExternalPackageSecuritySummary,
  PluginInventoryItem,
} from './pluginTypes';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: {
    open: boolean;
    title: string;
    description?: string;
    children: JSX.Element;
    footer?: JSX.Element;
    class?: string;
    onOpenChange: (open: boolean) => void;
  }) => props.open ? (
    <section role="dialog" aria-label={props.title} class={props.class}>
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
const confirmationDigest = packageHash;

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
  };
}

function committedResult(source: ExternalPluginInspection): ExternalPluginCommitResult {
  return {
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
      enable_state: 'enabled',
      policy_revision: 1,
      management_revision: 1,
      revoke_epoch: 0,
      manifest: {
        schema_version: 'redevplugin.manifest.v9',
        publisher: { publisher_id: source.publisher_id, display_name: 'Example Publisher' },
        plugin: {
          plugin_id: source.plugin_id,
          display_name: 'Example Toolbox',
          version: source.version,
        },
        api: { major: 1 },
        permissions: [],
        presentation: { locales: { default: 'en-US' } },
        surfaces: [],
        workers: [],
        methods: [],
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

function externalUpdateItem(
  source: ExternalPluginInspection = inspection(),
): PluginInventoryItem & { pluginInstanceID: string; managementRevision: number } {
  return {
    inventoryKey: 'instance:plugini_external_12345678',
    pluginID: source.plugin_id,
    pluginInstanceID: 'plugini_external_12345678',
    displayName: 'Example Toolbox',
    description: 'External plugin',
    iconFallback: 'generic',
    category: 'other',
    searchKeywords: [],
    publisher: 'Example Publisher',
    version: '1.2.3',
    managementRevision: 9,
    lifecycleState: 'disabled',
    trustBadge: 'unsigned',
    pinned: false,
    externalPackage: {
      signatureAssessment: source.signature_assessment,
      sourceProvenance: {
        kind: 'package_upload',
        upload_id: 'upload_previous_12345678',
        package_sha256: packageHash,
        resolved_at: '2026-07-23T10:00:00Z',
      },
      executionApproval: source.execution_approval,
      updateEligibility: source.update_eligibility,
      securitySummary: source.security_summary,
    },
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
  it('uses an opaque wide decision surface with a compact four-stage progress indicator', () => {
    renderDialog();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const progress = document.querySelector<HTMLOListElement>('ol')!;
    expect(dialog.className).toContain('max-w-[54rem]');
    expect(dialog.className).toContain('bg-background');
    expect(progress.children).toHaveLength(4);
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toContain('Plugin source');
    expect(progress.textContent).toContain('Review package');
    expect(progress.textContent).toContain('Install plugin');
    expect(progress.textContent).toContain('Ready');
    expect(progress.querySelectorAll('[data-install-progress-segment]')).toHaveLength(4);
    expect(document.querySelector('[data-install-progress-track]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-install-progress-track-active]')?.style.width).toBe('0%');
    expect(document.querySelector('[data-install-progress-current]')?.textContent).toBe('Plugin source');
    expect(document.querySelector('[data-install-progress]')?.textContent).toContain('Step 1 of 4');
  });

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

  it('requires a credential-free HTTPS package URL and a canonical GitHub repository URL', () => {
    renderDialog();
    const packageURL = inputWithPlaceholder('https://example.com/plugin.redevplugin');
    typeInto(packageURL, 'http://plugins.example.com/toolbox.redevplugin');
    packageURL.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(packageURL.getAttribute('aria-invalid')).toBe('true');
    expect(button('Review package').disabled).toBe(true);
    expect(document.body.textContent).toContain('Enter a valid HTTPS package URL');

    button('GitHub').click();
    const githubURL = inputWithPlaceholder('https://github.com/owner/repository');
    typeInto(githubURL, 'https://github.com/example/toolbox/releases');
    githubURL.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    expect(githubURL.getAttribute('aria-invalid')).toBe('true');
    expect(button('Review package').disabled).toBe(true);
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

  it.each([
    [
      new PluginPlatformRequestError(
        'PLUGIN_PACKAGE_INVALID',
        'Package at https://user:secret@plugins.example.com/bad.redevplugin?token=top-secret#fragment is invalid',
      ),
      'PLUGIN_PACKAGE_INVALID',
      'Use a valid, compatible ReDevPlugin package',
    ],
    [
      new PluginPlatformRequestError('PLUGIN_RELEASE_REF_POLICY_DENIED', 'This release source is blocked by policy'),
      'PLUGIN_RELEASE_REF_POLICY_DENIED',
      'conflicts with host trust policy',
    ],
    [
      new PluginTransportError('Plugin package request failed', new TypeError('offline')),
      undefined,
      'Check the network connection and source availability',
    ],
  ] as const)('preserves safe inspection error evidence and gives a recovery action', async (inspectionError, code, recovery) => {
    renderDialog({ onInspect: vi.fn(async () => { throw inspectionError; }) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    const copy = document.body.textContent ?? '';
    if (code) expect(copy).toContain(code);
    expect(copy).toContain(recovery);
    expect(copy).not.toContain('user:secret');
    expect(copy).not.toContain('top-secret');
    expect(copy).not.toContain('#fragment');
    const technicalDetails = document.querySelector<HTMLDetailsElement>('[role="alert"] details');
    expect(technicalDetails?.open).toBe(false);
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
    expect(document.querySelector('[data-external-plugin-selected-file]')?.textContent).toContain('toolbox.redevplugin');
    expect(document.querySelector('[data-external-plugin-selected-file]')?.textContent).toContain('7 B');

    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!;
    remove.click();
    expect(button('Review package').disabled).toBe(true);

    Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));

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
      expect(confirmation.closest('footer')).not.toBeNull();
      expect(confirmation.closest('[data-external-plugin-confirmation-region]')).not.toBeNull();
      expect(confirmation.closest('label')?.className).toContain('min-h-[46px]');
      confirmation.click();
      expect(install.disabled).toBe(false);

      install.click();
      await flush();
      expect(props.onCommit).toHaveBeenCalledWith(inspected, expect.any(AbortSignal));
    },
  );

  it('explains why exact-package confirmation is required without exposing approval jargon', async () => {
    const inspected = inspection('absent', 'pending');
    inspected.execution_approval.reason_codes = ['unsigned_package_requires_user_confirmation'];
    renderDialog({ onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');

    button('Review package').click();
    await flush();

    const trustReview = document.querySelector<HTMLElement>('[data-external-plugin-trust-review]')!;
    const confirmation = document.querySelector<HTMLElement>('[data-external-plugin-confirmation]')!;
    expect(trustReview.textContent).toContain('Confirm this package source');
    expect(trustReview.textContent).toContain('This package is unsigned');
    expect(trustReview.textContent).not.toContain('Update mode');
    expect(trustReview.textContent).not.toContain('Waiting for your approval');
    expect(trustReview.textContent).not.toContain('execution_approval=pending');
    expect(trustReview.textContent).not.toContain('unsigned_package_requires_user_confirmation');
    const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    expect(report.open).toBe(false);
    expect(report.textContent).toContain('execution_approval=pending');
    expect(report.textContent).toContain('unsigned_package_requires_user_confirmation');
    expect(report.textContent).toContain(inspected.inspection_id);
    expect(report.textContent).toContain(inspected.expires_at);
    expect(report.textContent).toContain('action=install');
    expect(document.activeElement).toBe(trustReview);
    expect(confirmation.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(confirmation.textContent).toContain('Confirm installation of this plugin package');
    expect(confirmation.textContent).toContain('grants allowed required permissions and enables the plugin');
    expect(confirmation.textContent).not.toContain(confirmationDigest);
    expect(report.textContent).toContain(confirmationDigest);
    button('Back').click();
    await flush();
    expect(document.activeElement).toBe(inputWithPlaceholder('https://example.com/plugin.redevplugin'));
  });

  it('keeps verified trust distinct from pending user approval', async () => {
    const inspected = inspection('verified', 'pending');
    renderDialog({ onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    const decision = document.querySelector<HTMLElement>('[data-external-plugin-trust-review]')!;
    expect(decision.textContent).toContain('Publisher identity verified');
    expect(decision.textContent).toContain('publisher signature is verified');
    expect(decision.textContent).not.toContain('Waiting for your approval');
    expect(button('Install plugin').disabled).toBe(true);
  });

  it.each(['pending', 'user_approved', 'policy_approved'] as const)(
    'requires exact-package confirmation when execution approval is %s',
    async (approvalState) => {
      const inspected = inspection('verified', approvalState);
      renderDialog({ onInspect: vi.fn(async () => inspected) });
      typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
      button('Review package').click();
      await flush();

      expect(document.querySelector('[data-external-plugin-confirmation]')).not.toBeNull();
      expect(button('Install plugin').disabled).toBe(true);
      const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
      expect(report.textContent).toContain(`execution_approval=${approvalState}`);
    },
  );

  it('presents one concise access-impact summary and keeps raw methods in the report', async () => {
    const inspected = inspection('absent');
    const method = (name: string, effect: 'read' | 'write' | 'execute' | 'delete' | 'admin', dangerous = false, preflightOnly = false) => ({
      method: name,
      route: { kind: 'capability' as const, binding_id: 'workspace-v1', target_method: name },
      effect,
      execution: 'sync' as const,
      dangerous,
      preflight_only: preflightOnly,
      required_permissions: [] as string[],
      confirmation: { mode: 'none' as const, request_hash_fields: [] as string[], plan_hash_required: false },
    });
    inspected.security_summary.permissions = [];
    inspected.security_summary.methods = [
      method('workspace.inspect', 'read', true),
      method('workspace.write', 'write'),
      method('workspace.run', 'execute', false, true),
      method('workspace.remove', 'delete'),
      method('workspace.admin', 'admin'),
      { ...method('workspace.future', 'admin'), effect: 'future_effect' as never },
    ];
    renderDialog({ onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    const summary = document.querySelector<HTMLElement>('[data-external-plugin-access-summary]')!;
    const operations = document.querySelector<HTMLElement>('[data-external-plugin-declared-operations]')!;
    for (const label of ['View information', 'Change content', 'Run actions', 'Delete content', 'Administrative control', 'Other high-attention operations']) {
      expect(operations.textContent).toContain(label);
    }
    expect(document.querySelector('[data-external-plugin-review-highlights]')?.textContent).toContain('1 operation needs extra attention');
    expect(operations.textContent).toContain('1 operation is limited to preflight checks');
    expect(summary.textContent).not.toContain('workspace.inspect');
    expect(summary.textContent).not.toContain('effect=');
    const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    expect(report.textContent).toContain('workspace.inspect');
    expect(report.textContent).toContain('effect=read');
    expect(report.textContent).toContain('workspace.future');
    expect(report.textContent).toContain('effect=future_effect');
  });

  it('distinguishes no declarations from standard declarations without claiming safety', async () => {
    renderDialog({ onInspect: vi.fn(async () => inspection('absent')) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/empty.redevplugin');
    button('Review package').click();
    await flush();
    expect(document.querySelector('[data-external-plugin-review-highlights]')?.textContent)
      .toContain('declares no plugin capabilities or access');

    dispose?.();
    document.body.innerHTML = '';
    const standard = inspection('absent');
    standard.security_summary.permissions = [{ permission_id: 'workspace.read', methods: ['workspace.list'], required: true, effects: ['read'] }];
    renderDialog({ onInspect: vi.fn(async () => standard) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/standard.redevplugin');
    button('Review package').click();
    await flush();
    const highlights = document.querySelector('[data-external-plugin-review-highlights]')?.textContent ?? '';
    expect(highlights).toContain('Protected access');
    expect(highlights).not.toContain('Workspace read');
    expect(highlights).not.toContain('Methods');
    expect(highlights).not.toContain('safe');
    expect(document.querySelector('[data-external-plugin-report]')?.textContent).toContain('workspace.read');
  });

  it('identifies standard added access by category before the full report', async () => {
    const previous = inspection('absent');
    const updateItem = externalUpdateItem(previous);
    const inspected = inspection('absent');
    inspected.intent = {
      action: 'update',
      plugin_instance_id: updateItem.pluginInstanceID,
      expected_management_revision: updateItem.managementRevision,
    };
    inspected.version = '1.2.4';
    inspected.security_summary.permissions = [{ permission_id: 'workspace.read', methods: ['workspace.list'], required: true, effects: ['read'] }];
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected) });

    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['new package'], 'toolbox-1.2.4.redevplugin');
    Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    button('Review package').click();
    await flush();

    const requestedPermissions = document.querySelector<HTMLElement>('[data-external-plugin-requested-permissions]')!;
    expect(requestedPermissions.textContent).toContain('Protected access');
    expect(requestedPermissions.textContent).not.toContain('Workspace read');
    expect(document.querySelector('[data-external-plugin-standard-changes]')?.textContent).toContain('Added');
    expect(document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')?.open).toBe(false);
  });

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
      permissions: [{ permission_id: 'workspace.read', methods: ['workspace.list'], required: true, effects: ['read'] }],
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
    const previousSummary: PluginExternalPackageSecuritySummary = {
      ...inspected.security_summary,
      permissions: [{ permission_id: 'workspace.write', methods: ['workspace.write'], required: true, effects: ['write'] }],
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
      category: 'other',
      searchKeywords: [],
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
    const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    const highlights = document.querySelector<HTMLElement>('[data-external-plugin-review-highlights]')!;
    expect(report.open).toBe(false);
    expect(report.querySelector('summary')?.textContent).toContain('3 changes');
    expect(highlights.textContent).toContain('Network rules');
    expect(highlights.textContent).toContain('api.github.com:443');
    expect(highlights.textContent).toContain('Changed');
    const declarations = document.querySelectorAll<HTMLDetailsElement>('[data-external-plugin-security-declarations] > details');
    expect(declarations.length).toBeGreaterThan(0);
    const declarationFor = (category: string) => [...declarations]
      .find((details) => details.querySelector('summary')?.textContent?.includes(category));
    expect(declarationFor('Permissions')?.open).toBe(true);
    expect(declarationFor('Network rules')?.open).toBe(true);
    expect(declarationFor('Storage')?.open).toBe(false);
  });

  it('explains declared capability purposes before collapsed technical evidence', async () => {
    const inspected = inspection('absent');
    inspected.security_summary = {
      ...inspected.security_summary,
      permissions: [{ permission_id: 'workspace.read', methods: ['workspace.list'], required: true, effects: ['read'] }],
      network: [{
        connector_id: 'github-api',
        transport: 'http',
        scope: 'user',
        destinations: ['api.github.com:443'],
        auth_declared: true,
        tls_declared: true,
        method_access: [{ method: 'github.repositories', operations: ['http'], http_methods: ['GET'] }],
      }],
    };
    renderDialog({ onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    const highlights = document.querySelector<HTMLElement>('[data-external-plugin-review-highlights]')!;
    expect(highlights.textContent).toContain('Network rules');
    expect(highlights.textContent).toContain('api.github.com:443');
    expect(highlights.textContent).toContain('Protected access');
    expect(highlights.textContent).not.toContain('Workspace read');
    const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    expect(report.open).toBe(false);
    expect(report.textContent).toContain('permissions the plugin may ask');
    expect(report.textContent).toContain('declared external destinations');
    expect(document.body.textContent).toContain('A fresh installation grants the required permissions allowed by Host policy');
    const permissionDisclosure = [...document.querySelectorAll<HTMLDetailsElement>('[data-external-plugin-security-declarations] > details')]
      .find((details) => details.querySelector('summary')?.textContent?.includes('Permissions'));
    expect(permissionDisclosure?.open).toBe(false);
    expect(permissionDisclosure?.querySelector('summary')?.textContent).not.toContain('workspace.read');
    expect(permissionDisclosure?.querySelector('code')?.textContent).toBe('workspace.read');
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

    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeNull();
    expect([...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Install plugin')).toBe(false);
    if (approvalState === 'policy_blocked') {
      expect(document.body.textContent).toContain('Blocked by environment policy');
      expect(document.body.textContent).toContain('enterprise_source_policy');
      const blockedDecision = document.querySelector<HTMLElement>('[role="alert"]')!;
      const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
      expect(blockedDecision.textContent).not.toContain('enterprise_source_policy');
      expect(report.open).toBe(false);
      expect(report.textContent).toContain('enterprise_source_policy');
    }
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('keeps the exact inspection and offers reconciliation after an unknown commit outcome', async () => {
    const inspected = inspection('absent');
    const committed = committedResult(inspected);
    const onCommit = vi.fn()
      .mockRejectedValueOnce(new Error('query transport unavailable'))
      .mockResolvedValueOnce(committed);
    const onOpenChange = vi.fn();
    renderDialog({ onInspect: vi.fn(async () => inspected), onCommit, onOpenChange });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Install plugin').click();
    await flush();

    expect(document.body.textContent).toContain('Installation status could not be confirmed');
    expect(document.body.textContent).toContain(confirmationDigest);
    expect([...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Back')).toBe(false);
    expect([...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Cancel')).toBe(false);
    (document.querySelector('[data-dialog-dismiss]') as HTMLButtonElement).click();
    expect(onOpenChange).not.toHaveBeenCalled();
    button('Retry').click();
    await flush();
    expect(onCommit).toHaveBeenNthCalledWith(2, inspected, expect.any(AbortSignal));
  });

  it('distinguishes a confirmed not-committed failure from an unknown outcome', async () => {
    const inspected = inspection('absent');
    const onCommit = vi.fn(async () => {
      throw new PluginTransportError('request was not sent', new TypeError('offline'), 'not_committed');
    });
    renderDialog({ onInspect: vi.fn(async () => inspected), onCommit });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Install plugin').click();
    await flush();

    expect(document.body.textContent).toContain('The plugin could not be installed');
    expect(document.body.textContent).not.toContain('Installation status could not be confirmed');
    expect(button('Install plugin')).toBeTruthy();
    expect([...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Retry')).toBe(false);
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
    expect([...document.querySelectorAll('button')]
      .some((candidate) => candidate.textContent?.trim() === 'Review required permissions')).toBe(false);
    expect(button('Close')).toBeTruthy();
  });

  it('keeps a committed install terminal when the inventory refresh callback fails', async () => {
    const inspected = inspection('absent');
    const committed = committedResult(inspected);
    const onCommit = vi.fn(async () => committed);
    const onCommitted = vi.fn()
      .mockRejectedValueOnce(new Error('inventory refresh failed'))
      .mockResolvedValueOnce(undefined);
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
    expect([...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Review required permissions')).toBe(false);
    button('Refresh plugins').click();
    await flush();
    expect(onCommitted).toHaveBeenNthCalledWith(2, committed);
    expect([...document.querySelectorAll('button')]
      .some((candidate) => candidate.textContent?.trim() === 'Review required permissions')).toBe(false);
    expect(button('Close')).toBeTruthy();
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
    const updateItem = externalUpdateItem();
    const inspectionBase = inspection('verified', 'user_approved');
    inspectionBase.signature_assessment.algorithm = 'ed25519';
    inspectionBase.signature_assessment.key_id = 'example-signing-key';
    inspectionBase.signature_assessment.assessment_epoch = '42';
    inspectionBase.execution_approval.approved_at = '2026-07-24T10:01:00Z';
    const nextInspection = {
      ...inspectionBase,
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
    const identity = document.querySelector<HTMLElement>('[data-external-plugin-identity]')!;
    const report = document.querySelector<HTMLDetailsElement>('[data-external-plugin-report]')!;
    const hashes = document.querySelector<HTMLElement>('[data-external-plugin-hashes]')!;
    expect(identity.textContent).not.toContain(packageHash);
    expect(report.open).toBe(false);
    expect(hashes.textContent).toContain(packageHash);
    expect(hashes.textContent).toContain(manifestHash);
    expect(hashes.textContent).toContain(entriesHash);
    expect(report.textContent).toContain('algorithm=ed25519');
    expect(report.textContent).toContain('key_id=example-signing-key');
    expect(report.textContent).toContain('assessment_epoch=42');
    expect(report.textContent).toContain('approved_at=2026-07-24T10:01:00Z');
  });

  it('uses update-specific copy for progress, unknown reconciliation, and completion', async () => {
    const updateItem = externalUpdateItem();
    const inspected = {
      ...inspection(),
      version: '1.2.4',
      intent: {
        action: 'update' as const,
        plugin_instance_id: updateItem.pluginInstanceID!,
        expected_management_revision: updateItem.managementRevision!,
      },
    };
    let resolveCommit!: (result: ExternalPluginCommitResult) => void;
    const onCommit = vi.fn()
      .mockRejectedValueOnce(new Error('query transport unavailable'))
      .mockImplementationOnce(() => new Promise<ExternalPluginCommitResult>((resolve) => { resolveCommit = resolve; }));
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected), onCommit });

    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { configurable: true, value: [new File(['update'], 'toolbox-1.2.4.redevplugin')] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    button('Review package').click();
    await flush();
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Update plugin').click();
    await flush();

    expect(document.body.textContent).toContain('Update status could not be confirmed');
    expect(document.body.textContent).not.toContain('Installation status could not be confirmed');
    button('Retry').click();
    await flush();
    expect(document.body.textContent).toContain('Completing update...');
    expect(document.body.textContent).not.toContain('Completing installation...');
    resolveCommit(committedResult(inspected));
    await flush();
    expect(document.body.textContent).toContain('Example Toolbox was updated');
    expect(document.body.textContent).not.toContain('Example Toolbox was installed');
  });

  it('reinstalls the exact package when version and package hash match', async () => {
    const updateItem = externalUpdateItem();
    const inspected = {
      ...inspection(),
      intent: {
        action: 'update' as const,
        plugin_instance_id: updateItem.pluginInstanceID,
        expected_management_revision: updateItem.managementRevision,
      },
    };
    const onCommit = vi.fn(async () => committedResult(inspected));
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected), onCommit });
    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { configurable: true, value: [new File(['same'], 'toolbox-1.2.3.redevplugin')] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    button('Review package').click();
    await flush();

    expect(document.querySelector('[data-external-plugin-identity]')?.textContent).toContain('This exact package is already installed; no update is needed · v1.2.3');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Reinstall Example Toolbox');
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Reinstall this version').click();
    await flush();
    expect(onCommit).toHaveBeenCalledWith(inspected, expect.any(AbortSignal));
  });

  it('warns when the same version resolves to different package content', async () => {
    const updateItem = externalUpdateItem();
    const differentHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const inspected = inspection();
    inspected.intent = {
      action: 'update',
      plugin_instance_id: updateItem.pluginInstanceID,
      expected_management_revision: updateItem.managementRevision,
    };
    inspected.inspected_hashes.package_sha256 = differentHash;
    inspected.source_provenance = { ...inspected.source_provenance, package_sha256: differentHash };
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected) });
    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { configurable: true, value: [new File(['different'], 'toolbox-1.2.3.redevplugin')] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    button('Review package').click();
    await flush();

    expect(document.querySelector('[data-external-plugin-identity]')?.textContent).toContain('Same version, different package · v1.2.3');
    expect(button('Replace with inspected package').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('latest version');
  });

  it('does not claim a package match when the installed hash is unavailable', async () => {
    const updateItem = { ...externalUpdateItem(), externalPackage: undefined };
    const inspected = inspection();
    inspected.intent = {
      action: 'update',
      plugin_instance_id: updateItem.pluginInstanceID,
      expected_management_revision: updateItem.managementRevision,
    };
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected) });
    typeInto(inputWithPlaceholder('https://example.com/plugin.redevplugin'), 'https://plugins.example.com/toolbox.redevplugin');
    button('Review package').click();
    await flush();

    expect(document.querySelector('[data-external-plugin-identity]')?.textContent).toContain('Same version, package match unknown · v1.2.3');
    expect(button('Install inspected package').disabled).toBe(true);
  });

  it('retains Host-managed enabled state and existing grants during update', async () => {
    const updateItem = { ...externalUpdateItem(), lifecycleState: 'enabled' as const };
    const inspected = inspection();
    inspected.version = '1.2.4';
    inspected.intent = {
      action: 'update',
      plugin_instance_id: updateItem.pluginInstanceID,
      expected_management_revision: updateItem.managementRevision,
    };
    const result = committedResult(inspected);
    result.plugin.enable_state = 'enabled';
    renderDialog({ updateItem, onInspect: vi.fn(async () => inspected), onCommit: vi.fn(async () => result) });
    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { configurable: true, value: [new File(['update'], 'toolbox-1.2.4.redevplugin')] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    button('Review package').click();
    await flush();

    const reviewFacts = document.querySelector<HTMLElement>('[data-external-plugin-install-outcome]')!;
    expect(reviewFacts.textContent).toContain('Current state retained');
    expect(reviewFacts.textContent).toContain('No new grants');
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    button('Update plugin').click();
    await flush();
    const completionFacts = document.querySelector<HTMLElement>('[data-external-plugin-install-outcome]')!;
    expect(completionFacts.textContent).toContain('Enabled');
    expect(completionFacts.textContent).not.toContain('Disabled');
    expect(completionFacts.textContent).toContain('No new grants');
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
      category: 'other',
      searchKeywords: [],
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
      category: 'other',
      searchKeywords: [],
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
