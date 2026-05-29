import { describe, expect, it } from 'vitest';

import { buildRedevenFileResourceUrl } from './filePreviewResource';

describe('buildRedevenFileResourceUrl', () => {
  it('encodes absolute file paths for the runtime resource endpoint', () => {
    expect(buildRedevenFileResourceUrl('/workspace/a b/video.mp4')).toBe(
      '/_redeven_proxy/api/fs/file?path=%2Fworkspace%2Fa+b%2Fvideo.mp4',
    );
    expect(buildRedevenFileResourceUrl('/workspace/#demo?.mp4')).toBe(
      '/_redeven_proxy/api/fs/file?path=%2Fworkspace%2F%23demo%3F.mp4',
    );
  });

  it('returns an empty URL when there is no usable path', () => {
    expect(buildRedevenFileResourceUrl('')).toBe('');
    expect(buildRedevenFileResourceUrl('   ')).toBe('');
  });
});
