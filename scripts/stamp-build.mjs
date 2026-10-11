// node scripts/stamp-build.mjs          → write the new build stamp (run before every commit)
// node scripts/stamp-build.mjs --check  → exit 1 if the stamp is stale
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = createRequire(import.meta.url)('./stamp-lib.cjs');

if (process.argv.includes('--check')) {
  const s = lib.stampState(root);
  console.log(s.ok ? 'build stamp OK (' + s.want + ')' : 'STALE: ' + s.reason);
  process.exit(s.ok ? 0 : 1);
}
console.log('stamped build ' + lib.stamp(root));
