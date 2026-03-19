// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewContent } from './FilePreviewContent';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (
    props.visible ? <div data-testid="loading-overlay">{props.message}</div> : null
  ),
}));

vi.mock('./TextFilePreviewPane', () => ({
  TextFilePreviewPane: (props: any) => (
    <div data-testid="text-preview-pane">{`${props.path}:${props.text}`}</div>
  ),
}));

vi.mock('./DocxPreviewPane', () => ({
  DocxPreviewPane: () => <div data-testid="docx-preview-pane" />,
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FilePreviewContent', () => {
  it('renders the path copy action and edit control inside the shared header', () => {
    const onCopyPath = vi.fn();
    const onStartEdit = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewContent
        item={{ id: '/workspace/demo.sh', name: 'demo.sh', path: '/workspace/demo.sh', type: 'file' }}
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'shellscript', wrapText: false }}
        text={'echo "redeven"'}
        canEdit
        onCopyPath={onCopyPath}
        onStartEdit={onStartEdit}
      />
    ), host);

    const root = host.firstElementChild as HTMLElement | null;
    const header = root?.firstElementChild as HTMLElement | null;
    expect(header?.textContent).toContain('Path');
    expect(header?.textContent).toContain('/workspace/demo.sh');
    expect(header?.textContent).toContain('Copy path');
    expect(header?.textContent).toContain('Edit');

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Copy path'))?.click();
    buttons.find((button) => button.textContent?.includes('Edit'))?.click();

    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onStartEdit).toHaveBeenCalledTimes(1);
  });

  it('keeps save and discard controls in the shared path header while editing', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCopyPath = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewContent
        item={{ id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' }}
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        draftText="const value = 2;"
        editing
        dirty
        canEdit
        onCopyPath={onCopyPath}
        onSave={onSave}
        onDiscard={onDiscard}
      />
    ), host);

    const root = host.firstElementChild as HTMLElement | null;
    const header = root?.firstElementChild as HTMLElement | null;
    expect(header?.textContent).toContain('/workspace/demo.ts');
    expect(header?.textContent).toContain('Copy path');
    expect(header?.textContent).toContain('Discard');
    expect(header?.textContent).toContain('Save');
    expect(header?.textContent).not.toContain('Edit');

    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find((button) => button.textContent?.includes('Copy path'))?.click();
    buttons.find((button) => button.textContent?.includes('Discard'))?.click();
    buttons.find((button) => button.textContent?.includes('Save'))?.click();

    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
