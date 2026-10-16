import type { Component } from 'solid-js';

/**
 * Flower icon — the visual identity of the "Flower" AI assistant.
 *
 * A stylized bloom with 5 rounded white petals and a warm yellow center.
 * Petals use cubic bezier paths for a plump, organic shape.
 * Opaque slate outlines keep the white petals readable on light surfaces;
 * the white fill preserves the same identity on dark surfaces. Compact hosts
 * can strengthen the outline through --flower-icon-petal-stroke.
 */
export const FlowerIcon: Component<{ class?: string }> = (props) => {
  const petalAngles = [0, 72, 144, 216, 288];
  const petalPath =
    'M 12 12 C 9.8 10, 7.2 7, 8.2 4.5 C 8.7 3, 10.3 1.8, 12 1.8 C 13.7 1.8, 15.3 3, 15.8 4.5 C 16.8 7, 14.2 10, 12 12 Z';

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
    >
      <g
        fill="#ffffff"
        stroke="#697788"
        stroke-width="var(--flower-icon-petal-stroke, 1.15)"
        stroke-linejoin="round"
      >
        {petalAngles.map((angle) => (
          <path
            d={petalPath}
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>

      <circle
        class="redeven-flower-icon-center"
        cx="12"
        cy="12"
        r="3"
        fill="#e9b13b"
        stroke="#a87013"
        stroke-width="0.75"
      />
    </svg>
  );
};
