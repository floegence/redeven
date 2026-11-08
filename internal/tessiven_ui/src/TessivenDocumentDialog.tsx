import { ErrorBoundary, Show, Suspense, createEffect, createSignal, lazy, on, onCleanup } from 'solid-js';
import type { CodeEditorApi } from '@floegence/floe-webapp-core/editor';
import { Check, Copy, Download, FileCode, Search } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { TessivenText, Version } from './types';

const CodeEditor = lazy(async () => {
  const module = await import('@floegence/floe-webapp-core/editor');
  return { default: module.CodeEditor };
});

function DocumentReader(props: { version: Version; t: TessivenText; onDownload: () => void }) {
  const [api, setApi] = createSignal<CodeEditorApi>();
  const [wrap, setWrap] = createSignal(true);
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal(false);
  let disposed = false;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { disposed = true; clearTimeout(copyTimer); });
  const filename = () => `${props.version.canvas_id}-v${props.version.number}.yaml`;
  createEffect(on(() => props.version.document_yaml, () => {
    clearTimeout(copyTimer); setCopied(false); setCopyError(false);
  }));
  createEffect(() => { api()?.editor.updateOptions({ wordWrap: wrap() ? 'on' : 'off' }); });
  const find = () => {
    api()?.focus();
    void api()?.editor.getAction('actions.find')?.run();
  };
  const copy = async () => {
    const text = props.version.document_yaml;
    setCopyError(false); setCopied(false);
    try {
      await navigator.clipboard.writeText(text);
      if (disposed || text !== props.version.document_yaml) return;
      setCopied(true);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (!disposed && text === props.version.document_yaml) setCopyError(true);
    }
  };
  return <div class="tessiven-document-reader" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f' && api()) {
      event.preventDefault(); event.stopPropagation(); find();
    }
  }}>
    <div class="tessiven-document-toolbar">
      <div class="tessiven-document-identity"><FileCode /><span title={filename()}>{filename()}</span><small>YAML</small></div>
      <div class="tessiven-document-tools">
        <Button size="xs" variant="ghost" aria-pressed={wrap()} onClick={() => setWrap(value => !value)}>{props.t('wrapLines')}</Button>
        <Button size="icon" variant="ghost" disabled={!api()} aria-label={props.t('findDocument')} title={props.t('findDocument')} onClick={find}><Search /></Button>
      </div>
    </div>
    <div class="tessiven-document-content">
      <Show when={!api()}><pre class="tessiven-source" classList={{ 'tessiven-source--wrap': wrap() }} tabIndex={0} aria-label={props.t('documentLabel')}>{props.version.document_yaml}</pre></Show>
      <ErrorBoundary fallback={<p role="status" class="tessiven-document-unavailable">{props.t('documentHighlightUnavailable')}</p>}>
        <Suspense>
          <CodeEditor path={filename()} language="yaml" value={props.version.document_yaml}
            class="tessiven-document-editor" style={{ opacity: api() ? 1 : 0, 'pointer-events': api() ? 'auto' : 'none' }}
            runtimeOptions={{ profile: 'preview_basic' }}
            options={{
              readOnly: true, domReadOnly: true, ariaLabel: props.t('documentLabel'),
              wordWrap: wrap() ? 'on' : 'off', wrappingIndent: 'same',
              lineNumbers: 'on', lineNumbersMinChars: 3, glyphMargin: false,
              folding: true, showFoldingControls: 'always', guides: { indentation: true },
              fontSize: 13, lineHeight: 22, padding: { top: 16, bottom: 20 },
              renderLineHighlight: 'none', renderWhitespace: 'selection',
              minimap: { enabled: false }, scrollBeyondLastLine: false,
              scrollbar: { alwaysConsumeMouseWheel: false },
              hover: { enabled: 'off' }, contextmenu: false, links: false,
              codeLens: false, inlayHints: { enabled: 'off' }, quickSuggestions: false,
              suggestOnTriggerCharacters: false, parameterHints: { enabled: false },
              inlineSuggest: { enabled: false }, dragAndDrop: false,
              dropIntoEditor: { enabled: false, showDropSelector: 'never' },
              pasteAs: { enabled: false, showPasteSelector: 'never' },
            }}
            onReady={ready => {
              setApi(ready);
              ready.editor.onDidDispose(() => { if (!disposed) setApi(current => current === ready ? undefined : current); });
            }} />
        </Suspense>
      </ErrorBoundary>
    </div>
    <div class="tessiven-document-footer">
      <p>{props.t('sourceDescription')}</p>
      <div class="tessiven-document-tools">
        <Button size="sm" variant="ghost" aria-label={props.t(copied() ? 'documentCopied' : 'copyDocument')} onClick={() => void copy()}><Show when={copied()} fallback={<Copy />}><Check /></Show><span aria-live="polite">{props.t(copied() ? 'documentCopied' : 'copyDocument')}</span></Button>
        <Button size="sm" variant="outline" onClick={props.onDownload}><Download />{props.t('export')}</Button>
      </div>
      <Show when={copyError()}><p role="alert" class="tessiven-document-copy-error">{props.t('documentCopyFailed')}</p></Show>
    </div>
  </div>;
}

export function TessivenDocumentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version?: Version;
  t: TessivenText;
  onDownload: () => void;
}) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange} title={props.t('viewSource')} closeLabel={props.t('close')}
    escapeKeyPhase="bubble" class="tessiven-dialog tessiven-document-dialog" contentClass="tessiven-document-body">
    <Show when={props.version}>{version => <DocumentReader version={version()} t={props.t} onDownload={props.onDownload} />}</Show>
  </Dialog>;
}
