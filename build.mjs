import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const BASE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

const clientExternals = [...BASE_EXTERNALS, ...(pkg.dsh?.client?.external ?? [])]

// The client bundle must register under the plugin's stable module ID, NOT the
// npm package name: dsh expects the id used in cordis.patch.yml (`name: dsh-skill-manage`).
// Keep this in sync if the patch name ever changes.
const CLIENT_MODULE_ID = 'dsh-skill-manage'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
})

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: clientExternals,
  sourcemap: true,
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_MODULE_ID)}, factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: '\nreturn module.exports; } });',
  },
})

console.log('built lib/index.js + lib/client.js')
