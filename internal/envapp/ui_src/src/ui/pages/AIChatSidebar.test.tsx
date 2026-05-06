// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIChatSidebar } from './AIChatSidebar';
import type { ThreadView } from './AIChatContext';
import {
  REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR,
  REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT,
} from '../workbench/surface/workbenchWheelInteractive';

const notificationMock = {
  error: vi.fn(),
  success: vi.fn(),
};

const clipboardMock = {
  writeTextToClipboard: vi.fn(),
};

const protocolState = {
  status: 'connected',
};

let aiContextStub: any;

const envResource: any = (() => ({
  permissions: {
    local_max: { read: true, write: true, execute: true },
    local_effective: { read: true, write: true, execute: true },
  },
})) as any;
envResource.state = 'ready';
envResource.loading = false;
envResource.error = null;

function makeThreadsResource(threads: ThreadView[]): any {
  const resource: any = () => ({ threads });
  resource.loading = false;
  resource.error = null;
  return resource;
}

function makeThread(overrides: Partial<ThreadView> = {}): ThreadView {
  return {
    thread_id: 'thread-1',
    title: 'Conversation',
    execution_mode: 'act',
    working_dir: '/workspace',
    queued_turn_count: 0,
    run_status: 'idle',
    created_at_unix_ms: 1000,
    updated_at_unix_ms: 2000,
    last_message_at_unix_ms: 2000,
    last_message_preview: 'preview',
    ...overrides,
  };
}

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useNotification: () => notificationMock,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Copy: Icon,
    History: Icon,
    Plus: Icon,
    Refresh: Icon,
    Sparkles: Icon,
    Trash: Icon,
    X: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  SnakeLoader: () => <div data-testid="snake-loader" />,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  SidebarContent: (props: any) => <div data-testid="sidebar-content" class={props.class}>{props.children}</div>,
  SidebarSection: (props: any) => (
    <section data-testid="sidebar-section" class={props.class}>
      <div>{props.title}</div>
      <div>{props.children}</div>
    </section>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  ),
  Checkbox: (props: any) => (
    <input
      type="checkbox"
      checked={!!props.checked}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
    />
  ),
  ConfirmDialog: (props: any) => (
    <Show when={props.open}>
      <div>{props.children}</div>
    </Show>
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div>{props.children}</div>
    </Show>
  ),
  ProcessingIndicator: (props: any) => <div data-testid="processing-indicator">{props.status}</div>,
  SegmentedControl: (props: any) => <div>{props.value}</div>,
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, style, ...rest } = props;
    return (
      <div
        ref={layerRef}
        class={className}
        style={{
          ...(style ?? {}),
          left: `${position?.x ?? 0}px`,
          top: `${position?.y ?? 0}px`,
        }}
        data-floe-local-interaction-surface="true"
        {...rest}
      >
        {children}
      </div>
    );
  },
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    status: () => protocolState.status,
    client: () => null,
  }),
}));

vi.mock('solid-motionone', () => ({
  Motion: {
    div: (props: any) => <div>{props.children}</div>,
  },
}));

vi.mock('../icons/FlowerIcon', () => ({
  FlowerIcon: () => <span data-testid="flower-icon" />,
}));

vi.mock('../services/gatewayApi', () => ({
  fetchGatewayJSON: vi.fn(),
  prepareGatewayRequestInit: vi.fn(async () => ({})),
}));

vi.mock('../utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => clipboardMock.writeTextToClipboard(...args),
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env_id: () => 'env-1',
    env: envResource,
    settingsSeq: () => 0,
    aiThreadFocusSeq: () => 0,
    aiThreadFocusId: () => null,
  }),
}));

vi.mock('./aiPermissions', () => ({
  hasRWXPermissions: () => true,
}));

vi.mock('./AIChatContext', () => ({
  useAIChatContext: () => aiContextStub,
}));

