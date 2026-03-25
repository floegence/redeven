// BlockRenderer — dispatcher that renders the appropriate block component based on block.type.

import { Switch, Match, Suspense, lazy } from 'solid-js';
import type { Component } from 'solid-js';
import type { MessageBlock } from '../types';
import { TextBlock } from './TextBlock';
import { MarkdownBlock } from './MarkdownBlock';
import { ImageBlock } from './ImageBlock';
import { FileBlock } from './FileBlock';
import { ChecklistBlock } from './ChecklistBlock';
import { ShellBlock } from './ShellBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { TodosBlock } from './TodosBlock';
import { SourcesBlock } from './SourcesBlock';
import { SubagentBlock } from './SubagentBlock';

// Lazy-load heavy components that rely on large third-party libraries
const CodeBlock = lazy(() =>
  import('./CodeBlock').then((m) => ({ default: m.CodeBlock })),
);
const CodeDiffBlock = lazy(() =>
  import('./CodeDiffBlock').then((m) => ({ default: m.CodeDiffBlock })),
);
const MermaidBlock = lazy(() =>
  import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock })),
);
const SvgBlock = lazy(() =>
  import('./SvgBlock').then((m) => ({ default: m.SvgBlock })),
);
const ToolCallBlock = lazy(() =>
  import('./ToolCallBlock').then((m) => ({ default: m.ToolCallBlock })),
);

export interface BlockRendererProps {
  block: MessageBlock;
  messageId: string;
  blockIndex: number;
  isStreaming?: boolean;
}

/**
 * A simple skeleton placeholder shown while lazy-loaded components are loading.
 */
const BlockSkeleton: Component = () => (
  <div
    class="chat-block-skeleton"
    style={{
      height: '48px',
      'border-radius': '6px',
      'background': 'var(--chat-skeleton-bg, rgba(128,128,128,0.15))',
      animation: 'chat-skeleton-pulse 1.5s ease-in-out infinite',
    }}
  />
);

/**
 * Dispatches to the correct block component based on `block.type`.
 * Heavy components (code, diff, mermaid, svg, tool-call) are lazy-loaded
 * and wrapped in Suspense with a skeleton fallback.
 */
export const BlockRenderer: Component<BlockRendererProps> = (props) => {
  return (
    <Switch
      fallback={
        <div class="chat-block-unknown">
          Unknown block type: {(props.block as any).type}
        </div>
      }
    >
      {/* Eagerly loaded blocks */}
      <Match when={props.block.type === 'text'}>
        <TextBlock content={(props.block as { content: string }).content} />
      </Match>

      <Match when={props.block.type === 'markdown'}>
        <MarkdownBlock
          content={(props.block as { content: string }).content}
          streaming={props.isStreaming}
        />
      </Match>

      <Match when={props.block.type === 'image'}>
        {(() => {
          const b = props.block as { src: string; alt?: string };
          return <ImageBlock src={b.src} alt={b.alt} />;
        })()}
      </Match>

      <Match when={props.block.type === 'file'}>
        {(() => {
          const b = props.block as {
            name: string;
            size: number;
            mimeType: string;
            url?: string;
          };
          return (
            <FileBlock
              name={b.name}
              size={b.size}
              mimeType={b.mimeType}
              url={b.url}
            />
          );
        })()}
      </Match>

      <Match when={props.block.type === 'checklist'}>
        {(() => {
          const b = props.block as { items: import('../types').ChecklistItem[] };
          return (
            <ChecklistBlock
              items={b.items}
              messageId={props.messageId}
              blockIndex={props.blockIndex}
            />
          );
        })()}
      </Match>

      <Match when={props.block.type === 'shell'}>
        {(() => {
          const b = props.block as {
            command: string;
            output?: string;
            outputRef?: { runId: string; toolId: string };
            cwd?: string;
            timeoutMs?: number;
            durationMs?: number;
            timedOut?: boolean;
            truncated?: boolean;
            exitCode?: number;
            status: 'running' | 'success' | 'error';
          };
          return (
            <ShellBlock
              command={b.command}
              output={b.output}
              outputRef={b.outputRef}
              cwd={b.cwd}
              timeoutMs={b.timeoutMs}
              durationMs={b.durationMs}
              timedOut={b.timedOut}
              truncated={b.truncated}
              exitCode={b.exitCode}
              status={b.status}
            />
          );
        })()}
      </Match>

      <Match when={props.block.type === 'thinking'}>
        {(() => {
          const b = props.block as { content?: string; duration?: number };
          return <ThinkingBlock content={b.content} duration={b.duration} />;
        })()}
      </Match>

      <Match when={props.block.type === 'request_user_input_response'}>
        {(() => {
          const b = props.block as {
            public_summary?: string;
            responses?: Array<{ public_summary?: string }>;
            contains_secret?: boolean;
          };
          const summary = String(b.public_summary ?? '').trim()
            || (Array.isArray(b.responses)
              ? b.responses.map((item) => String(item?.public_summary ?? '').trim()).filter(Boolean).join(' ')
              : '');
          return (
            <div class="chat-tool-ask-user-submitted">
              <span class="chat-tool-ask-user-submitted-label">Input Submitted</span>
              <p class="chat-tool-ask-user-submitted-text">
                {summary || (b.contains_secret ? 'Secret input submitted.' : 'Structured input submitted.')}
              </p>
            </div>
          );
        })()}
      </Match>

      {/* Lazy-loaded blocks wrapped in Suspense */}
      <Match when={props.block.type === 'code'}>
        {(() => {
          const b = props.block as {
            language: string;
            content: string;
            filename?: string;
          };
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <CodeBlock
                language={b.language}
                content={b.content}
                filename={b.filename}
              />
            </Suspense>
          );
        })()}
      </Match>

      <Match when={props.block.type === 'code-diff'}>
        {(() => {
          const b = props.block as {
            language: string;
            oldCode: string;
            newCode: string;
            filename?: string;
          };
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <CodeDiffBlock
                language={b.language}
                oldCode={b.oldCode}
                newCode={b.newCode}
                filename={b.filename}
              />
            </Suspense>
          );
        })()}
      </Match>

      <Match when={props.block.type === 'mermaid'}>
        {(() => {
          const b = props.block as { content: string };
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <MermaidBlock content={b.content} />
            </Suspense>
          );
        })()}
      </Match>

      <Match when={props.block.type === 'svg'}>
        {(() => {
          const b = props.block as { content: string };
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <SvgBlock content={b.content} />
            </Suspense>
          );
        })()}
      </Match>

      <Match when={props.block.type === 'tool-call'}>
        {(() => {
          const b = props.block as import('../types').ToolCallBlock;
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <ToolCallBlock
                block={b}
                messageId={props.messageId}
                blockIndex={props.blockIndex}
              />
            </Suspense>
          );
        })()}
      </Match>

      <Match when={props.block.type === 'todos'}>
        {(() => {
          const b = props.block as import('../types').TodosBlock;
          return (
            <TodosBlock
              version={b.version}
              updatedAtUnixMs={b.updatedAtUnixMs}
              todos={b.todos}
            />
          );
        })()}
      </Match>

      <Match when={props.block.type === 'sources'}>
        <SourcesBlock sources={(props.block as import('../types').SourcesBlock).sources} />
      </Match>

      <Match when={props.block.type === 'subagent'}>
        <SubagentBlock block={props.block as import('../types').SubagentBlock} />
      </Match>
    </Switch>
  );
};
