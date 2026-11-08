import { describe, expect, it } from 'vitest';
import { historicalToolName } from './historicalToolName';

describe('historical tool presentation lookup', () => {
  it('maps exact released names without touching canonical names or object properties', () => {
    expect(historicalToolName('terminal.exec')).toBe('terminal_exec');
    expect(historicalToolName('threads.read')).toBe('thread_read');
    for (const name of ['terminal_exec', 'constructor', '__proto__', 'browser.navigate()']) {
      expect(historicalToolName(name)).toBe(name);
    }
  });
});
