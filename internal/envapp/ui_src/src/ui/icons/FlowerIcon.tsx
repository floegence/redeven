import type { Component } from 'solid-js';

/**
 * Flower icon — the visual identity of the "Flower" AI assistant.
 *
 * A stylized bloom with 5 rounded white petals and a warm yellow center.
 * Petals use cubic bezier paths for a plump, organic shape.
 * White petals carry a subtle currentColor stroke so the outline stays
 * visible on both light and dark backgrounds.
 * Accepts the same `class` prop as Lucide icons for consistent sizing.
 */
export const FlowerIcon: Component<{ class?: string }> = (props) => {
  const uid = `flower-${Math.random().toString(36).slice(2, 8)}`;

  const petalAngles = [0, 72, 144, 216, 288];

  // Rounded petal path (pointing upward, rotated around center 12,12).
  // Tip reaches y=1.8 (~10.2 units from center); belly spans x 7.2→16.8.
  // After 5 rotations the bounding box covers roughly 2→22 of the 24×24
  // viewBox, matching the visual weight of standard Lucide icons.
  const petalPath =
    'M 12 12 C 9.8 10, 7.2 7, 8.2 4.5 C 8.7 3, 10.3 1.8, 12 1.8 C 13.7 1.8, 15.3 3, 15.8 4.5 C 16.8 7, 14.2 10, 12 12 Z';

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
    >
      <defs>
        <radialGradient id={`${uid}-c`} cx="50%" cy="45%" r="50%">
          <stop offset="0%" stop-color="#fde68a" />
          <stop offset="65%" stop-color="#fbbf24" />
          <stop offset="100%" stop-color="#f59e0b" />
        </radialGradient>
      </defs>

      {/* Petals — white fill, subtle currentColor stroke for edge definition */}
      <g>
        {petalAngles.map((angle, i) => (
          <path
            d={petalPath}
            fill="#ffffff"
            stroke="currentColor"
            stroke-width="0.45"
            stroke-opacity={i % 2 === 0 ? '0.18' : '0.13'}
            opacity={i % 2 === 0 ? '0.95' : '0.85'}
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>

      {/* Center — warm yellow */}
      <circle cx="12" cy="12" r="3.0" fill={`url(#${uid}-c)`} />
      <circle cx="12" cy="12" r="1.5" fill="#f59e0b" opacity="0.45" />
    </svg>
  );
};
