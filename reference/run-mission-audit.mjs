import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const outDir = await mkdtemp(join(tmpdir(), 'gtl-mission-audit-'));
try {
  await build({ configFile: false, logLevel: 'error', build: { ssr: resolve('reference/mission_audit.ts'), outDir, rollupOptions: { output: { entryFileNames: 'audit.mjs' } } } });
  const { auditMissions } = await import(pathToFileURL(join(outDir, 'audit.mjs')).href);
  process.stdout.write(JSON.stringify(auditMissions(), null, 2) + '\n');
} finally { await rm(outDir, { recursive: true, force: true }); }
