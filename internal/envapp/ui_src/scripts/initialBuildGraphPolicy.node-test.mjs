import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeInitialBuildGraph } from './initialBuildGraphPolicy.mjs';

const entry = (file, options = {}) => ({ file, isEntry: true, ...options });
const chunk = (modules) => ({ modules });

test('allows the lightweight sessions facade while ignoring dynamic terminal imports', () => {
  const result = analyzeInitialBuildGraph({
    'index.html': entry('assets/index.js', {
      imports: ['sessions.ts'],
      dynamicImports: ['terminal.ts'],
      css: ['assets/index.css'],
    }),
    'sessions.ts': { file: 'assets/sessions.js' },
    'terminal.ts': { file: 'assets/terminal.js' },
  }, {
    chunks: {
      'assets/index.js': chunk(['src/index.ts']),
      'assets/sessions.js': chunk([
        '@floegence/floeterm-terminal-web/dist/entries/sessions.js',
        '@floegence/floeterm-terminal-web/dist/sessions/TerminalSessionsCoordinator.js',
        '@floegence/floeterm-terminal-web/dist/utils/logger.js',
      ]),
      'assets/terminal.js': chunk([
        '@floegence/floeterm-terminal-web/dist/core/TerminalCore.js',
        'ghostty-web/dist/index.js',
      ]),
    },
  });

  assert.deepEqual(result.javascriptAssets.sort(), ['assets/index.js', 'assets/sessions.js']);
  assert.deepEqual(result.cssAssets, ['assets/index.css']);
  assert.deepEqual(result.forbiddenModules, []);
});

test('rejects terminal runtime modules hidden in a static shared chunk', () => {
  const result = analyzeInitialBuildGraph({
    'index.html': entry('assets/index.js', { imports: ['shared.ts'] }),
    'shared.ts': { file: 'assets/dist-a1.js', imports: ['index.html'] },
  }, {
    chunks: {
      'assets/index.js': chunk(['src/index.ts']),
      'assets/dist-a1.js': chunk([
        '@floegence/floeterm-terminal-web/dist/index.js',
        '@beamterm/renderer/dist/index.js',
        'ghostty-web/dist/index.js',
      ]),
    },
  });

  assert.equal(result.javascriptAssets.length, 2);
  assert.deepEqual(result.forbiddenModules.map((item) => item.moduleId), [
    '@floegence/floeterm-terminal-web/dist/index.js',
    '@beamterm/renderer/dist/index.js',
    'ghostty-web/dist/index.js',
  ]);
  assert.deepEqual(result.forbiddenModules[0]?.path, ['assets/index.js', 'assets/dist-a1.js']);
});

test('fails closed when a static manifest edge is missing', () => {
  assert.throws(() => analyzeInitialBuildGraph({
    'index.html': entry('assets/index.js', { imports: ['missing.ts'] }),
  }, {
    chunks: { 'assets/index.js': chunk(['src/index.ts']) },
  }), /manifest import is missing/u);
});
