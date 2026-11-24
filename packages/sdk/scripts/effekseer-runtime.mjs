import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const vendored = resolve(dirname(fileURLToPath(import.meta.url)), '../../../third_party/effekseer');

/** The vendored wasm the game serves; `@gm/sdk/vfx/effekseer.wasm` in the package. */
export const EFFEKSEER_WASM = resolve(vendored, 'effekseer.wasm');

/**
 * Resolves `effekseer-runtime` to the vendored Effekseer for WebGL script. The script is a classic script that defines
 * a global `effekseer`; exporting it from a module keeps the runtime out of the page until a scene imports it. Its
 * Node-only branches call `require('fs')`; shadowing `require` and `module` keeps the bundler from following them.
 */
/**
 * Names the sloppy-mode script assigns without declaring. A module is strict, where those writes throw, so the wrapper
 * declares them. src/vfx/runtime-wrapper.test.ts fails when an upgrade leaks a new one.
 */
export const IMPLICIT_GLOBALS = ['exports', 'moduleOrPromise', 'setImmediate', 'splitted_path', 'upvecVector'];

export const effekseerRuntime = {
  name: 'effekseer-runtime',
  setup(build) {
    build.onResolve({ filter: /^effekseer-runtime$/ }, () => ({ path: resolve(vendored, 'effekseer.min.js'), namespace: 'effekseer' }));
    build.onLoad({ filter: /.*/, namespace: 'effekseer' }, ({ path }) => ({
      contents: `const effekseer = (() => {\nlet require, module, ${IMPLICIT_GLOBALS.join(', ')};\n${readFileSync(path, 'utf8')}\nreturn effekseer;\n})();\nexport default effekseer;\n`,
      loader: 'js',
    }));
  },
};
