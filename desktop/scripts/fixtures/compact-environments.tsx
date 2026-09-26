import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from '../../src/welcome/App';
import { buildDesktopSettingsSurfaceSnapshot } from '../../src/main/settingsPageContent';
import { desktopRuntimeLifecycleLocation, runtimeLifecycleProgress, type DesktopRuntimeLifecycleOperation, type DesktopRuntimeLifecyclePhase } from '../../src/shared/desktopRuntimeLifecycleProgress';
import { advanceOpenConnectionTiming, desktopOpenConnectionLocation, openConnectionPhaseSequence, openConnectionProgress, type DesktopOpenConnectionLocation } from '../../src/shared/desktopOpenConnectionProgress';
import { launcherOperationInterruptionPresentation } from '../../src/shared/launcherOperationInterruptionPresentation';
import { REDEVEN_SUPPORTED_LOCALES, REDEVEN_LOCALE_META, type RedevenLocalePreference } from '../../src/shared/i18n/localeMeta';
import { resolveRedevenLanguageSnapshot, type RedevenLanguageSnapshot } from '../../src/shared/i18n/desktopLanguage';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionRequest, DesktopLauncherActionResult, DesktopEnvironmentEntry, DesktopLauncherActionProgress, DesktopLauncherActionOutcome, DesktopLauncherOperationStatus } from '../../src/shared/desktopLauncherIPC';
import fixtureData from '../../dist/compact-preview-fixtures.json';
import '../../src/welcome/index.css';
import './compact-environments.css';

// Chinese labels intentionally exercise the requested localized design. This
// toolbar belongs to the preview harness, not to the Desktop product surface.
const inventories = fixtureData as unknown as Record<'daily' | 'coverage' | 'states' | 'linkedError', DesktopWelcomeSnapshot>;
const [language, setLanguage] = createSignal(resolveRedevenLanguageSnapshot('zh-CN'));
const languageListeners = new Set<(snapshot: RedevenLanguageSnapshot) => void>();
const languageBridge = {
  getSnapshot: language,
  setPreference(preference: RedevenLocalePreference) {
    const next = resolveRedevenLanguageSnapshot(preference, navigator.languages);
    document.documentElement.lang = next.resolved_locale;
    document.documentElement.dir = REDEVEN_LOCALE_META[next.resolved_locale].direction;
    setLanguage(next); languageListeners.forEach(listener => listener(next)); return next;
  },
  subscribe(listener: (snapshot: RedevenLanguageSnapshot) => void) { languageListeners.add(listener); return () => languageListeners.delete(listener); },
};
Object.assign(window, { redevenDesktopLanguage: languageBridge });
document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
let snapshot = structuredClone(inventories.daily);
let receive: ((s: DesktopWelcomeSnapshot) => void) | undefined;
let revision = 0;
const pending = new Map<string, { cancel: () => void; reset: () => void; finish: () => void }>();
const [pendingCount, setPendingCount] = createSignal(0);
const requests: DesktopLauncherActionRequest[] = [];
const [notice, setNotice] = createSignal('真实产品组件 · 示例数据 · 不连接真实环境');
const [scenario, setScenario] = createSignal('daily');
const [result, setResult] = createSignal('succeeded');
const drafts = new Map<string, import('../../src/shared/settingsIPC').DesktopSettingsDraft>();
const publish = () => { snapshot = { ...snapshot, snapshot_revision: ++revision }; receive?.(structuredClone(snapshot)); };
const editEntry = (id: string, patch: Partial<DesktopEnvironmentEntry>) => {
  snapshot = { ...snapshot, environments: snapshot.environments.map(e => e.id === id ? { ...e, ...patch } : e) }; publish();
};
function setRunning(id: string, running: boolean) {
  const e = snapshot.environments.find(e => e.id === id)!;
  editEntry(id, { runtime_health: { ...e.runtime_health, status: running ? 'online' : 'offline', freshness: 'fresh', offline_reason_code: running ? undefined : 'not_started', checked_at_unix_ms: Date.now() },
    runtime_started_at_unix_ms: running ? Date.now() : undefined, local_environment_runtime_state: running ? 'running' : 'not_running',
    local_ui_url: running ? 'http://localhost:23998/' : '', local_ui_urls: running ? ['http://localhost:23998/'] : [], runtime_maintenance: undefined,
    runtime_operations: { ...e.runtime_operations, open: { ...e.runtime_operations.open, availability: running ? 'available' : 'blocked' },
      start: { ...e.runtime_operations.start, availability: 'available' }, stop: { ...e.runtime_operations.stop, availability: running ? 'available' : 'hidden' },
      restart: { ...e.runtime_operations.restart, availability: running ? 'available' : 'hidden' } },
  });
}

