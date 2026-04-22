// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkbenchWidgetBodyProps as RedevenWorkbenchWidgetBodyProps,
} from '@floegence/floe-webapp-core/workbench';

const workbenchMocks = vi.hoisted(() => ({
  terminalPanelState: vi.fn(() => ({
    sessionIds: ['session-1', 'session-2'],
    activeSessionId: 'session-2',
  })),
  terminalOpenRequest: vi.fn(() => null),
  consumeTerminalOpenRequest: vi.fn(),
  updateTerminalPanelState: vi.fn(),
  createTerminalSession: vi.fn(),
  deleteTerminalSession: vi.fn(),
  updateWidgetTitle: vi.fn(),
}));

const terminalPanelMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('./EnvWorkbenchInstancesContext', () => ({
  useEnvWorkbenchInstancesContext: () => workbenchMocks,
}));

vi.mock('../widgets/TerminalPanel', () => ({
  TerminalPanel: (props: any) => {
    terminalPanelMocks.render(props);
    return <div data-testid="live-terminal-panel" />;
  },
}));

import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';

function terminalBody() {
  const entry = redevenWorkbenchWidgets.find((widget) => widget.type === 'redeven.terminal');
  if (!entry?.body) throw new Error('missing terminal widget body');
  return entry.body as (props: RedevenWorkbenchWidgetBodyProps) => any;
}

function renderTerminalBody(overrides: Partial<RedevenWorkbenchWidgetBodyProps> = {}) {
  const Body = terminalBody();
  const props = {
    widgetId: 'widget-terminal-1',
    title: 'Terminal',
    type: 'redeven.terminal' as any,
    ...overrides,
  } satisfies RedevenWorkbenchWidgetBodyProps;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <Body {...props} />, host);
  return { host, dispose };
}

describe('redevenWorkbenchWidgets terminal behavior', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('always mounts the live workbench terminal panel', () => {
    const { host } = renderTerminalBody();

    expect(host.querySelector('[data-testid="live-terminal-panel"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="terminal-paused-preview"]')).toBeNull();
    expect(terminalPanelMocks.render).toHaveBeenCalledTimes(1);
    expect(terminalPanelMocks.render.mock.calls[0]?.[0]).toMatchObject({
      variant: 'workbench',
      sessionGroupState: {
        sessionIds: ['session-1', 'session-2'],
        activeSessionId: 'session-2',
      },
    });
  });
});
