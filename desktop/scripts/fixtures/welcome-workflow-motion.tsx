import { createMemo, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { EnvironmentSplitActionButton } from '../../src/welcome/App';
import { createDesktopI18n } from '../../src/shared/i18n';
import { runtimeLifecycleProgress, type DesktopRuntimeLifecycleStepID } from '../../src/shared/desktopRuntimeLifecycleProgress';
import type { DesktopLauncherActionProgress } from '../../src/shared/desktopLauncherIPC';
import type { EnvironmentOperationState } from '../../src/welcome/launcherBusyState';
import '../../src/welcome/index.css';

function WorkflowFixture() {
  const i18n = createDesktopI18n(new URLSearchParams(location.search).get('locale') === 'zh-CN' ? 'zh-CN' : 'en-US');
  const [progress, setProgress] = createSignal<DesktopLauncherActionProgress | null>(null);
  const [open, setOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [guidanceOpen, setGuidanceOpen] = createSignal(false);
  const [cancels, setCancels] = createSignal(0);
  const [opens, setOpens] = createSignal(0);
  const shortSteps: DesktopRuntimeLifecycleStepID[] = ['checking_host', 'checking_runtime_package'];
  const longSteps: DesktopRuntimeLifecycleStepID[] = [...shortSteps, 'detecting_platform', 'preparing_runtime_package', 'installing_runtime_package', 'starting_runtime_process', 'checking_runtime_service', 'runtime_ready'];
  function advance(stage: 'idle' | 'checking' | 'preparing' | 'ready' | 'failed') {
    if (stage === 'idle') { setProgress(null); setOpen(false); return; }
    const phase = stage === 'checking' ? 'checking_host' : stage === 'ready' ? 'runtime_ready' : 'preparing_runtime_package';
    const status = stage === 'ready' ? 'succeeded' : stage === 'failed' ? 'failed' : 'running';
    const steps = stage === 'checking' ? shortSteps : longSteps;
    const lifecycle = runtimeLifecycleProgress({ location: 'ssh_host', operation: 'update', phase,
      targetID: 'workflow-host', targetLabel: 'udesk26', planRevision: stage === 'checking' ? 1 : 2,
      stepStates: steps.map((id, index) => ({ id, status: stage === 'ready' || index < steps.indexOf(phase) ? 'succeeded' : id === phase ? status : 'pending' })),
    });
    const lifecycleWithTasks = stage === 'preparing' ? { ...lifecycle, steps: lifecycle.steps.map(step => step.id === phase ? { ...step, tasks: [{ id: 'runtime' as const, status: 'running' as const, phase: 'preparing' as const, strategy: 'desktop_upload' as const }] } : step) } : lifecycle;
    setProgress({ action: 'update_environment_runtime', environment_id: 'workflow-host', environment_label: 'udesk26', operation_key: 'workflow-operation',
      started_at_unix_ms: 1, status, phase, title: 'Update Runtime', detail: '', cancelable: status === 'running',
      active_progress_surface: 'runtime_lifecycle', lifecycle_progress: lifecycleWithTasks });
  }
  const operationState = createMemo<EnvironmentOperationState>(() => ({ activeProgress: progress()?.status === 'running' ? progress() : null, panelProgress: progress(),
    openProgress: null, runtimeLifecycleProgress: progress(), reinstallTargetProgress: null, isSubmitting: false, actionsDisabled: progress()?.status === 'running' }));
  Object.assign(window, { workflowFixture: { advance, setOpen, cancels, opens } });
  return <FloeProvider><main style={{ padding: '24px' }}>
    <button id="outside">Outside</button>
    <div class="redeven-environment-card" style={{ position: 'fixed', left: 'max(24px, calc(50vw - 160px))', bottom: '48px', width: 'min(320px, calc(100vw - 48px))', padding: '16px', border: '1px solid var(--floe-line)', 'border-radius': 'var(--floe-radius-panel)' }}>
      <div style={{ 'padding-bottom': '16px' }}>udesk26</div>
      <EnvironmentSplitActionButton i18n={i18n} environmentID="workflow-host" environmentLabel="udesk26"
        presentation={{ kind: 'split_button', primary_action: { intent: 'open', label: i18n.t('environmentAction.open'), enabled: true, variant: 'default' },
          menu_button_label: 'Actions', menu_actions: [{ id: 'update', label: 'Update', action: { intent: 'update_runtime', label: i18n.t('environmentAction.updateRuntimeAndOpen'), enabled: true, variant: 'default' } }] }}
        operationState={operationState()} menuOpen={menuOpen()} onMenuOpenChange={setMenuOpen} guidanceOpen={guidanceOpen()} onGuidanceOpenChange={setGuidanceOpen}
        progressOpen={open()} onProgressOpenChange={setOpen} guidanceSession={null}
        onRunAction={() => { setOpens(value => value + 1); advance('checking'); setOpen(true); }} onRunGuidanceAction={() => {}}
        cancelOperation={() => setCancels(value => value + 1)} dismissOperation={() => advance('idle')} copyOperationDiagnostics={() => {}}
        refreshEnvironmentRuntime={() => {}} runDesktopUpdateHandoff={async () => {}} />
    </div>
  </main></FloeProvider>;
}
render(() => <WorkflowFixture />, document.getElementById('root')!);
