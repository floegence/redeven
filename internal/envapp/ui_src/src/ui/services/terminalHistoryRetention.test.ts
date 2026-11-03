import { describe, expect, it } from 'vitest';
import { formatTerminalHistoryMemory, parseTerminalHistoryLimits } from './terminalHistoryRetention';
describe('terminal retention input', () => {
 it('distinguishes engine defaults, zero, lines and storage bytes', () => {
  expect(parseTerminalHistoryLimits('','')).toEqual({max_lines:null,max_bytes:null});
  expect(parseTerminalHistoryLimits('0','0')).toEqual({max_lines:0,max_bytes:0});
  expect(parseTerminalHistoryLimits('1000','1.5')).toEqual({max_lines:1000,max_bytes:1572864});
 });
 it('round-trips byte budgets without exponent notation or precision loss', () => {
  for (const bytes of [0, 1, 10, 1048576, Number.MAX_SAFE_INTEGER]) {
   const formatted = formatTerminalHistoryMemory(bytes);
   expect(formatted).not.toContain('e');
   expect(parseTerminalHistoryLimits('', formatted)?.max_bytes).toBe(bytes);
  }
  expect(formatTerminalHistoryMemory(null)).toBe('');
 });
 it('rejects unsafe, negative, fractional rows and malformed values', () => {
  for(const [lines,memory] of [['-1',''],['1.5',''],['NaN',''],['9007199254740992',''],['','1e9'],['','0.00000001']]) expect(parseTerminalHistoryLimits(lines!,memory!)).toBeNull();
 });
});
