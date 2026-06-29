import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { FileText, FolderOpen } from '@floegence/floe-webapp-core/icons';

import {
  presentFlowerActivityItem,
  type FlowerActivityDetailBlock,
  type FlowerActivityFileAction,
  type FlowerActivityFileActions,
  type FlowerActivityTitle,
  type FlowerActivityTodoStatus,
} from '../../../../../../flower_ui/src/flowerActivityPresentation';
import type { FlowerActivityItem, FlowerActivityRenderer, FlowerActivitySubagentAction } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { formatGitPatchLineNumber, getGitPatchRenderSnapshot, type GitPatchRenderedLine } from '../../../../../../flower_ui/src/gitPatch';
import { normalizeAskUserQuestions, type AskUserQuestion } from '../askUserContract';
import { useChatContext } from '../ChatProvider';
import { ActivityStatusIcon, formatActivityDuration, type ActivityStatus } from '../status/ActivityLine';
import { ShellBlock } from '../blocks/ShellBlock';
import type {
  ActivityItem,
  ActivityTimelineBlock as ActivityTimelineBlockType,
} from '../types';

export interface ActivityTimelineBlockProps {
  block: ActivityTimelineBlockType;
  messageId: string;
  blockIndex: number;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  class?: string;
}

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

function itemKey(item: ActivityItem, index: number): string {
  return String(item.item_id || item.tool_id || index).trim() || String(index);
}

function hasTextSelection(): boolean {
  const selection = window.getSelection?.();
  return Boolean(selection && selection.toString().trim());
}

function summaryLabel(block: ActivityTimelineBlockType): string {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 1) {
    return presentFlowerActivityItem(flowerItem(items[0]), block.file_actions as FlowerActivityFileActions | undefined, undefined, { subagentAction: subagentActionForItem(block, items[0]) }).label;
  }
  const total = block.summary?.total_items || items.length;
  return total === 1 ? '1 activity' : `${total} activities`;
}

function defaultTimelineOpen(block: ActivityTimelineBlockType): boolean {
  return block.summary?.needs_attention === true || block.summary?.status !== 'success';
}