describe('AIChatSidebar', () => {
  beforeEach(() => {
    protocolState.status = 'connected';
    notificationMock.error.mockReset();
    notificationMock.success.mockReset();
    clipboardMock.writeTextToClipboard.mockReset();
    clipboardMock.writeTextToClipboard.mockResolvedValue(undefined);
    aiContextStub = {
      threads: makeThreadsResource([]),
      activeThreadId: () => null,
      isThreadRunning: () => false,
      isThreadUnread: () => false,
      selectThreadId: vi.fn(),
      enterDraftChat: vi.fn(),
      clearActiveThreadPersistence: vi.fn(),
      bumpThreadsSeq: vi.fn(),
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows an unread dot for a non-running unread thread', () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-unread',
        run_status: 'waiting_user',
      }),
    ]);
    aiContextStub.isThreadUnread = (threadId: string) => threadId === 'thread-unread';

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const indicator = host.querySelector('[data-thread-id="thread-unread"] [data-thread-indicator]');
    expect(indicator?.getAttribute('data-thread-indicator')).toBe('unread');
  });

  it('keeps the running indicator when a running thread also has unread activity', () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-running',
        run_status: 'running',
      }),
    ]);
    aiContextStub.isThreadRunning = (threadId: string) => threadId === 'thread-running';
    aiContextStub.isThreadUnread = (threadId: string) => threadId === 'thread-running';

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const indicator = host.querySelector('[data-thread-id="thread-running"] [data-thread-indicator]');
    expect(indicator?.getAttribute('data-thread-indicator')).toBe('running');
  });

  it('leaves the indicator slot empty for a read non-running waiting_user thread', () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-read',
        run_status: 'waiting_user',
      }),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const indicator = host.querySelector('[data-thread-id="thread-read"] [data-thread-indicator]');
    expect(indicator?.getAttribute('data-thread-indicator')).toBe('none');
  });

  it('renders a dedicated delete button outside the thread selection button', () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-delete',
      }),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const threadCard = host.querySelector('[data-thread-id="thread-delete"]') as HTMLDivElement | null;
    const deleteButton = host.querySelector('button[aria-label="Delete chat Conversation"]') as HTMLButtonElement | null;

    expect(threadCard).toBeTruthy();
    expect(deleteButton).toBeTruthy();
    expect(threadCard?.querySelector('button button')).toBeNull();

    deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.textContent).toContain('Delete ');
    expect(host.textContent).toContain('"Conversation"?');
  });

  it('copies thread metadata from the thread row context menu', async () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-copy',
        working_dir: '/workspace/project',
      }),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const threadCard = host.querySelector('[data-thread-id="thread-copy"]') as HTMLDivElement | null;
    expect(threadCard).toBeTruthy();

    threadCard?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await Promise.resolve();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();
    expect(menu?.getAttribute('data-floe-local-interaction-surface')).toBe('true');

    const copyThreadIDButton = Array.from(menu?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Copy thread ID')
    ) as HTMLButtonElement | undefined;
    expect(copyThreadIDButton).toBeTruthy();
    copyThreadIDButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(clipboardMock.writeTextToClipboard).toHaveBeenNthCalledWith(1, 'thread-copy');
    expect(notificationMock.success).toHaveBeenNthCalledWith(1, 'Copied', 'Thread ID copied to clipboard');

    threadCard?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 44,
      clientY: 60,
    }));
    await Promise.resolve();

    const copyWorkingDirButton = Array.from(host.querySelectorAll('[role="menu"] button')).find((button) =>
      button.textContent?.includes('Copy working directory')
    ) as HTMLButtonElement | undefined;
    expect(copyWorkingDirButton).toBeTruthy();
    copyWorkingDirButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(clipboardMock.writeTextToClipboard).toHaveBeenNthCalledWith(2, '/workspace/project');
    expect(notificationMock.success).toHaveBeenNthCalledWith(2, 'Copied', 'Working directory copied to clipboard');
  });

  it('disables working directory copy when the thread has no working directory', async () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-no-working-dir',
        working_dir: '',
      }),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const threadCard = host.querySelector('[data-thread-id="thread-no-working-dir"]') as HTMLDivElement | null;
    threadCard?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await Promise.resolve();

    const copyWorkingDirButton = Array.from(host.querySelectorAll('[role="menu"] button')).find((button) =>
      button.textContent?.includes('Copy working directory')
    ) as HTMLButtonElement | undefined;

    expect(copyWorkingDirButton).toBeTruthy();
    expect(copyWorkingDirButton?.disabled).toBe(true);
  });

  it('keeps the threads rail actions fixed while the conversation list owns scrolling', () => {
    aiContextStub.threads = makeThreadsResource([
      makeThread({
        thread_id: 'thread-scroll',
      }),
    ]);

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <AIChatSidebar />, host);

    const content = host.querySelector('[data-testid="sidebar-content"]');
    const section = host.querySelector('[data-testid="sidebar-section"]');
    const scrollRegion = host.querySelector('[data-testid="flower-thread-scroll-region"]');
    const railBody = section?.parentElement;

    expect(content?.className).toContain('flex h-full min-h-0 flex-col overflow-hidden');
    expect(railBody?.className).toContain('flex flex-1 flex-col overflow-hidden');
    expect(section?.className).toContain('flex flex-1 flex-col overflow-hidden');
    expect(section?.className).toContain('[&>div:last-child]:flex-1');
    expect(scrollRegion?.className).toContain('flex-1 min-h-0 overflow-y-auto');
    expect(scrollRegion?.className).toContain('overscroll-contain');
    expect(scrollRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_ATTR)).toBe('true');
    expect(scrollRegion?.getAttribute(REDEVEN_WORKBENCH_WHEEL_ROLE_ATTR)).toBe(REDEVEN_WORKBENCH_WHEEL_ROLE_LOCAL_SCROLL_VIEWPORT);
  });
});
