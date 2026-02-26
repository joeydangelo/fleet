import { Command } from 'commander';
import { resolveMainRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readNudge, clearNudge } from '../lib/health.js';

export function inboxCommand(): Command {
  return new Command('inbox')
    .description('Check for orchestrator messages (called by hooks)')
    .action(() => {
      try {
        const cwd = process.cwd();
        const taskName = detectTaskName(cwd);
        if (!taskName) return;
        const mainRoot = resolveMainRoot(cwd);
        const nudge = readNudge(mainRoot, taskName);
        if (nudge) {
          console.log(`\n[paw] Message from orchestrator:\n${nudge}\n`);
          clearNudge(mainRoot, taskName);
        }
      } catch {
        // Hooks must not crash the agent — swallow all errors
      }
    });
}
