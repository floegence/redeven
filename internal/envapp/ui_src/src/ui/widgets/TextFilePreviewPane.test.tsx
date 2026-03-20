// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextFilePreviewPane } from './TextFilePreviewPane';

const resolveLanguageSpecMock = vi.hoisted(() => vi.fn((language?: string) => {
  switch (language) {
    case 'typescript':
      return { id: 'typescript' };
    case 'vue':
    case 'toml':
      return { id: 'plaintext' };
    case 'mdx':
      return { id: 'mdx' };
    default:
      return { id: String(language ?? 'plaintext') || 'plaintext' };
  }
}));

vi.mock('@floegence/floe-webapp-core/editor', () => ({
  resolveCodeEditorLanguageSpec: (language?: string) => resolveLanguageSpecMock(language),
  CodeEditor: (props: any) => (
    <button
      type="button"
      data-testid="mock-editor"
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
  ),
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
  resolveLanguageSpecMock.mockClear();
});

describe('TextFilePreviewPane', () => {
  it('uses the read-only fallback preview even for Monaco-supported languages', async () => {
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

    expect(resolveLanguageSpecMock).toHaveBeenCalledWith('typescript');
    expect(host.querySelector('[data-testid="mock-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('typescript:const value = 1;');
    expect(onSelectionChange).toHaveBeenCalledWith('');
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

  it('uses the read-only fallback preview for code languages that Monaco only treats as plaintext', async () => {
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

    expect(resolveLanguageSpecMock).toHaveBeenCalledWith('vue');
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('vue:');
  });

  it('uses the read-only fallback preview for code languages without a rich Monaco contribution', async () => {
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

    expect(resolveLanguageSpecMock).toHaveBeenCalledWith('mdx');
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('mdx:');
  });
});