function itemDefaultOpen(item: ActivityItem): boolean {
  return isBlockingItem(item) || item.status === 'error' || item.status === 'waiting';
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

function subagentActionForItem(block: ActivityTimelineBlockType, item: ActivityItem): FlowerActivitySubagentAction | undefined {
  return block.subagent_actions?.[String(item.item_id ?? '').trim()] as FlowerActivitySubagentAction | undefined;
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

function TerminalDetailBlock(props: { item: ActivityItem; runID?: string }) {
  const payload = createMemo(() => itemPayloadRecord(props.item));
  const processId = createMemo(() => payloadString(payload(), 'process_id') || String(props.item.metadata?.process_id ?? '').trim());
  const output = createMemo(() => payloadString(payload(), 'output') || payloadString(payload(), 'stdout'));
  const latestOutput = createMemo(() => payloadString(payload(), 'latest_output'));
  return (
    <ShellBlock
      command={terminalCommandForItem(props.item, payload())}
      output={output() || undefined}
      latestOutput={latestOutput() || undefined}
      outputRef={props.runID && props.item.tool_id ? { runId: props.runID, toolId: props.item.tool_id } : undefined}
      processId={processId() || undefined}
      durationMs={payloadNumber(payload(), 'duration_ms')}
      truncated={Boolean(payload().truncated)}
      exitCode={payloadNumber(payload(), 'exit_code')}
      status={shellStatusForItem(props.item)}
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

function ApprovalActions(props: { messageId: string; item: ActivityItem }) {
  const ctx = useChatContext();
  const canApprove = createMemo(() => props.item.requires_approval === true && props.item.approval_state === 'requested');
  return (
    <Show when={canApprove()}>
      <span class="chat-activity-approval-actions">
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-approve"
          onClick={(event) => {
            event.stopPropagation();
            ctx.approveToolCall(props.messageId, String(props.item.tool_id ?? ''), true);
          }}
        >
          Allow
        </button>
        <button
          type="button"
          class="chat-activity-approval-btn chat-activity-approval-btn-reject"
          onClick={(event) => {
            event.stopPropagation();
            ctx.approveToolCall(props.messageId, String(props.item.tool_id ?? ''), false);
          }}
        >
          Deny
        </button>
      </span>
    </Show>
  );
}

function DetailLines(props: { block: Extract<FlowerActivityDetailBlock, { kind: 'structured' | 'terminal' }> }) {
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
  const canPreview = createMemo(() => props.action.can_preview && props.action.action_id.trim() !== '' && !!props.onPreviewFile);
  const canBrowse = createMemo(() => props.action.can_browse_directory && props.action.action_id.trim() !== '' && !!props.onBrowseDirectory);
  return (
    <span class="chat-activity-file-actions" aria-label="File actions">
      <button
        type="button"
        class="chat-activity-file-action-btn"
        title="Preview file"
        aria-label={`Preview ${props.action.display_name || 'file'}`}
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
        title="Browse folder"
        aria-label={`Browse folder for ${props.action.display_name || 'file'}`}
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
                <div class={cn('chat-activity-todo-content', todo.status === 'completed' && 'chat-activity-todo-content-completed')}>{todo.content}</div>
                <div class="chat-activity-todo-meta">
                  <span>{todoStatusLabel(todo.status)}</span>
                  <Show when={todo.note}>
                    {(note) => <span>{note()}</span>}
                  </Show>
                </div>
              </div>
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
            <Show when={props.block.truncated}>{' · truncated'}</Show>
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
                    <Show when={file.truncated}>{' · truncated'}</Show>
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
                fallback={<div class="chat-activity-detail-empty">{file.diff_unavailable_reason || 'No textual diff'}</div>}
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

function DetailBlock(props: {
  block: FlowerActivityDetailBlock;
  item: ActivityItem;
  runID?: string;
  onPreviewFile?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
  onBrowseDirectory?: (action: FlowerActivityFileAction, item: ActivityItem) => void;
}) {
  if (props.block.kind === 'terminal') return <TerminalDetailBlock item={props.item} runID={props.runID} />;
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
  const [open, setOpen] = createSignal<boolean | null>(null);
  const [openByItem, setOpenByItem] = createSignal<Record<string, boolean>>({});

  const items = createMemo(() => Array.isArray(props.block.items) ? props.block.items : []);
  const hasItems = createMemo(() => items().length > 0);
  const summaryStatus = createMemo(() => toActivityStatus(props.block.summary?.status));
  const durationLabel = createMemo(() => formatActivityDuration(props.block.summary?.duration_ms));
  const expanded = createMemo(() => open() ?? defaultTimelineOpen(props.block));
  const fileActions = createMemo(() => props.block.file_actions as FlowerActivityFileActions | undefined);

  const itemOpen = (item: ActivityItem, id: string): boolean => {
    const local = openByItem()[id];
    if (typeof local === 'boolean') return local;
    return itemDefaultOpen(item);
  };

  const toggleItem = (item: ActivityItem, id: string) => {
    if (hasTextSelection()) return;
    setOpenByItem((prev) => ({ ...prev, [id]: !itemOpen(item, id) }));
  };

  return (
    <Show when={hasItems()}>
      <div class={cn('chat-activity-timeline', props.class)} data-status={summaryStatus()}>
        <button
          type="button"
          class="chat-activity-timeline-summary"
          aria-expanded={expanded()}
          onClick={() => setOpen(!expanded())}
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

        <Show when={expanded()}>
          <div class="chat-activity-items">
            <For each={items()}>
              {(item, itemIndex) => {
                const id = createMemo(() => itemKey(item, itemIndex()));
                const presentation = createMemo(() => presentFlowerActivityItem(flowerItem(item), fileActions(), undefined, { subagentAction: subagentActionForItem(props.block, item) }));
                const isOpen = createMemo(() => itemOpen(item, id()));
                const panelId = createMemo(() => `activity-detail-${props.blockIndex}-${id().replace(/[^a-zA-Z0-9_-]/g, '-')}`);
                const rowFileAction = createMemo(() => {
                  const primary = presentation().primaryAction;
                  if (primary) return primary;
                  const title = presentation().title;
                  return title.kind === 'file' ? disabledFileAction(title.display_name) : null;
                });
                return (
                  <div
                    class={cn('chat-activity-item-shell', isOpen() && 'chat-activity-item-shell-expanded')}
                    data-item-id={id()}
                  >
                    <div
                      class={cn(
                        'chat-activity-item chat-activity-item-clickable',
                        isBlockingItem(item) && 'chat-activity-item-blocking',
                      )}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen()}
                      aria-controls={panelId()}
                      onClick={() => toggleItem(item, id())}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        toggleItem(item, id());
                      }}
                    >
                      <span class={cn('chat-activity-item-chevron', isOpen() && 'chat-activity-item-chevron-open')} aria-hidden="true">
                        <svg viewBox="0 0 16 16"><path d="M5.5 3.75 9.75 8 5.5 12.25" /></svg>
                      </span>
                      <ActivityStatusIcon status={toActivityStatus(item.status)} class="chat-activity-item-status" />
                      <div class="chat-activity-item-main">
                        <div class="chat-activity-item-line">
                          <span class="chat-activity-item-label">{titleNode(presentation().title)}</span>
                          <Show when={presentation().meta}>
                            {(meta) => <span class="chat-activity-item-target">{meta()}</span>}
                          </Show>
                        </div>
                        <Show when={item.renderer === 'question' || item.tool_name === 'ask_user'}>
                          <AskUserAudit item={item} />
                        </Show>
                      </div>
                      <div class="chat-activity-item-actions">
                        <ApprovalActions messageId={props.messageId} item={item} />
                        <Show when={rowFileAction()}>
                          {(action) => (
                            <FileActionButtons
                              action={action()}
                              item={item}
                              onPreviewFile={props.onPreviewFile}
                              onBrowseDirectory={props.onBrowseDirectory}
                            />
                          )}
                        </Show>
                      </div>
                    </div>
                    <Show when={isOpen()}>
                      <div id={panelId()} class="chat-activity-detail-panel">
                        <div class="chat-activity-detail-sections">
                          <For each={presentation().detailBlocks}>
                            {(block) => (
                              <DetailBlock
                                block={block}
                                item={item}
                                runID={props.block.run_id}
                                onPreviewFile={props.onPreviewFile}
                                onBrowseDirectory={props.onBrowseDirectory}
                              />
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};