// Simulate the main-process timeline, leaving all painting and interaction to
// the shipped components. Each attempt owns its timers and progress identity.
function simulateOperation(input: {
  request: DesktopLauncherActionRequest;
  environment: DesktopEnvironmentEntry;
  stageCount: number;
  progress: (status: DesktopLauncherOperationStatus, stage: number, previous?: DesktopLauncherActionProgress) => Partial<DesktopLauncherActionProgress>;
  outcome: DesktopLauncherActionOutcome;
  onSuccess: () => void;
}): Promise<DesktopLauncherActionResult> {
  const { request, environment } = input;
  const started = 'operation_started_at_unix_ms' in request ? request.operation_started_at_unix_ms ?? Date.now() : Date.now();
  const key = ('operation_key' in request ? request.operation_key : undefined) ?? `preview:${environment.id}:${started}`;
  const selectedResult = result();
  let stage = 0;
  let progress: DesktopLauncherActionProgress | undefined;
  let canceling = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const later = (callback: () => void, delay: number) => { timers.add(setTimeout(callback, delay)); };
  return new Promise(resolve => {
    const update = (status: DesktopLauncherOperationStatus) => {
      const interruption = launcherOperationInterruptionPresentation(request.kind);
      progress = {
        action: request.kind, environment_id: environment.id, environment_label: environment.label,
        operation_key: key, started_at_unix_ms: started, updated_at_unix_ms: Date.now(), status,
        phase: '', title: '', detail: '', cancelable: status === 'running',
        ...input.progress(status, stage, progress),
        ...(status === 'canceling' || status === 'cleanup_running' ? {
          phase: interruption.cancelingPhase,
          title_key: status === 'cleanup_running' ? 'progress.cleaningUp' as const : interruption.cancelingTitleKey,
          detail_key: interruption.cancelingDetailKey,
        } : {}),
        ...(status === 'canceled' ? { title_key: 'progress.canceled' as const, detail_key: 'progress.detailStartupCanceled' as const } : {}),
        ...(status === 'failed' ? { title_key: 'progress.operationFailedTitle' as const, detail_key: 'progress.operationFailedSummary' as const } : {}),
        ...(status === 'failed' ? { next_actions: [{ kind: 'retry' as const, operation_key: key, label: 'Retry', label_key: 'common.retry' as const, retry_action: request }] } : {}),
      };
      snapshot = { ...snapshot, action_progress: [...snapshot.action_progress.filter(item => item.operation_key !== key && item.environment_id !== environment.id), progress] };
      publish();
    };
    const settle = (status: 'succeeded' | 'failed' | 'canceled', reset = false) => {
      clearTimers();
      pending.delete(key); setPendingCount(pending.size);
      if (!reset) {
        if (status === 'succeeded') stage = input.stageCount - 1;
        update(status);
        if (status === 'succeeded') input.onSuccess();
      }
      resolve(status === 'failed'
        ? { ok: false, code: 'action_invalid', scope: 'environment', message: 'Simulated connection failure.', operation_key: key }
        : { ok: true, outcome: status === 'canceled' ? 'canceled_launcher_operation' : input.outcome, operation_key: key, operation_started_at_unix_ms: started });
    };
    const finish = () => { if (!canceling) settle(selectedResult === 'failed' ? 'failed' : 'succeeded'); };
    pending.set(key, {
      finish,
      reset: () => settle('canceled', true),
      cancel: () => {
        if (canceling) return;
        canceling = true; clearTimers(); update('canceling');
        if (progress?.open_progress) later(() => update('cleanup_running'), 1000);
        later(() => settle('canceled'), 2200);
      },
    });
    setPendingCount(pending.size); update('running');
    for (let next = 1; next < input.stageCount - 1; next++) {
      later(() => { stage = next; update('running'); }, next * 4500 / Math.max(1, input.stageCount - 2));
    }
    if (selectedResult !== 'hold') later(finish, 6000);
  });
}

