import type {
  WorkbenchWidgetBodyProps as RedevenWorkbenchWidgetBodyProps,
  WorkbenchWidgetDefinition,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';
import { Activity, Code, Files, Globe, Search, Terminal } from '@floegence/floe-webapp-core/icons';
import { Show, type JSX } from 'solid-js';

import { CodexWorkbenchIcon } from '../icons/CodexIcon';
import { FlowerWorkbenchIcon } from '../icons/FlowerSoftAuraIcon';
import { useEnvContext } from '../pages/EnvContext';
import { EnvAIPage } from '../pages/EnvAIPage';
import { AIChatSidebar } from '../pages/AIChatSidebar';
import { EnvCodespacesPage } from '../pages/EnvCodespacesPage';
import { EnvPortForwardsPage } from '../pages/EnvPortForwardsPage';
import { hasRWXPermissions } from '../pages/aiPermissions';
import { CodexPage } from '../codex/CodexPage';
import { CodexSidebarShell } from '../codex/CodexSidebarShell';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';
import { TerminalPanel } from '../widgets/TerminalPanel';
import { useEnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';
import { EnvWorkbenchConversationShell } from './EnvWorkbenchConversationShell';
import { WorkbenchFilePreviewWidget } from './WorkbenchFilePreviewWidget';
import { REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS } from './surface/workbenchWheelInteractive';
import { buildWorkbenchFileBrowserStateScope } from './workbenchInstanceState';

const FRONTABLE_WORKBENCH_RENDER_MODE = 'projected_surface';

function WorkbenchBodyNotice(props: {
  title: string;
  description: string;
  eyebrow?: string;
  action?: JSX.Element;
}) {
  return (
    <div class="flex h-full min-h-0 items-center justify-center bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_8%,transparent),_transparent_52%)] p-4">
      <div class="redeven-workbench-body-notice-card w-full max-w-md rounded-2xl p-5">
        <Show when={props.eyebrow}>
          <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">{props.eyebrow}</div>
        </Show>
        <div class="mt-2 text-base font-semibold text-foreground">{props.title}</div>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">{props.description}</p>
        <Show when={props.action}>
          <div class="mt-4 flex items-center gap-2">{props.action}</div>
        </Show>
      </div>
    </div>
  );
}

function FilesWidget(props: RedevenWorkbenchWidgetBodyProps) {
  const workbench = useEnvWorkbenchInstancesContext();
  return (
    <div class="redeven-workbench-body-surface h-full min-h-0">
      <RemoteFileBrowser
        widgetId={props.widgetId}
        persistenceTarget="workbench"
        stateScope={buildWorkbenchFileBrowserStateScope(props.widgetId)}
        openPathRequest={workbench.fileBrowserOpenRequest(props.widgetId)}
        onOpenPathRequestHandled={workbench.consumeFileBrowserOpenRequest}
        onTitleChange={(title) => {
          workbench.updateWidgetTitle(props.widgetId, title);
        }}
        onCommittedPathChange={(path) => {
          workbench.updateFileBrowserPath(props.widgetId, path);
        }}
      />
    </div>
  );
}

function TerminalWidget(props: RedevenWorkbenchWidgetBodyProps) {
  const workbench = useEnvWorkbenchInstancesContext();
  const panelState = () => workbench.terminalPanelState(props.widgetId);
  const geometryPreferences = () => workbench.terminalGeometryPreferences(props.widgetId);

  return (
    <TerminalPanel
      variant="workbench"
      openSessionRequest={workbench.terminalOpenRequest(props.widgetId)}
      onOpenSessionRequestHandled={workbench.consumeTerminalOpenRequest}
      sessionGroupState={panelState()}
      terminalGeometryPreferences={{
        fontSize: geometryPreferences().fontSize,
        fontFamilyId: geometryPreferences().fontFamilyId,
        onFontSizeChange: (fontSize) => {
          workbench.updateTerminalGeometryPreferences(props.widgetId, (previous) => ({
            ...previous,
            fontSize,
          }));
        },
        onFontFamilyChange: (fontFamilyId) => {
          workbench.updateTerminalGeometryPreferences(props.widgetId, (previous) => ({
            ...previous,
            fontFamilyId,
          }));
        },
      }}
      onSessionGroupStateChange={(next) => {
        workbench.updateTerminalPanelState(props.widgetId, () => next);
      }}
      sessionOperations={{
        createSession: (name, workingDir) => workbench.createTerminalSession(props.widgetId, name, workingDir),
        deleteSession: (sessionId) => workbench.deleteTerminalSession(props.widgetId, sessionId),
      }}
      workbenchSelected={props.selected}
      workbenchActivationSeq={props.activation?.seq}
      onWorkbenchTerminalCoreChange={(sessionId, core) => {
        workbench.registerTerminalCore(props.widgetId, sessionId, core);
      }}
      onWorkbenchTerminalSurfaceChange={(sessionId, surface) => {
        workbench.registerTerminalSurface(props.widgetId, sessionId, surface);
      }}
      onTitleChange={(title) => {
        workbench.updateWidgetTitle(props.widgetId, title);
      }}
    />
  );
}

function MonitorWidget() {
  return <RuntimeMonitorPanel variant="workbench" />;
}

function CodespacesWidget() {
  return (
    <div
      {...REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS}
      class="redeven-workbench-body-surface h-full min-h-0 overflow-auto"
    >
      <EnvCodespacesPage />
    </div>
  );
}

function PortsWidget() {
  return (
    <div
      {...REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS}
      class="redeven-workbench-body-surface h-full min-h-0 overflow-auto"
    >
      <EnvPortForwardsPage />
    </div>
  );
}

function FlowerWidget(_props: RedevenWorkbenchWidgetBodyProps) {
  const env = useEnvContext();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow="Flower"
          title="Flower needs read, write, and execute access"
          description="Grant RWX permission for this environment to use the embedded Flower workspace in workbench mode."
        />
      )}
    >
      <EnvWorkbenchConversationShell
        railLabel="Flower threads"
        rail={<AIChatSidebar />}
        workbench={<EnvAIPage />}
      />
    </Show>
  );
}

