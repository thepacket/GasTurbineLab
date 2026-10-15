// Preserve notices in the static distribution; no UI or network access required.
import { readFile, writeFile, readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const packages = ['react', 'react-dom', 'scheduler', 'three',
  ...(await readdir(new URL('node_modules/', root))).filter(name => name.startsWith('workbox-')).sort()];
const sections = [await read('THIRD_PARTY_NOTICES.md'), await read('licenses/pycycle-LICENSE.txt'), await read('licenses/Apache-2.0.txt')];
for (const name of packages) {
  const metadata = JSON.parse(await read(`node_modules/${name}/package.json`));
  const files = await readdir(new URL(`node_modules/${name}/`, root));
  const license = files.find(file => /^licen[cs]e(?:\.(?:txt|md))?$/i.test(file));
  if (!license) throw new Error(`Missing license text for ${name}; review before distribution.`);
  sections.push(`${name} ${metadata.version}\n${await read(`node_modules/${name}/${license}`)}`);
}
await writeFile(new URL('public/LICENSE.txt', root), await read('LICENSE'));
await writeFile(new URL('public/THIRD_PARTY_NOTICES.txt', root), sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
console.log(`Included project, pyCycle and ${packages.length} dependency license notices.`);