function simulateLifecycle(request: DesktopLauncherActionRequest, e: DesktopEnvironmentEntry, operation: DesktopRuntimeLifecycleOperation) {
  const phases: Record<DesktopRuntimeLifecycleOperation, DesktopRuntimeLifecyclePhase[]> = {
    start: ['checking_existing_runtime', 'starting_runtime_process', 'checking_runtime_service', 'runtime_ready'],
    restart: ['checking_existing_runtime', 'stopping_runtime_process', 'verifying_runtime_stopped', 'starting_runtime_process', 'checking_runtime_service', 'runtime_ready'],
    update: ['checking_runtime_package', 'preparing_runtime_package', 'stopping_runtime_process', 'installing_runtime_package', 'starting_runtime_process', 'checking_runtime_service', 'runtime_ready'],
    stop: ['discovering_runtime_instances', 'stopping_runtime_process', 'verifying_runtime_stopped', 'runtime_stopped'],
    refresh: ['checking_host', 'discovering_runtime_instances', 'checking_runtime_service', 'runtime_ready'],
  };
  const sequence = phases[operation];
  const location = desktopRuntimeLifecycleLocation(e.managed_runtime_host_access!, e.managed_runtime_placement!);
  return simulateOperation({ request, environment: e, stageCount: sequence.length,
    progress: (status, stage) => ({
      phase: sequence[stage], title: `${operation} Runtime`, detail: status === 'failed' ? 'Simulated connection failure.' : '', active_progress_surface: 'runtime_lifecycle',
      lifecycle_progress: runtimeLifecycleProgress({ location, operation, phase: sequence[stage], targetID: e.id, targetLabel: e.label,
        planState: ['succeeded', 'failed', 'canceled'].includes(status) ? 'terminal' : 'executing',
        stepStates: sequence.map((id, index) => ({ id, status: index < stage || status === 'succeeded' ? 'succeeded' : index > stage ? 'pending' : status === 'failed' ? 'failed' : 'running' })),
      }),
    }),
    outcome: request.kind === 'prepare_environment_open' ? 'refreshed_environment_runtime' : ({ start: 'started_environment_runtime', restart: 'restarted_environment_runtime', update: 'updated_environment_runtime', stop: 'stopped_environment_runtime', refresh: 'refreshed_environment_runtime' } as const)[operation],
    onSuccess: () => {
      if (operation === 'refresh') editEntry(e.id, { runtime_health: { ...e.runtime_health, freshness: 'fresh', checked_at_unix_ms: Date.now() } });
      else setRunning(e.id, operation !== 'stop');
    },
  });
}

function simulateOpen(request: DesktopLauncherActionRequest, e: DesktopEnvironmentEntry) {
  const location: DesktopOpenConnectionLocation = e.kind === 'provider_environment' ? 'provider_remote'
    : e.kind === 'gateway_environment' ? 'runtime_gateway' : e.kind === 'external_local_ui' ? 'external_local_ui'
      : desktopOpenConnectionLocation(e.managed_runtime_host_access!, e.managed_runtime_placement!);
  const sequence = openConnectionPhaseSequence(location);
  return simulateOperation({ request, environment: e, stageCount: sequence.length,
    progress: (status, stage, previous) => ({
      phase: sequence[stage], title: 'Open environment', detail: status === 'failed' ? 'Simulated connection failure.' : '', active_progress_surface: 'open',
      open_progress: openConnectionProgress({ location, phase: sequence[stage], environmentID: e.id, environmentLabel: e.label }),
      open_timing: advanceOpenConnectionTiming(previous?.open_timing, sequence[stage], Date.now(), previous?.started_at_unix_ms ?? Date.now(), previous?.open_progress?.phase),
    }),
    outcome: 'opened_environment_window',
    onSuccess: () => {
      editEntry(e.id, { is_open: true, window_state: 'open', open_action: 'focus', open_session_key: `preview:${e.id}` });
      setNotice('Env App / 外部窗口停留在启动边界；此预览只运行 Desktop UI。');
    },
  });
}

