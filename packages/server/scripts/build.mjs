// Bundles the server into dist/index.js. Workspace packages (@keke/*) ship as TypeScript
// source, so they are bundled in; npm dependencies stay external and load from node_modules.
// The Tiled maps are copied to dist/maps so the built server is self-contained (src/maps.ts looks there first).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
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

const mapsSrc = new URL('../../../maps/', import.meta.url);
const mapsOut = new URL('../dist/maps/', import.meta.url);
mkdirSync(mapsOut, { recursive: true });
for (const file of readdirSync(mapsSrc).filter((f) => f.endsWith('.tmj'))) {
  copyFileSync(new URL(file, mapsSrc), new URL(file, mapsOut));
  console.log(`  dist/maps/${file}`);
}
