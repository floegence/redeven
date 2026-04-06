import { For, Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import {
  formatGitPatchLineNumber,
  gitPatchPreviewLineClass,
  gitPatchRenderedLineClass,
} from '../utils/gitPatch';
import {
  buildCodexRenderableFilePatch,
  codexFileChangeKindLabel,
} from './fileChangeDiff';
import type { CodexFileChange } from './types';

export function CodexFileChangeDiff(props: {
  change: CodexFileChange;
}) {
  const patch = createMemo(() => buildCodexRenderableFilePatch(props.change));

  return (
    <div class="codex-chat-file-change">
      <div class="codex-chat-file-change-header">
        <div class="codex-chat-file-change-title">
          <span class="codex-chat-file-change-path" title={patch().path}>
            {patch().path}
          </span>
          <span class={cn(
            'codex-chat-file-change-kind',
            `codex-chat-file-change-kind-${patch().changeKind}`,
          )}
          >
            {codexFileChangeKindLabel(patch().changeKind)}
          </span>
        </div>
        <div class="codex-chat-file-change-metrics" aria-label="Patch statistics">
          <span class="codex-chat-file-change-metric codex-chat-file-change-metric-added">
            +{patch().additions}
          </span>
          <span class="codex-chat-file-change-metric codex-chat-file-change-metric-deleted">
            -{patch().deletions}
          </span>
        </div>
      </div>

      <Show when={patch().movePath}>
        <div class="codex-chat-file-change-rename">
          <span class="codex-chat-file-change-rename-label">Move</span>
          <span class="codex-chat-file-change-rename-path" title={patch().path}>
            {patch().path}
          </span>
          <span aria-hidden="true" class="codex-chat-file-change-rename-arrow">
            →
          </span>
          <span class="codex-chat-file-change-rename-path" title={patch().movePath}>
            {patch().movePath}
          </span>
        </div>
      </Show>

      <Show
        when={patch().renderedLines.length > 0}
        fallback={(
          <div class="codex-chat-file-change-empty">
            No file change details were provided yet.
          </div>
        )}
      >
        <div class="codex-chat-file-change-viewport">
          <div class="codex-chat-file-change-canvas">
            <For each={patch().renderedLines}>
              {(line) => (
                <div
                  class={cn(
                    'codex-chat-file-change-line',
                    gitPatchRenderedLineClass(line),
                  )}
                >
                  <span class="codex-chat-file-change-line-number">
                    {formatGitPatchLineNumber(line.oldLine)}
                  </span>
                  <span class="codex-chat-file-change-line-number codex-chat-file-change-line-number-next">
                    {formatGitPatchLineNumber(line.newLine)}
                  </span>
                  <span
                    class={cn(
                      'codex-chat-file-change-line-text',
                      gitPatchPreviewLineClass(line.text),
                    )}
                  >
                    {line.text}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
