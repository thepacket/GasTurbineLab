import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const outDir = await mkdtemp(join(tmpdir(), 'gtl-estimate-audit-'));
try {
  await build({ configFile: false, logLevel: 'error', build: { ssr: resolve('reference/estimate_audit.ts'), outDir, rollupOptions: { output: { entryFileNames: 'audit.mjs' } } } });
  const { auditEstimates } = await import(pathToFileURL(join(outDir, 'audit.mjs')).href);
  process.stdout.write(JSON.stringify(auditEstimates(), null, 2) + '\n');
} finally { await rm(outDir, { recursive: true, force: true }); }
