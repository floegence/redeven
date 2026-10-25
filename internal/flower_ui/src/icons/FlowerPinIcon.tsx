import type { Component } from 'solid-js';

export const FlowerPinIcon: Component<{ class?: string; pinned?: boolean }> = (props) => (
  <svg
    class={props.class}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.55"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-flower-pin-icon
    data-pinned={props.pinned ? 'true' : 'false'}
  >
    <g transform="rotate(42 12 12)">
      <path
        data-flower-pin-head
        d="M8.2 4.2c0-1 .8-1.7 1.8-1.7h4c1 0 1.8.7 1.8 1.7v4.9l2.2 2.4c.8.9.2 2.3-1 2.3H7c-1.2 0-1.8-1.4-1-2.3l2.2-2.4V4.2Z"
        fill={props.pinned ? 'currentColor' : 'none'}
      />
      <path d="M12 13.8v7" />
    </g>
  </svg>
);
