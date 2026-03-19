import type { FloeThemePreset } from '@floegence/floe-webapp-core';

type ChartThemeScale = readonly [string, string, string, string, string];

interface ChartThemeDefinition {
  name: string;
  displayName: string;
  description: string;
  light?: ChartThemeScale;
  dark?: ChartThemeScale;
}

function createChartTokenMap(colors: ChartThemeScale) {
  const [chart1, chart2, chart3, chart4, chart5] = colors;
  return {
    '--chart-1': chart1,
    '--chart-2': chart2,
    '--chart-3': chart3,
    '--chart-4': chart4,
    '--chart-5': chart5,
  } as const;
}

function createChartThemePreset(definition: ChartThemeDefinition): FloeThemePreset {
  const { light, dark, ...preset } = definition;

  return {
    ...preset,
    tokens:
      light || dark
        ? {
            ...(light ? { light: createChartTokenMap(light) } : {}),
            ...(dark ? { dark: createChartTokenMap(dark) } : {}),
          }
        : undefined,
  };
}

export const envChartThemePresets = [
  createChartThemePreset({
    name: 'default',
    displayName: 'Default',
    description: 'Balanced shell colors that stay aligned with the core Floe theme contract.',
  }),
  createChartThemePreset({
    name: 'nord',
    displayName: 'Nord',
    description: 'Cool, low-fatigue accents for infrastructure and monitoring views.',
    light: ['#5e81ac', '#88c0d0', '#a3be8c', '#ebcb8b', '#b48ead'],
    dark: ['#5e81ac', '#88c0d0', '#a3be8c', '#ebcb8b', '#b48ead'],
  }),
  createChartThemePreset({
    name: 'everforest',
    displayName: 'Everforest',
    description: 'Natural chart accents that stay comfortable during longer debugging sessions.',
    light: ['#3a94c5', '#35a77c', '#8da101', '#dfa000', '#df69ba'],
    dark: ['#7fbbb3', '#83c092', '#a7c080', '#dbbc7f', '#d699b6'],
  }),
  createChartThemePreset({
    name: 'tokyo-night',
    displayName: 'Tokyo Night',
    description: 'Sharper telemetry colors for darker, command-center style layouts.',
    light: ['#2959aa', '#0f4b6e', '#33635c', '#8f5e15', '#5a3e8e'],
    dark: ['#7aa2f7', '#7dcfff', '#73daca', '#e0af68', '#bb9af7'],
  }),
] as const satisfies readonly FloeThemePreset[];
