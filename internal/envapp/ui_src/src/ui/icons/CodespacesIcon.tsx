export function CodespacesGlyph(props: { transform?: string; foreground?: string }) {
  const foreground = props.foreground ?? 'currentColor';

  return (
    <g transform={props.transform}>
      <rect x="5.1" y="4.75" width="13.2" height="10.15" rx="2.05" fill={foreground} fill-opacity=".07" stroke={foreground} stroke-opacity=".82" stroke-width="1.55" />
      <line x1="8.25" y1="8.35" x2="10.35" y2="8.35" stroke={foreground} stroke-opacity=".88" stroke-width="1.7" stroke-linecap="round" />
      <line x1="8.25" y1="11.7" x2="14.85" y2="11.7" stroke={foreground} stroke-opacity=".88" stroke-width="1.7" stroke-linecap="round" />
      <rect x="5.35" y="17.05" width="10.35" height="2.85" rx=".85" fill={foreground} fill-opacity=".1" stroke={foreground} stroke-opacity=".78" stroke-width="1.5" />
      <circle cx="19.1" cy="18.48" r="2.15" fill={foreground} fill-opacity=".86" />
    </g>
  );
}
