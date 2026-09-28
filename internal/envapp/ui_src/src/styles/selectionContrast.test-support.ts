import { expect } from 'vitest';

// Resolve layered product surfaces before measuring visible text and selection.
function selectionColors() {
  const canvas = document.createElement('canvas').getContext('2d')!;
  const rgba = (color: string): number[] => {
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = color;
    canvas.fillRect(0, 0, 1, 1);
    return [...canvas.getImageData(0, 0, 1, 1).data];
  };
  const mix = (front: number[], back: number[]): number[] => front.slice(0, 3)
    .map((value, index) => value * front[3] / 255 + back[index] * (1 - front[3] / 255));
  const background = (node: HTMLElement | null): number[] => node
    ? mix(rgba(getComputedStyle(node).backgroundColor), background(node.parentElement))
    : [255, 255, 255];
  const luminance = (rgb: number[]): number => rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first: number[], second: number[]): number => {
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  return { rgba, mix, background, contrast };
}

export function expectClearSelection(element: HTMLElement, context: string) {
  const { rgba, mix, background, contrast } = selectionColors();
  const face = background(element);
  const label = `${context}: ${element.textContent}`;
  expect.soft(contrast(mix(rgba(getComputedStyle(element).color), face), face), `${label} text`).toBeGreaterThanOrEqual(4.5);
  expect.soft(contrast(face, background(element.parentElement)), `${label} face`).toBeGreaterThanOrEqual(3);
}

export function expectClearRadioSelection(element: HTMLElement, indicator: HTMLElement, context: string) {
  const { rgba, mix, background, contrast } = selectionColors();
  const face = background(element);
  const label = `${context}: ${element.textContent}`;
  const ring = getComputedStyle(indicator);
  const dot = getComputedStyle(indicator, '::after');
  expect(element.getAttribute('role')).toBe('radio');
  expect(element.getAttribute('aria-checked')).toBe('true');
  expect.soft(contrast(mix(rgba(getComputedStyle(element).color), face), face), `${label} text`).toBeGreaterThanOrEqual(4.5);
  expect(indicator.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(indicator.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(ring.visibility).toBe('visible');
  expect(Number(ring.opacity)).toBeGreaterThan(0);
  expect(parseFloat(ring.borderTopWidth)).toBeGreaterThan(0);
  expect(ring.borderTopStyle).toBe('solid');
  expect.soft(contrast(mix(rgba(ring.borderTopColor), face), face), `${label} radio ring`).toBeGreaterThanOrEqual(3);
  expect(dot.content).toBe('""');
  expect(dot.display).not.toBe('none');
  expect(dot.visibility).toBe('visible');
  expect(Number(dot.opacity)).toBeGreaterThan(0);
  expect(parseFloat(dot.width)).toBeGreaterThan(0);
  expect(parseFloat(dot.height)).toBeGreaterThan(0);
  const inside = background(indicator);
  expect.soft(contrast(mix(rgba(dot.backgroundColor), inside), inside), `${label} checked mark`).toBeGreaterThanOrEqual(3);
}
