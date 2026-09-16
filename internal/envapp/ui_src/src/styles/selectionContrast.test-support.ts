import { expect } from 'vitest';

// Resolve layered product surfaces before measuring the visible selected face.
export function expectClearSelection(element: HTMLElement, context: string) {
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
  const face = background(element);
  const label = `${context}: ${element.textContent}`;
  expect.soft(contrast(mix(rgba(getComputedStyle(element).color), face), face), `${label} text`).toBeGreaterThanOrEqual(4.5);
  expect.soft(contrast(face, background(element.parentElement)), `${label} face`).toBeGreaterThanOrEqual(3);
}
