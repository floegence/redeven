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
      <Match when={props.block.type === 'text' && props.block}>
        {(block) => <TextBlock content={block().content} />}
      </Match>

      <Match when={props.block.type === 'markdown' && props.block}>
        {(block) => (
          <MarkdownBlock
            content={(block() as { content: string }).content}
            streaming={props.isStreaming}
          />
        )}
      </Match>

      <Match when={props.block.type === 'image' && props.block}>
        {(block) => {
          const b = block() as { src: string; alt?: string };
          return <ImageBlock src={b.src} alt={b.alt} />;
        }}
      </Match>

      <Match when={props.block.type === 'file' && props.block}>
        {(block) => {
          const b = block() as {
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
        }}
      </Match>

      <Match when={props.block.type === 'checklist' && props.block}>
        {(block) => {
          const b = block() as { items: import('../types').ChecklistItem[] };
          return (
            <ChecklistBlock
              items={b.items}
              messageId={props.messageId}
              blockIndex={props.blockIndex}
            />
          );
        }}
      </Match>

      <Match when={props.block.type === 'shell' && props.block}>
        {(block) => {
          const b = block() as {
            command: string;
            output?: string;
            exitCode?: number;
            status: 'running' | 'success' | 'error';
          };
          return (
            <ShellBlock
              command={b.command}
              output={b.output}
              exitCode={b.exitCode}
              status={b.status}
            />
          );
        }}
      </Match>

      <Match when={props.block.type === 'thinking' && props.block}>
        {(block) => {
          const b = block() as { content?: string; duration?: number };
          return <ThinkingBlock content={b.content} duration={b.duration} />;
        }}
      </Match>

      {/* Lazy-loaded blocks wrapped in Suspense */}
      <Match when={props.block.type === 'code' && props.block}>
        {(block) => {
          const b = block() as {
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
        }}
      </Match>

      <Match when={props.block.type === 'code-diff' && props.block}>
        {(block) => {
          const b = block() as {
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
        }}
      </Match>

      <Match when={props.block.type === 'mermaid' && props.block}>
        {(block) => {
          const b = block() as { content: string };
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <MermaidBlock content={b.content} />
            </Suspense>
          );
        }}
      </Match>

      <Match when={props.block.type === 'svg' && props.block}>
        {(block) => {
          const b = block() as { content: string };
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <SvgBlock content={b.content} />
            </Suspense>
          );
        }}
      </Match>

      <Match when={props.block.type === 'tool-call' && props.block}>
        {(block) => {
          const b = block() as import('../types').ToolCallBlock;
          return (
            <Suspense fallback={<BlockSkeleton />}>
              <ToolCallBlock
                block={b}
                messageId={props.messageId}
                blockIndex={props.blockIndex}
              />
            </Suspense>
          );
        }}
      </Match>
    </Switch>
  );
};
