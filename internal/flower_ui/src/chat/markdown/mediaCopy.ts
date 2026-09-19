import type { MarkdownMediaLabels } from '@floegence/floe-webapp-core/chat';

export type FlowerMarkdownMediaCopy = MarkdownMediaLabels & { previewImage: string; revealInFolder: string };

export const markdownMediaEnUS = {
  "image": "Image",
  "previewImage": "Preview image",
  "revealInFolder": "Open containing folder",
  "video": "Video",
  "audio": "Audio",
  "html": "Interactive preview",
  "loading": "Loading preview…",
  "unavailable": "Preview unavailable",
  "retry": "Retry",
  "expand": "Expand preview",
  "collapse": "Collapse preview",
  "open": "Open source",
  "close": "Close preview"
} satisfies FlowerMarkdownMediaCopy;