function CodexWidget(_props: RedevenWorkbenchWidgetBodyProps) {
  const env = useEnvContext();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow="Codex"
          title="Codex needs read, write, and execute access"
          description="Grant RWX permission for this environment to use the embedded Codex workspace in workbench mode."
        />
      )}
    >
      <EnvWorkbenchConversationShell
        railLabel="Codex threads"
        rail={<CodexSidebarShell />}
        workbench={<CodexPage />}
      />
    </Show>
  );
}

export const redevenWorkbenchWidgets: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: Files,
    body: FilesWidget,
    defaultTitle: 'Files',
    defaultSize: { width: 1080, height: 700 },
    group: 'workspace',
    singleton: false,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
  },
  {
    type: 'redeven.terminal',
    label: 'Terminal',
    icon: Terminal,
    body: TerminalWidget,
    defaultTitle: 'Terminal',
    defaultSize: { width: 1120, height: 680 },
    group: 'runtime',
    singleton: false,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
  },
  {
    type: 'redeven.preview',
    label: 'Preview',
    icon: Search,
    body: WorkbenchFilePreviewWidget,
    defaultTitle: 'Preview',
    defaultSize: { width: 1080, height: 700 },
    group: 'workspace',
    singleton: false,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
  },
  {
    type: 'redeven.monitor',
    label: 'Monitoring',
    icon: Activity,
    body: MonitorWidget,
    defaultTitle: 'Monitoring',
    defaultSize: { width: 1040, height: 640 },
    group: 'observability',
    singleton: true,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
    projectedSurfaceScaleBehavior: 'settle_sharp_zoom',
  },
  {
    type: 'redeven.codespaces',
    label: 'Codespaces',
    icon: Code,
    body: CodespacesWidget,
    defaultTitle: 'Codespaces',
    defaultSize: { width: 1040, height: 660 },
    group: 'workspace',
    singleton: true,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
  },
  {
    type: 'redeven.ports',
    label: 'Web Services',
    icon: Globe,
    body: PortsWidget,
    defaultTitle: 'Web Services',
    defaultSize: { width: 1000, height: 620 },
    group: 'network',
    singleton: true,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
    projectedSurfaceScaleBehavior: 'settle_sharp_zoom',
  },
  {
    type: 'redeven.ai',
    label: 'Flower',
    icon: FlowerWorkbenchIcon,
    body: FlowerWidget,
    defaultTitle: 'Flower',
    defaultSize: { width: 1200, height: 760 },
    group: 'assistant',
    singleton: true,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
  },
  {
    type: 'redeven.codex',
    label: 'Codex',
    icon: CodexWorkbenchIcon,
    body: CodexWidget,
    defaultTitle: 'Codex',
    defaultSize: { width: 1200, height: 760 },
    group: 'assistant',
    singleton: true,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
  },
];

export const redevenWorkbenchFilterBarWidgetTypes: readonly WorkbenchWidgetType[] = [
  'redeven.files',
  'redeven.terminal',
  'redeven.monitor',
  'redeven.codespaces',
  'redeven.ports',
  'redeven.ai',
  'redeven.codex',
];
