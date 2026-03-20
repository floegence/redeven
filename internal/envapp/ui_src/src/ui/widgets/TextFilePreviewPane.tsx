import { Suspense, Show, createEffect, createMemo, lazy } from 'solid-js';
import { resolveCodeEditorLanguageSpec, type CodeEditorApi, type CodeEditorProps } from '@floegence/floe-webapp-core/editor';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { CodePreviewPane } from './CodePreviewPane';

const CodeEditor = lazy(() => import('@floegence/floe-webapp-core/editor').then((module) => ({ default: module.CodeEditor })));

const MONACO_CODE_PREVIEW_LANGUAGE_IDS = new Set([
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'scss',
  'less',
  'markdown',
  'yaml',
  'ini',
  'xml',
  'python',
  'java',
  'kotlin',
  'scala',
  'go',
  'rust',
  'cpp',
  'csharp',
  'fsharp',
  'php',
  'ruby',
  'perl',
  'shell',
  'swift',
  'objective-c',
  'r',
  'sql',
  'lua',
  'dart',
  'dockerfile',
  'bat',
  'powershell',
]);

const PLAIN_TEXT_EDITOR_LANGUAGES = new Set(['', 'text', 'plaintext', 'txt']);
type CodeEditorOptions = NonNullable<CodeEditorProps['options']>;

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

function supportsRichMonacoCodePreview(language?: string): boolean {
  const normalized = String(language ?? '').trim().toLowerCase();
  if (PLAIN_TEXT_EDITOR_LANGUAGES.has(normalized)) return true;
  return MONACO_CODE_PREVIEW_LANGUAGE_IDS.has(resolveCodeEditorLanguageSpec(normalized).id);
}

export interface TextFilePreviewPaneProps {
  path: string;
  descriptor: FilePreviewDescriptor;
  text: string;
  draftText?: string;
  editing?: boolean;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string | null;
  canEdit?: boolean;
  onStartEdit?: () => void;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
  onSave?: () => void;
  onDiscard?: () => void;
}

export function TextFilePreviewPane(props: TextFilePreviewPaneProps) {
  const resolvedLanguage = createMemo(() => {
    if (props.descriptor.textPresentation !== 'code') return 'plaintext';
    return props.descriptor.language || 'plaintext';
  });
  const monacoSupported = createMemo(() => (
    props.descriptor.textPresentation !== 'code'
    || supportsRichMonacoCodePreview(resolvedLanguage())
  ));
  const shouldUseMonaco = createMemo(() => !!props.editing);
  const editorValue = createMemo(() => (props.editing ? props.draftText ?? props.text : props.text));
  const editorOptions = createMemo<CodeEditorOptions>(() => ({
    ...PREVIEW_MONACO_INTERACTION_OPTIONS,
    readOnly: !props.editing,
    wordWrap: props.descriptor.wrapText === false ? ('off' as const) : ('on' as const),
    lineNumbers: props.descriptor.textPresentation === 'code' ? ('on' as const) : ('off' as const),
    lineNumbersMinChars: props.descriptor.textPresentation === 'code' ? 3 : 0,
    folding: props.descriptor.textPresentation === 'code',
    renderLineHighlight: props.editing ? ('line' as const) : ('none' as const),
    renderWhitespace: 'selection' as const,
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
          fallback={(
            <CodePreviewPane
              code={props.text}
              language={props.descriptor.textPresentation === 'code' ? props.descriptor.language : undefined}
            />
          )}
        >
          <Suspense fallback={<div class="flex h-full items-center justify-center text-sm text-muted-foreground">Loading editor...</div>}>
            <CodeEditor
              path={props.path}
              language={monacoSupported() ? resolvedLanguage() : 'plaintext'}
              value={editorValue()}
              options={editorOptions()}
              onChange={(value: string) => {
                if (!props.editing) return;
                props.onDraftChange?.(value);
              }}
              onSelectionChange={(selectionText: string, _api: CodeEditorApi) => {
                props.onSelectionChange?.(selectionText);
              }}
              class="h-full"
            />
          </Suspense>
        </Show>
      </div>
    </div>
  );
}
