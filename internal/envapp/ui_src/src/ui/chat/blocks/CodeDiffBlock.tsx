// CodeDiffBlock — unified code diff viewer.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn, deferAfterPaint } from '@floegence/floe-webapp-core';

import { useVirtualWindow } from '../hooks/useVirtualWindow';
import {
  CHAT_DIFF_ROW_HEIGHT_PX,
  isLargeCodeDiff,
  resolveDiffViewportHeight,
} from '../responsiveness';
import type { CodeDiffRenderModel, UnifiedDiffLine } from '../types';
import {
  hasDiffWorkerSupport,
  renderCodeDiffModel,
  renderCodeDiffModelSync,
} from '../workers/diffWorkerClient';

export interface CodeDiffBlockProps {
  language: string;
  oldCode: string;
  newCode: string;
  filename?: string;
  class?: string;
}

async function renderDiffModel(oldCode: string, newCode: string): Promise<CodeDiffRenderModel> {
  if (isLargeCodeDiff(oldCode, newCode) && hasDiffWorkerSupport()) {
    try {
      return await renderCodeDiffModel(oldCode, newCode);
    } catch (error) {
      console.warn('Failed to render diff in worker, falling back to main thread.', error);
    }
  }

  return renderCodeDiffModelSync(oldCode, newCode);
}

function lineClass(type: string): string {
  switch (type) {
    case 'added':
      return 'chat-diff-line chat-diff-line-added';
    case 'removed':
      return 'chat-diff-line chat-diff-line-removed';
    case 'empty':
      return 'chat-diff-line chat-diff-line-empty';
    default:
      return 'chat-diff-line chat-diff-line-context';
  }
}

function lineStyle(virtualized: boolean): Record<string, string> | undefined {
  if (!virtualized) {
    return undefined;
  }

  return {
    height: `${CHAT_DIFF_ROW_HEIGHT_PX}px`,
  };
}

function UnifiedDiffRow(props: { line: UnifiedDiffLine; virtualized: boolean }) {
  return (
    <div class={lineClass(props.line.type)} style={lineStyle(props.virtualized)}>
      <span class="chat-diff-line-sign">{props.line.sign}</span>
      <span class="chat-diff-line-number">{props.line.lineNumber ?? ''}</span>
      <span class="chat-diff-line-content">{props.line.content}</span>
    </div>
  );
}

/** Renders a unified diff view of code changes. */
export const CodeDiffBlock: Component<CodeDiffBlockProps> = (props) => {
  const [diffModel, setDiffModel] = createSignal<CodeDiffRenderModel | null>(null);
  const [error, setError] = createSignal('');
  const [virtualized, setVirtualized] = createSignal(false);
  let renderRequestSeq = 0;

  createEffect(() => {
    const oldCode = props.oldCode;
    const newCode = props.newCode;
    const seq = (renderRequestSeq += 1);
    const nextVirtualized = isLargeCodeDiff(oldCode, newCode);
    let disposed = false;

    setDiffModel(null);
    setError('');
    setVirtualized(nextVirtualized);

    deferAfterPaint(() => {
      if (disposed || seq !== renderRequestSeq) return;

      void renderDiffModel(oldCode, newCode)
        .then((model) => {
          if (disposed || seq !== renderRequestSeq) return;
          setDiffModel(model);
          setError('');
        })
        .catch((renderError) => {
          if (disposed || seq !== renderRequestSeq) return;
          console.error('Failed to compute diff:', renderError);
          setError('Failed to compute diff');
        });
    });

    onCleanup(() => {
      disposed = true;
    });
  });

  const statsText = createMemo(() => {
    const model = diffModel();
    if (!model) return '';
    const { added, removed } = model.stats;
    const parts: string[] = [];
    if (added > 0) parts.push(`+${added}`);
    if (removed > 0) parts.push(`-${removed}`);
    return parts.join(' ');
  });

  const currentLineCount = createMemo(() => {
    const model = diffModel();
    return model ? model.unifiedLines.length : 0;
  });

  const virtualWindow = useVirtualWindow({
    count: currentLineCount,
    itemSize: () => CHAT_DIFF_ROW_HEIGHT_PX,
    overscan: 12,
  });

  const visibleUnifiedLines = createMemo(() => {
    const model = diffModel();
    if (!model) return [];
    const { start, end } = virtualWindow.range();
    return model.unifiedLines.slice(start, end);
  });

  const viewportHeight = createMemo(() => resolveDiffViewportHeight(currentLineCount()));

  return (
    <div class={cn('chat-code-diff-block', props.class)}>
      <div class="chat-code-diff-header">
        <div class="chat-code-diff-info">
          <Show when={props.filename}>
            <span class="chat-code-diff-filename">{props.filename}</span>
          </Show>
          <Show when={statsText()}>
            <span class="chat-code-diff-stats">{statsText()}</span>
          </Show>
        </div>
      </div>

      <Show when={error()}>
        <div class="chat-code-diff-error">{error()}</div>
      </Show>

      <Show when={diffModel()}>
        {(model) => (
          <div
            class={cn(
              'chat-code-diff-content',
              virtualized() && 'chat-code-diff-content-virtualized',
            )}
          >
            <Show
              when={virtualized()}
              fallback={(
                <div class="chat-code-diff-unified">
                  <For each={model().unifiedLines}>
                    {(line) => <UnifiedDiffRow line={line} virtualized={false} />}
                  </For>
                </div>
              )}
            >
              <div
                ref={virtualWindow.scrollRef}
                class="chat-code-diff-viewport"
                onScroll={virtualWindow.onScroll}
                style={{ height: `${viewportHeight()}px` }}
              >
                <div class="chat-code-diff-unified">
                  <div style={{ height: `${virtualWindow.paddingTop()}px` }} />
                  <For each={visibleUnifiedLines()}>
                    {(line) => <UnifiedDiffRow line={line} virtualized />}
                  </For>
                  <div style={{ height: `${virtualWindow.paddingBottom()}px` }} />
                </div>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};

export default CodeDiffBlock;
