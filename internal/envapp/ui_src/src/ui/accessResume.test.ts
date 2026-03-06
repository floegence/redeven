import { describe, expect, it } from 'vitest';
import { readAccessResumeTokenFromHash, stripAccessResumeTokenFromHash } from './accessResume';

describe('access resume hash helpers', () => {
  it('reads the resume token from hash params', () => {
    expect(readAccessResumeTokenFromHash('#redeven_access_resume=abc123')).toBe('abc123');
  });

  it('removes only the resume token from hash params', () => {
    expect(stripAccessResumeTokenFromHash('#redeven_access_resume=abc123&tab=files')).toBe('#tab=files');
  });

  it('returns empty hash when no params remain', () => {
    expect(stripAccessResumeTokenFromHash('#redeven_access_resume=abc123')).toBe('');
  });
});
