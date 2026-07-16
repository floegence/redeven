import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ExternalLink, FileText, FolderOpen } from '@floegence/floe-webapp-core/icons';

import {
  presentFlowerActivityItem,
  type FlowerActivityDetailBlock,
  type FlowerActivityFileAction,
  type FlowerActivityFileActions,
  type FlowerActivityPresentation,
  type FlowerActivitySubagentDetailItem,
  type FlowerActivityTitle,
  type FlowerActivityTodoStatus,
} from '../../../../../../flower_ui/src/flowerActivityPresentation';
import {
  createFlowerActivityDisclosureController,
  createFlowerActivityDisclosureMotion,
  flowerActivityDisclosureIntent,
} from '../../../../../../flower_ui/src/activityDisclosure';
import { flowerActivityIdentity } from '../../../../../../flower_ui/src/flowerActivityIdentity';
import type { FlowerActivityItem, FlowerActivityRenderer } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { formatGitPatchLineNumber, getGitPatchRenderSnapshot, type GitPatchRenderedLine } from '../../../../../../flower_ui/src/gitPatch';
import type { TerminalVisibleOutputStore } from '../../../../../../flower_ui/src/flowerTerminalOutput';
import { normalizeAskUserQuestions, type AskUserQuestion } from '../askUserContract';
import { useChatContext } from '../ChatProvider';
import { ActivityStatusIcon, formatActivityDuration, type ActivityStatus } from '../status/ActivityLine';
import { ShellBlock } from '../blocks/ShellBlock';
import type {
  ActivityItem,
  ActivityTimelineBlock as ActivityTimelineBlockType,
} from '../types';
import { useI18n } from '../../i18n';

export interface ActivityTimelineBlockProps {
  block: ActivityTimelineBlockType;
  messageId: string;
  blockIndex: number;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onOpenSubagentMessages?: (request: ActivitySubagentMessagesRequest) => void;
  class?: string;
}

export type ActivitySubagentMessagesRequest = Readonly<{
  threadID: string;
  subagentID: string;
  name: string;
  taskDescription: string;
  agentType: string;
}>;

function toActivityStatus(status: string | undefined): ActivityStatus {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'running':
      return 'running';
    case 'error':
      return 'error';
    case 'success':
      return 'success';
    case 'pending':
    case 'waiting':
      return 'pending';
    default:
      return 'info';
  }
}

function isBlockingItem(item: ActivityItem): boolean {
  return (item.requires_approval === true && item.approval_state === 'requested')
    || item.status === 'waiting'
    || item.severity === 'blocking';
}

function hasTextSelection(): boolean {
  const selection = window.getSelection?.();
  return Boolean(selection && selection.toString().trim());
}

function summaryLabel(block: ActivityTimelineBlockType): string {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 1) {
    return presentFlowerActivityItem(flowerItem(items[0]), block.file_actions as FlowerActivityFileActions | undefined).label;
  }
  const total = block.summary?.total_items || items.length;
  return total === 1 ? '1 activity' : `${total} activities`;
}

function flowerRenderer(value: unknown): FlowerActivityRenderer | undefined {
  switch (String(value ?? '').trim()) {
    case 'structured':
    case 'terminal':
    case 'file':
    case 'patch':
    case 'web_search':
    case 'todos':
    case 'question':
    case 'completion':
      return String(value).trim() as FlowerActivityRenderer;
    default:
      return undefined;
  }
}

function flowerItem(item: ActivityItem): FlowerActivityItem {
  const renderer = flowerRenderer(item.renderer);
  const { renderer: _renderer, payload: rawPayload, ...rest } = item;
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload as Readonly<Record<string, unknown>>
    : undefined;
  return {
    ...rest,
    severity: item.severity ?? 'normal',
    ...(renderer ? { renderer } : {}),
    ...(payload ? { payload } : {}),
  };
}

function itemPayloadRecord(item: ActivityItem): Readonly<Record<string, unknown>> {
  return item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
    ? item.payload as Readonly<Record<string, unknown>>
    : {};
}

function titleNode(title: FlowerActivityTitle) {
  if (title.kind === 'file') {
    return (
      <>
        <strong class="chat-activity-item-title-verb">{title.verb}</strong>
        <span class="chat-activity-item-title-target">{title.display_name}</span>
      </>
    );
  }
  return <span class="chat-activity-item-title-target">{title.kind === 'command' ? title.command : title.text}</span>;
}

