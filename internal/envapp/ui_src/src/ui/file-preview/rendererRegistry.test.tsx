// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  renderRedevenFilePreviewBody,
  resolveRedevenFilePreviewRenderer,
} from './rendererRegistry';

vi.mock('../widgets/TextFilePreviewPane', () => ({
  TextFilePreviewPane: (props: any) => (
    <div data-testid="text-renderer">{`${props.path}:${props.text}`}</div>
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
    expect(resolveRedevenFilePreviewRenderer({ mode: 'binary' }).id).toBe('binary');
  });

  it('renders text, PDF, DOCX, spreadsheet, and unsupported bodies without a shared-package preview component', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <>
        {renderRedevenFilePreviewBody({
          item: { id: '/workspace/app.ts', name: 'app.ts', path: '/workspace/app.ts', type: 'file' },
          descriptor: { mode: 'text', textPresentation: 'code', language: 'typescript' },
          text: 'const value = 1;',
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
    expect(host.querySelector('[data-testid="pdf-renderer"]')?.textContent).toBe('3');
    expect(host.querySelector('[data-testid="docx-renderer"]')?.textContent).toBe('2');
    expect(host.textContent).toContain('Sheet: Sheet1');
    expect(host.textContent).toContain('A1');
    expect(host.textContent).toContain('Preview blocked by policy.');
  });
});
