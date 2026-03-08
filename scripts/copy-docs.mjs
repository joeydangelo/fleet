import { cpSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'src', 'docs');
const dest = resolve(root, 'dist', 'docs');

if (!existsSync(src)) {
  console.error('src/docs/ not found, skipping copy');
  process.exit(0);
}

cpSync(src, dest, { recursive: true });
console.log('Copied src/docs/ → dist/docs/');

const skillsSrc = resolve(root, 'skills');
const skillsDest = resolve(root, 'dist', 'skills');

if (existsSync(skillsSrc)) {
  cpSync(skillsSrc, skillsDest, { recursive: true });
  console.log('Copied skills/ → dist/skills/');
}
