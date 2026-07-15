import type {
  WorkbenchWidgetBodyProps as RedevenWorkbenchWidgetBodyProps,
  WorkbenchWidgetDefinition,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';
import { DockCpu, DockFolder, DockTerminal, Search } from '@floegence/floe-webapp-core/icons';
import { Show, lazy, type JSX } from 'solid-js';

import { CodexWorkbenchIcon } from '../icons/CodexIcon';
import { CodespacesWorkbenchIcon } from '../icons/CodespacesIcon';
import { FlowerWorkbenchIcon } from '../icons/FlowerSoftAuraIcon';
import { useI18n, type I18nHelpers } from '../i18n';
import { useEnvContext } from '../pages/EnvContext';
import { hasRWXPermissions } from '../pages/aiPermissions';
import { useEnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';
import { WorkbenchFilePreviewWidget } from './WorkbenchFilePreviewWidget';
import { REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS } from './surface/workbenchWheelInteractive';
import { buildWorkbenchFileBrowserStateScope } from './workbenchInstanceState';

const FRONTABLE_WORKBENCH_RENDER_MODE = 'projected_surface';
const EnvAIPage = lazy(() => import('../pages/EnvAIPage').then((module) => ({ default: module.EnvAIPage })));
const EnvCodespacesPage = lazy(() => import('../pages/EnvCodespacesPage').then((module) => ({ default: module.EnvCodespacesPage })));
const EnvPortForwardsPage = lazy(() => import('../pages/EnvPortForwardsPage').then((module) => ({ default: module.EnvPortForwardsPage })));
const RemoteFileBrowser = lazy(() => import('../widgets/RemoteFileBrowser').then((module) => ({ default: module.RemoteFileBrowser })));
const RuntimeMonitorPanel = lazy(() => import('../widgets/RuntimeMonitorPanel').then((module) => ({ default: module.RuntimeMonitorPanel })));
const TerminalPanel = lazy(() => import('../widgets/TerminalPanel').then((module) => ({ default: module.TerminalPanel })));
const CodexWorkbenchSurface = lazy(() => import('./CodexWorkbenchSurface').then((module) => ({ default: module.CodexWorkbenchSurface })));

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
  const i18n = useI18n();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow={i18n.t('aiChrome.flowerTitle')}
          title={i18n.t('workbench.notices.flowerRwxTitle')}
          description={i18n.t('workbench.notices.flowerRwxDescription')}
        />
      )}
    >
      <div class="redeven-workbench-body-surface relative h-full min-h-0 min-w-0">
        <EnvAIPage />
      </div>
    </Show>
  );
}

function CodexWidget(_props: RedevenWorkbenchWidgetBodyProps) {
  const env = useEnvContext();
  const i18n = useI18n();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow={i18n.t('aiChrome.codexTitle')}
          title={i18n.t('workbench.notices.codexRwxTitle')}
          description={i18n.t('workbench.notices.codexRwxDescription')}
        />
      )}
    >
      <CodexWorkbenchSurface />
    </Show>
  );
}

function WebServicesDockIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" width="48" height="48" class={props.class}>
      <defs>
        <linearGradient id="ws-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="color-mix(in srgb, var(--card), #1a2030 8%)" />
          <stop offset="100%" stop-color="color-mix(in srgb, var(--card), #1a2030 18%)" />
        </linearGradient>
        <linearGradient id="ws-rim" x1="0" y1="0" x2="0" y2=".35">
          <stop offset="0%" stop-color="white" stop-opacity=".14" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <clipPath id="ws-clip">
          <circle cx="24" cy="20" r="8.5" />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#ws-bg)" />
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#ws-rim)" />
      <circle cx="24" cy="20" r="8.5" fill="#475569" fill-opacity=".4" stroke="var(--foreground)" stroke-opacity=".3" stroke-width="1.2" />
      <g clip-path="url(#ws-clip)">
        <ellipse cx="24" cy="14" rx="9" ry="3.2" fill="none" stroke="var(--foreground)" stroke-opacity=".16" stroke-width=".95" />
        <ellipse cx="24" cy="26" rx="9" ry="3.2" fill="none" stroke="var(--foreground)" stroke-opacity=".16" stroke-width=".95" />
        <path d="M 24 11.5 a 12 12 0 0 0 0 17 a 12 12 0 0 0 0 -17" fill="none" stroke="var(--foreground)" stroke-opacity=".16" stroke-width=".95" />
        <line x1="24" y1="11.5" x2="24" y2="28.5" stroke="var(--foreground)" stroke-opacity=".16" stroke-width=".95" />
      </g>
      <text x="24" y="37" text-anchor="middle" font-family="'Inter','SF Pro Display',-apple-system,sans-serif" font-size="6.5" font-weight="800" letter-spacing=".6" fill="var(--foreground)" fill-opacity=".65">HTTP</text>
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
    defaultSize: { width: 1200, height: 800 },
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
    defaultSize: { width: 1120, height: 780 },
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
    defaultSize: { width: 1040, height: 800 },
    group: 'observability',
    singleton: true,
    renderMode: FRONTABLE_WORKBENCH_RENDER_MODE,
    projectedSurfaceScaleBehavior: 'settle_sharp_zoom',
  },
  {
    type: 'redeven.codespaces',
    label: 'Codespaces',
    icon: CodespacesWorkbenchIcon,
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

function localizedWorkbenchWidgetCopy(
  type: WorkbenchWidgetType,
  t: I18nHelpers['t'],
): Pick<WorkbenchWidgetDefinition, 'label' | 'defaultTitle'> | null {
  switch (type) {
    case 'redeven.files':
      return { label: t('workbench.widgets.files.label'), defaultTitle: t('workbench.widgets.files.defaultTitle') };
    case 'redeven.terminal':
      return { label: t('workbench.widgets.terminal.label'), defaultTitle: t('workbench.widgets.terminal.defaultTitle') };
    case 'redeven.preview':
      return { label: t('workbench.widgets.preview.label'), defaultTitle: t('workbench.widgets.preview.defaultTitle') };
    case 'redeven.monitor':
      return { label: t('workbench.widgets.monitor.label'), defaultTitle: t('workbench.widgets.monitor.defaultTitle') };
    case 'redeven.codespaces':
      return { label: t('workbench.widgets.codespaces.label'), defaultTitle: t('workbench.widgets.codespaces.defaultTitle') };
    case 'redeven.ports':
      return { label: t('workbench.widgets.ports.label'), defaultTitle: t('workbench.widgets.ports.defaultTitle') };
    case 'redeven.ai':
      return { label: t('workbench.widgets.flower.label'), defaultTitle: t('workbench.widgets.flower.defaultTitle') };
    case 'redeven.codex':
      return { label: t('workbench.widgets.codex.label'), defaultTitle: t('workbench.widgets.codex.defaultTitle') };
    default:
      return null;
  }
}

export function localizedRedevenWorkbenchWidgets(t: I18nHelpers['t']): readonly WorkbenchWidgetDefinition[] {
  return redevenWorkbenchWidgets.map((definition) => ({
    ...definition,
    ...(localizedWorkbenchWidgetCopy(definition.type, t) ?? {}),
  }));
}

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