function todoStatusLabel(status: FlowerActivityTodoStatus): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'in_progress':
      return 'in progress';
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      return 'pending';
  }
}

function todoStatusMarker(status: FlowerActivityTodoStatus): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '•';
    case 'cancelled':
      return '!';
    case 'pending':
      return '';
  }
}

function writeLabel(question: AskUserQuestion): string {
  return String(question.writeLabel ?? '').trim();
}

function payloadString(payload: Readonly<Record<string, unknown>>, key: string): string {
  return String(payload[key] ?? '').trim();
}

function payloadNumber(payload: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = Number(payload[key] ?? NaN);
  return Number.isFinite(value) ? value : undefined;
}

function subagentsDetailForPresentation(presentation: FlowerActivityPresentation) {
  return presentation.detailBlocks.find((block): block is Extract<FlowerActivityDetailBlock, { kind: 'subagents' }> => block.kind === 'subagents')?.subagents;
}

function subagentElapsedText(presentation: FlowerActivityPresentation, now: number): string {
  const detail = subagentsDetailForPresentation(presentation);
  if (!detail || detail.elapsed_mode === 'none') return '';
  const first = detail.items.find((agent) => agent.started_at_ms || agent.created_at_ms);
  if (!first) return '';
  const startedAt = first.started_at_ms || first.created_at_ms || 0;
  const endAt = detail.elapsed_mode === 'final' && first.updated_at_ms ? first.updated_at_ms : now;
  const label = formatActivityDuration(Math.max(0, endAt - startedAt));
  if (!label) return '';
  return detail.elapsed_mode === 'running' ? `running ${label}` : label;
}

function shellStatusForItem(item: ActivityItem): 'running' | 'success' | 'error' {
  switch (String(item.status ?? '').trim().toLowerCase()) {
    case 'running':
    case 'pending':
    case 'waiting':
      return 'running';
    case 'success':
      return 'success';
    default:
      return 'error';
  }
}

function terminalCommandForItem(item: ActivityItem, payload: Readonly<Record<string, unknown>>): string {
  return payloadString(payload, 'command')
    || String(item.label ?? '').trim()
    || String(item.description ?? '').trim()
    || String(item.tool_name ?? 'terminal').trim();
}

function TerminalDetailBlock(props: {
  item: ActivityItem;
  runID?: string;
  turnID?: string;
  threadID?: string;
  messageID: string;
  blockIndex: number;
  outputStore?: TerminalVisibleOutputStore;
}) {
  const payload = createMemo(() => itemPayloadRecord(props.item));
  const processId = createMemo(() => payloadString(payload(), 'process_id') || String(props.item.metadata?.process_id ?? '').trim());
  const output = createMemo(() => payloadString(payload(), 'output'));
  const command = createMemo(() => terminalCommandForItem(props.item, payload()));
  return (
    <ShellBlock
      command={command()}
      output={output() || undefined}
      outputRef={props.runID && props.item.tool_id ? { runId: props.runID, toolId: props.item.tool_id } : undefined}
      processId={processId() || undefined}
      firstSeq={payloadNumber(payload(), 'first_seq')}
      lastSeq={payloadNumber(payload(), 'last_seq')}
      durationMs={payloadNumber(payload(), 'duration_ms')}
      truncated={Boolean(payload().truncated)}
      exitCode={payloadNumber(payload(), 'exit_code')}
      status={shellStatusForItem(props.item)}
      outputIdentity={{
        surface_scope: 'env-activity',
        owner_thread_id: props.threadID,
        render_thread_id: props.threadID,
        run_id: props.runID,
        turn_id: props.turnID,
        message_id: props.messageID,
        block_index: props.blockIndex,
        item_id: props.item.item_id,
        tool_id: props.item.tool_id,
        process_id: processId(),
        command: command(),
      }}
      outputStore={props.outputStore}
      class="chat-activity-terminal-shell"
    />
  );
}

