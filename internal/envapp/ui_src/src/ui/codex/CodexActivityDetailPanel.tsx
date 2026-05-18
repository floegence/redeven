import { Show, createMemo } from 'solid-js';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { CodexFileChangeDiff } from './CodexFileChangeDiff';
import { displayStatus, itemText } from './presentation';
import type { CodexActivityDetailRef } from './transcriptDisplayModel';
import type { CodexTranscriptItem } from './types';

function normalizeExecutionStatus(status: string | null | undefined, exitCode: number | null | undefined): 'running' | 'success' | 'error' {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized.includes('error') || normalized.includes('fail')) return 'error';
  if (normalized === 'running' || normalized === 'inprogress' || normalized === 'in_progress') return 'running';
  if (typeof exitCode === 'number' && exitCode !== 0) return 'error';
  return 'success';
}

function reasoningMarkdown(item: CodexTranscriptItem): string {
  const summary = (item.summary ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean);
  const content = (item.content ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean);
  const text = String(item.text ?? '').trim();
  const sections: string[] = [];
  if (summary.length > 0) {
    sections.push(summary.map((entry) => `- ${entry}`).join('\n'));
  }
  if (text) {
    sections.push(text);
  } else if (content.length > 0 && content.join('\n\n') !== summary.join('\n\n')) {
    sections.push(content.join('\n\n'));
  }
  return sections.join('\n\n').trim();
}

function detailTitle(detail: CodexActivityDetailRef, item: CodexTranscriptItem | null): string {
  switch (detail.type) {
    case 'file_diff': {
      const change = item?.changes?.[detail.changeIndex];
      return String(change?.move_path ?? change?.path ?? 'File diff').trim() || 'File diff';
    }
    case 'command_output':
      return String(item?.command ?? 'Command output').trim() || 'Command output';
    case 'web_search':
      return 'Search details';
    case 'reasoning':
      return 'Reasoning';
    case 'plan':
      return 'Plan';
    case 'file_preview':
      return detail.path;
    case 'raw_item':
      return displayStatus(item?.type, 'Item details');
    default:
      return 'Details';
  }
}

export function CodexActivityDetailPanel(props: {
  detail: CodexActivityDetailRef;
  item: CodexTranscriptItem | null;
  onClose: () => void;
}) {
  const title = createMemo(() => detailTitle(props.detail, props.item));
  const markdown = createMemo(() => {
    const item = props.item;
    if (!item) return '';
    if (props.detail.type === 'reasoning' || props.detail.type === 'plan') {
      return reasoningMarkdown(item);
    }
    return itemText(item);
  });

  return (
    <div class="codex-activity-detail-panel" data-codex-activity-detail={props.detail.type}>
      <div class="codex-activity-detail-header">
        <div class="codex-activity-detail-title" title={title()}>{title()}</div>
        <button
          type="button"
          class="codex-activity-detail-close"
          aria-label="Close activity detail"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>
      <Show
        when={props.item}
        fallback={<div class="codex-activity-detail-empty">Details are no longer available.</div>}
      >
        {(itemAccessor) => {
          const item = () => itemAccessor();
          if (props.detail.type === 'file_diff') {
            const change = item().changes?.[props.detail.changeIndex];
            return (
              <Show
                when={change}
                fallback={<div class="codex-activity-detail-empty">No file change details were provided.</div>}
              >
                {(changeAccessor) => <CodexFileChangeDiff change={changeAccessor()} />}
              </Show>
            );
          }
          if (props.detail.type === 'command_output') {
            return (
              <ShellBlock
                command={item().command || 'Command unavailable'}
                output={item().aggregated_output}
                cwd={item().cwd}
                durationMs={item().duration_ms}
                exitCode={item().exit_code}
                status={normalizeExecutionStatus(item().status, item().exit_code)}
                class="codex-chat-shell-block codex-activity-command-detail"
              />
            );
          }
          return (
            <Show
              when={markdown()}
              fallback={<div class="codex-activity-detail-empty">No detail content was provided.</div>}
            >
              {(content) => (
                <MarkdownBlock
                  content={content()}
                  streaming={false}
                  class="codex-chat-markdown-block codex-activity-detail-markdown"
                  rendererVariant="codex"
                />
              )}
            </Show>
          );
        }}
      </Show>
    </div>
  );
}
