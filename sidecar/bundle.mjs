import { build } from 'esbuild';
import { writeFileSync, chmodSync, copyFileSync, mkdirSync } from 'fs';

// Compile + bundle TypeScript directly into CJS
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'binaries/scraper.cjs',
  external: ['playwright-core'],
});

console.log('esbuild bundle OK');

// Create launcher script
const script = `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$(cd "$DIR/../../sidecar" && pwd)"
NODE_PATH="$SIDECAR_DIR/node_modules" exec node "$DIR/scraper.cjs"
`;
writeFileSync('binaries/scraper', script);
chmodSync('binaries/scraper', 0o755);

console.log('launcher script OK');
