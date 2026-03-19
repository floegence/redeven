import { describe, expect, it } from 'vitest';
import { describeFilePreview, previewModeByName } from './filePreview';

describe('describeFilePreview', () => {
  it('classifies source files as code previews with a language when known', () => {
    expect(describeFilePreview('src/app.ts')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'typescript',
      wrapText: false,
    });
    expect(describeFilePreview('Dockerfile')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'dockerfile',
      wrapText: false,
    });
    expect(describeFilePreview('CMakeLists.txt')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'cmake',
      wrapText: false,
    });
    expect(describeFilePreview('.gitignore')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: undefined,
      wrapText: false,
    });
  });

  it('keeps prose and logs as wrapped plain text previews', () => {
    expect(describeFilePreview('README.md')).toEqual({
      mode: 'text',
      textPresentation: 'plain',
      wrapText: true,
    });
    expect(describeFilePreview('server.log')).toEqual({
      mode: 'text',
      textPresentation: 'plain',
      wrapText: true,
    });
  });

  it('keeps binary-oriented modes unchanged', () => {
    expect(previewModeByName('diagram.png')).toBe('image');
    expect(previewModeByName('slides.pdf')).toBe('pdf');
    expect(previewModeByName('sheet.xlsx')).toBe('xlsx');
    expect(previewModeByName('archive.bin')).toBe('binary');
  });
});
