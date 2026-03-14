import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Returns the package version string from package.json. */
export function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}
