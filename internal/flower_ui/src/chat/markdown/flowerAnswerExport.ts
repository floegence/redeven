import { createMarkdownParser } from '@floegence/floe-webapp-core/markdown';
import type { FlowerCitationSource, FlowerChatMessageBlock } from '../../contracts/flowerSurfaceContracts';
import { createFlowerMarkdownRenderer, escapeFlowerMarkdownHtml as escape } from './markedConfig';
import { mapFlowerCitationSources, prepareFlowerCitations } from './flowerCitations';
import { parseFlowerSourceFence, type FlowerSourceCard } from './flowerSourceCards';
import { normalizeMarkdownForDisplay } from './normalizeMarkdownForDisplay';

export function flowerAnswerHTML(input: Readonly<{
  content: string;
  blocks?: readonly FlowerChatMessageBlock[];
  sources: readonly FlowerCitationSource[];
  title: string;
  timestamp: number;
  sourcesLabel: string;
  unavailableLabel: string;
}>): string {
  const sources: FlowerSourceCard[] = [...mapFlowerCitationSources(input.sources)];
  const visible = input.blocks?.flatMap(block => block.type === 'markdown' || block.type === 'text' ? [{ content: block.content ?? '', sources: block.type === 'markdown' ? block.sources ?? input.sources : [], plain: block.type === 'text' }] : []) ?? [];
  const parts = input.blocks?.length ? visible : [{ content: input.content, sources: input.sources, plain: false }];
  const body = parts.map(part => {
    if (part.plain) return '<p style="white-space:pre-wrap">' + escape(part.content) + '</p>';
    const citations = prepareFlowerCitations(part.content, part.sources, input.unavailableLabel, false);
    sources.push(...mapFlowerCitationSources(part.sources));
    const parser = createMarkdownParser({ gfm: true, breaks: false, pedantic: false });
    parser.use({ renderer: createFlowerMarkdownRenderer({ sourceFence: token => {
      const bibliography = parseFlowerSourceFence(token);
      if (!bibliography) return null;
      sources.push(...bibliography);
      return '\n';
    } }) });
    parser.use({ extensions: [{
      name: 'flowerCitation', level: 'inline',
      start(source) { return source.indexOf('\uE200flower-citation:'); },
      tokenizer(source) {
        const match = /^\uE200flower-citation:(\d+)\uE201/.exec(source);
        return match ? { type: 'flowerCitation', raw: match[0], index: Number(match[1]) } : undefined;
      },
      renderer(token) { return citations.html[Number(token.index)] ?? ''; },
    }] });
    return String(parser.parse(normalizeMarkdownForDisplay(citations.markdown)));
  }).join('\n');
  const uniqueSources = sources.filter((source, index) => sources.findIndex(other => other.url === source.url) === index);
  const references = uniqueSources.length ? '<section aria-label="' + escape(input.sourcesLabel) + '"><h2>' + escape(input.sourcesLabel) + '</h2><ol>'
    + uniqueSources.map(source => '<li><a href="' + escape(source.url) + '" rel="noopener noreferrer">' + escape(source.title || new URL(source.url).hostname) + '</a><br><small>' + escape(source.url) + '</small></li>').join('') + '</ol></section>' : '';
  const date = new Date(input.timestamp);
  const time = Number.isFinite(date.getTime()) && input.timestamp > 0 ? '<time datetime="' + date.toISOString() + '">' + escape(date.toLocaleString()) + '</time>' : '';
  return '<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src https: http: data:; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>' + escape(input.title) + '</title><style>'
    + 'body{max-width:760px;margin:48px auto;padding:0 24px;color:#25262a;background:#fff;font:16px/1.75 system-ui,sans-serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.3;letter-spacing:-.025em}a{color:#385c89}pre{overflow:auto;padding:18px;background:#f5f5f6;border-radius:8px}code{font-family:ui-monospace,monospace;font-size:.875em}img{max-width:100%;height:auto}table{border-collapse:collapse;display:block;overflow:auto}td,th{padding:8px 12px;border:1px solid #e5e5e8}blockquote{margin-left:0;padding-left:18px;border-left:2px solid #ddd;color:#62636b}section{margin-top:32px;padding-top:16px;border-top:1px solid #e8e8eb}section h2{font-size:14px}section li{margin:8px 0}small,time{color:#74757d;font-size:12px}footer{margin-top:24px}@media print{body{margin:0;max-width:none}pre{white-space:pre-wrap}}'
    + '</style></head><body><main>' + body + references + '</main><footer>' + time + '</footer></body></html>';
}

export function downloadFlowerAnswer(html: string, timestamp: number): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  const date = new Date(timestamp);
  anchor.download = 'flower-answer-' + (Number.isFinite(date.getTime()) && timestamp > 0 ? date.toISOString().replace(/[:.]/g, '-') : 'export') + '.html';
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
