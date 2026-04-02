const lines = Array.from({ length: 1200 }, (_, index) => (
  `export function generatedValue${index + 1}(input: number): number {
  return input + ${index + 1};
}`
));

export const LARGE_CODE_FIXTURE = lines.join('\n\n');
