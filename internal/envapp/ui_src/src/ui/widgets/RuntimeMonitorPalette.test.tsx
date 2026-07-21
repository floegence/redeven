// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MonitoringChart } from '@floegence/floe-webapp-core/ui';

const SERIES_COLOR = 'var(--redeven-runtime-monitor-cpu-line)';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('Runtime monitor chart paint ownership', () => {
  it('keeps the semantic series color undimmed on lines and tooltip points while area remains translucent', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
      configurable: true,
      value: () => ({ inverse: () => ({}) }),
    });
    Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        },
      }),
    });
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
      configurable: true,
      value: () => 80,
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(() => (
      <MonitoringChart
        series={[{ name: 'CPU', data: [20, 35, 50], color: SERIES_COLOR }]}
        labels={['10:00', '10:01', '10:02']}
        height={140}
        showLegend={false}
      />
    ), host);

    const line = host.querySelector<SVGPathElement>('.chart-line');
    const area = host.querySelector<SVGPathElement>('.chart-area');
    const stops = [...host.querySelectorAll<SVGStopElement>('linearGradient stop')];
    expect(line?.getAttribute('stroke')).toBe(SERIES_COLOR);
    expect(line?.getAttribute('opacity')).toBeNull();
    expect(area?.getAttribute('fill')).toMatch(/^url\(#gradient-/u);
    expect(stops.map((stop) => stop.style.getPropertyValue('stop-color'))).toEqual([SERIES_COLOR, SERIES_COLOR]);
    expect(stops.map((stop) => stop.style.getPropertyValue('stop-opacity'))).toEqual(['0.4', '0.05']);

    host.querySelector<SVGSVGElement>('.chart-svg')?.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 200,
      clientY: 60,
    }));
    await Promise.resolve();

    expect(host.querySelector<SVGCircleElement>('.chart-crosshair-point')?.getAttribute('fill')).toBe(SERIES_COLOR);
    expect(host.querySelector<SVGTextElement>('.chart-tooltip-value')?.parentElement
      ?.querySelector<SVGCircleElement>('circle')
      ?.getAttribute('fill')).toBe(SERIES_COLOR);
  });
});
