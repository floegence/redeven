// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextFilePreviewPane } from './TextFilePreviewPane';

const supportCheckMock = vi.hoisted(() => vi.fn((language?: string) => language !== 'toml'));

vi.mock('@floegence/floe-webapp-core/editor', () => ({
  isCodeEditorLanguageSupported: (language?: string) => supportCheckMock(language),
  CodeEditor: (props: any) => (
    <button
      type="button"
      data-testid="mock-editor"
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
  supportCheckMock.mockClear();
});

describe('TextFilePreviewPane', () => {
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

    editor?.click();

    expect(onDraftChange).toHaveBeenCalledWith('changed from editor');
    expect(onSelectionChange).toHaveBeenCalledWith('selected from editor');
  });

  it('uses the read-only fallback preview for unsupported code languages', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TextFilePreviewPane
        path="/workspace/demo.toml"
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'toml', wrapText: false }}
        text={'title = "redeven"'}
        canEdit
      />
    ), host);
    await flushAsync();

    expect(supportCheckMock).toHaveBeenCalledWith('toml');
    expect(host.querySelector('[data-testid="fallback-preview"]')).toBeTruthy();
    expect(host.textContent).toContain('Read-only highlight fallback');
  });
});
