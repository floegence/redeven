import { createSignal } from 'solid-js';
import type { EnvSettingsSection } from '../../../src/ui/pages/EnvContext';
import type { EnvSettingsPageContextValue } from '../../../src/ui/pages/settings/EnvSettingsPageContext';
import type { AgentSettingsResponse, SkillCatalogEntry } from '../../../src/ui/pages/settings/types';

// Acceptance-only data. Production entrypoints never import this module.
export function createRuntimeSettingsFixture() {
  const [activeSection, setActiveSection] = createSignal<EnvSettingsSection>('config');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [canAdmin, setCanAdmin] = createSignal(true);
  const [debugConsoleEnabled, setDebugConsoleEnabled] = createSignal(false);
  const [targetVersionInput, setTargetVersionInput] = createSignal('v1.2.4');
  const [installMethod, setInstallMethod] = createSignal<'desktop_transfer' | 'remote_download'>('remote_download');
  const [settings, setSettings] = createSignal<AgentSettingsResponse>({
    config_path: '/Users/alex/.redeven/config.json',
    connection: { controlplane_base_url: 'https://cloud.example.com', environment_id: 'env_design_workspace', agent_instance_id: 'runtime_macos_arm64', direct: { artifact_provisioned: true, expires_at_unix_s: 1893456000 } },
    runtime: { agent_home_dir: '/Users/alex/workspace', shell: '/bin/zsh' },
    logging: { log_format: 'json', log_level: 'info' },
    codespaces: { code_server_port_min: 20000, code_server_port_max: 21000 },
    permission_policy: { schema_version: 1, local_max: { read: true, write: true, execute: true }, by_user: { 'user_design_reviewer': { read: true, write: false, execute: false } }, by_app: {} },
    ai: { current_model_id: 'openai/gpt-5.4', permission_type: 'approval_required', providers: [{ id: 'openai', name: 'OpenAI', type: 'openai', base_url: '', models: [{ model_name: 'gpt-5.4', context_window: 1047576, max_output_tokens: 32768, input_modalities: ['text', 'image'] }] }] },
    ai_secrets: { provider_api_key_set: { openai: true }, web_search_provider_api_key_set: {} },
  });
  const [skills, setSkills] = createSignal<SkillCatalogEntry[]>([{ id: 'review', name: 'code-review', description: 'Review a change for correctness, maintainability, and clear intent.', path: '/Users/alex/.redeven/skills/code-review', scope: 'user', enabled: true, effective: true }]);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const saveSettings = async (patch: Record<string, unknown>) => {
    const allowed = ['agent_home_dir', 'shell', 'filesystem_scope', 'log_format', 'log_level', 'code_server_port_min', 'code_server_port_max', 'permission_policy'];
    if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('Settings API rejects unknown fields');
    requests.push({ url: '/_redeven_proxy/api/settings', init: { method: 'PUT', body: JSON.stringify(patch) } });
    if (saveError()) throw new Error(saveError()!);
    setSettings((current) => ({ ...current,
      runtime: { ...current.runtime, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['agent_home_dir', 'shell', 'filesystem_scope'].includes(key))) },
      logging: { ...current.logging, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['log_format', 'log_level'].includes(key))) },
      codespaces: { ...current.codespaces, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['code_server_port_min', 'code_server_port_max'].includes(key))) },
      ...('permission_policy' in patch ? { permission_policy: patch.permission_policy as AgentSettingsResponse['permission_policy'] } : {}),
    }));
    return { settings: settings() };
  };
  const ready = { state: 'ready' as const, reason_code: '' as const, retryable: false, safe_to_retry: false };
  const [readinessSnapshot, setReadinessSnapshot] = createSignal<import('../../../src/ui/flower/aiReadiness').AIReadinessSnapshot>(ready);
  const readiness = { snapshot: readinessSnapshot, loading: () => false, retryPending: () => false, busyStartedAt: () => null, startupElapsedMs: () => null, longStartupReadySequence: () => 0, refresh: async () => ready, retry: async () => ready, pause() {}, resume: async () => ready, dispose() {} };
  const noop = () => undefined;
  const context = {
    activeSection, setActiveSection, searchQuery, setSearchQuery, canAdmin, canInteract: () => true,
    env: { settingsOrigin: () => null, returnFromSettingsOrigin: noop, aiReadinessController: readiness, env_id: () => 'env_design_workspace', env: () => ({ namespace_public_id: 'workspace' }), debugConsoleEnabled, setDebugConsoleEnabled, bumpSettingsSeq: noop },
    protocol: { status: () => 'connected' }, notify: { success: noop, error: noop, info: noop },
    runtimeUpdate: { version: { currentVersion: () => 'v1.2.3' } },
    settings: Object.assign(settings, { loading: false, error: null, state: 'ready' }),
    mutateSettings: setSettings, saveSettings, refreshSettings: async () => undefined,
    saveDefaultAIPermission: async (permission_type: 'readonly' | 'approval_required' | 'full_access') => { setSettings((current) => ({ ...current, ai: { ...current.ai!, permission_type } })); return { settings: settings() }; },
    codeRuntimeStatus: Object.assign(() => ({ active_runtime: { present: true, detection_state: 'ready', source: 'managed', version: '4.109.1', binary_path: '/Users/alex/.redeven/code-server/bin/code-server' }, managed_runtime: { present: true, detection_state: 'ready', source: 'managed', version: '4.109.1' }, managed_prefix: '/Users/alex/.redeven/apps/code', installed_versions: [{ version: '4.109.1', selected_by_local_environment: true, removable: false, detection_state: 'ready' }], operation: { state: 'idle', log_tail: [] } }), { loading: false, error: null, state: 'ready' }),
    refreshCodeRuntimeStatus: noop, codeRuntimeInstallMethod: installMethod, setCodeRuntimeInstallMethod: setInstallMethod, desktopCodeRuntimeTransferAvailable: () => true,
    latestVersion: () => ({ latest_version: 'v1.2.4', manifest_etag: 'release-2026-09' }), latestVersionLoading: () => false, latestVersionError: () => null,
    maintenanceContext: () => ({ authority: 'runtime_rpc' }), upgradeState: () => ({ allowsUpgradeAction: true, requiresTargetVersion: true, actionLabel: 'Update Redeven', policy: 'self_upgrade' }), displayedStatus: () => 'online', maintenanceStage: () => '', maintenanceError: () => null, maintaining: () => false, isUpgrading: () => false, isRestarting: () => false,
    runtimeService: () => ({ compatibility: 'compatible', protocolVersion: 1, activeWorkload: { terminalCount: 2, sessionCount: 1, taskCount: 0, portForwardCount: 0 } }), activeWorkSummary: () => '2 terminals, 1 session', runtimeDesktopModelSourceBinding: () => null, statusLabel: () => 'Online', targetVersionInput, setTargetVersionInput, targetUpgradeVersion: targetVersionInput, targetUpgradeVersionValid: () => true, canStartRestart: canAdmin, canStartUpgrade: canAdmin, startRestart: async () => undefined, startUpgrade: async () => undefined, refreshSettingsPage: async () => undefined,
    codeRuntimeActionLoading: () => false, codeRuntimeCancelLoading: () => false, codeRuntimeSelectionLoadingVersion: () => null, codeRuntimeRemoveVersionLoading: () => null, codeRuntimeLocalPrepareFailure: () => null, codeRuntimeLocalPrepareCancelled: () => false, codeRuntimePrepareProgress: () => null, canManageCodeRuntime: canAdmin, prepareManagedCodeRuntime: noop, cancelManagedCodeRuntimeOperation: noop, selectManagedCodeRuntimeVersion: noop, removeManagedCodeRuntimeVersion: noop, showLoadingCurtain: noop, hideLoadingCurtain: noop,
  } as unknown as EnvSettingsPageContextValue;
  const request = async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/skills/sources')) return { items: [{ skill_path: skills()[0]?.path, source_type: 'github_import', source_id: 'example/skills#code-review' }] };
    if (url.endsWith('/skills/toggles')) setSkills((current) => current.map((skill) => ({ ...skill, enabled: body.patches[0].enabled })));
    if (url.endsWith('/skills') && init.method === 'POST') setSkills((current) => [...current, { ...body, id: body.name, path: `/Users/alex/.redeven/skills/${body.name}`, enabled: true, effective: true }]);
    if (url.endsWith('/skills') && init.method === 'DELETE') setSkills((current) => current.filter((skill) => skill.name !== body.name));
    if (url.endsWith('/skills') || url.endsWith('/skills/reload') || url.endsWith('/skills/toggles')) return { catalog_version: requests.length, skills: skills() };
    if (url.includes('/browse/tree')) return { root: skills()[0]?.path, dir: '.', entries: [{ name: 'SKILL.md', path: 'SKILL.md', is_dir: false }] };
    if (url.includes('/browse/file')) return { root: skills()[0]?.path, file: 'SKILL.md', encoding: 'utf8', truncated: false, content: '# Code review\n\nReview correctness and maintainability.' };
    if (url.includes('/import/github/validate')) return { resolved: [{ name: 'new-skill', target_dir: '/Users/alex/.redeven/skills/new-skill' }] };
    if (url.includes('/import/github') || url.endsWith('/skills/reinstall')) return { catalog: { catalog_version: requests.length, skills: skills() } };
    if (url.endsWith('/maintenance/snapshots')) return { snapshots: [] };
    if (url.endsWith('/ai/models')) return { models: [{ id: 'openai/gpt-5.4', web_search: { status: 'available' } }] };
    if (url.endsWith('/model_catalog')) return { models: settings().ai?.providers?.[0]?.models ?? [] };
    if (url.endsWith('/provider_bundle')) { setSettings((current) => ({ ...current, ai: { ...current.ai!, ...body.model_profile } })); return { settings: settings() }; }
    if (url.endsWith('/current_model')) return {};
    throw new Error(`Unmapped acceptance request: ${url}`);
  };
  return { context, request, requests, setActiveSection, setCanAdmin, setReadinessSnapshot, setSaveError, settings };
}
