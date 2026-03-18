/**
 * Worker script for sync concurrency tests.
 * Spawned as a child process — each instance simulates one agent.
 *
 * Usage: tsx tests/helpers/sync-worker.ts <repoDir> <taskName> <operation>
 *   operation: "claim" | "lastcheck" | "write-state" | "write-file"
 *
 * Exits 0 on success, 1 on failure. Prints JSON result to stdout.
 */
import {
  claimTaskAtomic,
  updateLastCheck,
  writeSyncState,
  readSyncState,
  writeSyncFile,
} from '../../src/lib/sync.js';

const [, , repoDir, taskName, operation] = process.argv;

if (!repoDir || !taskName || !operation) {
  console.error('Usage: sync-worker.ts <repoDir> <taskName> <operation>');
  process.exit(2);
}

try {
  switch (operation) {
    case 'claim':
      claimTaskAtomic(taskName, repoDir);
      break;
    case 'lastcheck':
      updateLastCheck(taskName, repoDir);
      break;
    case 'write-state': {
      const state = readSyncState(repoDir);
      if (state) writeSyncState(state, repoDir);
      break;
    }
    case 'write-file':
      writeSyncFile(`agent-${taskName}.txt`, `hello from ${taskName}\n`, repoDir);
      break;
    default:
      console.error(`Unknown operation: ${operation}`);
      process.exit(2);
  }
  console.log(JSON.stringify({ ok: true, task: taskName, operation }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ ok: false, task: taskName, operation, error: message }));
  process.exit(1);
}
