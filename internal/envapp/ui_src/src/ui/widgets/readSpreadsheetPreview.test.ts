import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readSpreadsheetPreview } from '../../../../../flower_ui/src/preview/readSpreadsheetPreview';

describe('basic spreadsheet preview contract', () => {
  it('retains literal identifiers, rich text and cached formula values without changing source bytes', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('First');
    sheet.addRow(['00123', '12345678901234567890', { formula: '1+2', result: 3 }, { richText: [{ text: 'Alpha' }, { text: 'Beta' }] }]);
    sheet.getCell('E1').value = { formula: '1+2' };
    sheet.getCell('F1').value = { formula: '1/0', result: { error: '#DIV/0!' } };
    sheet.getCell('G1').value = new Date('2026-10-30T00:00:00Z');
    sheet.getCell('A201').value = 'outside row budget';
    sheet.getCell('AY1').value = 'outside column budget';
    book.addWorksheet('Second').getCell('A1').value = 'other sheet';
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const before = bytes.slice();
    const result = await readSpreadsheetPreview(bytes);
    expect(result?.sheetName).toBe('First');
    expect(result?.rows).toHaveLength(200);
    expect(result?.rows[0]).toHaveLength(50);
    expect(result?.rows[0].slice(0, 5)).toEqual(['00123', '12345678901234567890', '3', 'AlphaBeta', '{"formula":"1+2"}']);
    expect(result?.rows[0].slice(5, 7)).toEqual(['{"error":"#DIV/0!"}', '2026-10-30T00:00:00.000Z']);
    expect(bytes).toEqual(before);
  });
  it('rejects a damaged file instead of presenting an empty successful table', async () => {
    await expect(readSpreadsheetPreview(new TextEncoder().encode('not a workbook'))).rejects.toThrow();
  });
});
