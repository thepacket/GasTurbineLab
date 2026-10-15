// Detect stale source claims when catalogue inputs change; no network access.
import { build } from 'vite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const outDir = await mkdtemp(join(tmpdir(), 'gtl-provenance-'));
try {
  await build({ configFile: false, logLevel: 'error', build: { ssr: resolve('src/engine/engines.ts'), outDir, rollupOptions: { output: { entryFileNames: 'engines.mjs' } } } });
  const { ENGINES } = await import(pathToFileURL(join(outDir, 'engines.mjs')).href);
  const ledger = JSON.parse(await readFile('reference/catalogue-provenance.json', 'utf8'));
  assert.deepEqual(ledger.entries.map(e => e.name), ENGINES.map(e => e.name));
  for (const spec of ENGINES) {
    const entry = ledger.entries.find(e => e.name === spec.name);
    const numeric = Object.fromEntries(Object.entries(spec).filter(([, value]) => typeof value === 'number'));
    assert.deepEqual(entry.catalogueInputs, numeric, `${spec.name}: refresh provenance after changing inputs`);
    assert.deepEqual([...Object.keys(entry.verifiedFields), ...entry.unverifiedFields].sort(), Object.keys(numeric).sort(), `${spec.name}: every field needs a status`);
    for (const claim of Object.values(entry.verifiedFields)) {
      assert.ok(claim.url || ledger.sources[claim.source]);
      assert.ok(claim.locator || claim.row);
    }
  }
  console.log(`Provenance inventory covers ${ENGINES.length} entries; unresolved fields remain explicitly marked.`);
} finally { await rm(outDir, { recursive: true, force: true }); }