function resetOperations() { [...pending.values()].forEach(operation => operation.reset()); }
const unavailableRuntime = async (): Promise<never> => { throw new Error('Preview has no connected runtime.'); };
const settings: DesktopWelcomeRuntime['settings'] = {
  startRuntimeFlowerStream: async () => ({ ok: false, error: { message: 'Preview has no connected runtime.' } }),
  cancelRuntimeFlowerStream() {}, subscribeRuntimeFlowerStream: () => () => {},
  prepareRuntimeFlowerAttachment: unavailableRuntime, writeRuntimeFlowerAttachmentChunk: unavailableRuntime,
  commitRuntimeFlowerAttachment: unavailableRuntime, cancelRuntimeFlowerAttachment: unavailableRuntime,
  subscribeRuntimeFlowerAttachmentProgress: () => () => {}, previewRuntimeFlowerAttachment: unavailableRuntime,
  async load({ environment_id }) {
    const e = snapshot.environments.find(e => e.id === environment_id)!;
    return { ok: true, snapshot: buildDesktopSettingsSurfaceSnapshot('environment_settings', {
      local_ui_bind: 'localhost:23998', local_ui_protocol: 'http', local_ui_password: '', local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true, ...drafts.get(environment_id),
    }, { environment_id, environment_label: e.label, environment_kind: 'runtime_target', runtime_connection: { host_access: e.managed_runtime_host_access!, placement: e.managed_runtime_placement! },
      current_runtime_running: e.runtime_health.status === 'online', current_runtime_urls: e.local_ui_urls, current_runtime_url: e.local_ui_url }) };
  },
  async save(request) { drafts.set(request.environment_id, request.draft); setNotice('已保存到本次预览，真实环境未更改。'); return settings.load(request); },
  cancel() {}, async requestRuntimeFlower() { return { ok: false, failureKind: 'local', error: { message: 'Preview has no connected AI runtime.' } }; },
};
async function performAction(request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionResult> {
  requests.push(request);
  const id = 'environment_id' in request ? request.environment_id : '';
  const e = snapshot.environments.find(e => e.id === id);
  setNotice(`预览操作：${e?.label ?? ''} · ${request.kind}`);
  if (request.kind === 'set_environment_registration_pinned' || request.kind === 'set_provider_environment_pinned') {
    const target = request.kind === 'set_provider_environment_pinned' ? e : snapshot.environments.find(e => JSON.stringify(e.registration_ref) === JSON.stringify(request.registration_ref));
    if (target) editEntry(target.id, { pinned: request.pinned });
    return { ok: true, outcome: 'saved_environment' };
  }
  if (request.kind === 'delete_environment_registration') {
    snapshot = { ...snapshot, environments: snapshot.environments.filter(e => JSON.stringify(e.registration_ref) !== JSON.stringify(request.registration_ref)) }; publish();
    return { ok: true, outcome: 'deleted_environment' };
  }
  if (request.kind === 'cancel_launcher_operation') { pending.get(request.operation_key)?.cancel(); return { ok: true, outcome: 'canceled_launcher_operation' }; }
  if (request.kind === 'dismiss_launcher_operation') { snapshot = { ...snapshot, action_progress: snapshot.action_progress.filter(item => item.operation_key !== request.operation_key) }; publish(); return { ok: true, outcome: 'dismissed_launcher_operation' }; }
  if (e && ['start_environment_runtime', 'restart_environment_runtime', 'update_environment_runtime', 'stop_environment_runtime', 'refresh_environment_runtime'].includes(request.kind)) {
    return simulateLifecycle(request, e, request.kind.split('_')[0] as DesktopRuntimeLifecycleOperation);
  }
  if (request.kind === 'preview_reinstall_target' && e) {
    return { ok: true, outcome: 'previewed_reinstall_target', reinstall_preview: {
      preflight_id: 'preview-preflight', operation_key: 'preview-reinstall', environment_id: e.id, label: e.label,
      target_kind: e.kind === 'wsl_environment' ? 'wsl_host' : 'ssh_host', host_label: e.label,
      target_root: e.managed_runtime_placement?.runtime_root ?? '/home/dev/.redeven', target_exists: true,
      target_exists_known: true, affected_environment_ids: [e.id], processes: [],
      deleted_data_keys: ['runtime_managed_packages', 'workspace_projects_application_data', 'floret_redevplugin_data', 'trust_identity_catalog_environment_config'],
      expires_at_unix_ms: Date.now() + 300000, mode: request.mode ?? 'preserve_data',
    } };
  }
  if (request.kind === 'prepare_environment_open' && e) return simulateLifecycle(request, e, 'start');
  if (e && ['open_local_environment', 'open_provider_environment', 'open_gateway_environment', 'open_remote_environment', 'open_ssh_environment'].includes(request.kind)) return simulateOpen(request, e);
  if (request.kind === 'focus_environment_window') {
    setNotice('Env App / 外部窗口停留在启动边界；此预览只运行 Desktop UI。');
    return { ok: true, outcome: 'focused_environment_window' };
  }
  if (request.kind === 'refresh_all_environment_runtimes') {
    const results = await Promise.all(snapshot.environments.filter(e => e.managed_runtime_host_access && e.managed_runtime_placement).map(e => simulateLifecycle({ kind: 'refresh_environment_runtime', environment_id: e.id }, e, 'refresh')));
    return results.find(result => !result.ok) ?? { ok: true, outcome: 'refreshed_all_environment_runtimes' };
  }
  if (request.kind === 'refresh_control_plane') { publish(); return { ok: true, outcome: 'refreshed_control_plane' }; }
  if (request.kind === 'start_control_plane_connect') { setNotice('授权交接边界：正式产品将在浏览器中请求 Redeven Cloud 授权。'); return { ok: true, outcome: 'started_control_plane_connect' }; }
  setNotice(`已到达真实主进程操作边界：${request.kind}；未执行外部操作。`);
  return { ok: false, code: 'action_invalid', scope: 'environment', message: 'This preview has no Desktop main process.' };
}
Object.assign(window, { compactPreview: { requests, snapshot: () => snapshot, publish: (s: DesktopWelcomeSnapshot) => { snapshot = s; publish(); } } });
render(() => {
  const [generation, setGeneration] = createSignal(0);
  return <><aside class="preview-toolbar" aria-label="预览控制（不属于产品界面）"><strong>设计验收预览</strong>
    <label>场景 <select value={scenario()} onChange={event => { resetOperations(); receive = undefined; setScenario(event.currentTarget.value); snapshot = structuredClone(inventories[event.currentTarget.value as keyof typeof inventories]); revision = 0; setGeneration(generation()+1); setNotice('真实产品组件 · 示例数据 · 不连接真实环境'); }}><option value="daily">日常环境 · 8 张卡片</option><option value="coverage">全部类型 · Cloud / WSL / 容器 / URL</option><option value="states">异常状态 · 授权 / 离线 / 更新 / 重装</option><option value="linkedError">关联环境 · Cloud 授权过期</option></select></label>
    <label>操作结果 <select value={result()} onChange={e=>setResult(e.currentTarget.value)}><option value="succeeded">6 秒后成功</option><option value="failed">6 秒后失败</option><option value="hold">保持进行中</option></select></label>
    <label>语言 <select aria-label="预览语言" value={language().resolved_locale} onChange={event => languageBridge.setPreference(event.currentTarget.value as RedevenLocalePreference)}>{REDEVEN_SUPPORTED_LOCALES.map(locale => <option value={locale}>{REDEVEN_LOCALE_META[locale].native_name}</option>)}</select></label>
    <label>字号 <select aria-label="预览字号" onChange={event => document.documentElement.style.fontSize = `${event.currentTarget.value}px`}><option value="16">100%</option><option value="20">125%</option><option value="24">150%</option></select></label>
    <Show when={result() === 'hold' && pendingCount() > 0}><button onClick={() => [...pending.values()].forEach(operation => operation.finish())}>完成进行中的操作</button></Show>
    <button onClick={()=>{ resetOperations(); receive=undefined; snapshot=structuredClone(inventories[scenario() as keyof typeof inventories]); revision=0; setGeneration(generation()+1); }}>重置示例</button><span role="status">{notice()}</span>
  </aside><Preview generation={generation()} /></>;
}, document.getElementById('root')!);
function Preview(props: { generation: number }) {
  return <div class="preview-product"><Show when={{ generation: props.generation }} keyed>{(_generation) => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: { getSnapshot: async()=>snapshot, subscribeSnapshot: listener=>{ receive=listener; return ()=>{if(receive===listener)receive=undefined;}; }, getSSHConfigHosts: async()=>[], performAction } }} />}</Show></div>;
}
