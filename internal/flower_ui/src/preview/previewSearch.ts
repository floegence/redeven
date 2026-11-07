import type { Accessor } from 'solid-js';

/** Product hosts may place the renderer-owned search in their action menu. */
export type RegisterPreviewSearch = (action: {
  show: (trigger?: HTMLElement) => void;
  enabled: Accessor<boolean>;
  expanded?: Accessor<boolean>;
}, available?: Accessor<boolean>) => boolean;
