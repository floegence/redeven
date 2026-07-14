// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestI18nHelpers as createI18nHelpers } from '../i18n/locales/testDictionaries';
import {
  renderRedevenFilePreviewBody,
  resolveRedevenFilePreviewRenderer,
} from './rendererRegistry';

vi.mock('../widgets/TextFilePreviewPane', () => ({
  TextFilePreviewPane: (props: any) => (
    <div data-testid="text-renderer">{`${props.path}:${props.text}`}</div>
  ),
}));

vi.mock('../widgets/MarkdownPreviewPane', () => ({
  MarkdownPreviewPane: (props: any) => (
    <div data-testid="markdown-renderer">{`${props.path}:${props.text}`}</div>
  ),
}));

vi.mock('../widgets/PdfPreviewPane', () => ({
  PdfPreviewPane: (props: any) => (
    <div data-testid="pdf-renderer">{props.bytes?.length ?? 0}</div>
  ),
}));

vi.mock('../widgets/DocxPreviewPane', () => ({
  DocxPreviewPane: (props: any) => (
    <div data-testid="docx-renderer">{props.bytes?.length ?? 0}</div>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Redeven file preview renderer registry', () => {
  it('resolves preview modes through the Redeven-owned registry', () => {
    expect(resolveRedevenFilePreviewRenderer({ mode: 'text' }).id).toBe('text');
    expect(resolveRedevenFilePreviewRenderer({ mode: 'pdf' }).id).toBe('pdf');
    expect(resolveRedevenFilePreviewRenderer({ mode: 'docx' }).id).toBe('docx');
    expect(resolveRedevenFilePreviewRenderer({ mode: 'xlsx' }).id).toBe('xlsx');
    expect(resolveRedevenFilePreviewRenderer({ mode: 'video' }).id).toBe('video');
    expect(resolveRedevenFilePreviewRenderer({ mode: 'audio' }).id).toBe('audio');
    expect(resolveRedevenFilePreviewRenderer({ mode: 'binary' }).id).toBe('binary');
  });

  it('renders text, PDF, DOCX, spreadsheet, and unsupported bodies without a shared-package preview component', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const i18n = createI18nHelpers('en-US');

    render(() => (
      <>
        {renderRedevenFilePreviewBody({
          item: { id: '/workspace/app.ts', name: 'app.ts', path: '/workspace/app.ts', type: 'file' },
          descriptor: { mode: 'text', textPresentation: 'code', language: 'typescript' },
          text: 'const value = 1;',
        })}
        {renderRedevenFilePreviewBody({
          item: { id: '/workspace/README.md', name: 'README.md', path: '/workspace/README.md', type: 'file' },
          descriptor: { mode: 'markdown' },
          text: '# Hello',
        })}
        {renderRedevenFilePreviewBody({
          descriptor: { mode: 'pdf' },
          bytes: new Uint8Array([1, 2, 3]),
        })}
        {renderRedevenFilePreviewBody({
          descriptor: { mode: 'docx' },
          bytes: new Uint8Array([1, 2]),
        })}
        {renderRedevenFilePreviewBody({
          descriptor: { mode: 'xlsx' },
          xlsxSheetName: 'Sheet1',
          xlsxRows: [['A1', 'B1']],
        })}
        {renderRedevenFilePreviewBody({
          descriptor: { mode: 'unsupported' },
          message: 'Preview blocked by policy.',
        })}
      </>
    ), host);

    expect(host.querySelector('[data-testid="text-renderer"]')?.textContent).toContain('/workspace/app.ts');
    expect(host.querySelector('[data-testid="markdown-renderer"]')?.textContent).toContain('/workspace/README.md');
    expect(host.querySelector('[data-testid="pdf-renderer"]')?.textContent).toBe('3');
    expect(host.querySelector('[data-testid="docx-renderer"]')?.textContent).toBe('2');
    expect(host.textContent).toContain('Sheet: Sheet1');
    expect(host.textContent).toContain('A1');
    expect(host.textContent).toContain(i18n.t('filePreview.errorUnsupportedTitle'));
    expect(host.textContent).toContain(i18n.t('filePreview.errorUnsupportedDescription'));
    expect(host.textContent).toContain(i18n.t('filePreview.technicalDetails'));

    const detailsButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes(i18n.t('filePreview.technicalDetails')));
    expect(detailsButton).toBeTruthy();
    detailsButton?.click();
    expect(host.textContent).toContain('Preview blocked by policy.');
  });

  it('renders native media elements with resource URLs', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <>
        {renderRedevenFilePreviewBody({
          item: { id: '/workspace/demo.mp4', name: 'demo.mp4', path: '/workspace/demo.mp4', type: 'file' },
          descriptor: { mode: 'video' },
          resourceUrl: '/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Fdemo.mp4',
        })}
        {renderRedevenFilePreviewBody({
          item: { id: '/workspace/audio.mp3', name: 'audio.mp3', path: '/workspace/audio.mp3', type: 'file' },
          descriptor: { mode: 'audio' },
          resourceUrl: '/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Faudio.mp3',
        })}
      </>
    ), host);

    const video = host.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('controls')).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('src')).toBe('/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Fdemo.mp4');

    const audio = host.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute('controls')).not.toBeNull();
    expect(audio?.getAttribute('preload')).toBe('metadata');
    expect(audio?.getAttribute('src')).toBe('/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Faudio.mp3');
  });
});
