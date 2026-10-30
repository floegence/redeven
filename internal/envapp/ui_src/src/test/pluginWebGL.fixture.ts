import type { PluginBridgeClient } from '@floegence/redevplugin-ui/plugin';

// The application owns DOM and drawing. The bridge carries business data only.
export async function renderNativeWebGL(stage: HTMLElement, bridge: Pick<PluginBridgeClient, 'ready' | 'call'>): Promise<void> {
  await bridge.ready();
  const samples: Record<string, number[]> = {};
  for (const kind of ['webgl', 'webgl2'] as const) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    stage.append(canvas);
    const gl = kind === 'webgl'
      ? canvas.getContext('webgl', { preserveDrawingBuffer: true })
      : canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) throw new Error(kind + ' context unavailable');
    gl.clearColor(kind === 'webgl' ? 1 : 0, kind === 'webgl2' ? 1 : 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (gl.getError() !== gl.NO_ERROR) throw new Error(kind + ' rendering failed');
    samples[kind] = [...pixel];
  }
  await bridge.call('webgl.report', { samples });
}
