import { ErrorBoundary, Suspense, Show, createMemo, createSignal, lazy } from 'solid-js';
import type { CodeEditorApi, CodeEditorProps } from '@floegence/floe-webapp-core/editor';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { fileItemFromPath } from '../utils/filePreviewItem';
import { FileMarkdown } from '../file-markdown/FileMarkdown';
import { useFilePreviewContext } from './FilePreviewContext';

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

const EDITING_MONACO_RUNTIME_OPTIONS: CodeEditorRuntimeOptions = {
  profile: 'editor_full',
};

export interface MarkdownPreviewPaneProps {
  path: string;
  descriptor: FilePreviewDescriptor;
  text: string;
  draftText?: string;
  editing?: boolean;
  saveError?: string | null;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
}

export function MarkdownPreviewPane(props: MarkdownPreviewPaneProps) {
  const filePreview = useFilePreviewContext();
  const [monacoFailed, setMonacoFailed] = createSignal(false);
  const editorValue = createMemo(() => (props.editing ? props.draftText ?? props.text : props.text));
  const resolvedLanguage = createMemo(() => props.descriptor.language ?? 'markdown');

  const editorOptions = createMemo<CodeEditorOptions>(() => ({
    ...PREVIEW_MONACO_INTERACTION_OPTIONS,
    readOnly: false,
    wordWrap: 'on' as const,
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    folding: true,
    renderLineHighlight: 'line' as const,
    renderWhitespace: 'selection' as const,
  }));

  const renderMarkdownPreview = () => (
    <FileMarkdown
      content={props.text}
      filePath={props.path}
      showToc={true}
      onOpenFileLink={(target) => {
        void filePreview.openPreview(fileItemFromPath(target.path), {
          reusePolicy: 'same_file_or_create',
          focus: true,
          ensureVisible: true,
        });
      }}
    />
  );

  const renderMonacoEditor = () => (
    <CodeEditor
      path={props.path}
      language={resolvedLanguage()}
      value={editorValue()}
      options={editorOptions()}
      runtimeOptions={EDITING_MONACO_RUNTIME_OPTIONS}
      onChange={(value: string) => {
        props.onDraftChange?.(value);
      }}
      onSelectionChange={(selectionText: string, _api: CodeEditorApi) => {
        props.onSelectionChange?.(selectionText);
      }}
      class="h-full"
    />
  );

  const renderEditFailureFallback = () => (
    <div class="flex h-full items-center justify-center p-4">
      <div class="max-w-md rounded-md border border-warning/20 bg-warning/10 px-4 py-3 text-sm">
        <div class="font-medium text-foreground">Editor unavailable</div>
        <div class="mt-1 text-xs text-muted-foreground">
          The Monaco editor could not start for this file. Discard this edit session or try again later.
        </div>
      </div>
    </div>
  );

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={(props.saveError ?? '').trim()}>
        <div class="shrink-0 border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {props.saveError}
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-hidden">
        <Show
          when={!props.editing}
          fallback={
            <ErrorBoundary
              fallback={() => {
                queueMicrotask(() => {
                  setMonacoFailed(true);
                });
                return renderEditFailureFallback();
              }}
            >
              <Suspense fallback={
                <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading editor...
                </div>
              }>
                <Show when={!monacoFailed()} fallback={renderEditFailureFallback()}>
                  {renderMonacoEditor()}
                </Show>
              </Suspense>
            </ErrorBoundary>
          }
        >
          {renderMarkdownPreview()}
        </Show>
      </div>
    </div>
  );
}
