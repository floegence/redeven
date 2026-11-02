// A gateway aperture crossed by one route. Match Floe's 24-unit rail glyphs:
// one silhouette, 1.5-unit rounded strokes and equal optical margins.
export function GatewayMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" class="redeven-gateway-mark" data-gateway-mark>
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M8 16v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2" />
      <path d="M3 12h18m-3-3 3 3-3 3" />
    </svg>
  );
}
