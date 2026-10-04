import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
await rm(path.join(root, 'extension'), { recursive: true, force: true });
await mkdir(path.join(root, 'extension'), { recursive: true });
await cp(path.join(root, 'static'), path.join(root, 'extension'), { recursive: true });
const options = { absWorkingDir: root, bundle: true, minify: true, target: 'chrome125', platform: 'browser', legalComments: 'eof', logLevel: 'info' };
await build({ ...options, entryPoints: ['src/background.js', 'src/popup.js', 'src/offscreen.js'], outdir: 'extension', format: 'esm', splitting: true, chunkNames: 'chunks/[name]-[hash]' });
for (const entry of ['content', 'page']) await build({ ...options, entryPoints: [`src/${entry}.js`], outfile: `extension/${entry}.js`, format: 'iife' });
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
manifest.key = (await readFile(path.join(root, 'extension-key.txt'), 'utf8')).trim();
await writeFile(path.join(root, 'extension/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const notices = ['Dust Wave Downloader — third-party notices\n\nMediabunny is unmodified MPL-2.0 code. Its corresponding source is included in the distribution under third-party-source/. Other dependency source is also included there.'];
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory || pkg.dev || directory.includes('/@types/')) continue;
  let license;
  for (const filename of ['LICENSE', 'LICENCE', 'LICENSE.md']) {
    try { license = await readFile(path.join(root, directory, filename), 'utf8'); break; } catch { /* Try alternate spelling. */ }
  }
  if (!license) throw new Error(`Missing dependency license: ${directory}`);
  notices.push(`${directory.replace('node_modules/', '')} ${pkg.version}\n\n${license}`);
}
await writeFile(path.join(root, 'extension/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n----------------------------------------\n\n'));
