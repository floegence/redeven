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

const protocolMocks = vi.hoisted(() => ({
  status: vi.fn(() => 'connected'),
}));

const terminalPanelMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('./EnvWorkbenchInstancesContext', () => ({
  useEnvWorkbenchInstancesContext: () => workbenchMocks,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => protocolMocks,
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
  const requestActivate = vi.fn();
  const props = {
    widgetId: 'widget-terminal-1',
    title: 'Terminal',
    type: 'redeven.terminal' as any,
    lifecycle: 'warm',
    selected: false,
    filtered: false,
    requestActivate,
    ...overrides,
  } satisfies RedevenWorkbenchWidgetBodyProps;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <Body {...props} />, host);
  return { host, dispose, requestActivate };
}

describe('redevenWorkbenchWidgets terminal lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('keeps inactive terminal widgets paused instead of mounting the live panel', () => {
    const { host, requestActivate } = renderTerminalBody();

    const preview = host.querySelector('[data-testid="terminal-paused-preview"]') as HTMLButtonElement | null;
    expect(preview).toBeTruthy();
    expect(host.querySelector('[data-testid="live-terminal-panel"]')).toBeNull();
    expect(terminalPanelMocks.render).not.toHaveBeenCalled();
    expect(preview?.textContent).toContain('2 sessions');
    expect(preview?.textContent).toContain('Click to resume live terminal');

    preview?.click();

    expect(requestActivate).toHaveBeenCalledTimes(1);
  });

  it('mounts the live terminal panel only for hot terminal widgets', () => {
    const { host } = renderTerminalBody({
      lifecycle: 'hot',
      selected: true,
    });

    expect(host.querySelector('[data-testid="terminal-paused-preview"]')).toBeNull();
    expect(host.querySelector('[data-testid="live-terminal-panel"]')).toBeTruthy();
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
