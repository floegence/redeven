import type { WidgetDefinition, WidgetProps } from '@floegence/floe-webapp-core';
import { Activity, Files, Terminal } from '@floegence/floe-webapp-core/icons';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';
import { TerminalPanel } from '../widgets/TerminalPanel';

function FilesWidget(props: WidgetProps) {
  return (
    <div class="h-full">
      <RemoteFileBrowser widgetId={props.widgetId} />
    </div>
  );
}

function TerminalWidget(_props: WidgetProps) {
  return <TerminalPanel variant="deck" />;
}

function MonitorWidget(_props: WidgetProps) {
  return <RuntimeMonitorPanel variant="deck" />;
}

// Deck widget definitions used by Deck layouts.
export const redevenDeckWidgets: WidgetDefinition[] = [
  {
    type: 'redeven.files',
    name: 'Files',
    icon: Files,
    category: 'custom',
    component: FilesWidget,
    minColSpan: 8,
    minRowSpan: 4,
    defaultColSpan: 12,
    defaultRowSpan: 10,
  },
  {
    type: 'redeven.terminal',
    name: 'Terminal',
    icon: Terminal,
    category: 'terminal',
    component: TerminalWidget,
    minColSpan: 8,
    minRowSpan: 4,
    defaultColSpan: 12,
    defaultRowSpan: 10,
  },
  {
    type: 'redeven.monitor',
    name: 'Monitoring',
    icon: Activity,
    category: 'custom',
    component: MonitorWidget,
    minColSpan: 12,
    minRowSpan: 6,
    defaultColSpan: 24,
    defaultRowSpan: 12,
  },
];
