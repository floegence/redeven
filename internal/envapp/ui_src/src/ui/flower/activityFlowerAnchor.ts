import type { Accessor } from 'solid-js';

export type ActivityFlowerAnchorPalette = Readonly<{ background: string; foreground: string }>;
export type ActivityFlowerAnchorRegistrar = (
  anchor: HTMLElement,
  palette: Accessor<ActivityFlowerAnchorPalette>,
) => () => void;
