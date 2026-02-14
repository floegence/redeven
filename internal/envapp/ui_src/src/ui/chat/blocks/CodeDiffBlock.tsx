// CodeDiffBlock — code diff viewer with unified/split toggle.
// Uses dynamic import of the 'diff' library.

import { createSignal, createMemo, createEffect, Show, For } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { CodeDiffRenderModel, UnifiedDiffLine, SplitDiffLine } from '../types';

export interface CodeDiffBlockProps {
  language: string;
  oldCode: string;
  newCode: string;
  filename?: string;
  class?: string;
}

/**
 * Parse a unified diff string into structured line models for rendering.
 */
function parseDiffModel(patch: string): CodeDiffRenderModel {
  const lines = patch.split('\n');
  const unifiedLines: UnifiedDiffLine[] = [];
  const leftLines: SplitDiffLine[] = [];
  const rightLines: SplitDiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let leftLineNum = 0;
  let rightLineNum = 0;

  for (const line of lines) {
    // Skip diff headers
    if (
      line.startsWith('===') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('Index:') ||
      line.startsWith('diff ')
    ) {
      continue;
    }

    // Parse hunk header to get line numbers
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        leftLineNum = parseInt(match[1], 10) - 1;
        rightLineNum = parseInt(match[2], 10) - 1;
      }
      continue;
    }

    if (line.startsWith('+')) {
      rightLineNum++;
      addedCount++;
      const content = line.slice(1);
      unifiedLines.push({
        type: 'added',
        sign: '+',
        lineNumber: rightLineNum,
        content,
      });
      leftLines.push({ type: 'empty', lineNumber: null, content: '' });
      rightLines.push({ type: 'added', lineNumber: rightLineNum, content });
    } else if (line.startsWith('-')) {
      leftLineNum++;
      removedCount++;
      const content = line.slice(1);
      unifiedLines.push({
        type: 'removed',
        sign: '-',
        lineNumber: leftLineNum,
        content,
      });
      leftLines.push({ type: 'removed', lineNumber: leftLineNum, content });
      rightLines.push({ type: 'empty', lineNumber: null, content: '' });
    } else if (line.startsWith(' ')) {
      leftLineNum++;
      rightLineNum++;
      const content = line.slice(1);
      unifiedLines.push({
        type: 'context',
        sign: ' ',
        lineNumber: leftLineNum,
        content,
      });
      leftLines.push({ type: 'context', lineNumber: leftLineNum, content });
      rightLines.push({ type: 'context', lineNumber: rightLineNum, content });
    }
    // Skip empty lines in the diff or the newline-at-eof marker
  }

  return {
    unifiedLines,
    split: { left: leftLines, right: rightLines },
    stats: { added: addedCount, removed: removedCount },
  };
}

/**
 * Renders a side-by-side or unified diff view of code changes.
 */
export const CodeDiffBlock: Component<CodeDiffBlockProps> = (props) => {
  const [viewMode, setViewMode] = createSignal<'unified' | 'split'>('unified');
  const [diffModel, setDiffModel] = createSignal<CodeDiffRenderModel | null>(null);
  const [error, setError] = createSignal<string>('');

  // Compute diff when code changes
  createEffect(() => {
    const oldCode = props.oldCode;
    const newCode = props.newCode;

    import('diff')
      .then(({ createPatch }) => {
        const filename = props.filename || 'file';
        const patch = createPatch(filename, oldCode, newCode, '', '', { context: 3 });
        const model = parseDiffModel(patch);
        setDiffModel(model);
        setError('');
      })
      .catch((err) => {
        console.error('Failed to load diff library:', err);
        setError('Failed to compute diff');
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

  const lineClass = (type: string): string => {
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
  };

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
        <div class="chat-code-diff-actions">
          <button
            class={cn(
              'chat-code-diff-toggle-btn',
              viewMode() === 'unified' && 'chat-code-diff-toggle-btn-active',
            )}
            onClick={() => setViewMode('unified')}
          >
            Unified
          </button>
          <button
            class={cn(
              'chat-code-diff-toggle-btn',
              viewMode() === 'split' && 'chat-code-diff-toggle-btn-active',
            )}
            onClick={() => setViewMode('split')}
          >
            Split
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="chat-code-diff-error">{error()}</div>
      </Show>

      <Show when={diffModel()}>
        {(model) => (
          <div class="chat-code-diff-content">
            <Show
              when={viewMode() === 'unified'}
              fallback={
                // Split view
                <div class="chat-code-diff-split">
                  <div class="chat-code-diff-split-panel chat-code-diff-split-left">
                    <For each={model().split.left}>
                      {(line) => (
                        <div class={lineClass(line.type)}>
                          <span class="chat-diff-line-number">
                            {line.lineNumber ?? ''}
                          </span>
                          <span class="chat-diff-line-content">{line.content}</span>
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="chat-code-diff-split-panel chat-code-diff-split-right">
                    <For each={model().split.right}>
                      {(line) => (
                        <div class={lineClass(line.type)}>
                          <span class="chat-diff-line-number">
                            {line.lineNumber ?? ''}
                          </span>
                          <span class="chat-diff-line-content">{line.content}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              }
            >
              {/* Unified view */}
              <div class="chat-code-diff-unified">
                <For each={model().unifiedLines}>
                  {(line) => (
                    <div class={lineClass(line.type)}>
                      <span class="chat-diff-line-sign">{line.sign}</span>
                      <span class="chat-diff-line-number">
                        {line.lineNumber ?? ''}
                      </span>
                      <span class="chat-diff-line-content">{line.content}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};

export default CodeDiffBlock;
