import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { installStdioBrokenPipeGuards, isBrokenPipeError } from './stdio';

describe('stdio', () => {
  it('recognizes broken pipe errors by code', () => {
    expect(isBrokenPipeError(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).toBe(true);
    expect(isBrokenPipeError(new Error('boom'))).toBe(false);
    expect(isBrokenPipeError(null)).toBe(false);
  });

  it('ignores EPIPE stream errors', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();

    installStdioBrokenPipeGuards([stdout, stderr]);

    expect(() => {
      stdout.emit('error', Object.assign(new Error('stdout closed'), { code: 'EPIPE' }));
      stderr.emit('error', { code: 'EPIPE' });
    }).not.toThrow();
  });

  it('rethrows non-EPIPE stream errors', () => {
    const stdout = new EventEmitter();
    const error = new Error('boom');

    installStdioBrokenPipeGuards([stdout]);

    expect(() => {
      stdout.emit('error', error);
    }).toThrow(error);
  });

  it('installs only one guard per stream', () => {
    const stdout = new EventEmitter();

    installStdioBrokenPipeGuards([stdout]);
    installStdioBrokenPipeGuards([stdout]);

    expect(stdout.listenerCount('error')).toBe(1);
  });
});
