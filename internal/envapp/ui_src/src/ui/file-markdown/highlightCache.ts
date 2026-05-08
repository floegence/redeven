import hljs from 'highlight.js';

const HLJS_CACHE_MAX = 256;

interface CacheEntry {
  hash: number;
  html: string;
}

const cache = new Map<number, CacheEntry>();
let accessOrder: number[] = [];

function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function evictLru(): void {
  while (accessOrder.length >= HLJS_CACHE_MAX) {
    const oldest = accessOrder.shift();
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

export function highlightCached(code: string, lang?: string): string {
  const key = lang ? `${lang}:${code}` : code;
  const hash = fnv1aHash(key);
  const cached = cache.get(hash);
  if (cached) {
    accessOrder = accessOrder.filter((h) => h !== hash);
    accessOrder.push(hash);
    return cached.html;
  }

  let html: string;
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } else if (code.length <= 4000) {
      html = hljs.highlightAuto(code).value;
    } else {
      html = escapeHtml(code);
    }
  } catch {
    html = escapeHtml(code);
  }

  evictLru();
  cache.set(hash, { hash, html });
  accessOrder.push(hash);
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
