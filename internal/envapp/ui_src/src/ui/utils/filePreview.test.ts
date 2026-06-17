import { describe, expect, it } from 'vitest';
import { describeFilePreview, mimeFromExtDot, previewModeByName } from './filePreview';

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
    expect(describeFilePreview('reference/guide.markdown')).toEqual({
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

  it('routes browser-playable media files to native media preview modes', () => {
    expect(previewModeByName('demo.mp4')).toBe('video');
    expect(previewModeByName('clip.webm')).toBe('video');
    expect(previewModeByName('movie.mov')).toBe('video');
    expect(previewModeByName('archive.mkv')).toBe('video');
    expect(previewModeByName('sound.mp3')).toBe('audio');
    expect(previewModeByName('voice.m4a')).toBe('audio');
    expect(previewModeByName('track.flac')).toBe('audio');
  });

  it('maps media extensions to browser MIME types used by the resource endpoint', () => {
    expect(mimeFromExtDot('.mp4')).toBe('video/mp4');
    expect(mimeFromExtDot('.m4v')).toBe('video/x-m4v');
    expect(mimeFromExtDot('.webm')).toBe('video/webm');
    expect(mimeFromExtDot('.mov')).toBe('video/quicktime');
    expect(mimeFromExtDot('.mkv')).toBe('video/x-matroska');
    expect(mimeFromExtDot('.mp3')).toBe('audio/mpeg');
    expect(mimeFromExtDot('.m4a')).toBe('audio/mp4');
    expect(mimeFromExtDot('.aac')).toBe('audio/aac');
    expect(mimeFromExtDot('.wav')).toBe('audio/wav');
    expect(mimeFromExtDot('.opus')).toBe('audio/ogg');
    expect(mimeFromExtDot('.flac')).toBe('audio/flac');
  });
});
