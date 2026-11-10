// Bundles the server into dist/index.js. Workspace packages (@keke/*) ship as TypeScript
// source, so they are bundled in; npm dependencies stay external and load from node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'external-npm-deps',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@keke/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
