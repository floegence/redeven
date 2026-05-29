// @vitest-environment jsdom

import {
  AudioFileIcon,
  VideoFileIcon,
  getFileIcon,
} from '@floegence/floe-webapp-core/file-browser';
import { describe, expect, it } from 'vitest';

import { toFileItem } from './FileBrowserShared';

describe('FileBrowser media icons', () => {
  it('keeps media file extensions aligned with the shared file-browser icon set', () => {
    const videoItem = toFileItem({
      name: 'demo.webm',
      path: '/Users/tester/demo.webm',
      isDirectory: false,
    });
    const audioItem = toFileItem({
      name: 'interview.m4a',
      path: '/Users/tester/interview.m4a',
      isDirectory: false,
    });

    expect(videoItem.extension).toBe('webm');
    expect(audioItem.extension).toBe('m4a');
    expect(getFileIcon(videoItem.extension)).toBe(VideoFileIcon);
    expect(getFileIcon(audioItem.extension)).toBe(AudioFileIcon);
  });
});
