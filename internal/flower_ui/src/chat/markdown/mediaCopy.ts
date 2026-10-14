import type { MarkdownMediaLabels } from '@floegence/floe-webapp-core/chat';

export type FlowerMarkdownMediaCopy = MarkdownMediaLabels & {
  previewImage: string;
  previewHTML: string;
  previewHTMLWindow: string;
  linkUnavailable: string;
  anchorUnavailable: string;
  relativePathUnavailable: string;
  invalidLink: string;
  unsupportedLink: string;
  revealInFolder: string;
};

export const markdownMediaEnUS = {
  "image": "Image",
  "previewImage": "Preview image",
  "previewHTML": "Open file preview",
  "previewHTMLWindow": "Open preview window",
  "linkUnavailable": "This link could not be opened in this preview.",
  "anchorUnavailable": "The linked section was not found.",
  "relativePathUnavailable": "Cannot resolve this relative link because the preview has no source directory.",
  "invalidLink": "This link is invalid.",
  "unsupportedLink": "This link protocol is not supported.",
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
