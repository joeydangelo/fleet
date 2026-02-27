import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/** Create a unique temporary directory for tests. Optionally creates a .paw/ subdirectory. */
export function makeTempDir(opts?: { withPawDir?: boolean }): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  if (opts?.withPawDir) {
    mkdirSync(resolve(dir, '.paw'), { recursive: true });
  }
  return dir;
}
