import { Command } from 'commander';
import { resolveMainRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { writeHeartbeat } from '../lib/health.js';

export function heartbeatCommand(): Command {
  return new Command('heartbeat')
    .description('Record agent activity (called by hooks)')
    .action(() => {
      try {
        const cwd = process.cwd();
        const taskName = detectTaskName(cwd);
        if (!taskName) return; // not in a paw worktree — exit silently
        const mainRoot = resolveMainRoot(cwd);
        writeHeartbeat(mainRoot, taskName);
      } catch {
        // Hooks must not crash the agent — swallow all errors
      }
    });
}
