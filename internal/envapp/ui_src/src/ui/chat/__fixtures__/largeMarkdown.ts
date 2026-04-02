const markdownSections = Array.from({ length: 80 }, (_, index) => (
  `## Section ${index + 1}

- Item ${index + 1}.1
- Item ${index + 1}.2
- Item ${index + 1}.3

\`\`\`ts
export const section${index + 1} = ${index + 1};
\`\`\`
`
));

export const LARGE_MARKDOWN_FIXTURE = `# Large Markdown Fixture

${markdownSections.join('\n')}`;
