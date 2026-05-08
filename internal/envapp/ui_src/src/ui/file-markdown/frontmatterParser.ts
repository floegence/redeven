export interface ParsedFrontmatter {
  fields: Record<string, unknown>;
  body: string;
  html: string;
}

export function extractFrontmatter(source: string): ParsedFrontmatter {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) {
    return { fields: {}, body: source, html: '' };
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return { fields: {}, body: source, html: '' };
  }

  const frontmatterBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trimStart();
  const fields = parseYamlSimple(frontmatterBlock);
  const html = renderFrontmatterTable(fields);

  return { fields, body, html };
}

function parseYamlSimple(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;

    const kvMatch = trimmedLine.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      if (currentKey && currentArray.length > 0) {
        result[currentKey] = currentArray;
        currentArray = [];
        currentKey = null;
      }

      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === '') {
        currentKey = key;
        currentArray = [];
        continue;
      }

      if (/^\[.*\]$/.test(value)) {
        const inner = value.slice(1, -1);
        result[key] = inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }

      if (value === 'true' || value === 'false') {
        result[key] = value === 'true';
      } else if (/^-?\d+(\.\d+)?$/.test(value)) {
        result[key] = Number(value);
      } else {
        result[key] = value.replace(/^['"]|['"]$/g, '');
      }
    } else if (currentKey && /^\s*-\s+/.test(trimmedLine)) {
      currentArray.push(trimmedLine.replace(/^\s*-\s+/, '').replace(/^['"]|['"]$/g, ''));
    }
  }

  if (currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  }

  return result;
}

function renderFrontmatterTable(fields: Record<string, unknown>): string {
  if (Object.keys(fields).length === 0) return '';

  let html = '<div class="fm-frontmatter"><table class="fm-frontmatter-table">';
  for (const [key, value] of Object.entries(fields)) {
    const displayValue = formatFrontmatterValue(value);
    html += `<tr><td class="fm-frontmatter-key">${escapeHtml(key)}</td><td class="fm-frontmatter-value">${displayValue}</td></tr>`;
  }
  html += '</table></div>';
  return html;
}

function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => `<span class="fm-frontmatter-tag">${escapeHtml(String(v))}</span>`).join(' ');
  }
  if (typeof value === 'boolean') {
    return `<span class="fm-frontmatter-bool">${value}</span>`;
  }
  if (typeof value === 'number') {
    return `<span class="fm-frontmatter-number">${value}</span>`;
  }
  return escapeHtml(String(value));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
