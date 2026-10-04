// Two open jambs define the access boundary; a single route crosses it and
// branches to two endpoints. Keep the small-size geometry independent of text.
export function GatewayMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" class="redeven-gateway-mark" data-gateway-mark>
      <path d="M17 7h-4a4 4 0 0 0-4 4v18a4 4 0 0 0 4 4h4" class="redeven-gateway-mark__outer" />
      <path d="M23 7h4a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4h-4" class="redeven-gateway-mark__outer" />
      <path d="M6 20h14m0 0 7-7m-7 7 7 7" class="redeven-gateway-mark__route" />
      <circle cx="5" cy="20" r="2" fill="currentColor" />
      <rect x="25" y="11" width="4" height="4" rx="1.25" fill="currentColor" />
      <rect x="25" y="25" width="4" height="4" rx="1.25" fill="currentColor" />
    </svg>
  );
}
