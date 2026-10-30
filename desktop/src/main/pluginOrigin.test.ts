import { expect, it } from 'vitest';
import { isGatewayApplicationHostname } from './pluginOrigin';

it('confines application routing to one Runtime and exact opaque plugin names', () => {
  const parent = `r-${'a'.repeat(40)}.redeven.invalid`;
  expect(isGatewayApplicationHostname(parent, parent)).toBe(true);
  expect(isGatewayApplicationHostname(parent, `${'b'.repeat(48)}.${parent}`)).toBe(true);
  for (const host of [`other.${parent}`, `${'b'.repeat(47)}.${parent}`, `${'B'.repeat(48)}.${parent}`, `nested.${'b'.repeat(48)}.${parent}`, `${'b'.repeat(48)}.${parent}.`, `${'b'.repeat(48)}.r-${'c'.repeat(40)}.redeven.invalid`]) {
    expect(isGatewayApplicationHostname(parent, host)).toBe(false);
  }
});
