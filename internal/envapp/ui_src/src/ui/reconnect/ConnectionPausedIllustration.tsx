export function ConnectionPausedIllustration() {
  // Keep the brand illustration inline so a failed proxy never has to fetch it.
  return (
    <div class="pointer-events-none mx-auto w-[248px] max-w-full text-foreground" aria-hidden="true">
      <svg viewBox="0 0 280 180" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="143" cy="154" rx="66" ry="4" fill="currentColor" opacity=".055"/>
        <path d="M203 112c21-1 9 23 24 23" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".38"/>
        <g transform="rotate(-7 143 105)">
          <path d="M113 69V52q0-11-12-11M165 67V37" stroke="currentColor" stroke-width="7" stroke-linecap="round" opacity=".85"/>
          <circle cx="98" cy="41" r="6.5" fill="currentColor" opacity=".85"/>
          <circle cx="165" cy="32" r="6.5" fill="currentColor" opacity=".85"/>
          <rect x="79" y="65" width="128" height="77" rx="19" fill="currentColor" opacity=".88"/>
          <rect x="97" y="83" width="92" height="40" rx="9" fill="var(--background, #f7f8f6)"/>
          <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity=".85">
            <path d="m113 98 9 3m42 0 9-3"/>
            <path d="M137 114q6-5 12 0"/>
          </g>
        </g>
        <g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M237 132h4m-4 6h4" opacity=".45"/>
          <rect x="226" y="128" width="11" height="14" rx="3" fill="var(--background, #f7f8f6)" stroke-opacity=".45"/>
          <path d="M254 122c11 0 14-6 14-14" opacity=".18"/>
          <path d="M254 115h-6v14h6z" stroke-opacity=".3" fill="var(--background, #f7f8f6)"/>
        </g>
        <g stroke="var(--primary, #526b56)" stroke-width="1.6" stroke-linecap="round" opacity=".4">
          <path d="m231 97 1-6m10 10 5-3"/>
        </g>
      </svg>
    </div>
  );
}
