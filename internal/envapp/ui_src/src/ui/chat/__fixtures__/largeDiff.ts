function buildOldLine(index: number): string {
  return `export const value_${index} = ${index};`;
}

function buildNewLine(index: number): string {
  if (index % 9 === 0) {
    return `export const value_${index} = ${index} * 2;`;
  }
  if (index % 13 === 0) {
    return `export const next_value_${index} = ${index} + 1;`;
  }
  return buildOldLine(index);
}

const oldLines = Array.from({ length: 1400 }, (_, index) => buildOldLine(index + 1));
const newLines = Array.from({ length: 1400 }, (_, index) => buildNewLine(index + 1));

export const LARGE_DIFF_OLD_CODE = oldLines.join('\n');
export const LARGE_DIFF_NEW_CODE = newLines.join('\n');
