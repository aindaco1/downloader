import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only reproducible project output. Keep source, installed dependencies, and
// the user's separately installed extension or normal browser profiles.
const output = ['extension/', 'test-results/', 'tests/fixtures/', 'coverage/', 'dist/', 'playwright-report/', 'blob-report/'];
for (const directory of output) await rm(fileURLToPath(new URL(`../${directory}`, import.meta.url)), { recursive: true, force: true });
console.log('Removed generated builds, fixtures, and disposable test data.');
