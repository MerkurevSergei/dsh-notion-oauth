// Build:
//   host   src/index.ts        -> lib/index.js   (ESM; @deepseek-ai/* + commander left external)
//   client src/client/index.ts -> lib/client.js  (CJS bundle wrapped in the web GUI's
//                                                 __ModuleLoader__ closure-factory contract;
//                                                 react / react/jsx-runtime come from the injected require)
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** Host runtime imports left to the profile / app runtime. */
const HOST_EXTERNAL = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/cordis',
  'commander',
];

/** Browser externals resolved through the loader's injected require. */
const CLIENT_EXTERNAL = ['react', 'react/jsx-runtime'];

// ---------------------------------------------------------------- host half
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'inline',
  external: HOST_EXTERNAL,
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
});

// ------------------------------------------------------------- browser half
const result = await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: CLIENT_EXTERNAL,
  write: false,
});

const bundleText = result.outputFiles[0].text;
const wrapper = `window.__ModuleLoader__.load({
\tid: "dsh-notion-oauth",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${indent(bundleText, 2)}
\t\treturn module.exports;
\t}
});
`;

writeFileSync('lib/client.js', wrapper);
console.log('built lib/index.js (ESM host) + lib/client.js (__ModuleLoader__ wrapper)');

/** Indent every line so the wrapper stays readable. */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n');
}
