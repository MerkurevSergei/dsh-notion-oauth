// Build: esbuild host (src/index.ts -> lib/index.js) + client (src/client/index.ts -> lib/client.js).
import { build } from 'esbuild';

async function run() {
  // Host half: Node ESM, peer deps left external.
  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: false,
    external: [
      '@deepseek-ai/schemastery',
      '@deepseek-ai/dsh-cmdline',
      '@deepseek-ai/dsh-mcp-client',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/cordis',
      'commander',
    ],
  });

  // Browser half: bundled, react + client runtime peers left external.
  await build({
    entryPoints: ['src/client/index.ts'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    jsx: 'automatic',
    external: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-settings/client',
    ],
  });

  console.log('built lib/index.js + lib/client.js');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
