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
        data-read-only={String(props.options.readOnly)}
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

vi.mock('./CodePreviewPane', () => ({
  CodePreviewPane: (props: any) => <div data-testid="fallback-preview">{`${props.language}:${props.code}`}</div>,
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
});

describe('TextFilePreviewPane', () => {
  it('renders Monaco in read-only mode for Monaco-supported preview languages', async () => {
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
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('typescript:const value = 1;:ro');
    expect(editor?.dataset.readOnly).toBe('true');
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('renders the Monaco editor path for supported languages and forwards edits and selections', async () => {
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
        dirty
        canEdit
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

    editor?.click();

    expect(onDraftChange).toHaveBeenCalledWith('changed from editor');
    expect(onSelectionChange).toHaveBeenCalledWith('selected from editor');
  });

  it('recreates the Monaco editor instance when switching from preview to edit mode', async () => {
    const [editing, setEditing] = createSignal(false);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.ts"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        draftText="const value = 1;"
        editing={editing()}
        canEdit
      />
    ), host);
    await flushAsync();

    const previewEditor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(previewEditor?.dataset.instanceId).toBe('1');
    expect(previewEditor?.dataset.readOnly).toBe('true');

    setEditing(true);
    await flushAsync();

    const editingEditor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editingEditor?.dataset.instanceId).toBe('2');
    expect(editingEditor?.dataset.readOnly).toBe('false');
  });

  it('keeps unsupported code languages on the same read-only Monaco surface as Edit mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.vue"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'vue', wrapText: false }}
        text={'<script setup lang="ts">const value = 1;</script>'}
        canEdit
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('vue:<script setup lang="ts">const value = 1;</script>:ro');
  });

  it('keeps richer preview-only languages on the Monaco surface to match Edit mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.mdx"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'mdx', wrapText: false }}
        text={'# Hello\n\nexport const value = 1;'}
        canEdit
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('mdx:# Hello');
  });

  it('uses the lightweight fallback for truncated previews even when Monaco supports the language', async () => {
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
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(onSelectionChange).toHaveBeenCalledWith('');
  });

  it('falls back to the lightweight preview when Monaco rendering fails', async () => {
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
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('typescript:const value = 1;');
    expect(onSelectionChange).toHaveBeenCalledWith('');
  });
});
