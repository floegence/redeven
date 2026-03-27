// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexTranscript } from './CodexTranscript';
import type { CodexTranscriptItem } from './types';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Code: Icon,
    FileText: Icon,
    Terminal: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

vi.mock('../chat/blocks/MarkdownBlock', () => ({
  MarkdownBlock: (props: any) => <div class={props.class}>{props.content}</div>,
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

function renderTranscript(items: CodexTranscriptItem[], options?: {
  showWorkingState?: boolean;
  workingLabel?: string;
  workingFlags?: string[];
}) {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => (
    <CodexTranscript
      items={items}
      showWorkingState={options?.showWorkingState}
      workingLabel={options?.workingLabel}
      workingFlags={options?.workingFlags}
      emptyTitle="Empty"
      emptyBody="Nothing yet."
    />
  ), host);
  return { host, dispose };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CodexTranscript', () => {
  it('renders the compact working indicator without a trailing assistant avatar and keeps a cursor visible', () => {
    const { host, dispose } = renderTranscript([], {
      showWorkingState: true,
      workingLabel: 'working',
      workingFlags: ['web search'],
    });

    expect(host.querySelector('[data-codex-working-state="true"]')).toBeTruthy();
    expect(host.textContent).toContain('Working...');
    expect(host.textContent).not.toContain('Codex is');
    expect(host.textContent).not.toContain('web search');
    expect(host.querySelector('.codex-message-run-indicator-graph')).toBeTruthy();
    expect(host.querySelector('[data-testid="streaming-cursor"]')).toBeTruthy();
    expect(host.querySelector('[data-codex-working-state="true"] .chat-message-avatar')).toBeNull();

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
});
