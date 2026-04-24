import { ErrorBoundary, For, Suspense, Show, createEffect, createMemo, createSignal, lazy, on } from 'solid-js';
import type { CodeEditorApi, CodeEditorProps } from '@floegence/floe-webapp-core/editor';
import type { FilePreviewDescriptor } from '../utils/filePreview';

const CodeEditor = lazy(async () => {
  const module = await import('@floegence/floe-webapp-core/editor');
  return { default: module.CodeEditor };
});

type CodeEditorOptions = NonNullable<CodeEditorProps['options']>;
type CodeEditorRuntimeOptions = CodeEditorProps['runtimeOptions'];

const PREVIEW_MONACO_INTERACTION_OPTIONS: CodeEditorOptions = {
  hover: { enabled: false, sticky: false },
  codeLens: false,
  inlayHints: { enabled: 'off' },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
  dropIntoEditor: { enabled: false, showDropSelector: 'never' },
  pasteAs: { enabled: false, showPasteSelector: 'never' },
  dragAndDrop: false,
};

const PREVIEW_MONACO_RUNTIME_OPTIONS: CodeEditorRuntimeOptions = {
  profile: 'preview_basic',
};

const EDITING_MONACO_RUNTIME_OPTIONS: CodeEditorRuntimeOptions = {
  profile: 'editor_full',
};

interface StaticTextPreviewPaneProps {
  text: string;
  wrapText?: boolean;
  showEditorUnavailableNotice?: boolean;
}

function splitPreviewLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split('\n');
}

function StaticTextPreviewPane(props: StaticTextPreviewPaneProps) {
  const lines = createMemo(() => splitPreviewLines(props.text));

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={props.showEditorUnavailableNotice}>
        <div class="shrink-0 border-b border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
          Editor unavailable. Showing a plain-text fallback for this preview.
        </div>
      </Show>

      <div
        data-testid="text-preview-fallback"
        class="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5 text-foreground"
      >
        <table class="min-w-full border-collapse">
          <tbody>
            <For each={lines()}>
              {(line, index) => (
                <tr class="align-top">
                  <td
                    data-testid="text-preview-fallback-line-number"
                    class="select-none border-r border-border/70 px-3 py-0 text-right text-muted-foreground/70"
                  >
                    {index() + 1}
                  </td>
                  <td class="w-full px-3 py-0">
                    <code
                      class={`block min-h-5 ${
                        props.wrapText === false ? 'whitespace-pre' : 'whitespace-pre-wrap break-words'
                      }`}
                    >
                      {line.length > 0 ? line : ' '}
                    </code>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface TextFilePreviewPaneProps {
  path: string;
  descriptor: FilePreviewDescriptor;
  text: string;
  draftText?: string;
  truncated?: boolean;
  editing?: boolean;
  saveError?: string | null;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
}

export function TextFilePreviewPane(props: TextFilePreviewPaneProps) {
  const [monacoFailed, setMonacoFailed] = createSignal(false);
  const resolvedLanguage = createMemo<string | undefined>(() => {
    return props.descriptor.language;
  });
  const shouldUseMonaco = createMemo(() => !props.truncated && !monacoFailed());
  const editorValue = createMemo(() => (props.editing ? props.draftText ?? props.text : props.text));
  const editorRuntimeOptions = createMemo<CodeEditorRuntimeOptions>(() => (
    props.editing ? EDITING_MONACO_RUNTIME_OPTIONS : PREVIEW_MONACO_RUNTIME_OPTIONS
  ));
  const editorOptions = createMemo<CodeEditorOptions>(() => ({
    ...PREVIEW_MONACO_INTERACTION_OPTIONS,
    readOnly: !props.editing,
    wordWrap: props.descriptor.wrapText === false ? ('off' as const) : ('on' as const),
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    folding: props.descriptor.textPresentation === 'code',
    renderLineHighlight: props.editing ? ('line' as const) : ('none' as const),
    renderWhitespace: 'selection' as const,
  }));
  const previewFallback = (showEditorUnavailableNotice = false) => (
    <StaticTextPreviewPane
      text={editorValue()}
      wrapText={props.descriptor.wrapText}
      showEditorUnavailableNotice={showEditorUnavailableNotice}
    />
  );
  const editFailureFallback = () => (
    <div class="flex h-full items-center justify-center p-4">
      <div class="max-w-md rounded-md border border-warning/20 bg-warning/10 px-4 py-3 text-sm">
        <div class="font-medium text-foreground">Editor unavailable</div>
        <div class="mt-1 text-xs text-muted-foreground">
          The Monaco editor could not start for this file. Discard this edit session or try again later.
        </div>
      </div>
    </div>
  );
  const renderMonacoEditor = () => (
    <CodeEditor
      path={props.path}
      language={resolvedLanguage()}
      value={editorValue()}
      options={editorOptions()}
      runtimeOptions={editorRuntimeOptions()}
      onChange={(value: string) => {
        if (!props.editing) return;
        props.onDraftChange?.(value);
      }}
      onSelectionChange={(selectionText: string, _api: CodeEditorApi) => {
        props.onSelectionChange?.(selectionText);
      }}
      class="h-full"
    />
  );
  const renderReadonlyMonaco = () => renderMonacoEditor();
  const renderEditingMonaco = () => renderMonacoEditor();
  const renderFallbackSurface = () => (props.editing ? editFailureFallback() : previewFallback(monacoFailed()));

  createEffect(on(() => [props.path, props.truncated, resolvedLanguage(), props.editing], () => {
    setMonacoFailed(false);
  }));

  createEffect(() => {
    if (!shouldUseMonaco()) {
      props.onSelectionChange?.('');
    }
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={(props.saveError ?? '').trim()}>
        <div class="shrink-0 border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {props.saveError}
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-hidden">
        <Show
          when={shouldUseMonaco()}
          fallback={renderFallbackSurface()}
        >
          <ErrorBoundary
            fallback={() => {
              queueMicrotask(() => {
                setMonacoFailed(true);
              });
              return props.editing ? editFailureFallback() : previewFallback(true);
            }}
          >
            <Suspense fallback={<div class="flex h-full items-center justify-center text-sm text-muted-foreground">Loading editor...</div>}>
              {/* Monaco must remount when switching between read-only preview and edit mode.
                  Reusing a preview instance can leak stale readOnly state and trigger
                  "Cannot edit in read-only editor" after the user clicks Edit. */}
              <Show when={props.editing} fallback={renderReadonlyMonaco()}>
                {renderEditingMonaco()}
              </Show>
            </Suspense>
          </ErrorBoundary>
        </Show>
      </div>
    </div>
  );
}
