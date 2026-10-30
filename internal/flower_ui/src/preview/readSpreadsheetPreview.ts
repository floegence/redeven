function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  const cell = value as { text?: unknown; richText?: { text?: unknown }[]; result?: unknown };
  if (typeof cell.text === 'string') return cell.text;
  if (Array.isArray(cell.richText)) return cell.richText.map(part => String(part.text ?? '')).join('');
  if (cell.result != null) return cellText(cell.result);
  return JSON.stringify(value);
}

/** Existing basic XLSX preview policy; richer rendering awaits upstream acceptance. */
export async function readSpreadsheetPreview(bytes: Uint8Array<ArrayBuffer>): Promise<{ sheetName: string; rows: string[][] } | null> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return null;
  return {
    sheetName: worksheet.name,
    rows: Array.from({ length: Math.min(worksheet.rowCount, 200) }, (_, row) =>
      Array.from({ length: Math.min(worksheet.columnCount, 50) }, (_, col) => cellText(worksheet.getCell(row + 1, col + 1).value))),
  };
}
