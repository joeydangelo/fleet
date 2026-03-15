import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/** Create a unique temporary directory for tests. Optionally creates a .fleet/ subdirectory. */
export function makeTempDir(opts?: { withFleetDir?: boolean }): string {
  const dir = resolve(tmpdir(), `fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  if (opts?.withFleetDir) {
    mkdirSync(resolve(dir, '.fleet'), { recursive: true });
  }
  return dir;
}
