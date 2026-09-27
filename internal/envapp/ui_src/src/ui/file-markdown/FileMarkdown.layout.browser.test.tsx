import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FileMarkdown } from './FileMarkdown';

const renderer = vi.hoisted(() => ({ release: undefined as (() => void) | undefined }));
vi.mock('./mermaidPlugin', async importOriginal => {
  const original = await importOriginal<typeof import('./mermaidPlugin')>();
  return { ...original, runMermaid: async (...args: Parameters<typeof original.runMermaid>) => {
    await new Promise<void>(resolve => { renderer.release = resolve; });
    return original.runMermaid(...args);
  } };
});
let dispose: (() => void) | undefined;
afterEach(() => { renderer.release?.(); dispose?.(); document.body.replaceChildren(); });
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const geometry = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };

it.each([1280, 390])('reserves diagram and image geometry and installs the TOC before enhancement at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.style.height = '800px'; document.body.append(host);
  dispose = render(() => <FileMarkdown filePath="/workspace/layout.md" content={'# Layout\n\n```mermaid\nflowchart TB\n A[One] --> B[Two]\n B --> C[Three]\n```\n\n## Following diagram\n\n![Portrait](https://example.invalid/layout.svg)\n\n## Following image'} />, host);
  await vi.waitFor(() => expect(renderer.release).toBeTypeOf('function')); await settle();
  expect(host.querySelectorAll('.fm-toc-link').length).toBeGreaterThan(0);
  const diagramFollower = host.querySelector('#following-diagram')!;
  const imageFollower = host.querySelector('#following-image')!;
  const before = [geometry(diagramFollower), geometry(imageFollower)];
  renderer.release?.();
  await vi.waitFor(() => expect(host.querySelector('.mermaid svg')).toBeTruthy(), { timeout: 15000 });
  const image = host.querySelector<HTMLImageElement>('img.fm-image')!;
  image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="green"/></svg>');
  await image.decode(); await settle();
  expect([geometry(diagramFollower), geometry(imageFollower)]).toEqual(before);
});

it('honors authored image dimensions and keeps inline badges compact while decoding', async () => {
  await page.viewport(900, 900);
  const host = document.createElement('div'); host.style.height = '800px'; document.body.append(host);
  dispose = render(() => <FileMarkdown showToc={false} filePath="/workspace/images.md" content={'<p><img src="https://example.invalid/logo.svg" width="120" height="80" alt="Logo"></p>\n\n<p><a href="https://example.invalid/"><img src="https://example.invalid/badge.svg" alt="Build"></a><img src="https://example.invalid/badge2.svg" alt="Coverage"></p>\n\n## Following images'} />, host);
  await vi.waitFor(() => expect(host.querySelectorAll('img.fm-image').length).toBe(3)); await settle();
  const images = [...host.querySelectorAll<HTMLImageElement>('img.fm-image')];
  const before = [...images, host.querySelector('#following-images')!].map(geometry);
  expect(before[0].width).toBe(120); expect(before[0].height).toBe(80);
  expect(before[1].height).toBeLessThan(30);
  for (const image of images) { image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"/>'); await image.decode(); }
  await settle(); expect([...images, host.querySelector('#following-images')!].map(geometry)).toEqual(before);
});
