import { describe, expect, it } from 'vitest';
import { webServiceBrowserContentBounds } from './webServiceBrowserLayout';

describe('Web Service content placement', () => {
  it('reserves the complete title and navigation rows at normal and compact sizes', () => {
    expect(webServiceBrowserContentBounds(1100, 740)).toEqual({ x: 0, y: 94, width: 1100, height: 646 });
    expect(webServiceBrowserContentBounds(640, 480)).toEqual({ x: 0, y: 94, width: 640, height: 386 });
  });
  it('retains valid view dimensions during a transient collapsed resize', () => {
    expect(webServiceBrowserContentBounds(0, 0)).toEqual({ x: 0, y: 94, width: 1, height: 1 });
  });
});