function AskUserAudit(props: { item: ActivityItem }) {
  const questions = createMemo(() => normalizeAskUserQuestions(itemPayloadRecord(props.item).questions));
  return (
    <Show when={questions().length > 0}>
      <div class="chat-activity-user-input-audit">
        <For each={questions()}>
          {(question) => (
            <div class="chat-activity-user-input-question">
              <div class="chat-activity-user-input-question-text">{question.question}</div>
              <Show when={question.choices.length > 0 || writeLabel(question)}>
                <div class="chat-activity-user-input-choices">
                  <For each={question.choices}>
                    {(choice) => (
                      <span class="chat-activity-user-input-choice">
                        <span class="chat-activity-user-input-choice-label">{choice.label}</span>
                        <Show when={choice.description}>
                          {(description) => <span class="chat-activity-user-input-choice-description">{description()}</span>}
                        </Show>
                      </span>
                    )}
                  </For>
                  <Show when={writeLabel(question)}>
                    {(label) => <span class="chat-activity-user-input-choice">{label()}</span>}
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function DetailLines(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'structured' }> }) {
  return (
    <div class="chat-activity-detail-section">
      <div class="chat-activity-structured-groups">
        <For each={props.block.lines}>
          {(line) => (
            <dl class="chat-activity-structured-field">
              <dt>{line.label}</dt>
              <dd class={line.tone === 'code' ? 'chat-activity-structured-code' : undefined}>{line.value}</dd>
            </dl>
          )}
        </For>
      </div>
    </div>
  );
}

function FileActionButtons(props: {
  action: FlowerActivityFileAction;
  item: ActivityItem;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
}) {
  const i18n = useI18n();
  const canPreview = createMemo(() => props.action.can_preview && props.action.action_id.trim() !== '' && !!props.onPreviewFile);
  const canBrowse = createMemo(() => props.action.can_browse_directory && props.action.action_id.trim() !== '' && !!props.onBrowseDirectory);
  return (
    <span class="chat-activity-file-actions" aria-label={i18n.t('uiCopy.chat.fileActions')}>
      <button
        type="button"
        class="chat-activity-file-action-btn"
        title={i18n.t('uiCopy.chat.previewFile')}
        aria-label={i18n.t('uiCopy.chat.previewTarget', { target: props.action.display_name || i18n.t('uiCopy.chat.fileFallback') })}
        disabled={!canPreview()}
        onClick={(event) => {
          event.stopPropagation();
          if (canPreview()) props.onPreviewFile?.(props.action, props.item);
        }}
      >
        <FileText class="chat-activity-file-action-icon" />
      </button>
      <button
        type="button"
        class="chat-activity-file-action-btn"
        title={i18n.t('uiCopy.chat.browseFolder')}
        aria-label={i18n.t('uiCopy.chat.browseFolderForTarget', { target: props.action.display_name || i18n.t('uiCopy.chat.fileFallback') })}
        disabled={!canBrowse()}
        onClick={(event) => {
          event.stopPropagation();
          if (canBrowse()) props.onBrowseDirectory?.(props.action, props.item);
        }}
      >
        <FolderOpen class="chat-activity-file-action-icon" />
      </button>
    </span>
  );
}

function disabledFileAction(displayName: string): FlowerActivityFileAction {
  return {
    action_id: '',
    display_name: String(displayName ?? '').trim() || 'file',
    can_preview: false,
    can_browse_directory: false,
  };
}

function TodoBlock(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'todos' }> }) {
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-todo-list" role="list">
        <For each={props.block.items}>
          {(todo) => (
            <div class="chat-activity-todo-item" data-status={todo.status} role="listitem">
              <span class="chat-activity-todo-marker" aria-hidden="true">{todoStatusMarker(todo.status)}</span>
              <div class="chat-activity-todo-copy">
                <span class={cn('chat-activity-todo-content', todo.status === 'completed' && 'chat-activity-todo-content-completed')}>{todo.content}</span>
                <Show when={todo.note}>
                  {(note) => <span class="chat-activity-todo-note"> · {note()}</span>}
                </Show>
              </div>
              <span class={cn('chat-activity-todo-badge', `chat-activity-todo-badge-${todo.status}`)}>
                {todoStatusLabel(todo.status)}
              </span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function FileReadBlock(props: {
  block: Extract<FlowerActivityDetailBlock, { kind: 'file_read' }>;
  item: ActivityItem;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
}) {
  const i18n = useI18n();
  const lineSummary = createMemo(() => {
    const start = Math.max(1, Math.floor(Number(props.block.line_offset || 1)));
    const count = Math.max(0, Math.floor(Number(props.block.line_count || 0)));
    const total = Math.max(0, Math.floor(Number(props.block.total_lines || 0)));
    if (count <= 0) return total > 0 ? `0 lines of ${total}` : '0 lines';
    const end = start + count - 1;
    return total > 0 ? `lines ${start}-${end} of ${total}` : `lines ${start}-${end}`;
  });
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-copy">
          <div class="chat-activity-detail-section-title">{props.block.action.display_name}</div>
          <div class="chat-activity-detail-section-meta">
            {lineSummary()}
            <Show when={props.block.truncated}>{` · ${i18n.t('uiCopy.chat.truncated')}`}</Show>
          </div>
        </div>
        <FileActionButtons
          action={props.block.action}
          item={props.item}
          onPreviewFile={props.onPreviewFile}
          onBrowseDirectory={props.onBrowseDirectory}
        />
      </div>
      <pre class="chat-activity-file-preview"><code>{props.block.content}</code></pre>
    </section>
  );
}

function PatchLine(props: { line: GitPatchRenderedLine }) {
  return (
    <div class={cn('chat-activity-file-diff-line', `chat-activity-file-diff-line-${props.line.kind}`)}>
      <span class="chat-activity-file-diff-line-number">{formatGitPatchLineNumber(props.line.oldLine)}</span>
      <span class="chat-activity-file-diff-line-number chat-activity-file-diff-line-number-new">{formatGitPatchLineNumber(props.line.newLine)}</span>
      <code>{props.line.text}</code>
    </div>
  );
}

function FileDiffBlock(props: {
  block: Extract<FlowerActivityDetailBlock, { kind: 'file_diff' }>;
  item: ActivityItem;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
}) {
  const i18n = useI18n();
  return (
    <div class="chat-activity-file-diff-list">
      <For each={props.block.files}>
        {(file) => {
          const snapshot = createMemo(() => getGitPatchRenderSnapshot(file.patch_text));
          return (
            <section class="chat-activity-detail-section chat-activity-file-diff-file">
              <div class="chat-activity-detail-section-head">
                <div class="chat-activity-file-diff-heading">
                  <code class="chat-activity-file-path">{file.display_name}</code>
                  <span class="chat-activity-file-operation">{file.change_type}</span>
                  <div class="chat-activity-detail-section-meta">
                    <span class="chat-activity-file-stat-add">+{file.additions}</span>
                    {' '}
                    <span class="chat-activity-file-stat-del">-{file.deletions}</span>
                    <Show when={file.truncated}>{` · ${i18n.t('uiCopy.chat.truncated')}`}</Show>
                  </div>
                </div>
                <FileActionButtons
                  action={file.action}
                  item={props.item}
                  onPreviewFile={props.onPreviewFile}
                  onBrowseDirectory={props.onBrowseDirectory}
                />
              </div>
              <Show
                when={snapshot().renderedLines.length > 0}
                fallback={<div class="chat-activity-detail-empty">{file.diff_unavailable_reason || i18n.t('uiCopy.chat.noTextualDiff')}</div>}
              >
                <div class="chat-activity-file-diff-unified">
                  <For each={snapshot().renderedLines}>
                    {(line) => <PatchLine line={line} />}
                  </For>
                </div>
              </Show>
            </section>
          );
        }}
      </For>
    </div>
  );
}

function WebSearchDetailBlock(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'web_search' }> }) {
  const i18n = useI18n();
  const entries = createMemo(() => [
    ...props.block.search.results,
    ...props.block.search.matches,
    ...props.block.search.sections,
    ...props.block.search.sources,
  ]);
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-copy">
          <div class="chat-activity-detail-section-title">{props.block.search.query || i18n.t('uiCopy.chat.searchResults')}</div>
          <div class="chat-activity-detail-section-meta">
            {[props.block.search.provider, props.block.search.count !== undefined ? i18n.t('uiCopy.chat.searchResultCount', { count: props.block.search.count }) : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <div class="chat-activity-detail-lines">
        <For each={entries()}>
          {(entry) => (
            <div class="chat-activity-detail-line">
              <span class="chat-activity-detail-key">{entry.source || entry.url || i18n.t('uiCopy.chat.result')}</span>
              <span class="chat-activity-detail-value">{[entry.title, entry.snippet].filter(Boolean).join(' - ')}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function QuestionDetailBlock(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'question' }> }) {
  return (
    <section class="chat-activity-detail-section">
      <For each={props.block.question.questions}>
        {(question) => (
          <div class="chat-activity-user-input-question">
            <div class="chat-activity-user-input-question-text">{question.question}</div>
            <Show when={question.choices.length > 0 || question.write_label}>
              <div class="chat-activity-user-input-choices">
                <For each={question.choices}>
                  {(choice) => (
                    <span class="chat-activity-user-input-choice">
                      <span class="chat-activity-user-input-choice-label">{choice.label}</span>
                      <Show when={choice.description}>
                        {(description) => <span class="chat-activity-user-input-choice-description">{description()}</span>}
                      </Show>
                    </span>
                  )}
                </For>
                <Show when={question.write_label}>
                  {(label) => <span class="chat-activity-user-input-choice">{label()}</span>}
                </Show>
              </div>
            </Show>
          </div>
        )}
      </For>
    </section>
  );
}

function CompletionDetailBlock(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'completion' }> }) {
  const completion = props.block.completion;
  const rows = createMemo(() => [
    { label: 'result', value: completion.result || completion.summary || completion.details },
    { label: 'evidence', value: completion.evidence_refs.join('\n') },
    { label: 'risks', value: completion.remaining_risks.join('\n') },
    { label: 'next', value: completion.next_actions.join('\n') },
  ].filter((row) => row.value.trim()));
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-lines">
        <For each={rows()}>
          {(row) => (
            <div class="chat-activity-detail-line">
              <span class="chat-activity-detail-key">{row.label}</span>
              <span class="chat-activity-detail-value">{row.value}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function ErrorDetailBlock(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'error' }> }) {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section chat-activity-error-section" aria-label={i18n.t('uiCopy.chat.failureReason')}>
      <div class="chat-activity-error-message">{props.block.error.message}</div>
    </section>
  );
}

function SubagentsDetailBlock(props: {
  block: Extract<FlowerActivityDetailBlock, { kind: 'subagents' }>;
  now: number;
  onOpenSubagentMessages?: (request: ActivitySubagentMessagesRequest) => void;
}) {
  const i18n = useI18n();
  const detail = props.block.subagents;
  const elapsedText = (agent: FlowerActivitySubagentDetailItem): string => {
    const startedAt = agent.started_at_ms || agent.created_at_ms || 0;
    if (!startedAt || detail.elapsed_mode === 'none') return '';
    const endAt = detail.elapsed_mode === 'final' && agent.updated_at_ms ? agent.updated_at_ms : props.now;
    const label = formatActivityDuration(Math.max(0, endAt - startedAt));
    if (!label) return '';
    return detail.elapsed_mode === 'running' ? `running ${label}` : label;
  };
  const openMessages = (agent: FlowerActivitySubagentDetailItem) => {
    const action = agent.open_messages;
    if (!action?.thread_id || !props.onOpenSubagentMessages) return;
    props.onOpenSubagentMessages({
      threadID: action.thread_id,
      subagentID: action.subagent_id || action.thread_id,
      name: agent.name,
      taskDescription: agent.description,
      agentType: agent.agent_type,
    });
  };
  return (
    <section class="chat-activity-detail-section chat-activity-subagents-section" aria-label={i18n.t('uiCopy.chat.subagents')}>
      <Show when={detail.items.length > 0}>
        <div class="chat-activity-subagents-list" role="list">
          <For each={detail.items}>
            {(agent) => (
              <div class="chat-activity-subagents-item" role="listitem">
                <div class="chat-activity-subagents-item-main">
                  <div class="chat-activity-subagents-item-head">
                    <span class="chat-activity-subagents-item-title-row">
                      <span class="chat-activity-subagents-item-title">{agent.name}</span>
                      <Show when={agent.open_messages && props.onOpenSubagentMessages}>
                        <button
                          type="button"
                          class="chat-activity-subagents-open"
                          aria-label={i18n.t('uiCopy.chat.openSubagentMessagesFor', { name: agent.name })}
                          title={i18n.t('uiCopy.chat.openSubagentMessages')}
                          onClick={(event) => {
                            event.stopPropagation();
                            openMessages(agent);
                          }}
                        >
                          <ExternalLink class="h-3.5 w-3.5" />
                        </button>
                      </Show>
                    </span>
                    <span class="chat-activity-subagents-item-meta">
                      {[agent.show_status ? agent.status : '', elapsedText(agent)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <Show when={agent.description}>
                    {(description) => <div class="chat-activity-subagents-item-task">{description()}</div>}
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function DetailBlock(props: {
  block: FlowerActivityDetailBlock;
  item: ActivityItem;
  runID?: string;
  turnID?: string;
  threadID?: string;
  messageID: string;
  blockIndex: number;
  now: number;
  outputStore?: TerminalVisibleOutputStore;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onOpenSubagentMessages?: (request: ActivitySubagentMessagesRequest) => void;
}) {
  if (props.block.kind === 'error') return <ErrorDetailBlock block={props.block} />;
  if (props.block.kind === 'subagents') return <SubagentsDetailBlock block={props.block} now={props.now} onOpenSubagentMessages={props.onOpenSubagentMessages} />;
  if (props.block.kind === 'terminal_output') {
    return (
      <TerminalDetailBlock
        item={props.item}
        runID={props.runID}
        turnID={props.turnID}
        threadID={props.threadID}
        messageID={props.messageID}
        blockIndex={props.blockIndex}
        outputStore={props.outputStore}
      />
    );
  }
  if (props.block.kind === 'web_search') return <WebSearchDetailBlock block={props.block} />;
  if (props.block.kind === 'question') return <QuestionDetailBlock block={props.block} />;
  if (props.block.kind === 'completion') return <CompletionDetailBlock block={props.block} />;
  if (props.block.kind === 'todos') return <TodoBlock block={props.block} />;
  if (props.block.kind === 'file_read') {
    return (
      <FileReadBlock
        block={props.block}
        item={props.item}
        onPreviewFile={props.onPreviewFile}
        onBrowseDirectory={props.onBrowseDirectory}
      />
    );
  }
  if (props.block.kind === 'file_diff') {
    return (
      <FileDiffBlock
        block={props.block}
        item={props.item}
        onPreviewFile={props.onPreviewFile}
        onBrowseDirectory={props.onBrowseDirectory}
      />
    );
  }
  return <DetailLines block={props.block} />;
}

export const ActivityTimelineBlock: Component<ActivityTimelineBlockProps> = (props) => {
  const ctx = useChatContext();
  const [open, setOpen] = createSignal<boolean | null>(null);
  const [openByItem, setOpenByItem] = createSignal<Record<string, boolean>>({});
  const [clockNow, setClockNow] = createSignal(Date.now());
  let clockTimer: number | undefined;

  onMount(() => {
    clockTimer = window.setInterval(() => setClockNow(Date.now()), 1000);
  });

  onCleanup(() => {
    if (clockTimer !== undefined) {
      window.clearInterval(clockTimer);
      clockTimer = undefined;
    }
  });

  const items = createMemo(() => Array.isArray(props.block.items) ? props.block.items : []);
  const hasItems = createMemo(() => items().length > 0);
  const summaryStatus = createMemo(() => toActivityStatus(props.block.summary?.status));
  const durationLabel = createMemo(() => formatActivityDuration(props.block.summary?.duration_ms));
  const timelineDisclosureControl = createFlowerActivityDisclosureController({
    intent: () => flowerActivityDisclosureIntent(props.block.summary),
    manualOpen: open,
    onManualOpenChange: setOpen,
  });
  const expanded = timelineDisclosureControl.open;
  const timelineDisclosure = createFlowerActivityDisclosureMotion(() => expanded() && hasItems());
  const fileActions = createMemo(() => props.block.file_actions as FlowerActivityFileActions | undefined);
  const itemIdentity = (item: ActivityItem): string => flowerActivityIdentity({
    threadID: props.block.thread_id,
    runID: props.block.run_id,
    turnID: props.block.turn_id || props.messageId,
    itemID: item.item_id,
  });
  const itemKeys = createMemo(() => items().map(itemIdentity));
  const itemsByKey = createMemo(() => new Map(itemKeys().map((key, index) => [key, items()[index]] as const)));

  return (
    <Show when={hasItems()}>
      <div class={cn('chat-activity-timeline', props.class)} data-status={summaryStatus()}>
        <button
          type="button"
          class="chat-activity-timeline-summary"
          aria-expanded={expanded()}
          onClick={timelineDisclosureControl.toggle}
        >
          <span class={cn('chat-activity-timeline-chevron', expanded() && 'chat-activity-timeline-chevron-open')} aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
          </span>
          <ActivityStatusIcon status={summaryStatus()} class="chat-activity-timeline-summary-icon" />
          <span class="chat-activity-timeline-summary-text">{summaryLabel(props.block)}</span>
          <Show when={durationLabel()}>
            {(value) => <span class="chat-activity-timeline-duration">{value()}</span>}
          </Show>
        </button>

        <Show when={timelineDisclosure.mounted()}>
          <div
            ref={timelineDisclosure.bindViewport}
            class="chat-activity-items-presence"
            data-state={timelineDisclosure.state()}
            data-layout-motion={timelineDisclosure.layoutMotion()}
            style={{ height: timelineDisclosure.height() }}
          >
            <div class="chat-activity-items-clip">
              <div
                ref={timelineDisclosure.bindContent}
                class="chat-activity-items"
                onPointerDown={timelineDisclosureControl.retainOpen}
                onFocusIn={timelineDisclosureControl.retainOpen}
                onWheel={timelineDisclosureControl.retainOpen}
                onTouchStart={timelineDisclosureControl.retainOpen}
              >
                <For each={itemKeys()}>
                  {(itemKeyValue) => {
                    const itemRecord = createMemo(() => itemsByKey().get(itemKeyValue) ?? null);
                    return (
                      <Show when={itemRecord()}>
                        {(record) => {
                          const item = createMemo(() => record());
                          const id = createMemo(() => itemIdentity(item()));
                          const presentation = createMemo(() => presentFlowerActivityItem(flowerItem(item()), fileActions()));
                          const detailKeys = createMemo(() => presentation().detailBlocks.map((block) => `${id()}:${block.kind}`));
                          const detailsByKey = createMemo(() => {
                            const blocks = presentation().detailBlocks;
                            return new Map<string, FlowerActivityDetailBlock>(blocks.map((block) => [`${id()}:${block.kind}`, block]));
                          });
                          const itemDisclosureControl = createFlowerActivityDisclosureController({
                            intent: () => {
                              const intent = flowerActivityDisclosureIntent(item());
                              return intent === 'active' ? 'settled' : intent;
                            },
                            manualOpen: () => openByItem()[id()],
                            onManualOpenChange: (open) => {
                              const key = id();
                              setOpenByItem((prev) => ({ ...prev, [key]: open }));
                            },
                          });
                          const isOpen = itemDisclosureControl.open;
                          const hasDetails = createMemo(() => presentation().detailBlocks.length > 0);
                          const itemMeta = createMemo(() => [presentation().meta, subagentElapsedText(presentation(), clockNow())].filter(Boolean).join(' · '));
                          const panelId = createMemo(() => `activity-detail-${id().replace(/[^a-zA-Z0-9_-]/g, '-')}`);
                          const rowFileAction = createMemo(() => {
                            const primary = presentation().primaryAction;
                            if (primary) return primary;
                            const title = presentation().title;
                            return title.kind === 'file' ? disabledFileAction(title.display_name) : null;
                          });
                          let itemButtonRef: HTMLDivElement | undefined;
                          let detailPanelRef: HTMLDivElement | undefined;
                          const disclosure = createFlowerActivityDisclosureMotion(
                            () => isOpen() && hasDetails(),
                            {
                              animateContentResize: true,
                              onBeforeClose: () => {
                                if (detailPanelRef && detailPanelRef.contains(document.activeElement)) {
                                  itemButtonRef?.focus();
                                }
                              },
                            },
                          );
                          return (
                            <div
                              class={cn('chat-activity-item-shell', isOpen() && hasDetails() && 'chat-activity-item-shell-expanded', subagentsDetailForPresentation(presentation()) && 'chat-activity-item-shell-subagents')}
                              data-item-id={item().item_id}
                              data-activity-identity={id()}
                              data-state={disclosure.state()}
                            >
                              <div
                                ref={itemButtonRef}
                                class={cn(
                                  'chat-activity-item',
                                  hasDetails() && 'chat-activity-item-clickable',
                                  isBlockingItem(item()) && 'chat-activity-item-blocking',
                                )}
                                role={hasDetails() ? 'button' : undefined}
                                tabIndex={hasDetails() ? 0 : undefined}
                                aria-expanded={hasDetails() ? isOpen() : undefined}
                                aria-controls={hasDetails() ? panelId() : undefined}
                                onClick={hasDetails() ? () => {
                                  if (!hasTextSelection()) itemDisclosureControl.toggle();
                                } : undefined}
                                onKeyDown={(event) => {
                                  if (!hasDetails()) return;
                                  if (event.key !== 'Enter' && event.key !== ' ') return;
                                  event.preventDefault();
                                  if (!hasTextSelection()) itemDisclosureControl.toggle();
                                }}
                              >
                                <Show
                                  when={hasDetails()}
                                  fallback={<span class="chat-activity-item-chevron-placeholder" aria-hidden="true" />}
                                >
                                  <span class={cn('chat-activity-item-chevron', isOpen() && 'chat-activity-item-chevron-open')} aria-hidden="true">
                                    <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
                                  </span>
                                </Show>
                                <ActivityStatusIcon status={toActivityStatus(item().status)} class="chat-activity-item-status" />
                                <div class="chat-activity-item-main">
                                  <div class="chat-activity-item-line">
                                    <span class="chat-activity-item-label">{titleNode(presentation().title)}</span>
                                    <Show when={itemMeta()}>
                                      {(meta) => <span class="chat-activity-item-target">{meta()}</span>}
                                    </Show>
                                  </div>
                                  <Show when={item().renderer === 'question' || item().tool_name === 'ask_user'}>
                                    <AskUserAudit item={item()} />
                                  </Show>
                                </div>
                                <div class="chat-activity-item-actions">
                                  <Show when={rowFileAction()}>
                                    {(action) => (
                                      <FileActionButtons
                                        action={action()}
                                        item={item()}
                                        onPreviewFile={props.onPreviewFile}
                                        onBrowseDirectory={props.onBrowseDirectory}
                                      />
                                    )}
                                  </Show>
                                </div>
                              </div>
                              <Show when={disclosure.mounted() && hasDetails()}>
                                <div
                                  ref={(node) => {
                                    detailPanelRef = node;
                                    disclosure.bindViewport(node);
                                  }}
                                  id={panelId()}
                                  class="chat-activity-detail-panel"
                                  data-state={disclosure.state()}
                                  data-layout-motion={disclosure.layoutMotion()}
                                  style={{ height: disclosure.height() }}
                                  onPointerDown={itemDisclosureControl.retainOpen}
                                  onFocusIn={itemDisclosureControl.retainOpen}
                                  onWheel={itemDisclosureControl.retainOpen}
                                  onTouchStart={itemDisclosureControl.retainOpen}
                                >
                                  <div class="chat-activity-detail-panel-clip">
                                    <div ref={disclosure.bindContent} class="chat-activity-detail-panel-content">
                                      <div class="chat-activity-detail-sections">
                                        <For each={detailKeys()}>
                                          {(detailKey) => {
                                            const block = createMemo(() => detailsByKey().get(detailKey)!);
                                            return (
                                            <DetailBlock
                                              block={block()}
                                              item={item()}
                                              runID={props.block.run_id}
                                              turnID={props.block.turn_id}
                                              threadID={props.block.thread_id}
                                              messageID={props.messageId}
                                              blockIndex={props.blockIndex}
                                              now={clockNow()}
                                              outputStore={ctx.terminalVisibleOutputStore}
                                              onPreviewFile={props.onPreviewFile}
                                              onBrowseDirectory={props.onBrowseDirectory}
                                              onOpenSubagentMessages={props.onOpenSubagentMessages}
                                            />
                                            );
                                          }}
                                        </For>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </Show>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};
