// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextFilePreviewPane } from './TextFilePreviewPane';

const editorRenderState = vi.hoisted(() => ({
  errorMessage: '',
  nextInstanceId: 0,
}));

vi.mock('@floegence/floe-webapp-core/editor', () => ({
  CodeEditor: (props: any) => {
    if (editorRenderState.errorMessage) {
      throw new Error(editorRenderState.errorMessage);
    }
    const instanceId = String(++editorRenderState.nextInstanceId);
    return (
      <button
        type="button"
        data-testid="mock-editor"
        data-instance-id={instanceId}
        data-language={String(props.language)}
        data-read-only={String(props.options.readOnly)}
        data-line-numbers={String(props.options.lineNumbers)}
        data-line-numbers-min-chars={String(props.options.lineNumbersMinChars)}
        data-hover-enabled={String(props.options.hover?.enabled)}
        data-code-lens={String(props.options.codeLens)}
        data-inlay-hints={String(props.options.inlayHints?.enabled)}
        data-quick-suggestions={String(props.options.quickSuggestions)}
        data-suggest-on-trigger={String(props.options.suggestOnTriggerCharacters)}
        data-parameter-hints={String(props.options.parameterHints?.enabled)}
        data-inline-suggest={String(props.options.inlineSuggest?.enabled)}
        data-drop-into-editor={String(props.options.dropIntoEditor?.enabled)}
        data-paste-as={String(props.options.pasteAs?.enabled)}
        data-drag-and-drop={String(props.options.dragAndDrop)}
        data-runtime-profile={String(props.runtimeOptions?.profile)}
        onClick={() => {
          props.onChange?.('changed from editor');
          props.onSelectionChange?.('selected from editor', {});
        }}
      >
        {`${props.language}:${props.value}:${props.options.readOnly ? 'ro' : 'rw'}`}
      </button>
    );
  },
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.dynamicImportSettled();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  editorRenderState.errorMessage = '';
  editorRenderState.nextInstanceId = 0;
  vi.restoreAllMocks();
});

describe('TextFilePreviewPane', () => {
  it('keeps Monaco as the shared surface for supported read-only code previews', async () => {
    const onSelectionChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.ts"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    const editor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editor).toBeTruthy();
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
    expect(host.textContent).toContain('typescript:const value = 1;:ro');
    expect(editor?.dataset.lineNumbers).toBe('on');
    expect(editor?.dataset.lineNumbersMinChars).toBe('3');
    expect(editor?.dataset.runtimeProfile).toBe('preview_basic');
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('keeps stylesheet previews on the same Monaco path so css stays aligned with edit mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/styles.css"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'css', wrapText: false }}
        text=".card { color: var(--accent); }"
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
    expect(host.textContent).toContain('css:.card { color: var(--accent); }:ro');
  });

  it('keeps previously split formats such as TOML and Makefile-family files on the Monaco preview surface', async () => {
    const tomlHost = document.createElement('div');
    document.body.appendChild(tomlHost);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/Cargo.toml"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'toml', wrapText: false }}
        text={'[package]\nname = "redeven"'}
      />
    ), tomlHost);
    await flushAsync();

    expect(tomlHost.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(tomlHost.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
    expect(tomlHost.textContent).toContain('toml:[package]\nname = "redeven":ro');

    const makefileHost = document.createElement('div');
    document.body.appendChild(makefileHost);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/Makefile"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'makefile', wrapText: false }}
        text={'build:\n\tpnpm test'}
      />
    ), makefileHost);
    await flushAsync();

    expect(makefileHost.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(makefileHost.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
    expect(makefileHost.textContent).toContain('makefile:build:\n\tpnpm test:ro');
  });

  it('renders the Monaco editor path for edit mode and forwards edits and selections', async () => {
    const onDraftChange = vi.fn();
    const onSelectionChange = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.ts"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        draftText="const value = 2;"
        editing
        onDraftChange={onDraftChange}
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    const editor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editor).toBeTruthy();
    expect(host.textContent).toContain('typescript:const value = 2;:rw');
    expect(host.textContent).not.toContain('Editing');
    expect(editor?.dataset.readOnly).toBe('false');
    expect(editor?.dataset.hoverEnabled).toBe('false');
    expect(editor?.dataset.codeLens).toBe('false');
    expect(editor?.dataset.inlayHints).toBe('off');
    expect(editor?.dataset.quickSuggestions).toBe('false');
    expect(editor?.dataset.suggestOnTrigger).toBe('false');
    expect(editor?.dataset.parameterHints).toBe('false');
    expect(editor?.dataset.inlineSuggest).toBe('false');
    expect(editor?.dataset.dropIntoEditor).toBe('false');
    expect(editor?.dataset.pasteAs).toBe('false');
    expect(editor?.dataset.dragAndDrop).toBe('false');
    expect(editor?.dataset.runtimeProfile).toBe('preview_basic');

    editor?.click();

    expect(onDraftChange).toHaveBeenCalledWith('changed from editor');
    expect(onSelectionChange).toHaveBeenCalledWith('selected from editor');
  });

  it('recreates the Monaco editor instance when entering edit mode so read-only state cannot leak', async () => {
    const [editing, setEditing] = createSignal(false);
    const onDraftChange = vi.fn();
    const onSelectionChange = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.ts"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        draftText="const value = 1;"
        editing={editing()}
        onDraftChange={onDraftChange}
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    const previewEditor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(previewEditor?.dataset.instanceId).toBe('1');
    expect(previewEditor?.dataset.readOnly).toBe('true');
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();

    setEditing(true);
    await flushAsync();

    const editingEditor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editingEditor?.dataset.instanceId).toBe('2');
    expect(editingEditor?.dataset.readOnly).toBe('false');

    editingEditor?.click();

    expect(onDraftChange).toHaveBeenCalledWith('changed from editor');
    expect(onSelectionChange).toHaveBeenCalledWith('selected from editor');
  });

  it('keeps code-like filenames without an explicit language on the Monaco path instead of forcing a separate fallback renderer', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/.gitignore"
        descriptor={{ mode: 'text', textPresentation: 'code', wrapText: false }}
        text={'node_modules/\ndist/'}
      />
    ), host);
    await flushAsync();

    const editor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editor).toBeTruthy();
    expect(editor?.dataset.language).toBe('undefined');
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
  });

  it('keeps markdown previews on the Monaco viewer path with markdown tokenization', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/README.md"
        descriptor={{ mode: 'text', textPresentation: 'plain', language: 'markdown', wrapText: true }}
        text={'hello\nredeven'}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
    expect(host.textContent).toContain('markdown:hello\nredeven:ro');
    expect((host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null)?.dataset.lineNumbers).toBe('on');
  });

  it('uses the plain-text fallback for truncated previews and clears selection state', async () => {
    const onSelectionChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.sh"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'shellscript', wrapText: false }}
        text={'echo "redeven"'}
        truncated
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeTruthy();
    expect(Array.from(host.querySelectorAll('[data-testid="text-preview-fallback-line-number"]')).map((el) => el.textContent)).toEqual(['1']);
    expect(host.textContent).toContain('echo "redeven"');
    expect(onSelectionChange).toHaveBeenCalledWith('');
  });

  it('renders manual line numbers in the plain-text fallback for multiline previews', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    editorRenderState.errorMessage = 'monaco unavailable';
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.txt"
        descriptor={{ mode: 'text', textPresentation: 'plain', wrapText: true }}
        text={'alpha\nbeta\n'}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(Array.from(host.querySelectorAll('[data-testid="text-preview-fallback-line-number"]')).map((el) => el.textContent)).toEqual(['1', '2', '3']);
    expect(host.textContent).toContain('alpha');
    expect(host.textContent).toContain('beta');
  });

  it('shows an explicit editor-unavailable state instead of a fake editable fallback when Monaco fails in edit mode', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    editorRenderState.errorMessage = 'monaco unavailable';
    const onSelectionChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.ts"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        draftText="const value = 2;"
        editing
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeNull();
    expect(host.textContent).toContain('Editor unavailable');
    expect(host.textContent).toContain('The Monaco editor could not start for this file.');
    expect(onSelectionChange).toHaveBeenCalledWith('');
  });

  it('shows a plain-text emergency fallback instead of a second highlighted renderer when Monaco fails outside edit mode', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    editorRenderState.errorMessage = 'monaco unavailable';
    const onSelectionChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.ts"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="text-preview-fallback"]')).toBeTruthy();
    expect(host.textContent).toContain('Editor unavailable. Showing a plain-text fallback for this preview.');
    expect(host.textContent).toContain('const value = 1;');
    expect(Array.from(host.querySelectorAll('[data-testid="text-preview-fallback-line-number"]')).map((el) => el.textContent)).toEqual(['1']);
    expect(onSelectionChange).toHaveBeenCalledWith('');
  });
});
