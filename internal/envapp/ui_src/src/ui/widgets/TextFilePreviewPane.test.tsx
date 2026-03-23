// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextFilePreviewPane } from './TextFilePreviewPane';

const editorRenderState = vi.hoisted(() => ({
  errorMessage: '',
  nextInstanceId: 0,
}));
const resolveCodeEditorLanguageSpecMock = vi.hoisted(() => vi.fn((language?: string) => {
  switch (language) {
    case 'typescript':
      return { id: 'typescript' };
    case 'css':
      return { id: 'css' };
    case 'shellscript':
      return { id: 'shell' };
    case 'html':
      return { id: 'html' };
    default:
      return { id: 'plaintext' };
  }
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
  resolveCodeEditorLanguageSpec: (language?: string) => resolveCodeEditorLanguageSpecMock(language),
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
  resolveCodeEditorLanguageSpecMock.mockClear();
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
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('typescript:const value = 1;:ro');
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
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('css:.card { color: var(--accent); }:ro');
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

  it('keeps the same Monaco surface and makes it writable when entering edit mode', async () => {
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
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();

    setEditing(true);
    await flushAsync();

    const editingEditor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editingEditor?.dataset.instanceId).toBe('1');
    expect(editingEditor?.dataset.readOnly).toBe('false');
  });

  it('keeps Monaco-unsupported read-only languages on the highlighted fallback surface', async () => {
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

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('vue:<script setup lang="ts">const value = 1;</script>');
  });

  it('still opens Monaco for unsupported code files once the user starts editing', async () => {
    const [editing, setEditing] = createSignal(false);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.vue"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'vue', wrapText: false }}
        text={'<script setup lang="ts">const value = 1;</script>'}
        draftText={'<script setup lang="ts">const value = 2;</script>'}
        editing={editing()}
        canEdit
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();

    setEditing(true);
    await flushAsync();

    const editingEditor = host.querySelector('[data-testid="mock-editor"]') as HTMLButtonElement | null;
    expect(editingEditor).toBeTruthy();
    expect(editingEditor?.dataset.readOnly).toBe('false');
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('vue:<script setup lang="ts">const value = 2;</script>:rw');
  });

  it('keeps plain-text previews on the Monaco viewer path until the user enters edit mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/README.md"
        descriptor={{ mode: 'text', textPresentation: 'plain', wrapText: true }}
        text={'hello\nredeven'}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeNull();
    expect(host.textContent).toContain('plaintext:hello\nredeven:ro');
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
        draftText="const value = 2;"
        editing
        onSelectionChange={onSelectionChange}
      />
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('typescript:const value = 2;');
    expect(onSelectionChange).toHaveBeenCalledWith('');
  });
});
