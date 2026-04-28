// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewContent } from './FilePreviewContent';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  LOCAL_INTERACTION_SURFACE_ATTR: 'data-floe-local-interaction-surface',
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR: 'data-floe-workbench-widget-activation-surface',
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

vi.mock('./PdfPreviewPane', () => ({
  PdfPreviewPane: () => <div data-testid="pdf-preview-pane" />,
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FilePreviewContent', () => {
  it('renders the path copy icon inline and briefly shows the copied state', async () => {
    vi.useFakeTimers();

    const onCopyPath = vi.fn(async () => true);
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
    expect(header?.textContent).toContain('Edit');
    expect(host.querySelector('button[aria-label="Copy path"]')).toBeTruthy();

    const copyButton = host.querySelector('button[aria-label="Copy path"]') as HTMLButtonElement | null;
    copyButton?.click();
    await flushAsync();
    expect(host.querySelector('button[aria-label="Path copied"]')).toBeTruthy();
    vi.advanceTimersByTime(1600);
    await flushAsync();
    expect(host.querySelector('button[aria-label="Copy path"]')).toBeTruthy();

    const buttons = Array.from(host.querySelectorAll('button'));
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
    expect(header?.textContent).toContain('Discard');
    expect(header?.textContent).toContain('Save');
    expect(header?.textContent).not.toContain('Edit');
    expect(host.querySelector('button[aria-label="Copy path"]')).toBeTruthy();

    const buttons = Array.from(host.querySelectorAll('button'));
    (host.querySelector('button[aria-label="Copy path"]') as HTMLButtonElement | null)?.click();
    buttons.find((button) => button.textContent?.includes('Discard'))?.click();
    buttons.find((button) => button.textContent?.includes('Save'))?.click();

    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps discard available when editing starts without any local changes', () => {
    const onDiscard = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewContent
        item={{ id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' }}
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        draftText="const value = 1;"
        editing
        dirty={false}
        canEdit
        onDiscard={onDiscard}
      />
    ), host);

    const discardButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Discard')) as HTMLButtonElement | undefined;
    const saveButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Save')) as HTMLButtonElement | undefined;

    expect(discardButton?.disabled).toBe(false);
    expect(saveButton?.disabled).toBe(true);

    discardButton?.click();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('supports a content-only mode without the shared path header', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewContent
        item={{ id: '/workspace/demo.ts', name: 'demo.ts', path: '/workspace/demo.ts', type: 'file' }}
        descriptor={{ mode: 'text', textPresentation: 'code', language: 'typescript', wrapText: false }}
        text="const value = 1;"
        showHeader={false}
        canEdit
      />
    ), host);

    const root = host.firstElementChild as HTMLElement | null;
    expect(root?.firstElementChild?.textContent).not.toContain('Path');
    expect(host.textContent).not.toContain('Edit');
    expect(host.querySelector('button[aria-label="Copy path"]')).toBeNull();
    expect(host.querySelector('[data-testid="text-preview-pane"]')?.textContent).toContain('/workspace/demo.ts');
  });

  it('routes PDF previews through the shared PDF pane', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FilePreviewContent
        item={{ id: '/workspace/demo.pdf', name: 'demo.pdf', path: '/workspace/demo.pdf', type: 'file' }}
        descriptor={{ mode: 'pdf' }}
        bytes={new Uint8Array([1, 2, 3])}
      />
    ), host);

    expect(host.querySelector('[data-testid="pdf-preview-pane"]')).toBeTruthy();
    expect(host.querySelector('iframe[title="PDF preview"]')).toBeNull();
  });
});
