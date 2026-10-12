import { describe, expect, it } from 'vitest';
import {
  runtimeFlowerPath,
  runtimeFlowerMethodAllowed,
} from './runtimeFlowerRoutes';
const base = '/_redeven_proxy/api/tessiven';
describe('Tessiven Desktop request authority', () => {
  it('allows exact canvas and version routes through the existing local adapter', () => {
    for (const path of [
      `${base}/schema`,
      `${base}/presentation-contract`,
      `${base}/canvases/canvas/versions/latest/presentation?format=redeven.io%2Ftessiven-presentation%2Fv1&capabilities=group_layouts`,
      `${base}/schema?version=v1`,
      `${base}/schema?version=v1.0.0`,
      `${base}/events`,
      `${base}/canvases?query=commerce&archived=false`,
      `${base}/canvases/canvas/versions/12`,
    ]) {
      expect(runtimeFlowerPath(path)).toBe(path);
      expect(runtimeFlowerMethodAllowed(path, 'GET')).toBe(true);
    }
    expect(runtimeFlowerMethodAllowed(`${base}/resources`, 'POST')).toBe(true);
    expect(runtimeFlowerMethodAllowed(`${base}/canvases`, 'POST')).toBe(true);
    expect(runtimeFlowerMethodAllowed(`${base}/canvases/c/versions`, 'POST')).toBe(false);
    for (const action of ['rename', 'duplicate', 'restore']) {
      expect(() => runtimeFlowerPath(`${base}/canvases/c/${action}`)).toThrow();
    }
  });
  it('rejects alternate authorities and arbitrary methods or queries', () => {
    for (const path of [
      `https://attacker.example${base}/schema`,
      `${base}/events?target=remote`,
      `${base}/schema?version=`,
      `${base}/schema?version=v1&version=v1.0.0`,
      `${base}/schema?version=v1&target=remote`,
      `${base}/schema?version=${"x".repeat(65)}`,
      `${base}/canvases?archived=true&archived=false`,
      `${base}/canvases/c/versions/0`,
      `${base}/host`,
      `${base}/presentation-contract?target=remote`,
      `${base}/canvases/c/versions/1/presentation?format=v1&target=remote`,
      `${base}/canvases/c/versions/1/presentation?format=v1&format=v2`,
      `${base}/canvases/c/versions/1/presentation?format=v1&capabilities=group_layouts,group_layouts`,
    ])
      expect(() => runtimeFlowerPath(path)).toThrow();
    expect(runtimeFlowerMethodAllowed(`${base}/schema`, 'POST')).toBe(false);
    expect(runtimeFlowerMethodAllowed(`${base}/resources`, 'DELETE')).toBe(
      false,
    );
  });
});
