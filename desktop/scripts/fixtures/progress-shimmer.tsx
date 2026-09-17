import { createMemo, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { EnvironmentSplitActionButton } from '../../src/welcome/App';
import { createDesktopI18n } from '../../src/shared/i18n';
import type { DesktopLauncherActionProgress } from '../../src/shared/desktopLauncherIPC';
import { runtimeLifecycleProgress } from '../../src/shared/desktopRuntimeLifecycleProgress';
import { FlowerProgressIndicator } from '../../../internal/flower_ui/src/chat/FlowerProgressIndicator';
import '../../src/welcome/index.css';

function Fixture() {
  const theme = useTheme();
  const [status, setStatus] = createSignal<DesktopLauncherActionProgress['status']>('running');
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [progressOpen, setProgressOpen] = createSignal(false);
  const [cancelCount, setCancelCount] = createSignal(0);
  const [submitting, setSubmitting] = createSignal(false);
  const progress = createMemo<DesktopLauncherActionProgress | null>(() => status() === 'succeeded' || submitting() ? null : ({
    action: 'update_environment_runtime', environment_id: 'local-environment', environment_label: 'Local Environment',
    operation_key: 'progress-acceptance', subject_kind: 'local_environment', subject_id: 'local-environment',
    started_at_unix_ms: Date.now(), status: status(), phase: 'starting_runtime_process', title: 'Updating runtime', detail: 'Preparing runtime',
    active_progress_surface: 'runtime_lifecycle', cancelable: true,
    lifecycle_progress: runtimeLifecycleProgress({ location: 'local_host', operation: 'update', phase: 'starting_runtime_process', targetID: 'local-environment', targetLabel: 'Local Environment' }),
  }));
  const active = () => ['running', 'canceling', 'cleanup_running'].includes(status() ?? '');
  onMount(() => Object.assign(window, { progressFixture: { theme, themes: builtInShellThemePresets, setStatus, setSubmitting, cancelCount } }));
  return <main class="redeven-welcome-surface" style={{ padding: '180px 48px 48px', 'min-height': '100vh' }}>
    <section class="redeven-environment-card" style={{ padding: '24px', width: '350px', 'margin-bottom': '32px' }}>
      <h2 style={{ 'margin-bottom': '24px' }}>Local Environment</h2>
      <EnvironmentSplitActionButton
        i18n={createDesktopI18n('zh-CN')}
        environmentID="local-environment" environmentLabel="Local Environment"
        presentation={{ kind: 'split_button', primary_action: { intent: 'open', label: 'Open Env App', enabled: true, variant: 'default' }, menu_button_label: 'Environment actions', menu_actions: [{ id: 'refresh', label: 'Refresh status', action: { intent: 'refresh_runtime', label: 'Refresh status', enabled: true, variant: 'default' } }] }}
        menuOpen={menuOpen()} onMenuOpenChange={setMenuOpen} guidanceOpen={false} onGuidanceOpenChange={() => undefined}
        progressOpen={progressOpen()} onProgressOpenChange={setProgressOpen} guidanceSession={null}
        operationState={{ activeProgress: active() ? progress() : null, panelProgress: progress(), openProgress: null, runtimeLifecycleProgress: progress(), reinstallTargetProgress: null, isSubmitting: submitting(), actionsDisabled: submitting() || active() }}
        cancelOperation={() => { setCancelCount(c => c + 1); setStatus('canceling'); }} dismissOperation={() => undefined}
        copyOperationDiagnostics={() => undefined} refreshEnvironmentRuntime={() => undefined} runDesktopUpdateHandoff={async () => undefined}
        onRunAction={() => undefined} onRunGuidanceAction={() => undefined}
      />
    </section>
    <div class="flower-component-shell" style={{ display: 'block', padding: '24px', width: '700px' }}>
      <div class="flower-model-status-lane"><FlowerProgressIndicator progress={active() ? { kind: 'waiting_response', runID: 'run-acceptance' } : null} label="正在等待模型响应..." /></div>
    </div>
  </main>;
}

render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { shellPresets: builtInShellThemePresets, defaultTheme: 'light', defaultSurfaceStyle: 'soft-neumorphic' } }}><Fixture /></FloeProvider>, document.getElementById('root')!);
