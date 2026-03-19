import { splitProps, type Component, type JSX } from 'solid-js';

type RedevenMarkProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  theme?: 'light' | 'dark';
};

const LIGHT_PALETTE = {
  outer: '#111111',
  inner: '#fffaf7',
  detail: '#111111',
} as const;

const DARK_PALETTE = {
  outer: '#fffaf7',
  inner: '#201917',
  detail: '#fffaf7',
} as const;

export const RedevenMark: Component<RedevenMarkProps> = (props) => {
  const [local, svgProps] = splitProps(props, ['class', 'theme']);
  const palette = local.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;

  return (
    <svg
      {...svgProps}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={local.class}
    >
      <rect x="4.5" y="9.5" width="15" height="8.5" rx="2.5" fill={palette.outer} />
      <rect x="6.75" y="11.75" width="10.5" height="4" rx="1.1" fill={palette.inner} />
      <circle cx="8.5" cy="5.75" r="1.75" fill={palette.outer} />
      <circle cx="15.5" cy="5.75" r="1.75" fill={palette.outer} />
      <path d="M8.5 7.25V9.5" stroke={palette.outer} stroke-width="1.8" stroke-linecap="round" />
      <path d="M15.5 7.25V9.5" stroke={palette.outer} stroke-width="1.8" stroke-linecap="round" />
      <path d="M8 13.25H10.75" stroke={palette.detail} stroke-width="1" stroke-linecap="square" />
      <path d="M8 14.95H12.75" stroke={palette.detail} stroke-width="1" stroke-linecap="square" />
    </svg>
  );
};
