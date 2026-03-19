import { Suspense, Show, createEffect, createMemo, lazy } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { isCodeEditorLanguageSupported, type CodeEditorApi } from '@floegence/floe-webapp-core/editor';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { CodePreviewPane } from './CodePreviewPane';

const CodeEditor = lazy(() => import('@floegence/floe-webapp-core/editor').then((module) => ({ default: module.CodeEditor })));

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

function describePreviewMode(props: TextFilePreviewPaneProps, monacoSupported: boolean): string {
  if (props.editing) {
    return monacoSupported
      ? 'Editing'
      : 'Editing in plain text mode (syntax highlighting unavailable for this language).';
  }
  if (props.descriptor.textPresentation === 'plain') {
    return 'Read-only text preview';
  }
  if (monacoSupported) {
    return 'Read-only code preview';
  }
  return 'Read-only highlight fallback';
}

export function TextFilePreviewPane(props: TextFilePreviewPaneProps) {
  const resolvedLanguage = createMemo(() => {
    if (props.descriptor.textPresentation !== 'code') return 'plaintext';
    return props.descriptor.language || 'plaintext';
  });
  const monacoSupported = createMemo(() => (
    props.descriptor.textPresentation !== 'code'
    || isCodeEditorLanguageSupported(resolvedLanguage())
  ));
  const shouldUseMonaco = createMemo(() => (
    props.editing
    || props.descriptor.textPresentation !== 'code'
    || monacoSupported()
  ));
  const editorValue = createMemo(() => (props.editing ? props.draftText ?? props.text : props.text));
  const editorOptions = createMemo(() => ({
    readOnly: !props.editing,
    wordWrap: props.descriptor.wrapText === false ? ('off' as const) : ('on' as const),
    lineNumbers: props.descriptor.textPresentation === 'code' ? ('on' as const) : ('off' as const),
    lineNumbersMinChars: props.descriptor.textPresentation === 'code' ? 3 : 0,
    folding: props.descriptor.textPresentation === 'code',
    renderLineHighlight: props.editing ? ('line' as const) : ('none' as const),
    renderWhitespace: 'selection' as const,
  }));
  const statusText = createMemo(() => describePreviewMode(props, monacoSupported()));
  const languageLabel = createMemo(() => (
    props.descriptor.textPresentation === 'code'
      ? props.descriptor.language || 'plaintext'
      : 'text'
  ));
  const showEditActions = createMemo(() => Boolean(props.canEdit));

  createEffect(() => {
    if (!shouldUseMonaco()) {
      props.onSelectionChange?.('');
    }
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{languageLabel()}</div>
          <div class="text-xs text-muted-foreground">{statusText()}</div>
        </div>

        <div class="flex items-center gap-2">
          <Show when={showEditActions() && !props.editing}>
            <Button size="sm" variant="outline" onClick={() => props.onStartEdit?.()}>
              Edit
            </Button>
          </Show>

          <Show when={showEditActions() && props.editing}>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.saving || (!props.dirty && !(props.saveError ?? '').trim())}
              onClick={() => props.onDiscard?.()}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="default"
              loading={props.saving}
              disabled={!props.dirty}
              onClick={() => props.onSave?.()}
            >
              Save
            </Button>
          </Show>
        </div>
      </div>

      <Show when={(props.saveError ?? '').trim()}>
        <div class="shrink-0 border-b border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {props.saveError}
        </div>
      </Show>

      <div class="min-h-0 flex-1 overflow-hidden">
        <Show
          when={shouldUseMonaco()}
          fallback={<CodePreviewPane code={props.text} language={props.descriptor.language} />}
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
