const mermaidLines = Array.from({ length: 160 }, (_, index) => {
  const current = index + 1;
  const next = index + 2;
  return `  Node${current}[Section ${current}] --> Node${next}[Section ${next}]`;
});

export const LARGE_MERMAID_FIXTURE = `flowchart TD
${mermaidLines.join('\n')}
`;
