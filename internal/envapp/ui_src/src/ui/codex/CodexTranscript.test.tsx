// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexTranscript } from './CodexTranscript';
import type { CodexOptimisticUserTurn, CodexTranscriptItem } from './types';

const openPreview = vi.fn(async () => undefined);
const readFileBytesOnceMock = vi.fn();
const protocolState: {
  client: () => Record<string, never> | null;
} = {
  client: () => null,
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => protocolState,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    ChevronRight: Icon,
    Code: Icon,
    FileText: Icon,
    Sparkles: Icon,
    Terminal: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

vi.mock('../chat/blocks/MarkdownBlock', () => ({
  MarkdownBlock: (props: any) => (
    <div class={props.class} data-markdown-streaming={props.streaming ? 'true' : 'false'}>
      {props.content}
      {props.streaming ? <span data-testid="streaming-cursor">{'\u258B'}</span> : null}
    </div>
  ),
}));

vi.mock('../chat/blocks/ShellBlock', () => ({
  ShellBlock: (props: any) => <div class={props.class}>{props.command}{props.output}</div>,
}));

vi.mock('../chat/blocks/ThinkingBlock', () => ({
  ThinkingBlock: (props: any) => <div class={props.class}>{props.content}</div>,
}));

vi.mock('../chat/status/StreamingCursor', () => ({
  StreamingCursor: () => <span data-testid="streaming-cursor">{'\u258B'}</span>,
}));

vi.mock('../icons/CodexIcon', () => ({
  CodexIcon: (props: any) => <span class={props.class}>Codex</span>,
}));

vi.mock('../widgets/FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview,
  }),
}));

vi.mock('../utils/fileStreamReader', () => ({
  readFileBytesOnce: (...args: unknown[]) => readFileBytesOnceMock(...args),
}));

function renderTranscript(items: CodexTranscriptItem[], options?: {
  optimisticUserTurns?: CodexOptimisticUserTurn[];
  showWorkingState?: boolean;
  workingLabel?: string;
  workingFlags?: string[];
}) {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => (
    <CodexTranscript
      items={items}
      optimisticUserTurns={options?.optimisticUserTurns}
      showWorkingState={options?.showWorkingState}
      workingLabel={options?.workingLabel}
      workingFlags={options?.workingFlags}
      emptyTitle="Empty"
      emptyBody="Nothing yet."
    />
  ), host);
  return { host, dispose };
}

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

afterEach(() => {
  openPreview.mockReset();
  readFileBytesOnceMock.mockReset();
  protocolState.client = () => null;
  document.body.innerHTML = '';
});

