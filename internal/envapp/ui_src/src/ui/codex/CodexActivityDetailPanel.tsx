import { Show, createMemo } from 'solid-js';

import { MarkdownBlock } from '../chat/blocks/MarkdownBlock';
import { ShellBlock } from '../chat/blocks/ShellBlock';
import { CodexFileChangeDiff } from './CodexFileChangeDiff';
import { displayStatus, itemText } from './presentation';
import type { CodexActivityDetailRef } from './transcriptDisplayModel';
import type { CodexFileChange, CodexTranscriptItem } from './types';
import { useI18n, type I18nHelpers } from '../i18n';

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

function detailTitle(
  i18n: I18nHelpers,
  detail: CodexActivityDetailRef,
  item: CodexTranscriptItem | null,
): string {
  switch (detail.type) {
    case 'file_diff': {
      const change = item?.changes?.[detail.changeIndex];
      const fallback = i18n.t('codexActivity.detail.fileDiff');
      return String(change?.move_path ?? change?.path ?? fallback).trim() || fallback;
    }
    case 'command_output':
      return String(item?.command ?? i18n.t('codexActivity.detail.commandOutput')).trim()
        || i18n.t('codexActivity.detail.commandOutput');
    case 'web_search':
      return i18n.t('codexActivity.detail.searchDetails');
    case 'reasoning':
      return i18n.t('codexActivity.detail.reasoning');
    case 'plan':
      return i18n.t('codexActivity.detail.plan');
    case 'file_preview':
      return detail.path;
    case 'raw_item':
      return displayStatus(item?.type, i18n.t('codexActivity.detail.itemDetails'));
    default:
      return i18n.t('codexActivity.detail.details');
  }
}

export function CodexActivityDetailPanel(props: {
  detail: CodexActivityDetailRef;
  item: CodexTranscriptItem | null;
  onClose: () => void;
}) {
  const i18n = useI18n();
  const title = createMemo(() => detailTitle(i18n, props.detail, props.item));
  const selectedFileChange = createMemo<CodexFileChange | null>(() => {
    if (props.detail.type !== 'file_diff') return null;
    return props.item?.changes?.[props.detail.changeIndex] ?? null;
  });
  const markdown = createMemo(() => {
    const item = props.item;
    if (!item) return '';
    if (props.detail.type === 'reasoning' || props.detail.type === 'plan') {
      return reasoningMarkdown(item);
    }
    return itemText(item, i18n);
  });

  return (
    <div class="codex-activity-detail-panel" data-codex-activity-detail={props.detail.type}>
      <div class="codex-activity-detail-header">
        <div class="codex-activity-detail-title" data-codex-activity-detail-title={props.detail.type} title={title()}>{title()}</div>
        <button
          type="button"
          class="codex-activity-detail-close"
          aria-label={i18n.t('codexActivity.detail.closeAria')}
          onClick={props.onClose}
        >
          {i18n.t('codexActivity.detail.close')}
        </button>
      </div>
      <Show
        when={props.item}
        fallback={<div class="codex-activity-detail-empty">{i18n.t('codexActivity.detail.unavailable')}</div>}
      >
        {(itemAccessor) => {
          const item = () => itemAccessor();
          if (props.detail.type === 'file_diff') {
            return (
              <Show
                when={selectedFileChange()}
                fallback={<div class="codex-activity-detail-empty">{i18n.t('codexActivity.detail.noFileChangeDetails')}</div>}
              >
                {(changeAccessor) => <CodexFileChangeDiff change={changeAccessor()} />}
              </Show>
            );
          }
          if (props.detail.type === 'command_output') {
            return (
              <ShellBlock
                command={item().command || i18n.t('codexActivity.detail.commandUnavailable')}
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
              fallback={<div class="codex-activity-detail-empty">{i18n.t('codexActivity.detail.noContent')}</div>}
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
