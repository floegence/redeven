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
    expect(describeFilePreview('frontend/postcss.config.mjs')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'javascript',
      wrapText: false,
    });
    expect(describeFilePreview('frontend/env.d.mts')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'typescript',
      wrapText: false,
    });
    expect(describeFilePreview('frontend/app.webmanifest')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'json',
      wrapText: false,
    });
    expect(describeFilePreview('frontend/routes.graphql')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'graphql',
      wrapText: false,
    });
    expect(describeFilePreview('frontend/layout.astro')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'astro',
      wrapText: false,
    });
    expect(describeFilePreview('Cargo.toml')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'toml',
      wrapText: false,
    });
    expect(describeFilePreview('Dockerfile')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'dockerfile',
      wrapText: false,
    });
    expect(describeFilePreview('Makefile')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'makefile',
      wrapText: false,
    });
    expect(describeFilePreview('Jenkinsfile')).toEqual({
      mode: 'text',
      textPresentation: 'code',
      language: 'groovy',
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

  it('routes markdown files to the markdown preview mode', () => {
    expect(describeFilePreview('README.md')).toEqual({
      mode: 'markdown',
      language: 'markdown',
    });
    expect(describeFilePreview('docs/guide.markdown')).toEqual({
      mode: 'markdown',
      language: 'markdown',
    });
  });

  it('keeps prose and logs as wrapped plain text previews', () => {
    expect(describeFilePreview('server.log')).toEqual({
      mode: 'text',
      textPresentation: 'plain',
      language: undefined,
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