describe('CodexTranscript', () => {
  it('renders a single pending assistant lane with the pre-output cursor above the compact working indicator', () => {
    const { host, dispose } = renderTranscript([], {
      showWorkingState: true,
      workingLabel: 'working',
      workingFlags: ['web search'],
    });
    const rows = Array.from(host.querySelectorAll('.codex-transcript-row'));
    const preOutputRow = host.querySelector('[data-codex-pre-output="true"]')?.closest('.chat-message-item');
    const workingRow = host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('[data-codex-pre-output="true"]')).toBeTruthy();
    expect(rows[0]?.querySelector('[data-codex-working-state="true"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-pre-output="true"] [data-testid="streaming-cursor"]')).toBeTruthy();
    expect(preOutputRow).toBe(workingRow);
    expect(preOutputRow?.classList.contains('codex-assistant-lead-aligned-row')).toBe(true);
    expect(preOutputRow?.querySelector('.chat-message-content-wrapper')?.classList.contains('codex-assistant-lead-aligned-content-prelude')).toBe(true);
    expect(preOutputRow?.querySelector('.chat-message-avatar')).toBeTruthy();
    expect(host.querySelector('[data-codex-working-state="true"]')).toBeTruthy();
    expect(host.textContent).toContain('Working...');
    expect(host.textContent).not.toContain('Codex is');
    expect(host.textContent).not.toContain('web search');
    expect(host.querySelector('.codex-message-run-indicator-graph')).toBeTruthy();
    expect(host.querySelector('[data-codex-working-state="true"] [data-testid="streaming-cursor"]')).toBeNull();
    expect(workingRow?.querySelector('.chat-message-avatar')).toBeTruthy();

    dispose();
  });

  it('hands the streaming cursor over to the real agent message once output starts', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_agent_live',
        type: 'agentMessage',
        text: 'Streaming response',
        status: 'inProgress',
        order: 0,
      },
    ], {
      showWorkingState: true,
      workingLabel: 'working',
    });
    const workingRow = host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item');
    const agentRow = host.querySelector('[data-codex-item-type="agentMessage"]')?.closest('.chat-message-item');

    expect(host.querySelector('[data-codex-pre-output="true"]')).toBeNull();
    expect(host.querySelector('[data-codex-item-type="agentMessage"] [data-markdown-streaming="true"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-item-type="agentMessage"] [data-testid="streaming-cursor"]')).toBeTruthy();
    expect(agentRow?.classList.contains('codex-assistant-lead-aligned-row')).toBe(true);
    expect(agentRow?.querySelector('.chat-message-content-wrapper')?.classList.contains('codex-assistant-lead-aligned-content-markdown')).toBe(true);
    expect(host.querySelector('[data-codex-working-state="true"] [data-testid="streaming-cursor"]')).toBeNull();
    expect(workingRow?.querySelector('.chat-message-avatar')).toBeNull();

    dispose();
  });

  it('keeps the pre-output cursor visible for a new optimistic turn even when the previous run already has assistant output', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_previous',
        type: 'userMessage',
        text: 'Review the previous answer.',
        order: 0,
      },
      {
        id: 'item_agent_previous',
        type: 'agentMessage',
        text: 'Previous assistant answer.',
        order: 1,
      },
    ], {
      optimisticUserTurns: [
        {
          id: 'optimistic_turn_1',
          thread_id: 'thread_1',
          text: 'Please continue.',
          inputs: [],
        },
      ],
      showWorkingState: true,
      workingLabel: 'working',
    });

    expect(host.querySelector('[data-codex-pre-output="true"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-pre-output="true"] [data-testid="streaming-cursor"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-pre-output="true"]')?.closest('.chat-message-item')).toBe(
      host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item'),
    );
    expect(host.querySelector('[data-codex-working-state="true"]')?.closest('.chat-message-item')?.querySelector('.chat-message-avatar')).toBeTruthy();

    dispose();
  });

  it('shows the Codex avatar only on the first agent message until a user message resets the run', () => {
    const items: CodexTranscriptItem[] = [
      {
        id: 'item_reasoning_intro',
        type: 'reasoning',
        text: 'Planning the next steps.',
        order: 0,
      },
      {
        id: 'item_agent_first',
        type: 'agentMessage',
        text: 'First assistant message.',
        order: 1,
      },
      {
        id: 'item_web_search',
        type: 'webSearch',
        query: 'codex ui avatar grouping',
        action: {
          type: 'search',
          queries: ['codex ui avatar grouping'],
        },
        order: 2,
      },
      {
        id: 'item_agent_second',
        type: 'agentMessage',
        text: 'Second assistant message.',
        order: 3,
      },
      {
        id: 'item_user_reset',
        type: 'userMessage',
        text: 'Please continue.',
        order: 4,
      },
      {
        id: 'item_agent_after_user',
        type: 'agentMessage',
        text: 'Assistant message after user reset.',
        order: 5,
      },
    ];

    const { host, dispose } = renderTranscript(items);
    const rows = Array.from(host.querySelectorAll('.codex-transcript-row'));

    expect(rows).toHaveLength(6);
    expect(rows[0]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[1]?.querySelector('.chat-message-avatar')).toBeTruthy();
    expect(rows[1]?.querySelector('.chat-message-item')?.classList.contains('codex-assistant-lead-aligned-row')).toBe(true);
    expect(rows[1]?.querySelector('.chat-message-content-wrapper')?.classList.contains('codex-assistant-lead-aligned-content-markdown')).toBe(true);
    expect(rows[2]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[3]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[3]?.querySelector('.chat-message-item')?.classList.contains('codex-assistant-lead-aligned-row')).toBe(false);
    expect(rows[4]?.querySelector('.chat-message-avatar')).toBeNull();
    expect(rows[5]?.querySelector('.chat-message-avatar')).toBeTruthy();
    expect(rows[5]?.querySelector('.chat-message-item')?.classList.contains('codex-assistant-lead-aligned-row')).toBe(true);
    expect(host.querySelectorAll('.chat-message-avatar')).toHaveLength(2);

    dispose();
  });

  it('renders reasoning as a collapsible markdown block and auto-collapses it after completion', async () => {
    const [items, setItems] = createSignal<CodexTranscriptItem[]>([
      {
        id: 'item_reasoning_live',
        type: 'reasoning',
        text: 'Investigating the event replay path.\n\n- Verify resume flow',
        status: 'inProgress',
        order: 0,
      },
    ]);
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => (
      <CodexTranscript
        items={items()}
        emptyTitle="Empty"
        emptyBody="Nothing yet."
      />
    ), host);

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('true');
    expect(host.textContent).not.toContain('Reasoning note');
    expect(host.querySelector('.codex-chat-reasoning-card')).toBeNull();
    expect(host.querySelector('.codex-chat-reasoning-toggle .codex-chat-reasoning-kicker')).toBeTruthy();
    expect(host.querySelector('.codex-chat-reasoning-markdown')).toBeTruthy();

    setItems([
      {
        id: 'item_reasoning_live',
        type: 'reasoning',
        text: 'Investigating the event replay path.\n\n- Verify resume flow',
        status: 'completed',
        order: 0,
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('false');

    const toggle = host.querySelector('.codex-chat-reasoning-toggle') as HTMLButtonElement | null;
    toggle?.click();
    await Promise.resolve();

    expect(host.querySelector('[data-codex-reasoning-row="true"]')?.getAttribute('data-codex-reasoning-expanded')).toBe('true');
    expect(host.textContent).toContain('Investigating the event replay path.');

    dispose();
  });

  it('keeps evidence rows avatar-free, hides empty reasoning rows, and shows web search details instead of a No content fallback', () => {
    const items: CodexTranscriptItem[] = [
      {
        id: 'item_reasoning_empty',
        type: 'reasoning',
        summary: [],
        content: [],
        order: 0,
      },
      {
        id: 'item_web_search',
        type: 'webSearch',
        query: 'site:nmc.cn changsha weather',
        action: {
          type: 'search',
          queries: [
            'site:nmc.cn changsha weather',
            'site:weather.com changsha weather',
          ],
        },
        order: 1,
      },
      {
        id: 'item_web_search_open',
        type: 'webSearch',
        action: {
          type: 'openPage',
          url: 'https://nmc.cn/publish/forecast/AHN/changsha.html',
        },
        order: 2,
      },
    ];

    const { host, dispose } = renderTranscript(items);

    expect(host.textContent).not.toContain('Reasoning note');
    expect(host.textContent).toContain('Web search');
    expect(host.textContent).toContain('site:nmc.cn changsha weather');
    expect(host.textContent).toContain('Opened page: https://nmc.cn/publish/forecast/AHN/changsha.html');
    expect(host.textContent).not.toContain('No content.');
    expect(host.querySelector('[data-codex-item-type="webSearch"] .chat-message-avatar')).toBeNull();

    dispose();
  });

  it('renders command execution rows as direct shell blocks without the extra evidence header wrapper', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_command',
        type: 'commandExecution',
        command: 'pnpm test',
        aggregated_output: 'PASS CodexTranscript.test.tsx',
        status: 'completed',
        exit_code: 0,
        order: 0,
      },
    ]);

    expect(host.textContent).toContain('pnpm test');
    expect(host.textContent).toContain('PASS CodexTranscript.test.tsx');
    expect(host.textContent).not.toContain('Command evidence');
    expect(host.querySelector('.codex-chat-evidence-card')).toBeNull();

    dispose();
  });

  it('renders user-authored text as raw text instead of markdown or HTML', () => {
    const rawText = '<div class="demo">literal html</div>\n# not a heading\n[not a link](/tmp/demo.txt)';
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_raw',
        type: 'userMessage',
        text: '',
        inputs: [
          {
            type: 'text',
            text: rawText,
          },
        ],
        order: 0,
      },
    ]);

    const userRow = host.querySelector('[data-codex-item-type="userMessage"]');
    const rawBlock = host.querySelector('.codex-chat-user-raw-text');

    expect(rawBlock?.textContent).toBe(rawText);
    expect(userRow?.querySelector('a')).toBeNull();
    expect(userRow?.querySelector('h1')).toBeNull();
    expect(userRow?.querySelector('.codex-chat-markdown-block')).toBeNull();

    dispose();
  });

  it('renders structured user inputs in source order and keeps remote image thumbnails inline', () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_structured',
        type: 'userMessage',
        text: '',
        inputs: [
          { type: 'text', text: 'before image' },
          { type: 'image', url: 'data:image/png;base64,AAAA', name: 'diagram.png' },
          { type: 'text', text: 'after image' },
        ],
        order: 0,
      },
    ]);

    const userContent = host.querySelector('.codex-chat-user-content');
    const inputTypes = Array.from(userContent?.children ?? []).map((element) => element.getAttribute('data-codex-user-input-type'));
    const image = host.querySelector('.codex-chat-user-image') as HTMLImageElement | null;

    expect(inputTypes).toEqual(['text', 'image', 'text']);
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(image?.getAttribute('alt')).toBe('diagram.png');

    dispose();
  });

  it('opens the file preview when a structured local file input is clicked', async () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_skill',
        type: 'userMessage',
        text: '',
        inputs: [
          {
            type: 'skill',
            name: 'checks',
            path: '/workspace/.codex/skills/checks/SKILL.md',
          },
        ],
        order: 0,
      },
    ]);

    const skillButton = host.querySelector('[data-codex-user-input-type="skill"]');
    skillButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(openPreview).toHaveBeenCalledWith({
      id: '/workspace/.codex/skills/checks/SKILL.md',
      name: 'checks',
      path: '/workspace/.codex/skills/checks/SKILL.md',
      type: 'file',
    });

    dispose();
  });

  it('renders fallback user text together with file mention cards and opens the file preview', async () => {
    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_file_mention',
        type: 'userMessage',
        text: 'Review this implementation.',
        inputs: [
          {
            type: 'mention',
            name: 'CodexComposerShell.tsx',
            path: '/workspace/src/ui/codex/CodexComposerShell.tsx',
          },
        ],
        order: 0,
      },
    ]);

    expect(host.textContent).toContain('Review this implementation.');
    const fileButton = host.querySelector('[data-codex-user-input-type="mention"]');
    expect(fileButton?.textContent).toContain('CodexComposerShell.tsx');

    fileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(openPreview).toHaveBeenCalledWith({
      id: '/workspace/src/ui/codex/CodexComposerShell.tsx',
      name: 'CodexComposerShell.tsx',
      path: '/workspace/src/ui/codex/CodexComposerShell.tsx',
      type: 'file',
    });

    dispose();
  });

  it('loads a local image thumbnail and still routes clicks into the file preview surface', async () => {
    protocolState.client = () => ({});
    readFileBytesOnceMock.mockResolvedValue({
      bytes: new Uint8Array([137, 80, 78, 71]),
      meta: {
        ok: true,
        content_len: 4,
        truncated: false,
      },
    });

    const createObjectURL = vi.fn(() => 'blob:local-image-preview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { host, dispose } = renderTranscript([
      {
        id: 'item_user_local_image',
        type: 'userMessage',
        text: '',
        inputs: [
          {
            type: 'localImage',
            name: 'mock.png',
            path: '/workspace/mock.png',
          },
        ],
        order: 0,
      },
    ]);

    await flushAsync();

    const image = host.querySelector('.codex-chat-user-local-image') as HTMLImageElement | null;
    const card = host.querySelector('[data-codex-user-input-type="localImage"]');

    expect(readFileBytesOnceMock).toHaveBeenCalledWith({
      client: {},
      path: '/workspace/mock.png',
      maxBytes: 20 * 1024 * 1024,
    });
    expect(image?.getAttribute('src')).toBe('blob:local-image-preview');

    card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(openPreview).toHaveBeenCalledWith({
      id: '/workspace/mock.png',
      name: 'mock.png',
      path: '/workspace/mock.png',
      type: 'file',
    });

    dispose();
  });
});
