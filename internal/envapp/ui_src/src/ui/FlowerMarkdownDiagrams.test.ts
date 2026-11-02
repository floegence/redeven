import { describe, expect, it } from 'vitest';
import { createMarkdownParser } from '@floegence/floe-webapp-core/markdown';
import { createFlowerMarkdownRenderer } from '../../../../flower_ui/src/chat/markdown/markedConfig';
const fence = String.fromCharCode(96).repeat(3);
const parse = (text: string) => {
  const parser = createMarkdownParser({ gfm: true });
  parser.use({ renderer: createFlowerMarkdownRenderer({ diagrams: true }) });
  return String(parser.parse(text));
};
describe('Flower diagram fence contract', () => {
  it('keeps open or mismatched fences as copyable source', () => {
    for (const ending of ['', '\n~~' + '~', '\n' + fence.slice(0,2)]) {
      const html = parse(fence + 'mermaid\nflowchart LR\n A-->B' + ending);
      expect(html).not.toContain('data-flower-diagram-source');
      expect(html).toContain('flower-chat-md-code-block');
    }
  });
  it('enables complete backtick and tilde fences without changing source', () => {
    for (const delimiter of [fence, '~~~']) {
      const html = parse(delimiter + 'mermaid\nflowchart LR\n A[&quot;]-->B\n' + delimiter);
      expect(html).toContain('data-flower-diagram-source');
      expect(html).toContain('&amp;quot;');
      expect(html).not.toContain('flower-chat-md-code-block');
    }
  });
  it('escapes source attributes and does not activate other languages', () => {
    expect(parse(fence + 'mermaid\nflowchart LR\n A["<script>"]-->B\n' + fence)).not.toContain('<script>');
    expect(parse(fence + 'typescript\nconst mermaid = 1;\n' + fence)).not.toContain('data-flower-diagram-source');
  });
});
