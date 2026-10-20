import { PluginBridgeClient, type PluginUIVNode } from '@floegence/redevplugin-ui/plugin';

// Plugin-author code only: the published SDK owns the sandbox and canvas transfer.
const bridge = new PluginBridgeClient();
const samples: Record<string, number[]> = {};
let initialized = false;

bridge.onLifecycle(async (event) => {
  if (initialized && (event.type === 'visible' || event.type === 'hidden')) {
    await bridge.call('webgl.report', { phase: event.type });
  }
});

void (async () => {
  try {
    await bridge.ready();
    await bridge.render({ type: 'element', key: 'root', tag: 'main', children:
      ['webgl', 'webgl2'].map((id): PluginUIVNode => ({
        type: 'element', key: id, tag: 'canvas',
        attributes: { width: 32, height: 32, 'data-redevplugin-canvas': id }, children: [],
      })),
    });
    for (const id of ['webgl', 'webgl2'] as const) {
      const { canvas } = await bridge.openCanvas(id);
      canvas.width = 32;
      canvas.height = 32;
      const gl = canvas.getContext(id, { preserveDrawingBuffer: true }) as WebGLRenderingContext | WebGL2RenderingContext | null;
      if (!gl) throw new Error(`${id} context unavailable`);
      gl.clearColor(id === 'webgl' ? 1 : 0, id === 'webgl2' ? 1 : 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (gl.getError() !== gl.NO_ERROR) throw new Error(`${id} rendering failed`);
      samples[id] = [...pixel];
    }
    initialized = true;
    await bridge.call('webgl.report', { phase: 'rendered', samples });
  } catch (error) {
    await bridge.call('webgl.report', { phase: 'failed', message: String(error) });
  }
})();
