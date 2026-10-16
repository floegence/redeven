import manifest from '../../../../../assets/flower_source_icons.json';
import { escapeFlowerMarkdownHtml } from './markedConfig';

// Vite emits the audited assets into both carriers; no public CDN is used.
const assets: Record<string, string> = {
  'anthropic.svg': new URL('../../assets/source-icons/anthropic.svg', import.meta.url).href,
  'apple.svg': new URL('../../assets/source-icons/apple.svg', import.meta.url).href,
  'arxiv.svg': new URL('../../assets/source-icons/arxiv.svg', import.meta.url).href,
  'aws.svg': new URL('../../assets/source-icons/aws.svg', import.meta.url).href,
  'bing.svg': new URL('../../assets/source-icons/bing.svg', import.meta.url).href,
  'cloudflare.svg': new URL('../../assets/source-icons/cloudflare.svg', import.meta.url).href,
  'discord.svg': new URL('../../assets/source-icons/discord.svg', import.meta.url).href,
  'figma.svg': new URL('../../assets/source-icons/figma.svg', import.meta.url).href,
  'github.svg': new URL('../../assets/source-icons/github.svg', import.meta.url).href,
  'google.svg': new URL('../../assets/source-icons/google.svg', import.meta.url).href,
  'medium.svg': new URL('../../assets/source-icons/medium.svg', import.meta.url).href,
  'microsoft.svg': new URL('../../assets/source-icons/microsoft.svg', import.meta.url).href,
  'notion.svg': new URL('../../assets/source-icons/notion.svg', import.meta.url).href,
  'nvidia.svg': new URL('../../assets/source-icons/nvidia.svg', import.meta.url).href,
  'openai.svg': new URL('../../assets/source-icons/openai.svg', import.meta.url).href,
  'reddit.svg': new URL('../../assets/source-icons/reddit.svg', import.meta.url).href,
  'vercel.svg': new URL('../../assets/source-icons/vercel.svg', import.meta.url).href,
  'wikipedia.svg': new URL('../../assets/source-icons/wikipedia.svg', import.meta.url).href,
  'x.svg': new URL('../../assets/source-icons/x.svg', import.meta.url).href,
  'youtube.svg': new URL('../../assets/source-icons/youtube.svg', import.meta.url).href,
  'stack-overflow.svg': new URL('../../assets/source-icons/stack-overflow.svg', import.meta.url).href,
  'mozilla.svg': new URL('../../assets/source-icons/mozilla.svg', import.meta.url).href,
  'npm.svg': new URL('../../assets/source-icons/npm.svg', import.meta.url).href,
  'gitlab.svg': new URL('../../assets/source-icons/gitlab.svg', import.meta.url).href,
  'baidu.svg': new URL('../../assets/source-icons/baidu.svg', import.meta.url).href,
  'zhihu.svg': new URL('../../assets/source-icons/zhihu.svg', import.meta.url).href,
  'bilibili.svg': new URL('../../assets/source-icons/bilibili.svg', import.meta.url).href,
};
export type FlowerSourceIcon = Readonly<{ data_url?: string; expires_at: string }>;
export type FlowerSourceIconResolver = (origin: string) => Promise<FlowerSourceIcon>;

export function bundledFlowerSourceIcon(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  const asset = manifest.assets.find(asset => asset.domains.some(domain => host === domain || host.endsWith('.' + domain)));
  return asset ? assets[asset.file] : undefined;
}

export function flowerSourceIconPlaceholder(url: URL): string {
  const host = url.hostname.replace(/^www\./, '');
  const letter = /^[a-z0-9]/i.exec(host)?.[0].toUpperCase() ?? '↗';
  return `<span class="flower-chat-source-icon" data-flower-source-origin="${escapeFlowerMarkdownHtml(url.origin)}" aria-hidden="true"><span>${letter}</span></span>`;
}

// Each adapter owns a bounded presentation cache, separate from agent execution.
export function createFlowerSourceIconResolver(request: (origin: string) => Promise<FlowerSourceIcon>): FlowerSourceIconResolver {
  const cache = new Map<string, FlowerSourceIcon>();
  const pending = new Map<string, Promise<FlowerSourceIcon>>();
  const queue: Array<() => void> = [];
  let active = 0;
  const unavailable = () => ({ expires_at: new Date(Date.now() + 60_000).toISOString() });
  const pump = () => { while (active < 4 && queue.length) queue.shift()!(); };
  return origin => {
    const cached = cache.get(origin);
    if (cached && Date.parse(cached.expires_at) > Date.now()) return Promise.resolve(cached);
    const existing = pending.get(origin);
    if (existing) return existing;
    if (pending.size >= 64) return Promise.resolve(unavailable());
    const result = new Promise<FlowerSourceIcon>(resolve => {
      queue.push(() => {
        active++;
        void Promise.resolve().then(() => request(origin)).catch(unavailable).then(icon => {
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(origin, icon);
          pending.delete(origin);
          active--;
          resolve(icon);
          pump();
        });
      });
    });
    pending.set(origin, result);
    pump();
    return result;
  };
}

// Nodes survive fold changes; late completions cannot update disposed regions.
export function enhanceFlowerSourceIcons(root: HTMLElement, resolve?: FlowerSourceIconResolver): () => void {
  let disposed = false;
  const images: HTMLImageElement[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('[data-flower-source-origin]')) {
    if (node.dataset.flowerIconStarted) continue;
    node.dataset.flowerIconStarted = 'true';
    const url = new URL(node.dataset.flowerSourceOrigin!);
    const apply = (src?: string) => {
      if (!src || disposed || !root.contains(node)) return;
      const img = new Image();
      images.push(img);
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        if (disposed || !root.contains(node)) return;
        if (node.dataset.monochrome) {
          const mark = document.createElement('span');
          mark.className = 'flower-chat-source-brand';
          mark.style.maskImage = 'url("' + src + '")';
          node.replaceChildren(mark);
        } else node.replaceChildren(img);
        node.dataset.loaded = 'true';
      };
      img.onerror = () => { /* The generated icon stays visible. */ };
      img.src = src;
    };
    const bundled = bundledFlowerSourceIcon(url.hostname);
    if (bundled) {
      const monochrome = manifest.assets.find(asset => assets[asset.file] === bundled)?.monochrome;
      if (monochrome) node.dataset.monochrome = 'true';
      apply(bundled);
    } else if (resolve) void Promise.resolve().then(() => resolve(url.origin)).then(icon => {
      // Runtime supplies verified bytes, never a remote image URL.
      if (icon.data_url && /^data:image\/(?:png|jpeg|gif|x-icon|svg\+xml);base64,[a-z0-9+/=]+$/i.test(icon.data_url)) apply(icon.data_url);
    }).catch(() => undefined);
  }
  return () => { disposed = true; for (const image of images) { image.onload = null; image.onerror = null; } };
}
