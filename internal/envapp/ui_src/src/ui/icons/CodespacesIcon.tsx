export function CodespacesActivityBarGlyph() {
  return (
    <g data-codespaces-icon-surface="activity-bar">
      <rect
        data-codespaces-icon-part="monitor"
        x="4.75"
        y="4.6"
        width="13.85"
        height="10.4"
        rx="2.15"
        fill="currentColor"
        fill-opacity=".045"
        stroke="currentColor"
        stroke-opacity=".84"
        stroke-width="1.55"
      />
      <path
        data-codespaces-icon-part="screen-lines"
        d="M8 8.2h2.25M8 11.45h6.4"
        stroke="currentColor"
        stroke-opacity=".84"
        stroke-width="1.25"
        stroke-linecap="round"
      />
      <rect
        data-codespaces-icon-part="keyboard"
        x="5"
        y="17.1"
        width="10.8"
        height="2.9"
        rx="1"
        fill="currentColor"
        fill-opacity=".055"
        stroke="currentColor"
        stroke-opacity=".7"
        stroke-width="1.35"
      />
      <circle
        data-codespaces-icon-part="mouse"
        cx="19.4"
        cy="18.75"
        r="1.75"
        fill="currentColor"
        fill-opacity=".84"
      />
    </g>
  );
}

export function CodespacesWorkbenchIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width="48"
      height="48"
      class={props.class}
      data-codespaces-icon-surface="workbench"
    >
      <defs>
        <linearGradient id="cs-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="color-mix(in srgb, var(--card), #315f91 9%)" />
          <stop offset="100%" stop-color="color-mix(in srgb, var(--card), #315f91 17%)" />
        </linearGradient>
        <linearGradient id="cs-rim" x1="0" y1="0" x2="0" y2=".35">
          <stop offset="0%" stop-color="white" stop-opacity=".14" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#cs-bg)" />
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#cs-rim)" />
      <rect
        data-codespaces-icon-part="monitor"
        x="9"
        y="9.5"
        width="28"
        height="20.5"
        rx="4.2"
        fill="#3b82f6"
        fill-opacity=".2"
        stroke="#3b82f6"
        stroke-opacity=".74"
        stroke-width="1.8"
      />
      <rect
        data-codespaces-icon-part="screen"
        x="12"
        y="12.5"
        width="22"
        height="13.5"
        rx="2.2"
        fill="var(--foreground)"
        fill-opacity=".08"
      />
      <path
        data-codespaces-icon-part="screen-line-short"
        d="M15.5 17h4.5"
        stroke="#2596be"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <path
        data-codespaces-icon-part="screen-line-long"
        d="M15.5 22h12.5"
        stroke="var(--foreground)"
        stroke-opacity=".62"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <rect
        data-codespaces-icon-part="keyboard"
        x="9"
        y="34"
        width="22.5"
        height="5.8"
        rx="2"
        fill="#8194a9"
        fill-opacity=".58"
      />
      <path
        data-codespaces-icon-part="keyboard-highlight"
        d="M12.5 36.9h15.5"
        stroke="var(--card)"
        stroke-opacity=".5"
        stroke-width="1.25"
        stroke-linecap="round"
      />
      <rect
        data-codespaces-icon-part="mouse"
        x="35"
        y="33"
        width="7.5"
        height="9"
        rx="3.75"
        fill="#35b98b"
        fill-opacity=".84"
      />
      <path
        data-codespaces-icon-part="mouse-wheel"
        d="M38.75 34.2v2.2"
        stroke="#17694d"
        stroke-opacity=".8"
        stroke-width="1.1"
        stroke-linecap="round"
      />
    </svg>
  );
}
