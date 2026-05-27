import type {
  WorkbenchWidgetBodyProps as RedevenWorkbenchWidgetBodyProps,
  WorkbenchWidgetDefinition,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';
import { DockCpu, DockFileCode, DockFolder, DockTerminal, Search } from '@floegence/floe-webapp-core/icons';
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
        onCommittedPathChange={(path, rootId) => {
          workbench.updateFileBrowserPath(props.widgetId, path, rootId);
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

function WebServicesDockIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" width="48" height="48" class={props.class}>
      <defs>
        <linearGradient id="ws-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="color-mix(in srgb, var(--card), #0a5c8a 8%)" />
          <stop offset="100%" stop-color="color-mix(in srgb, var(--card), #0a5c8a 18%)" />
        </linearGradient>
        <linearGradient id="ws-rim" x1="0" y1="0" x2="0" y2=".35">
          <stop offset="0%" stop-color="white" stop-opacity=".14" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#ws-bg)" />
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#ws-rim)" />
      <circle cx="24" cy="24" r="6" fill="none" stroke="var(--foreground)" stroke-opacity=".55" stroke-width="2" />
      <ellipse cx="24" cy="24" rx="6" ry="2.5" fill="none" stroke="var(--foreground)" stroke-opacity=".18" stroke-width="1" />
      <line x1="18" y1="24" x2="30" y2="24" stroke="var(--foreground)" stroke-opacity=".18" stroke-width="1" />
      <line x1="24" y1="12" x2="24" y2="18" stroke="var(--foreground)" stroke-opacity=".3" stroke-width="1.5" />
      <line x1="24" y1="30" x2="24" y2="37" stroke="var(--foreground)" stroke-opacity=".3" stroke-width="1.5" />
      <line x1="12" y1="24" x2="18" y2="24" stroke="var(--foreground)" stroke-opacity=".3" stroke-width="1.5" />
      <line x1="30" y1="24" x2="37" y2="24" stroke="var(--foreground)" stroke-opacity=".3" stroke-width="1.5" />
      <circle cx="24" cy="8.5" r="2.8" fill="var(--chart-4)" fill-opacity=".7" />
      <circle cx="24" cy="39.5" r="2.8" fill="var(--chart-4)" fill-opacity=".7" />
      <circle cx="8.5" cy="24" r="2.8" fill="var(--chart-4)" fill-opacity=".7" />
      <circle cx="39.5" cy="24" r="2.8" fill="var(--chart-4)" fill-opacity=".7" />
    </svg>
  );
}

export const redevenWorkbenchWidgets: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: DockFolder,
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
    icon: DockTerminal,
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
    icon: DockCpu,
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
    icon: DockFileCode,
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
    icon: WebServicesDockIcon,
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

export const redevenWorkbenchInitialCanvasWidgetTypes: readonly WorkbenchWidgetType[] = [
  'redeven.files',
  'redeven.terminal',
  'redeven.monitor',
  'redeven.codespaces',
  'redeven.ports',
  'redeven.ai',
  'redeven.codex',
];
