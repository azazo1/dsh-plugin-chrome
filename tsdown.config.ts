/**
 * dsh-plugin-chrome build faces.
 *
 * Two artifacts share one lib/ directory (neither face cleans it):
 *   - host half:  ESM bundle lib/index.js for the cordis Loader (Node).
 *     Production dependencies (puppeteer-core, ws, schemastery) and
 *     @deepseek-ai peer packages stay imports — the real install provides
 *     them; everything else inlines.
 *   - client half: CJS bundle lib/client.js wrapped in the official
 *     `window.__ModuleLoader__.load({ id, factory })` closure the browser
 *     module table materializes. React ships through the loader module
 *     table (external); every other dependency inlines.
 *
 * TS declarations are emitted separately by the two tsc programs into
 * lib/types (see scripts/build.mjs).
 */
import { isBuiltin } from 'node:module'
import { defineConfig } from 'tsdown'

const ID = 'dsh-plugin-chrome'

/** Host-half externals: everything the real install or the DSH loader provides. */
const HOST_EXTERNALS = [
  'puppeteer-core',
  'ws',
  'schemastery',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-attachment',
]

/** Client-half externals: browser module-table rows (react + jsx runtime). */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

const matches = (specifier: string, names: readonly string[]): boolean =>
  names.some((name) => specifier === name || specifier.startsWith(`${name}/`))

export default defineConfig([
  {
    name: ID,
    entry: ['src/host/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    fixedExtension: false,
    sourcemap: true,
    deps: {
      neverBundle: (specifier) => matches(specifier, HOST_EXTERNALS),
      alwaysBundle: (specifier) => !isBuiltin(specifier) && !matches(specifier, HOST_EXTERNALS),
    },
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    // Browser bundle lands next to the host half (single lib/ artifact dir).
    // clean must stay off — a default clean would wipe the host-half output.
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: (specifier) => matches(specifier, CLIENT_EXTERNALS),
      alwaysBundle: (specifier) => !matches(specifier, CLIENT_EXTERNALS),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
